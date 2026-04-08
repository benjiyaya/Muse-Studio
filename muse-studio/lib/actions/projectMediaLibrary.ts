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
import { getOutputsRoot, normalizeStoredOutputsReference, resolveUnderOutputs, toPosixPath } from '@/lib/server/paths';

const OUTPUTS_ROOT = getOutputsRoot();

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv']);

export type MediaLibraryItem = {
  path: string;
  kind: 'image' | 'video';
  mtimeMs: number;
  sizeBytes?: number;
};

const TEXT_LIBRARY_EXT = new Set(['.txt', '.md', '.json', '.csv', '.tsv', '.srt', '.vtt', '.yaml', '.yml']);

export type TextLibraryItem = {
  path: string;
  mtimeMs: number;
  sizeBytes: number;
};

function fullPath(rel: string): string {
  return resolveUnderOutputs(rel.trim());
}

/** Accept outputs from Media playground or Extensions MCP console (under outputs/). */
function isAllowedPlaygroundSource(sourceRelPath: string): boolean {
  const n = toPosixPath(sourceRelPath.trim());
  if (
    !n.startsWith('drafts/playground/') &&
    !n.startsWith('drafts/mcp-extensions/')
  ) {
    return false;
  }
  try {
    resolveUnderOutputs(n);
  } catch {
    return false;
  }
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
  return toPosixPath(path.relative(OUTPUTS_ROOT, destAbs));
}

function inferMediaKindFromExt(ext: string): 'image' | 'video' | null {
  const e = ext.toLowerCase();
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  return null;
}

/** Add a file under outputs/ to the map if it exists and is image/video. */
function tryAddMediaFile(relRaw: string | null | undefined, byPath: Map<string, MediaLibraryItem>): void {
  const normalized = normalizeStoredOutputsReference(relRaw ?? null);
  if (!normalized) return;
  const ext = path.extname(normalized);
  const kind = inferMediaKindFromExt(ext);
  if (!kind) return;
  let abs: string;
  try {
    abs = resolveUnderOutputs(normalized);
  } catch {
    return;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
  const stat = fs.statSync(abs);
  const rel = toPosixPath(normalized);
  byPath.set(rel, { path: rel, kind, mtimeMs: stat.mtimeMs, sizeBytes: stat.size });
}

export async function listProjectMediaLibrary(projectId: string): Promise<MediaLibraryItem[]> {
  const row = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: string } | undefined;
  if (!row) throw new Error('Project not found');

  const dirs = [
    path.join(OUTPUTS_ROOT, 'drafts', 'playground', projectId),
    path.join(OUTPUTS_ROOT, 'drafts', projectId, 'library'),
  ];

  const byPath = new Map<string, MediaLibraryItem>();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      const kind = inferMediaKindFromExt(ext);
      if (!kind) continue;

      const abs = path.join(dir, ent.name);
      const stat = fs.statSync(abs);
      const rel = toPosixPath(path.relative(OUTPUTS_ROOT, abs));
      byPath.set(rel, { path: rel, kind, mtimeMs: stat.mtimeMs, sizeBytes: stat.size });
    }
  }

  // Scene-linked media: keyframes, scene videos, generation jobs, reference images
  const keyframePaths = db
    .prepare<
      [string],
      { draft_image_path: string | null; final_image_path: string | null }
    >(
      `SELECT k.draft_image_path, k.final_image_path
       FROM keyframes k
       JOIN scenes s ON k.scene_id = s.id
       WHERE s.project_id = ?`,
    )
    .all(projectId);
  for (const kf of keyframePaths) {
    tryAddMediaFile(kf.draft_image_path, byPath);
    tryAddMediaFile(kf.final_image_path, byPath);
  }

  const refUrls = db
    .prepare<[string], { url: string }>(
      `SELECT r.url
       FROM reference_images r
       JOIN keyframes k ON r.keyframe_id = k.id
       JOIN scenes s ON k.scene_id = s.id
       WHERE s.project_id = ?`,
    )
    .all(projectId);
  for (const r of refUrls) {
    tryAddMediaFile(r.url, byPath);
  }

  const sceneVideos = db
    .prepare<[string], { video_url: string | null }>('SELECT video_url FROM scenes WHERE project_id = ?')
    .all(projectId);
  for (const s of sceneVideos) {
    tryAddMediaFile(s.video_url, byPath);
  }

  const jobOutputs = db
    .prepare<[string], { output_path: string | null }>(
      `SELECT j.output_path
       FROM generation_jobs j
       JOIN scenes s ON j.scene_id = s.id
       WHERE s.project_id = ?`,
    )
    .all(projectId);
  for (const j of jobOutputs) {
    tryAddMediaFile(j.output_path, byPath);
  }

  const items = [...byPath.values()];
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items;
}

