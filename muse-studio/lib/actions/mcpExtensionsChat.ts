'use server';

import { randomUUID } from 'crypto';
import { db } from '@/db';
import type { McpToolCallLogEntry } from '@/lib/mcp-extensions/mcpChatTypes';

export type McpExtensionsInitialLine =
  | { id: string; role: 'user'; content: string }
  | {
      id: string;
      role: 'assistant';
      content: string;
      toolCalls?: McpToolCallLogEntry[];
    };

type Row = {
  id: string;
  role: string;
  content: string;
  tool_calls_json: string | null;
};

export type McpExtensionsChatSession = {
  id: string;
  title: string;
  pinned: boolean;
  projectId?: string;
  sceneId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageAt?: string;
};

const DEFAULT_SESSION_ID = 'default';
const DEFAULT_SESSION_TITLE = 'General';

function ensureSessionSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_extensions_chat_sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      pinned      INTEGER NOT NULL DEFAULT 0,
      project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
      scene_id    TEXT REFERENCES scenes(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `);
  try {
    db.exec(`ALTER TABLE mcp_extensions_chat_messages ADD COLUMN session_id TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE mcp_extensions_chat_sessions ADD COLUMN project_id TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE mcp_extensions_chat_sessions ADD COLUMN scene_id TEXT`);
  } catch {
    /* column already exists */
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_mcp_ext_chat_session_sort
      ON mcp_extensions_chat_messages (session_id, sort_key)`,
  );
}

function ensureDefaultSession(): string {
  ensureSessionSchema();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO mcp_extensions_chat_sessions (id, title, pinned, created_at, updated_at)
     VALUES (@id, @title, 1, @now, @now)`,
  ).run({ id: DEFAULT_SESSION_ID, title: DEFAULT_SESSION_TITLE, now });
  db.prepare(
    `UPDATE mcp_extensions_chat_messages
     SET session_id = @sid
     WHERE session_id IS NULL OR TRIM(session_id) = ''`,
  ).run({ sid: DEFAULT_SESSION_ID });
  return DEFAULT_SESSION_ID;
}

function parseRows(rows: Row[]): McpExtensionsInitialLine[] {
  const out: McpExtensionsInitialLine[] = [];
  for (const r of rows) {
    if (r.role === 'user') {
      out.push({ id: r.id, role: 'user', content: r.content });
      continue;
    }
    if (r.role === 'assistant') {
      let toolCalls: McpToolCallLogEntry[] | undefined;
      if (r.tool_calls_json && r.tool_calls_json.trim()) {
        try {
          const parsed = JSON.parse(r.tool_calls_json) as unknown;
          if (Array.isArray(parsed)) toolCalls = parsed as McpToolCallLogEntry[];
        } catch {
          toolCalls = undefined;
        }
      }
      out.push({
        id: r.id,
        role: 'assistant',
        content: r.content,
        toolCalls,
      });
    }
  }
  return out;
}

export async function listMcpExtensionsChatSessions(): Promise<McpExtensionsChatSession[]> {
  ensureDefaultSession();
  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.title,
         s.pinned,
         s.project_id,
         s.scene_id,
         s.created_at,
         s.updated_at,
         COUNT(m.id) AS message_count,
         MAX(m.created_at) AS last_message_at
       FROM mcp_extensions_chat_sessions s
       LEFT JOIN mcp_extensions_chat_messages m ON m.session_id = s.id
       GROUP BY s.id
       ORDER BY s.pinned DESC, COALESCE(MAX(m.created_at), s.updated_at) DESC, s.created_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    pinned: number;
    project_id: string | null;
    scene_id: string | null;
    created_at: string;
    updated_at: string;
    message_count: number;
    last_message_at: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    pinned: !!r.pinned,
    projectId: r.project_id ?? undefined,
    sceneId: r.scene_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: Number(r.message_count ?? 0),
    lastMessageAt: r.last_message_at ?? undefined,
  }));
}

export async function getMcpExtensionsChatSessionLines(
  sessionId: string,
): Promise<McpExtensionsInitialLine[]> {
  const sid = sessionId?.trim() || ensureDefaultSession();
  const rows = db
    .prepare(
      `SELECT id, role, content, tool_calls_json
       FROM mcp_extensions_chat_messages
       WHERE session_id = ?
       ORDER BY sort_key ASC`,
    )
    .all(sid) as Row[];
  return parseRows(rows);
}

export async function getMcpExtensionsChatInitialState(): Promise<{
  sessions: McpExtensionsChatSession[];
  activeSessionId: string;
  initialLines: McpExtensionsInitialLine[];
}> {
  const sessions = await listMcpExtensionsChatSessions();
  const activeSessionId = sessions[0]?.id ?? ensureDefaultSession();
  return {
    sessions,
    activeSessionId,
    initialLines: await getMcpExtensionsChatSessionLines(activeSessionId),
  };
}

export async function createMcpExtensionsChatSession(title?: string): Promise<McpExtensionsChatSession> {
  ensureDefaultSession();
  const now = new Date().toISOString();
  const id = randomUUID();
  const nextTitle = title?.trim() || 'New chat';
  db.prepare(
    `INSERT INTO mcp_extensions_chat_sessions (id, title, pinned, created_at, updated_at)
     VALUES (@id, @title, 0, @now, @now)`,
  ).run({ id, title: nextTitle, now });
  return {
    id,
    title: nextTitle,
    pinned: false,
    projectId: undefined,
    sceneId: undefined,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}

export async function renameMcpExtensionsChatSession(sessionId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!sessionId || !trimmed) return;
  db.prepare(
    `UPDATE mcp_extensions_chat_sessions
     SET title = @title, updated_at = @now
     WHERE id = @id`,
  ).run({ id: sessionId, title: trimmed, now: new Date().toISOString() });
}

export async function setMcpExtensionsChatSessionPinned(
  sessionId: string,
  pinned: boolean,
): Promise<void> {
  if (!sessionId) return;
  db.prepare(
    `UPDATE mcp_extensions_chat_sessions
     SET pinned = @pinned, updated_at = @now
     WHERE id = @id`,
  ).run({ id: sessionId, pinned: pinned ? 1 : 0, now: new Date().toISOString() });
}

export async function setMcpExtensionsChatSessionContext(
  sessionId: string,
  context: { projectId?: string | null; sceneId?: string | null },
): Promise<void> {
  if (!sessionId) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE mcp_extensions_chat_sessions
     SET project_id = @project_id,
         scene_id = @scene_id,
         updated_at = @now
     WHERE id = @id`,
  ).run({
    id: sessionId,
    project_id: context.projectId ?? null,
    scene_id: context.sceneId ?? null,
    now,
  });
}

