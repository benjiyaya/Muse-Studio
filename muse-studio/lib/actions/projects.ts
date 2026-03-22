'use server';

import { revalidatePath } from 'next/cache';
import path from 'path';
import fs from 'fs';
import { db } from '@/db';
import type { Project, Scene, Keyframe, StorylineContent, ImageAsset } from '@/lib/types';
import { generateStorySuggestions } from '@/lib/actions/muse-agent';
import { backendClient } from '@/lib/backend-client';

// ─── Row types returned by SQLite ─────────────────────────────────────────────

interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  storyline_logline: string | null;
  storyline_plot_outline: string | null;
  storyline_characters: string | null;
  storyline_themes: string | null;
  storyline_genre: string | null;
  storyline_source: string;
  storyline_confirmed: number;
  current_stage: string;
  active_muse: string;
  muse_control_level: string;
  created_at: string;
  updated_at: string;
  scene_count?: number;
  final_scene_count?: number;
}

interface SceneRow {
  id: string;
  project_id: string;
  scene_number: number;
  title: string;
  heading: string;
  description: string;
  dialogue: string | null;
  technical_notes: string | null;
  status: string;
  video_url: string | null;
  video_duration_seconds: number | null;
  active_muse: string | null;
  comfy_image_workflow_id: string | null;
  comfy_video_workflow_id: string | null;
  created_at: string;
  updated_at: string;
}

interface KeyframeRow {
  id: string;
  scene_id: string;
  sequence_order: number;
  source: string;
  status: string;
  draft_image_path: string | null;
  final_image_path: string | null;
  prompt: string | null;
  denoise_strength: number | null;
  style_strength: number | null;
  aspect_ratio: string | null;
  created_at: string;
  updated_at: string;
}