const PLAYGROUND_OUTPUT_DIR = path.join(OUTPUTS_ROOT, 'drafts', 'playground');

function collectMediaUnderPlayground(dir: string, items: MediaLibraryItem[]): void {
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
      collectMediaUnderPlayground(abs, items);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      let kind: 'image' | 'video' | null = null;
      if (IMAGE_EXT.has(ext)) kind = 'image';
      else if (VIDEO_EXT.has(ext)) kind = 'video';
      else continue;
      const stat = fs.statSync(abs);
      const rel = toPosixPath(path.relative(OUTPUTS_ROOT, abs));
      if (!rel.startsWith('drafts/playground/')) continue;
      items.push({ path: rel, kind, mtimeMs: stat.mtimeMs, sizeBytes: stat.size });
    }
  }
}

/** Images and videos under outputs/drafts/playground (any subfolder), newest first. */
export async function listPlaygroundGlobalLibrary(): Promise<MediaLibraryItem[]> {
  const items: MediaLibraryItem[] = [];
  collectMediaUnderPlayground(PLAYGROUND_OUTPUT_DIR, items);
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.slice(0, 300);
}

/** Text files from project playground folder + project library (for Extensions picker). */
export async function listProjectTextLibrary(projectId: string): Promise<TextLibraryItem[]> {
  const row = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: string } | undefined;
  if (!row) throw new Error('Project not found');

  const dirs = [
    path.join(OUTPUTS_ROOT, 'drafts', 'playground', projectId),
    path.join(OUTPUTS_ROOT, 'drafts', projectId, 'library'),
  ];

  const items: TextLibraryItem[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!TEXT_LIBRARY_EXT.has(ext)) continue;
      const abs = path.join(dir, ent.name);
      const stat = fs.statSync(abs);
      const rel = toPosixPath(path.relative(OUTPUTS_ROOT, abs));
      items.push({ path: rel, mtimeMs: stat.mtimeMs, sizeBytes: stat.size });
    }
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.slice(0, 200);
}

function collectTextUnderPlayground(dir: string, items: TextLibraryItem[]): void {
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
      collectTextUnderPlayground(abs, items);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (!TEXT_LIBRARY_EXT.has(ext)) continue;
      const stat = fs.statSync(abs);
      const rel = toPosixPath(path.relative(OUTPUTS_ROOT, abs));
      if (!rel.startsWith('drafts/playground/')) continue;
      items.push({ path: rel, mtimeMs: stat.mtimeMs, sizeBytes: stat.size });
    }
  }
}

/** Text files under outputs/drafts/playground (recursive), newest first. */
export async function listPlaygroundGlobalTextLibrary(): Promise<TextLibraryItem[]> {
  const items: TextLibraryItem[] = [];
  collectTextUnderPlayground(PLAYGROUND_OUTPUT_DIR, items);
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.slice(0, 200);
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
  // Match in-app generation: video is ready for review, not still "script only"
  await updateSceneStatus(sceneId, 'PENDING_APPROVAL');

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/playground');
}
