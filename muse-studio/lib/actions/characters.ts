'use server';

import { db } from '@/db';
import type { Character, CharacterImage, CharacterImageKind, CharacterImageSource, ImageAsset } from '@/lib/types';

interface CharacterRow {
  id: string;
  project_id: string;
  name: string;
  short_bio: string | null;
  design_notes: string | null;
  primary_role: string | null;
  sort_order: number;
  prompt_positive: string | null;
  prompt_negative: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

interface CharacterImageRow {
  id: string;
  character_id: string;
  kind: string;
  image_path: string;
  source: string;
  width: number;
  height: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function newId(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function mapImageRow(row: CharacterImageRow): CharacterImage {
  const relPath = row.image_path;
  const asset: ImageAsset = {
    id: row.id,
    url: `/api/outputs/${relPath}`,
    width: row.width ?? 0,
    height: row.height ?? 0,
  };

  return {
    id: row.id,
    characterId: row.character_id,
    kind: (row.kind.toUpperCase() as CharacterImageKind) ?? 'OTHER',
    image: asset,
    source: (row.source as CharacterImageSource) ?? 'UPLOAD',
    notes: row.notes ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapCharacter(row: CharacterRow, images: CharacterImage[]): Character {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    shortBio: row.short_bio ?? undefined,
    designNotes: row.design_notes ?? undefined,
    primaryRole: row.primary_role ?? undefined,
    sortOrder: row.sort_order,
    promptPositive: row.prompt_positive ?? undefined,
    promptNegative: row.prompt_negative ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : [],
    images,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** List all characters for a project, including their reference images. */
export async function listCharacters(projectId: string): Promise<Character[]> {
  const characterRows = db
    .prepare<[string], CharacterRow>('SELECT * FROM characters WHERE project_id = ? ORDER BY sort_order, name')
    .all(projectId);

  if (!characterRows.length) return [];

  const ids = characterRows.map((c) => c.id);
  const placeholders = ids.map(() => '?').join(',');
  const imageRows = db
    .prepare<CharacterImageRow[]>(`SELECT * FROM character_images WHERE character_id IN (${placeholders}) ORDER BY created_at`)
    .all(...ids) as CharacterImageRow[];

  const byCharacter: Record<string, CharacterImage[]> = {};
  for (const row of imageRows) {
    const img = mapImageRow(row);
    (byCharacter[img.characterId] ??= []).push(img);
  }

  return characterRows.map((row) => mapCharacter(row, byCharacter[row.id] ?? []));
}

interface CreateCharacterInput {
  projectId: string;
  name: string;
  shortBio?: string;
  designNotes?: string;
  primaryRole?: string;
  sortOrder?: number;
  promptPositive?: string;
  promptNegative?: string;
  tags?: string[];
}

export async function createCharacter(input: CreateCharacterInput): Promise<Character> {
  const id = newId('char');
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO characters
      (id, project_id, name, short_bio, design_notes, primary_role, sort_order,
       prompt_positive, prompt_negative, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.name,
    input.shortBio ?? null,
    input.designNotes ?? null,
    input.primaryRole ?? null,
    input.sortOrder ?? 0,
    input.promptPositive ?? null,
    input.promptNegative ?? null,
    input.tags ? JSON.stringify(input.tags) : null,
    now,
    now,
  );

  const row = db
    .prepare<[string], CharacterRow>('SELECT * FROM characters WHERE id = ?')
    .get(id);

  return mapCharacter(row, []);
}

interface UpdateCharacterInput {
  name?: string;
  shortBio?: string;
  designNotes?: string;
  primaryRole?: string;
  sortOrder?: number;
  promptPositive?: string;
  promptNegative?: string;
  tags?: string[];
}

export async function updateCharacter(id: string, data: UpdateCharacterInput): Promise<void> {
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [new Date().toISOString()];

  if (data.name !== undefined) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if (data.shortBio !== undefined) {
    fields.push('short_bio = ?');
    values.push(data.shortBio ?? null);
  }
  if (data.designNotes !== undefined) {
    fields.push('design_notes = ?');
    values.push(data.designNotes ?? null);
  }
  if (data.primaryRole !== undefined) {
    fields.push('primary_role = ?');
    values.push(data.primaryRole ?? null);
  }
  if (data.sortOrder !== undefined) {
    fields.push('sort_order = ?');
    values.push(data.sortOrder);
  }
  if (data.promptPositive !== undefined) {
    fields.push('prompt_positive = ?');
    values.push(data.promptPositive ?? null);
  }
  if (data.promptNegative !== undefined) {
    fields.push('prompt_negative = ?');
    values.push(data.promptNegative ?? null);
  }
  if (data.tags !== undefined) {
    fields.push('tags = ?');
    values.push(data.tags ? JSON.stringify(data.tags) : null);
  }

  values.push(id);

  db.prepare(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`).run(...(values as never[]));
}

export async function deleteCharacter(id: string): Promise<void> {
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
}

interface AddCharacterImageInput {
  characterId: string;
  kind: CharacterImageKind;
  imagePath: string; // relative path under outputs/, e.g. "refs/characters/..."
  source?: CharacterImageSource;
  width?: number;
  height?: number;
  notes?: string;
}

export async function addCharacterImage(input: AddCharacterImageInput): Promise<CharacterImage> {
  const id = newId('charimg');
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO character_images
      (id, character_id, kind, image_path, source, width, height, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.characterId,
    input.kind,
    input.imagePath,
    input.source ?? 'UPLOAD',
    input.width ?? 0,
    input.height ?? 0,
    input.notes ?? null,
    now,
    now,
  );

  const row = db
    .prepare<[string], CharacterImageRow>('SELECT * FROM character_images WHERE id = ?')
    .get(id);

  return mapImageRow(row);
}

export async function deleteCharacterImage(id: string): Promise<void> {
  db.prepare('DELETE FROM character_images WHERE id = ?').run(id);
}