interface ReferenceImageRow {
  id: string;
  keyframe_id: string;
  url: string;
  width: number;
  height: number;
  alt: string | null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapKeyframe(row: KeyframeRow, refs: ReferenceImageRow[]): Keyframe {
  const referenceImages: ImageAsset[] = refs.map((r) => ({
    id: r.id, url: r.url, width: r.width, height: r.height, alt: r.alt ?? undefined,
  }));

  const draftImage: ImageAsset | undefined = row.draft_image_path
    ? { id: `${row.id}-draft`, url: `/api/outputs/${row.draft_image_path}`, width: 0, height: 0 }
    : undefined;

  const finalImage: ImageAsset | undefined = row.final_image_path
    ? { id: `${row.id}-final`, url: `/api/outputs/${row.final_image_path}`, width: 0, height: 0 }
    : undefined;

  return {
    keyframeId: row.id,
    sequenceOrder: row.sequence_order,
    source: row.source as Keyframe['source'],
    status: row.status as Keyframe['status'],
    draftImage,
    finalImage,
    referenceImages,
    generationParams: {
      prompt: row.prompt ?? undefined,
      denoiseStrength: row.denoise_strength ?? undefined,
      styleStrength: row.style_strength ?? undefined,
      aspectRatio: row.aspect_ratio ?? undefined,
    },
  };
}

function mapScene(row: SceneRow, keyframes: Keyframe[]): Scene {
  return {
    id: row.id,
    sceneNumber: row.scene_number,
    title: row.title,
    heading: row.heading,
    description: row.description,
    dialogue: row.dialogue ?? undefined,
    technicalNotes: row.technical_notes ?? undefined,
    status: row.status as Scene['status'],
    keyframes,
    videoUrl: row.video_url ?? undefined,
    videoDurationSeconds: row.video_duration_seconds ?? undefined,
    activeMuse: row.active_muse ? (row.active_muse as Scene['activeMuse']) : undefined,
    comfyImageWorkflowId: row.comfy_image_workflow_id ?? undefined,
    comfyVideoWorkflowId: row.comfy_video_workflow_id ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapProject(row: ProjectRow, scenes: Scene[]): Project {
  const storyline: Project['storyline'] =
    row.storyline_plot_outline
      ? {
          logline: row.storyline_logline ?? undefined,
          plotOutline: row.storyline_plot_outline,
          characters: row.storyline_characters ? JSON.parse(row.storyline_characters) : [],
          themes: row.storyline_themes ? JSON.parse(row.storyline_themes) : [],
          genre: row.storyline_genre ?? undefined,
        }
      : undefined;

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    thumbnail: row.thumbnail ?? undefined,
    storyline,
    storylineSource: row.storyline_source as Project['storylineSource'],
    storylineConfirmed: row.storyline_confirmed === 1,
    currentStage: row.current_stage as Project['currentStage'],
    activeMuse: row.active_muse as Project['activeMuse'],
    museControlLevel: row.muse_control_level as Project['museControlLevel'],
    scenes,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadScenesForProject(projectId: string): Scene[] {
  const sceneRows = db
    .prepare<[string], SceneRow>('SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number')
    .all(projectId);

  return sceneRows.map((sceneRow) => {
    const kfRows = db
      .prepare<[string], KeyframeRow>('SELECT * FROM keyframes WHERE scene_id = ? ORDER BY sequence_order')
      .all(sceneRow.id);

    const keyframes = kfRows.map((kfRow) => {
      const refs = db
        .prepare<[string], ReferenceImageRow>('SELECT * FROM reference_images WHERE keyframe_id = ?')
        .all(kfRow.id);
      return mapKeyframe(kfRow, refs);
    });

    return mapScene(sceneRow, keyframes);
  });
}

function newId(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Return all projects with scenes (no keyframes loaded — for list view). */
export async function getProjects(): Promise<Project[]> {
  const rows = db
    .prepare<[], ProjectRow>('SELECT * FROM projects ORDER BY updated_at DESC')
    .all();

  return rows.map((row) => {
    const sceneRows = db
      .prepare<[string], SceneRow>('SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number')
      .all(row.id);

    const scenes = sceneRows.map((s) => mapScene(s, []));
    return mapProject(row, scenes);
  });
}

/** Return a single project with all scenes and keyframes. */
export async function getProjectById(id: string): Promise<Project | null> {
  const row = db
    .prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?')
    .get(id);

  if (!row) return null;

  const scenes = loadScenesForProject(id);
  const project = mapProject(row, scenes);

  // Phase 2.5: Sync project to backend for agent data access (fire-and-forget)
  backendClient
    .syncProjectToBackend(id, JSON.parse(JSON.stringify(project)))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[projects] Failed to sync project to backend', { id, err });
    });

  return project;
}

/** Create a new project. Returns the created project. */
export async function createProject(data: {
  title: string;
  description?: string;
  storylineSource: 'MUSE_GENERATED' | 'UPLOAD' | 'MANUAL';
  museControlLevel?: Project['museControlLevel'];
}): Promise<Project> {
  const id = newId('proj');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects
      (id, title, description, storyline_source, storyline_confirmed,
       current_stage, active_muse, muse_control_level, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 'STORYLINE', 'STORY_MUSE', ?, ?, ?)
  `).run(
    id,
    data.title,
    data.description ?? null,
    data.storylineSource,
    data.museControlLevel ?? 'ASSISTANT',
    now,
    now,
  );

  revalidatePath('/projects');
  const project = await getProjectById(id);
  return project!;
}

/** Update project metadata fields. */
export async function updateProject(
  id: string,
  data: Partial<{
    title: string;
    description: string;
    thumbnail: string;
    currentStage: Project['currentStage'];
    activeMuse: Project['activeMuse'];
    museControlLevel: Project['museControlLevel'];
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
  if (data.thumbnail !== undefined) { fields.push('thumbnail = ?'); values.push(data.thumbnail); }
  if (data.currentStage !== undefined) { fields.push('current_stage = ?'); values.push(data.currentStage); }
  if (data.activeMuse !== undefined) { fields.push('active_muse = ?'); values.push(data.activeMuse); }
  if (data.museControlLevel !== undefined) { fields.push('muse_control_level = ?'); values.push(data.museControlLevel); }

  values.push(id);
  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...(values as Parameters<typeof db.prepare>[0][]));

  revalidatePath('/projects');
  revalidatePath(`/projects/${id}`);
}

/** Save confirmed storyline and advance the project to SCRIPT stage. */
export async function confirmStoryline(
  id: string,
  storyline: StorylineContent,
): Promise<void> {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE projects SET
      storyline_logline = ?,
      storyline_plot_outline = ?,
      storyline_characters = ?,
      storyline_themes = ?,
      storyline_genre = ?,
      storyline_confirmed = 1,
      current_stage = 'SCRIPT',
      updated_at = ?
    WHERE id = ?
  `).run(
    storyline.logline ?? null,
    storyline.plotOutline,
    JSON.stringify(storyline.characters),
    JSON.stringify(storyline.themes),
    storyline.genre ?? null,
    now,
    id,
  );

  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');

  // Fire-and-forget generation of story-level Muse suggestions.
  generateStorySuggestions(id).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to generate story suggestions', err);
  });
}

