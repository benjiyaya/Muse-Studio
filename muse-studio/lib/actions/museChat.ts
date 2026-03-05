'use server';

import { db } from '@/db';
import type { MuseAgent } from '@/lib/types';

export type MuseChatRole = 'user' | 'assistant';

interface MuseChatMessageRow {
  id: string;
  project_id: string | null;
  muse_agent: string;
  role: MuseChatRole;
  content: string;
  created_at: string;
}

export interface MuseChatMessage {
  id: string;
  projectId?: string;
  muse: MuseAgent;
  role: MuseChatRole;
  content: string;
  createdAt: Date;
}

function newId(prefix = 'chat'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function mapRow(row: MuseChatMessageRow): MuseChatMessage {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    muse: row.muse_agent as MuseAgent,
    role: row.role,
    content: row.content,
    createdAt: new Date(row.created_at),
  };
}

export async function appendMuseChatMessage(input: {
  projectId?: string | null;
  muse: MuseAgent;
  role: MuseChatRole;
  content: string;
}): Promise<MuseChatMessage> {
  const id = newId();
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO muse_chat_messages (id, project_id, muse_agent, role, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(id, input.projectId ?? null, input.muse, input.role, input.content, now);

  const row: MuseChatMessageRow = {
    id,
    project_id: input.projectId ?? null,
    muse_agent: input.muse,
    role: input.role,
    content: input.content,
    created_at: now,
  };

  return mapRow(row);
}

export async function getMuseChatHistory(input: {
  projectId?: string | null;
  muse: MuseAgent;
  limit?: number;
}): Promise<MuseChatMessage[]> {
  const limit = input.limit ?? 100;

  let rows: MuseChatMessageRow[];
  if (input.projectId) {
    rows = db
      .prepare<[string, string, number], MuseChatMessageRow>(
        `
          SELECT id, project_id, muse_agent, role, content, created_at
          FROM muse_chat_messages
          WHERE project_id = ? AND muse_agent = ?
          ORDER BY created_at ASC
          LIMIT ?
        `,
      )
      .all(input.projectId, input.muse, limit);
  } else {
    rows = db
      .prepare<[string, number], MuseChatMessageRow>(
        `
          SELECT id, project_id, muse_agent, role, content, created_at
          FROM muse_chat_messages
          WHERE project_id IS NULL AND muse_agent = ?
          ORDER BY created_at ASC
          LIMIT ?
        `,
      )
      .all(input.muse, limit);
  }

  return rows.map(mapRow);
}

