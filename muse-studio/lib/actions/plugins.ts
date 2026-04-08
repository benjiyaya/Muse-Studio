'use server';

import { createHash } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import type { PluginHook, PluginManifest, PluginService, UIExtension } from '@/lib/plugin-extension/manifest';
import { isMuseApiCompatible, isWithinMuseVersionRange, parsePluginManifest } from '@/lib/plugin-extension/manifest';

import { HOST_MUSE_API_VERSION, HOST_MUSE_VERSION, type PluginSummary } from '@/lib/plugin-extension/plugin-types';
import { normalizePluginBaseUrl, parseMcpServersConfig } from '@/lib/mcp-extensions/mcpConfig';
import {
  inferMuseCapabilityForMcpTool,
  isAuxiliaryMcpTool,
  mcpCallToolJson,
  mcpListToolNames,
  mcpListToolsMeta,
  resolveMcpEndpointUrl,
  withMcpClient,
} from '@/lib/mcp-extensions/mcpStreamableClient';

export interface PluginCapabilityProvider {
  id: string;
  name: string;
  version: string;
  capability: string;
  method: string;
  path: string;
}

interface PluginsRow {
  id: string;
  name: string;
  version: string;
  enabled: number;
  status: string;
  updated_at: string;
  manifest_json: string;
  source_url: string;
  repo: string | null;
  branch_or_tag: string | null;
  installed_at: string;
  last_error: string | null;
}

interface PluginEndpointRow {
  plugin_id: string;
  base_url: string;
  auth_type: string;
  auth_ref: string | null;
  health_status: string;
  last_health_at: string | null;
}

interface PluginHookRow {
  plugin_id: string;
  capability: string;
  method: string;
  path: string;
  permissions_json: string | null;
  enabled: number;
  mcp_policy?: string | null;
  created_at: string;
  updated_at: string;
}

