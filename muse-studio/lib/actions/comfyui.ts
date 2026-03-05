'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';

function newId(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface ComfyWorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  kind: 'image' | 'video';
  createdAt: string;
  updatedAt: string;
}

export interface ComfyWorkflowFull extends ComfyWorkflowSummary {
  json: string;
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  json: string;
  created_at: string;
  updated_at: string;
}

function mapWorkflow(row: WorkflowRow): ComfyWorkflowFull {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind as 'image' | 'video',
    json: row.json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listComfyWorkflows(): Promise<ComfyWorkflowSummary[]> {
  const rows = db
    .prepare<[], WorkflowRow>(
      'SELECT id, name, description, kind, created_at, updated_at, json FROM comfy_workflows ORDER BY created_at DESC',
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    kind: r.kind as 'image' | 'video',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getComfyWorkflowJson(id: string): Promise<ComfyWorkflowFull | null> {
  const row = db
    .prepare<[string], WorkflowRow>('SELECT * FROM comfy_workflows WHERE id = ?')
    .get(id);
  if (!row) return null;
  return mapWorkflow(row);
}

export async function registerComfyWorkflow(data: {
  name: string;
  description?: string;
  kind: 'image' | 'video';
  json: string;
}): Promise<string> {
  const id = newId('wf');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO comfy_workflows (id, name, description, kind, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, data.name, data.description ?? null, data.kind, data.json, now, now);
  revalidatePath('/settings/comfyui');
  return id;
}

export async function updateComfyWorkflow(
  id: string,
  data: { name?: string; description?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
  values.push(id);
  db.prepare(`UPDATE comfy_workflows SET ${fields.join(', ')} WHERE id = ?`).run(...(values as Parameters<typeof db.prepare>[0][]));
  revalidatePath('/settings/comfyui');
}

export async function deleteComfyWorkflow(id: string): Promise<void> {
  db.prepare('DELETE FROM comfy_workflows WHERE id = ?').run(id);
  revalidatePath('/settings/comfyui');
}
