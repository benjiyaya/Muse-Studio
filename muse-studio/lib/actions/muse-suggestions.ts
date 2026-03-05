'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import type {
  MuseSuggestion,
  SuggestionType,
  MuseAgent,
  SuggestionAction,
} from '@/lib/types';
import type { NewSuggestion } from '@/lib/muse/suggestion-engine';

interface SuggestionRow {
  id: string;
  project_id: string;
  scene_id: string | null;
  type: string;
  muse: string;
  message: string;
  actions: string;
  is_read: number;
  created_at: string;
}

function mapRow(row: SuggestionRow): MuseSuggestion {
  return {
    id: row.id,
    type: row.type as SuggestionType,
    muse: row.muse as MuseAgent,
    message: row.message,
    sceneId: row.scene_id ?? undefined,
    actions: JSON.parse(row.actions) as SuggestionAction[],
    createdAt: new Date(row.created_at),
    isRead: row.is_read === 1,
  };
}

function newId(prefix = 'sug'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/**
 * List all Muse suggestions for a project (for Muse Suggests panel).
 * Returns suggestions ordered by created_at descending.
 */
export async function listMuseSuggestions(projectId: string): Promise<MuseSuggestion[]> {
  const rows = db
    .prepare<[string], SuggestionRow>(
      `SELECT id, project_id, scene_id, type, muse, message, actions, is_read, created_at
       FROM muse_suggestions
       WHERE project_id = ?
       ORDER BY created_at DESC`,
    )
    .all(projectId);
  return rows.map(mapRow);
}

/**
 * Insert a batch of new suggestions for a project with simple deduping.
 *
 * Deduping rule: skip any suggestion where a row already exists with the same
 * (project_id, type, muse, scene_id, message).
 */
export async function createMuseSuggestions(
  projectId: string,
  suggestions: NewSuggestion[],
): Promise<void> {
  if (!suggestions.length) return;

  const now = new Date().toISOString();

  const selectWithScene = db.prepare<
    [string, string, string, string, string],
    SuggestionRow
  >(
    `SELECT id, project_id, scene_id, type, muse, message, actions, is_read, created_at
     FROM muse_suggestions
     WHERE project_id = ? AND type = ? AND muse = ? AND scene_id = ? AND message = ?`,
  );

  const selectWithoutScene = db.prepare<[string, string, string, string], SuggestionRow>(
    `SELECT id, project_id, scene_id, type, muse, message, actions, is_read, created_at
     FROM muse_suggestions
     WHERE project_id = ? AND type = ? AND muse = ? AND scene_id IS NULL AND message = ?`,
  );

  const insert = db.prepare<
    [string, string, string | null, string, string, string, number, string]
  >(
    `INSERT INTO muse_suggestions
      (id, project_id, scene_id, type, muse, message, actions, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction(() => {
    for (const s of suggestions) {
      const existing =
        s.sceneId != null
          ? selectWithScene.get(projectId, s.type, s.muse, s.sceneId, s.message)
          : selectWithoutScene.get(projectId, s.type, s.muse, s.message);

      if (existing) continue;

      const id = newId();
      insert.run(
        id,
        projectId,
        s.sceneId ?? null,
        s.type,
        s.muse,
        s.message,
        JSON.stringify(s.actions),
        0,
        now,
      );
    }
  });

  insertMany();
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Mark a suggestion as read (e.g. when user opens the panel or focuses the card).
 */
export async function markSuggestionRead(id: string): Promise<void> {
  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM muse_suggestions WHERE id = ?')
    .get(id);
  if (!row) return;
  db.prepare('UPDATE muse_suggestions SET is_read = 1 WHERE id = ?').run(id);
  revalidatePath(`/projects/${row.project_id}`);
}

/**
 * Dismiss (delete) a suggestion. Used when user clicks Dismiss in Muse Suggests panel.
 */
export async function dismissSuggestion(id: string): Promise<void> {
  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM muse_suggestions WHERE id = ?')
    .get(id);
  if (!row) return;
  db.prepare('DELETE FROM muse_suggestions WHERE id = ?').run(id);
  revalidatePath(`/projects/${row.project_id}`);
}