interface PluginUiExtensionRow {
  plugin_id: string;
  slot: string;
  bundle_url: string;
  integrity_hash: string | null;
  permissions_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function revalidatePluginPaths(): void {
  revalidatePath('/settings/plugins');
  revalidatePath('/settings/extensions');
  revalidatePath('/settings/mcp-extensions');
  revalidatePath('/mcp-extensions');
}

function pluginEnvBearerTokenKey(pluginId: string): string {
  const safe = pluginId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  return `MUSE_PLUGIN_BEARER_TOKEN_${safe}`;
}

function resolveAuthRef(pluginId: string, authType: string, authRef: string | null): string | null {
  if (authRef) return authRef;
  if (authType === 'bearer') {
    return process.env[pluginEnvBearerTokenKey(pluginId)] ?? null;
  }
  return null;
}

function normalizeBaseUrl(input: string): string {
  return normalizePluginBaseUrl(input);
}

export interface McpExtensionToolDescriptor {
  pluginId: string;
  pluginName: string;
  capability: string;
  method: string;
  path: string;
  /** MCP listTools: human description for this tool name (`path`). */
  mcpDescription?: string;
  /** MCP listTools: JSON Schema for tool arguments. */
  mcpInputSchema?: unknown;
}

export async function installMcpExtensionsFromJson(raw: string): Promise<{
  installed: string[];
  failed: Array<{ serverName: string; error: string }>;
  warnings: string[];
}> {
  const { entries, warnings } = parseMcpServersConfig(raw);
  const installed: string[] = [];
  const failed: Array<{ serverName: string; error: string }> = [];

  for (const e of entries) {
    try {
      const { id } = await installPluginFromLocalUrl({ baseUrl: e.baseUrl });
      installed.push(id);
    } catch (err) {
      failed.push({
        serverName: e.serverName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePluginPaths();
  return { installed, failed, warnings };
}

type McpExtensionToolQueryRow = {
  plugin_id: string;
  name: string;
  capability: string;
  method: string;
  path: string;
  base_url: string | null;
  auth_type: string | null;
  auth_ref: string | null;
};

function queryMcpExtensionToolRows(): McpExtensionToolQueryRow[] {
  return db
    .prepare<
      [],
      McpExtensionToolQueryRow
    >(
      `
      SELECT p.id AS plugin_id, p.name, ph.capability, ph.method, ph.path,
             pe.base_url AS base_url, pe.auth_type AS auth_type, pe.auth_ref AS auth_ref
      FROM plugin_hooks ph
      INNER JOIN plugins p ON p.id = ph.plugin_id
      LEFT JOIN plugin_endpoints pe ON pe.plugin_id = p.id
      WHERE ph.enabled = 1 AND p.enabled = 1
      ORDER BY p.name ASC, ph.capability ASC
      `,
    )
    .all();
}

/**
 * Enabled extension hooks from SQLite only (no MCP network I/O).
 * Use for SSR, tool routing, and UI — avoids connecting to MCP servers on every page load.
 */
export async function listMcpExtensionToolsForLlm(): Promise<McpExtensionToolDescriptor[]> {
  const rows = queryMcpExtensionToolRows();
  return rows.map((r) => ({
    pluginId: r.plugin_id,
    pluginName: r.name,
    capability: r.capability,
    method: r.method,
    path: r.path,
  }));
}

/**
 * Same hooks as {@link listMcpExtensionToolsForLlm} plus MCP `listTools` metadata per tool
 * (description + inputSchema). Call only when running the Extensions orchestrator LLM.
 */
export async function listMcpExtensionToolsForOrchestration(): Promise<McpExtensionToolDescriptor[]> {
  const rows = queryMcpExtensionToolRows();

  const metaByPlugin = new Map<
    string,
    Map<string, { description?: string; inputSchema?: unknown }>
  >();

  const mcpEndpoints = new Map<
    string,
    { base_url: string; auth_type: string | null; auth_ref: string | null }
  >();
  for (const r of rows) {
    if (r.method === 'MCP' && r.base_url && !mcpEndpoints.has(r.plugin_id)) {
      mcpEndpoints.set(r.plugin_id, {
        base_url: r.base_url,
        auth_type: r.auth_type,
        auth_ref: r.auth_ref,
      });
    }
  }

  await Promise.all(
    [...mcpEndpoints.entries()].map(async ([pluginId, ep]) => {
      try {
        const authToken =
          ep.auth_type === 'bearer'
            ? resolveAuthRef(pluginId, ep.auth_type, ep.auth_ref)
            : null;
        const tools = await mcpListToolsMeta(ep.base_url, authToken);
        const m = new Map<string, { description?: string; inputSchema?: unknown }>();
        for (const t of tools) {
          if (!t.name) continue;
          m.set(t.name, { description: t.description, inputSchema: t.inputSchema });
        }
        metaByPlugin.set(pluginId, m);
      } catch {
        /* listTools failure: descriptors still work without schemas */
      }
    }),
  );

  return rows.map((r) => {
    const meta = metaByPlugin.get(r.plugin_id)?.get(r.path);
    return {
      pluginId: r.plugin_id,
      pluginName: r.name,
      capability: r.capability,
      method: r.method,
      path: r.path,
      ...(r.method === 'MCP' && meta
        ? { mcpDescription: meta.description, mcpInputSchema: meta.inputSchema }
        : {}),
    };
  });
}

async function fetchWithTimeout(input: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPluginManifestFromLocal(baseUrl: string): Promise<PluginManifest> {
  const manifestPathCandidates = ['/plugin.manifest.json', '/manifest.json', '/.well-known/muse-plugin.manifest.json'];
  for (const p of manifestPathCandidates) {
    const url = new URL(p, `${baseUrl}/`).toString();
    try {
      const res = await fetchWithTimeout(url, { method: 'GET', timeoutMs: 8000 });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      return parsePluginManifest(json);
    } catch {
      continue;
    }
  }
  throw new Error(
    `Could not fetch plugin manifest from ${baseUrl}. Expected one of: ` +
      `${manifestPathCandidates.map((p) => `"${p}"`).join(', ')}.`,
  );
}

async function checkPluginHealthById(pluginId: string): Promise<void> {
  const pluginRow = db
    .prepare<[string], PluginsRow>('SELECT * FROM plugins WHERE id = ?')
    .get(pluginId);
  if (!pluginRow) throw new Error('Plugin not found.');

  const endpointRow = db
    .prepare<[string], PluginEndpointRow>('SELECT * FROM plugin_endpoints WHERE plugin_id = ?')
    .get(pluginId);
  if (!endpointRow) throw new Error('Plugin endpoint not found.');

  let manifestParsed: PluginManifest | null = null;
  try {
    manifestParsed = parsePluginManifest(JSON.parse(pluginRow.manifest_json) as unknown);
  } catch {
    manifestParsed = null;
  }

  /** MCP Streamable HTTP: probe tools/list on stored `…/mcp` endpoint. */
  if (manifestParsed?.mcp?.endpointUrl) {
    let healthStatus = 'unknown';
    try {
      const token =
        endpointRow.auth_type === 'bearer'
          ? resolveAuthRef(pluginId, endpointRow.auth_type, endpointRow.auth_ref)
          : null;
      await mcpListToolNames(manifestParsed.mcp.endpointUrl, token);
      healthStatus = 'healthy';
    } catch {
      healthStatus = 'unhealthy:timeout';
    }
    db.prepare(
      `UPDATE plugin_endpoints
       SET health_status = ?, last_health_at = ?
       WHERE plugin_id = ?`,
    ).run(healthStatus, nowIso(), pluginId);
    return;
  }

  let healthPath = '/health';
  if (manifestParsed?.service?.healthPath) {
    healthPath = manifestParsed.service.healthPath;
  }

  const base = endpointRow.base_url.replace(/\/+$/, '');
  const path = healthPath.startsWith('/') ? healthPath : `/${healthPath}`;
  const url = `${base}${path}`;
  let healthStatus = 'unknown';

  try {
    const token = resolveAuthRef(pluginId, endpointRow.auth_type, endpointRow.auth_ref);
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: 5000,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    healthStatus = res.ok ? 'healthy' : `unhealthy:${res.status}`;
  } catch {
    healthStatus = 'unhealthy:timeout';
  }

  db.prepare(
    `UPDATE plugin_endpoints
     SET health_status = ?, last_health_at = ?
     WHERE plugin_id = ?`,
  ).run(healthStatus, nowIso(), pluginId);
}

export async function listPlugins(): Promise<PluginSummary[]> {
  const rows = db
    .prepare<[], {
      id: string;
      name: string;
      version: string;
      source_url: string;
      enabled: number;
      status: string;
      updated_at: string;
      last_error: string | null;
      health_status: string;
      last_health_at: string | null;
    }>(
      `
      SELECT p.id, p.name, p.version, p.source_url, p.enabled, p.status, p.updated_at, p.last_error,
             e.health_status, e.last_health_at
      FROM plugins p
      LEFT JOIN plugin_endpoints e ON e.plugin_id = p.id
      ORDER BY p.updated_at DESC
      `,
    )
    .all();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    sourceUrl: r.source_url,
    enabled: r.enabled === 1,
    status: r.status,
    healthStatus: r.health_status ?? 'unknown',
    lastHealthAt: r.last_health_at ?? null,
    lastError: r.last_error ?? null,
    updatedAt: r.updated_at,
  }));
}

export async function listEnabledPluginsForCapability(capability: string): Promise<PluginCapabilityProvider[]> {
  const rows = db
    .prepare<
      [string],
      {
        id: string;
        name: string;
        version: string;
        capability: string;
        method: string;
        path: string;
      }
    >(
      `
      SELECT p.id, p.name, p.version, ph.capability, ph.method, ph.path
      FROM plugin_hooks ph
      INNER JOIN plugins p ON p.id = ph.plugin_id
      WHERE ph.capability = ?
        AND ph.enabled = 1
        AND p.enabled = 1
      ORDER BY p.installed_at DESC
      `,
    )
    .all(capability);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    capability: r.capability,
    method: r.method,
    path: r.path,
  }));
}