/** Delete a project and all its cascaded data. */
export async function deleteProject(id: string): Promise<void> {
  await deleteProjectAndAssets(id);
}

/** Delete a project, its cascaded DB data, and associated media files under outputs/. */
export async function deleteProjectAndAssets(projectId: string): Promise<void> {
  // Validate project exists
  const row = db
    .prepare<[string], { id: string }>('SELECT id FROM projects WHERE id = ?')
    .get(projectId);
  if (!row) {
    throw new Error('Project not found');
  }

  // Collect file paths before deleting DB rows
  const outputsRoot = path.join(process.cwd(), 'outputs');
  const filePaths = new Set<string>();

  const normalizeOutputsRelative = (value: string | null): string | null => {
    if (!value) return null;
    let rel = value.trim();
    if (!rel) return null;

    const prefix = '/api/outputs/';
    const idx = rel.indexOf(prefix);
    if (idx !== -1) {
      rel = rel.slice(idx + prefix.length);
    }

    // Strip protocol/host if present, keep only path after /api/outputs/
    if (rel.startsWith('http://') || rel.startsWith('https://')) {
      try {
        const url = new URL(rel);
        const p = url.pathname;
        const pIdx = p.indexOf(prefix);
        if (pIdx !== -1) {
          rel = p.slice(pIdx + prefix.length);
        }
      } catch {
        // fall through and use raw rel
      }
    }

    rel = rel.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    return rel || null;
  };

  const addRelative = (rel: string | null) => {
    if (!rel) return;
    const abs = path.normalize(path.join(outputsRoot, rel));
    if (!abs.startsWith(outputsRoot)) return;
    filePaths.add(abs);
  };

  // Draft/final keyframe images
  const keyframeRows = db
    .prepare<[string], { draft_image_path: string | null; final_image_path: string | null }>(
      `SELECT k.draft_image_path, k.final_image_path
       FROM keyframes k
       JOIN scenes s ON k.scene_id = s.id
       WHERE s.project_id = ?`,
    )
    .all(projectId);
  for (const kf of keyframeRows) {
    addRelative(normalizeOutputsRelative(kf.draft_image_path));
    addRelative(normalizeOutputsRelative(kf.final_image_path));
  }

  // Reference images (stored as URLs)
  const refRows = db
    .prepare<[string], { url: string }>(
      `SELECT r.url
       FROM reference_images r
       JOIN keyframes k ON r.keyframe_id = k.id
       JOIN scenes s ON k.scene_id = s.id
       WHERE s.project_id = ?`,
    )
    .all(projectId);
  for (const ref of refRows) {
    addRelative(normalizeOutputsRelative(ref.url));
  }

  // Scene video URLs
  const sceneVideoRows = db
    .prepare<[string], { video_url: string | null }>(
      'SELECT video_url FROM scenes WHERE project_id = ?',
    )
    .all(projectId);
  for (const scene of sceneVideoRows) {
    addRelative(normalizeOutputsRelative(scene.video_url));
  }

  // Generation job outputs
  const jobRows = db
    .prepare<[string], { output_path: string | null }>(
      `SELECT j.output_path
       FROM generation_jobs j
       JOIN scenes s ON j.scene_id = s.id
       WHERE s.project_id = ?`,
    )
    .all(projectId);
  for (const job of jobRows) {
    addRelative(normalizeOutputsRelative(job.output_path));
  }

  // Project-scoped playground + promoted library folders (may not be referenced in DB rows)
  const libraryDir = path.join(outputsRoot, 'drafts', projectId, 'library');
  const playgroundProjDir = path.join(outputsRoot, 'drafts', 'playground', projectId);
  for (const dir of [libraryDir, playgroundProjDir]) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[projects] Failed to remove project media directory', { projectId, dir, err });
    }
  }

  // Perform DB delete (cascades will remove child rows)
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

  // Best-effort file cleanup; failures are logged but not surfaced to the user.
  for (const abs of filePaths) {
    try {
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[projects] Failed to delete asset file', { projectId, file: abs, err });
    }
  }

  revalidatePath('/projects');
}