export async function deleteMcpExtensionsChatSession(sessionId: string): Promise<string> {
  if (!sessionId) return ensureDefaultSession();
  ensureDefaultSession();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM mcp_extensions_chat_sessions WHERE id = ?`).run(sessionId);
    const rows = listMcpExtensionsChatSessionsSync();
    if (rows.length > 0) return rows[0]!.id;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO mcp_extensions_chat_sessions (id, title, pinned, created_at, updated_at)
       VALUES (@id, @title, 1, @now, @now)`,
    ).run({ id: DEFAULT_SESSION_ID, title: DEFAULT_SESSION_TITLE, now });
    return DEFAULT_SESSION_ID;
  });
  return tx();
}

function listMcpExtensionsChatSessionsSync(): McpExtensionsChatSession[] {
  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.title,
         s.pinned,
         s.project_id,
         s.scene_id,
         s.created_at,
         s.updated_at,
         COUNT(m.id) AS message_count,
         MAX(m.created_at) AS last_message_at
       FROM mcp_extensions_chat_sessions s
       LEFT JOIN mcp_extensions_chat_messages m ON m.session_id = s.id
       GROUP BY s.id
       ORDER BY s.pinned DESC, COALESCE(MAX(m.created_at), s.updated_at) DESC, s.created_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    pinned: number;
    project_id: string | null;
    scene_id: string | null;
    created_at: string;
    updated_at: string;
    message_count: number;
    last_message_at: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    pinned: !!r.pinned,
    projectId: r.project_id ?? undefined,
    sceneId: r.scene_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: Number(r.message_count ?? 0),
    lastMessageAt: r.last_message_at ?? undefined,
  }));
}

export async function getMcpExtensionsChatInitialLines(): Promise<McpExtensionsInitialLine[]> {
  const sid = ensureDefaultSession();
  return getMcpExtensionsChatSessionLines(sid);
}

export async function appendMcpExtensionsChatTurn(input: {
  sessionId?: string;
  userContent: string;
  assistantContent: string;
  toolCalls: McpToolCallLogEntry[];
}): Promise<void> {
  const sessionId = input.sessionId?.trim() || ensureDefaultSession();
  const exists = db
    .prepare(`SELECT id FROM mcp_extensions_chat_sessions WHERE id = ?`)
    .get(sessionId) as { id: string } | undefined;
  let safeSessionId = sessionId;
  if (!exists) {
    ensureDefaultSession();
    safeSessionId = DEFAULT_SESSION_ID;
  }
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO mcp_extensions_chat_messages (id, session_id, role, content, tool_calls_json, created_at)
     VALUES (@id, @session_id, @role, @content, @tool_calls_json, @created_at)`,
  );
  const touch = db.prepare(
    `UPDATE mcp_extensions_chat_sessions
     SET updated_at = @updated_at
     WHERE id = @id`,
  );
  const run = db.transaction(() => {
    insert.run({
      id: randomUUID(),
      session_id: safeSessionId,
      role: 'user',
      content: input.userContent,
      tool_calls_json: null,
      created_at: now,
    });
    insert.run({
      id: randomUUID(),
      session_id: safeSessionId,
      role: 'assistant',
      content: input.assistantContent,
      tool_calls_json:
        input.toolCalls.length > 0 ? JSON.stringify(input.toolCalls) : null,
      created_at: now,
    });
    touch.run({ id: safeSessionId, updated_at: now });
  });
  run();
}