export async function getPluginDetails(id: string): Promise<{
  plugin: PluginSummary;
  manifest: PluginManifest;
  hooks: Array<PluginHook & { enabled: boolean; permissions: string[] }>;
  uiExtensions: Array<UIExtension & { enabled: boolean; permissions: string[] }>;
  endpoint: PluginService & { authType: string; authRef: string | null };
} | null> {
  const pluginRow = db
    .prepare<[string], PluginsRow>(
      'SELECT * FROM plugins WHERE id = ?',
    )
    .get(id);
  if (!pluginRow) return null;

  const endpointRow = db
    .prepare<[string], PluginEndpointRow>(
      'SELECT * FROM plugin_endpoints WHERE plugin_id = ?',
    )
    .get(id);

  const manifest = parsePluginManifest(JSON.parse(pluginRow.manifest_json) as unknown);

  const hooksRows = db
    .prepare<[string], PluginHookRow>(
      'SELECT * FROM plugin_hooks WHERE plugin_id = ?',
    )
    .all(id);
  const hooks = hooksRows.map((r) => ({
    capability: r.capability,
    method: r.method as PluginHook['method'],
    path: r.path,
    description: undefined,
    enabled: r.enabled === 1,
    permissions: r.permissions_json ? JSON.parse(r.permissions_json) : [],
  }));

  const uiRows = db
    .prepare<[string], PluginUiExtensionRow>(
      'SELECT * FROM plugin_ui_extensions WHERE plugin_id = ?',
    )
    .all(id);
  const uiExtensions = uiRows.map((r) => ({
    slot: r.slot,
    bundleUrl: r.bundle_url,
    integrityHash: r.integrity_hash ?? undefined,
    permissions: r.permissions_json ? JSON.parse(r.permissions_json) : undefined,
    enabled: r.enabled === 1,
  })) as Array<UIExtension & { enabled: boolean; permissions: string[] }>;

  const plugin: PluginSummary = {
    id: pluginRow.id,
    name: pluginRow.name,
    version: pluginRow.version,
    sourceUrl: pluginRow.source_url,
    enabled: pluginRow.enabled === 1,
    status: pluginRow.status,
    healthStatus: endpointRow?.health_status ?? 'unknown',
    lastHealthAt: endpointRow?.last_health_at ?? null,
    lastError: pluginRow.last_error ?? null,
    updatedAt: pluginRow.updated_at,
  };

  const endpoint: PluginService & { authType: string; authRef: string | null } = {
    baseUrl: endpointRow?.base_url ?? manifest.service.baseUrl,
    healthPath: manifest.service.healthPath,
    authScheme: manifest.service.authScheme,
    requiredEnv: manifest.service.requiredEnv,
    authType: endpointRow?.auth_type ?? manifest.service.authScheme ?? 'none',
    authRef: endpointRow?.auth_ref ?? null,
  };

  return { plugin, manifest, hooks, uiExtensions, endpoint };
}

