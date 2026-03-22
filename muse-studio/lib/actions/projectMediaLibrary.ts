'use server';

import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import type { CharacterImageKind } from '@/lib/types';
import {
  createKeyframe,
  updateKeyframeOutput,
  updateSceneStatus,
  updateScene,
} from '@/lib/actions/scenes';
import { addCharacterImage } from '@/lib/actions/characters';

const OUTPUTS_ROOT = path.join(process.cwd(), 'outputs');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv']);

export type MediaLibraryItem = {
  path: string;
  kind: 'image' | 'video';
  mtimeMs: number;
};

function toPosix(rel: string): string {
  return rel.split(path.sep).join('/');
}

function assertNoTraversal(rel: string): void {
  const parts = toPosix(rel).split('/').filter(Boolean);
  if (parts.some((p) => p === '..')) throw new Error('Invalid path');
}

function fullPath(rel: string): string {
  const n = toPosix(rel.trim());
  assertNoTraversal(n);
  const abs = path.join(OUTPUTS_ROOT, ...n.split('/'));
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(path.resolve(OUTPUTS_ROOT))) {
    throw new Error('Path escapes outputs root');
  }
  return resolved;
}

/** Accept outputs produced under drafts/playground (global or project subfolder). */
function isAllowedPlaygroundSource(sourceRelPath: string): boolean {
  const n = toPosix(sourceRelPath.trim());
  if (!n.startsWith('drafts/playground/')) return false;
  assertNoTraversal(n);
  return true;
}

function copyWithinOutputs(relSrc: string, destRelDir: string): string {
  const src = fullPath(relSrc);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
    throw new Error('Source file not found');
  }
  const ext = path.extname(src) || '.bin';
  const name = `${randomUUID()}${ext}`;
  const destDirAbs = fullPath(destRelDir);
  fs.mkdirSync(destDirAbs, { recursive: true });
  const destAbs = path.join(destDirAbs, name);
  fs.copyFileSync(src, destAbs);
  return toPosix(path.relative(OUTPUTS_ROOT, destAbs));
}

export async function listProjectMediaLibrary(projectId: string): Promise<MediaLibraryItem[]> {
  const row = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: string } | undefined;
  if (!row) throw new Error('Project not found');

  const dirs = [
    path.join(OUTPUTS_ROOT, 'drafts', 'playground', projectId),
    path.join(OUTPUTS_ROOT, 'drafts', projectId, 'library'),
  ];

  const items: MediaLibraryItem[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      let kind: 'image' | 'video' | null = null;
      if (IMAGE_EXT.has(ext)) kind = 'image';
      else if (VIDEO_EXT.has(ext)) kind = 'video';
      else continue;

      const abs = path.join(dir, ent.name);
      const stat = fs.statSync(abs);
      const rel = toPosix(path.relative(OUTPUTS_ROOT, abs));
      items.push({ path: rel, kind, mtimeMs: stat.mtimeMs });
    }
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items;
}

const PLAYGROUND_OUTPUT_DIR = path.join(OUTPUTS_ROOT, 'drafts', 'playground');

function collectImagesUnderPlayground(dir: string, items: MediaLibraryItem[]): void {
  if (!fs.existsSync(dir)) return;
  const baseResolved = path.resolve(PLAYGROUND_OUTPUT_DIR);
  const dirResolved = path.resolve(dir);
  if (!dirResolved.startsWith(baseResolved)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const absResolved = path.resolve(abs);
    if (!absResolved.startsWith(baseResolved)) continue;

    if (ent.isDirectory()) {
      collectImagesUnderPlayground(abs, items);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      const stat = fs.statSync(abs);
      const rel = toPosix(path.relative(OUTPUTS_ROOT, abs));
      if (!rel.startsWith('drafts/playground/')) continue;
      items.push({ path: rel, kind: 'image', mtimeMs: stat.mtimeMs });
    }
  }
}

/** All images under outputs/drafts/playground (any subfolder), newest first. For Media playground picker. */
export async function listPlaygroundGlobalLibrary(): Promise<MediaLibraryItem[]> {
  const items: MediaLibraryItem[] = [];
  collectImagesUnderPlayground(PLAYGROUND_OUTPUT_DIR, items);
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.slice(0, 300);
}

export async function promotePlaygroundAssetToKeyframe(input: {
  projectId: string;
  sceneId: string;
  sourceRelPath: string;
}): Promise<{ keyframeId: string; imagePath: string }> {
  const { projectId, sceneId, sourceRelPath } = input;
  if (!isAllowedPlaygroundSource(sourceRelPath)) throw new Error('Invalid source path');

  const scene = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);
  if (!scene || scene.project_id !== projectId) throw new Error('Scene not in this project');

  const ext = path.extname(sourceRelPath).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error('Only images can be saved as keyframes');

  const newRel = copyWithinOutputs(sourceRelPath, `drafts/${projectId}/library`);

  const kfId = await createKeyframe({
    sceneId,
    source: 'VISUAL_MUSE',
  });
  await updateKeyframeOutput(kfId, { draftImagePath: newRel });
  await updateSceneStatus(sceneId, 'DRAFT_QUEUE');

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/playground');
  return { keyframeId: kfId, imagePath: newRel };
}

export async function promotePlaygroundAssetToCharacterImage(input: {
  projectId: string;
  characterId: string;
  sourceRelPath: string;
  kind: CharacterImageKind;
}): Promise<void> {
  const { projectId, characterId, sourceRelPath, kind } = input;
  if (!isAllowedPlaygroundSource(sourceRelPath)) throw new Error('Invalid source path');

  const char = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM characters WHERE id = ?')
    .get(characterId);
  if (!char || char.project_id !== projectId) throw new Error('Character not in this project');

  const ext = path.extname(sourceRelPath).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error('Only images are supported');

  const newRel = copyWithinOutputs(sourceRelPath, `refs/${characterId}`);

  await addCharacterImage({
    characterId,
    kind,
    imagePath: newRel,
    source: 'UPLOAD',
    notes: 'From Media playground',
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/playground');
}

export async function promotePlaygroundVideoToScene(input: {
  projectId: string;
  sceneId: string;
  sourceRelPath: string;
}): Promise<void> {
  const { projectId, sceneId, sourceRelPath } = input;
  if (!isAllowedPlaygroundSource(sourceRelPath)) throw new Error('Invalid source path');

  const scene = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);
  if (!scene || scene.project_id !== projectId) throw new Error('Scene not in this project');

  const ext = path.extname(sourceRelPath).toLowerCase();
  if (!VIDEO_EXT.has(ext)) throw new Error('Only video files are supported');

  const newRel = copyWithinOutputs(sourceRelPath, `drafts/${projectId}/library`);
  const videoUrl = `/api/outputs/${newRel}`;
  await updateScene(sceneId, { videoUrl });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/playground');
}
