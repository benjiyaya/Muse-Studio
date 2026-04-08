/**
 * Muse Studio as MCP **client** — Streamable HTTP (`POST …/mcp`) via official SDK.
 * Server-only (Node runtime).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { HOST_MUSE_VERSION } from '@/lib/plugin-extension/plugin-types';

/** Local inference (e.g. Z-Image) can exceed the SDK default (60s). */
const MCP_TOOL_CALL_TIMEOUT_MS = 45 * 60 * 1000;

/** Full URL ending with `/mcp` (e.g. `http://192.168.56.1:18182/mcp`). */
export function resolveMcpEndpointUrl(input: string): string {
  const t = input.trim().replace(/\/+$/, '');
  if (!t) throw new Error('MCP URL is required.');
  if (t.endsWith('/mcp')) return t;
  return `${t}/mcp`;
}

function unwrapToolResult(result: Record<string, unknown>): unknown {
  const sc = result.structuredContent;
  if (sc && typeof sc === 'object') return sc;
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        try {
          return JSON.parse(block.text) as unknown;
        } catch {
          return { text: block.text };
        }
      }
    }
  }
  return result;
}

export async function withMcpClient<T>(
  mcpEndpointUrl: string,
  fn: (client: Client) => Promise<T>,
  options?: { headers?: Record<string, string> },
): Promise<T> {
  const client = new Client({ name: 'muse-studio', version: HOST_MUSE_VERSION }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(mcpEndpointUrl), {
    requestInit: options?.headers ? { headers: options.headers } : undefined,
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    try {
      await client.close();
    } catch {
      // Streamable HTTP transport often throws AbortError on close; safe to ignore.
    }
  }
}

export type McpToolListEntry = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export async function mcpListToolNames(mcpEndpointUrl: string, authBearer?: string | null): Promise<string[]> {
  const headers = authBearer ? { Authorization: `Bearer ${authBearer}` } : undefined;
  return withMcpClient(
    mcpEndpointUrl,
    async (client) => {
      const { tools } = await client.listTools();
      return (tools ?? []).map((t) => t.name).filter(Boolean);
    },
    { headers },
  );
}

/** Full tool metadata for orchestrator (argument JSON Schema + description). */
export async function mcpListToolsMeta(
  mcpEndpointUrl: string,
  authBearer?: string | null,
): Promise<McpToolListEntry[]> {
  const headers = authBearer ? { Authorization: `Bearer ${authBearer}` } : undefined;
  return withMcpClient(
    mcpEndpointUrl,
    async (client) => {
      const { tools } = await client.listTools();
      return (tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    { headers },
  );
}

export async function mcpCallToolJson(
  mcpEndpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  authBearer?: string | null,
): Promise<unknown> {
  const headers = authBearer ? { Authorization: `Bearer ${authBearer}` } : undefined;
  return withMcpClient(
    mcpEndpointUrl,
    async (client) => {
      const raw = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout: MCP_TOOL_CALL_TIMEOUT_MS },
      );
      return unwrapToolResult(raw as Record<string, unknown>);
    },
    { headers },
  );
}

/** Map MCP tool name → Muse hook capability (for orchestration / image pipeline). */
export function inferMuseCapabilityForMcpTool(toolName: string): string {
  const n = toolName.toLowerCase();
  if (n === 'zimage_generate' || n.endsWith('_image_generate')) return 'image.generate';
  if (n.includes('video') && n.includes('generat')) return 'video.generate';
  return toolName;
}

/** Tools to omit from the hook catalog (health / meta only). */
export function isAuxiliaryMcpTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  return n.endsWith('_health') || n === 'health' || n === 'muse_health';
}