function runPluginInstallTransaction(params: {
  pluginId: string;
  manifest: PluginManifest;
  sourceUrl: string;
  endpointBaseUrl: string;
  authScheme: string;
}): void {
  const { pluginId, manifest, sourceUrl, endpointBaseUrl, authScheme } = params;
  const now = nowIso();
  const enabled = 0;

  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO plugins
        (id, name, version, source_url, repo, branch_or_tag, manifest_json,
         status, enabled, installed_at, updated_at, last_error)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        source_url = excluded.source_url,
        repo = excluded.repo,
        branch_or_tag = excluded.branch_or_tag,
        manifest_json = excluded.manifest_json,
        status = excluded.status,
        enabled = plugins.enabled,
        updated_at = excluded.updated_at,
        last_error = null
      `,
    ).run(
      pluginId,
      manifest.name,
      manifest.version,
      sourceUrl,
      null,
      null,
      JSON.stringify(manifest),
      'installed',
      enabled,
      now,
      now,
      null,
    );

    db.prepare(
      `
      INSERT INTO plugin_endpoints
        (plugin_id, base_url, auth_type, auth_ref, health_status, last_health_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET
        base_url = excluded.base_url,
        auth_type = excluded.auth_type,
        auth_ref = excluded.auth_ref,
        health_status = excluded.health_status,
        last_health_at = excluded.last_health_at
      `,
    ).run(pluginId, endpointBaseUrl, authScheme, null, 'unknown', null);

    db.prepare('DELETE FROM plugin_hooks WHERE plugin_id = ?').run(pluginId);
    db.prepare('DELETE FROM plugin_ui_extensions WHERE plugin_id = ?').run(pluginId);

    const insertHook = db.prepare(
      `
      INSERT INTO plugin_hooks
        (plugin_id, capability, method, path, permissions_json, enabled, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const hook of manifest.hooks ?? []) {
      const permissionsJson = JSON.stringify(manifest.permissions ?? []);
      insertHook.run(
        pluginId,
        hook.capability,
        hook.method,
        hook.path,
        permissionsJson,
        1,
        now,
        now,
      );
    }

    const insertUi = db.prepare(
      `
      INSERT INTO plugin_ui_extensions
        (plugin_id, slot, bundle_url, integrity_hash, permissions_json, enabled, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const ui of manifest.uiExtensions ?? []) {
      insertUi.run(
        pluginId,
        ui.slot,
        ui.bundleUrl,
        ui.integrityHash ?? null,
        JSON.stringify(ui.permissions ?? manifest.permissions ?? []),
        1,
        now,
        now,
      );
    }
  })();
}

async function installFromMcpEndpointUrl(mcpEndpointUrl: string): Promise<{ id: string }> {
  const { toolNames, serverName, serverVersion } = await withMcpClient(
    mcpEndpointUrl,
    async (client) => {
      const { tools } = await client.listTools();
      const names = (tools ?? [])
        .map((t) => t.name)
        .filter((n): n is string => Boolean(n) && !isAuxiliaryMcpTool(n));
      const ver = client.getServerVersion();
      return {
        toolNames: names,
        serverName: ver?.name ?? 'MCP Server',
        serverVersion: ver?.version ?? '0.0.0',
      };
    },
  );

  const pluginId = `mcp_${createHash('sha256').update(mcpEndpointUrl).digest('hex').slice(0, 24)}`;

  const hooks: PluginHook[] = toolNames.map((name) => ({
    capability: inferMuseCapabilityForMcpTool(name),
    method: 'MCP',
    path: name,
  }));

  const manifest: PluginManifest = {
    id: pluginId,
    name: serverName,
    version: serverVersion,
    museApiVersion: '1',
    service: {
      baseUrl: mcpEndpointUrl,
      healthPath: '/mcp',
      authScheme: 'none',
    },
    hooks,
    uiExtensions: [],
    mcp: { endpointUrl: mcpEndpointUrl },
  };

  runPluginInstallTransaction({
    pluginId,
    manifest,
    sourceUrl: mcpEndpointUrl,
    endpointBaseUrl: mcpEndpointUrl,
    authScheme: 'none',
  });

  await checkPluginHealthById(pluginId);
  revalidatePluginPaths();
  return { id: pluginId };
}

export async function installPluginFromLocalUrl(data: { baseUrl: string }): Promise<{ id: string }> {
  const raw = data.baseUrl.trim();
  if (!raw) throw new Error('URL is required.');

  try {
    const baseUrl = normalizeBaseUrl(raw);
    const manifest = await fetchPluginManifestFromLocal(baseUrl);

    if (!isMuseApiCompatible(manifest.museApiVersion, HOST_MUSE_API_VERSION)) {
      throw new Error(
        `Plugin API mismatch: plugin museApiVersion=${manifest.museApiVersion} (requires major ${HOST_MUSE_API_VERSION}).`,
      );
    }

    if (
      !isWithinMuseVersionRange({
        pluginMinMuseVersion: manifest.minMuseVersion,
        pluginMaxMuseVersion: manifest.maxMuseVersion,
        hostMuseVersion: HOST_MUSE_VERSION,
      })
    ) {
      throw new Error(`Plugin version range not compatible with this Muse Studio version.`);
    }

    const pluginId = manifest.id;
    runPluginInstallTransaction({
      pluginId,
      manifest,
      sourceUrl: baseUrl,
      endpointBaseUrl: baseUrl,
      authScheme: manifest.service.authScheme ?? 'none',
    });

    await checkPluginHealthById(pluginId);
    revalidatePluginPaths();
    return { id: pluginId };
  } catch (httpErr) {
    try {
      const mcpUrl = resolveMcpEndpointUrl(raw);
      return await installFromMcpEndpointUrl(mcpUrl);
    } catch (mcpErr) {
      const a = httpErr instanceof Error ? httpErr.message : String(httpErr);
      const b = mcpErr instanceof Error ? mcpErr.message : String(mcpErr);
      throw new Error(
        `Could not register as Muse HTTP extension (${a}) or as an MCP Streamable HTTP server (${b}).`,
      );
    }
  }
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  db.prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, pluginId);
  revalidatePluginPaths();
}

export type McpConsoleHookRow = {
  capability: string;
  path: string;
  method: string;
  enabled: boolean;
  mcpPolicy: 'auto' | 'ask';
};

export type McpConsolePluginGroup = {
  pluginId: string;
  pluginName: string;
  enabled: boolean;
  hooks: McpConsoleHookRow[];
};

/** Extensions console right panel: plugins and their MCP hooks with on/off and Ask/Auto policy. */
export async function listMcpExtensionsConsolePlugins(): Promise<McpConsolePluginGroup[]> {
  const rows = db
    .prepare<[], { id: string; name: string; enabled: number }>(
      `SELECT id, name, enabled FROM plugins ORDER BY name ASC`,
    )
    .all();

  const hookStmt = db.prepare<
    [string],
    {
      capability: string;
      path: string;
      method: string;
      enabled: number;
      mcp_policy: string | null;
    }
  >(
    `SELECT capability, path, method, enabled,
            COALESCE(mcp_policy, 'auto') AS mcp_policy
     FROM plugin_hooks WHERE plugin_id = ? ORDER BY capability ASC`,
  );

  return rows.map((r) => {
    const hooks = hookStmt.all(r.id);
    return {
      pluginId: r.id,
      pluginName: r.name,
      enabled: r.enabled === 1,
      hooks: hooks.map((h) => ({
        capability: h.capability,
        path: h.path,
        method: h.method,
        enabled: h.enabled === 1,
        mcpPolicy: h.mcp_policy === 'ask' ? 'ask' : 'auto',
      })),
    };
  });
}

export async function setPluginHookEnabled(
  pluginId: string,
  capability: string,
  enabled: boolean,
): Promise<void> {
  db.prepare(
    `UPDATE plugin_hooks SET enabled = ?, updated_at = ? WHERE plugin_id = ? AND capability = ?`,
  ).run(enabled ? 1 : 0, nowIso(), pluginId, capability);
  revalidatePluginPaths();
}

export async function setPluginHookMcpPolicy(
  pluginId: string,
  capability: string,
  mcpPolicy: 'auto' | 'ask',
): Promise<void> {
  db.prepare(
    `UPDATE plugin_hooks SET mcp_policy = ?, updated_at = ? WHERE plugin_id = ? AND capability = ?`,
  ).run(mcpPolicy, nowIso(), pluginId, capability);
  revalidatePluginPaths();
}

/** Runtime: whether the LLM may run this hook immediately or must wait for user confirmation. */
export async function getMcpHookMcpPolicy(
  pluginId: string,
  capability: string,
): Promise<'auto' | 'ask'> {
  const row = db
    .prepare<[string, string], { mcp_policy: string | null }>(
      `SELECT mcp_policy FROM plugin_hooks WHERE plugin_id = ? AND capability = ?`,
    )
    .get(pluginId, capability);
  return row?.mcp_policy === 'ask' ? 'ask' : 'auto';
}

export async function deletePlugin(pluginId: string): Promise<void> {
  db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
  revalidatePluginPaths();
}

export async function updatePlugin(pluginId: string): Promise<void> {
  const row = db
    .prepare<[string], { source_url: string }>('SELECT source_url FROM plugins WHERE id = ?')
    .get(pluginId);
  if (!row) throw new Error('Plugin not found.');
  await installPluginFromLocalUrl({ baseUrl: row.source_url });
}

export async function refreshPluginHealth(pluginId: string): Promise<void> {
  await checkPluginHealthById(pluginId);
  revalidatePluginPaths();
}

// This is the runtime host contract (used by /api/plugins/call).
export async function callEnabledPluginsForCapability(params: {
  capability: string;
  pluginId?: string;
  methodOverride?: string;
  input: unknown;
  projectId?: string;
}): Promise<{ ok: boolean; data?: unknown; error?: string; pluginId?: string }> {
  const pluginsRows = db
    .prepare<
      [string],
      {
        plugin_id: string;
        method: string;
        path: string;
        base_url: string;
        auth_type: string;
        auth_ref: string | null;
      }
    >(
      `
      SELECT ph.plugin_id, ph.method, ph.path,
             pe.base_url, pe.auth_type, pe.auth_ref
      FROM plugin_hooks ph
      INNER JOIN plugins p ON p.id = ph.plugin_id
      LEFT JOIN plugin_endpoints pe ON pe.plugin_id = p.id
      WHERE ph.capability = ?
        AND ph.enabled = 1
        AND p.enabled = 1
      ORDER BY p.installed_at DESC
      `,
    )
    .all(params.capability);

  if (pluginsRows.length === 0) {
    return { ok: false, error: `No enabled plugin registered for capability "${params.capability}".` };
  }

  const target = params.pluginId
    ? pluginsRows.find((p) => p.plugin_id === params.pluginId) ?? null
    : pluginsRows[0];
  if (!target) {
    return { ok: false, error: `Plugin "${params.pluginId}" is not enabled for "${params.capability}".` };
  }

  if (target.method === 'MCP') {
    const authToken =
      target.auth_type === 'bearer'
        ? resolveAuthRef(target.plugin_id, target.auth_type, target.auth_ref)
        : null;
    try {
      const inputObj =
        params.input && typeof params.input === 'object' && !Array.isArray(params.input)
          ? (params.input as Record<string, unknown>)
          : {};
      const data = await mcpCallToolJson(target.base_url, target.path, inputObj, authToken);
      return { ok: true, data, pluginId: target.plugin_id };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        pluginId: target.plugin_id,
      };
    }
  }

  const url = new URL(target.path, target.base_url).toString();

  const timeoutMs = 30_000;
  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;

  // MVP resilience:
  // - Retry once on network/timeouts and 5xx.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const authToken =
        target.auth_type === 'bearer'
          ? resolveAuthRef(target.plugin_id, target.auth_type, target.auth_ref)
          : null;

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-muse-capability': params.capability,
        'x-muse-request-id': requestId,
        ...(params.projectId ? { 'x-muse-project-id': params.projectId } : {}),
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      };

      const res = await fetch(url, {
        method: params.methodOverride ?? target.method,
        headers,
        body: JSON.stringify(params.input ?? {}),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        if (res.status >= 500 && attempt === 1) continue;
        return { ok: false, error: `Plugin call failed: ${res.status} ${bodyText}`, pluginId: target.plugin_id };
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        return { ok: true, data: json, pluginId: target.plugin_id };
      }
      const text = await res.text();
      return { ok: true, data: text, pluginId: target.plugin_id };
    } catch {
      if (attempt === 2) {
        return { ok: false, error: `Plugin call timeout/err (${timeoutMs}ms)`, pluginId: target.plugin_id };
      }
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: 'Plugin call failed after retries.', pluginId: target.plugin_id };
}

