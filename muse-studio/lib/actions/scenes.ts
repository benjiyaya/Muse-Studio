'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import type { Scene, KanbanStatus, Keyframe } from '@/lib/types';
import {
  generateSceneSuggestions,
  generateVideoSuggestions,
} from '@/lib/actions/muse-agent';

function newId(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Scene Actions ─────────────────────────────────────────────────────────────

/** Create a new scene in a project. */
export async function createScene(data: {
  projectId: string;
  title: string;
  heading: string;
  description: string;
  dialogue?: string;
  technicalNotes?: string;
}): Promise<string> {
  const id = newId('scene');
  const now = new Date().toISOString();

  const maxRow = db
    .prepare<[string], { max_num: number | null }>(
      'SELECT MAX(scene_number) as max_num FROM scenes WHERE project_id = ?',
    )
    .get(data.projectId);

  const sceneNumber = (maxRow?.max_num ?? 0) + 1;

  db.prepare(`
    INSERT INTO scenes
      (id, project_id, scene_number, title, heading, description, dialogue, technical_notes,
       status, active_muse, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCRIPT', 'STORY_MUSE', ?, ?)
  `).run(
    id,
    data.projectId,
    sceneNumber,
    data.title,
    data.heading,
    data.description,
    data.dialogue ?? null,
    data.technicalNotes ?? null,
    now,
    now,
  );

  // Touch project updated_at
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, data.projectId);

  revalidatePath(`/projects/${data.projectId}`);
  // Fire-and-forget scene-level suggestions.
  generateSceneSuggestions(data.projectId, id).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to generate scene suggestions (createScene)', err);
  });

  return id;
}

/** Update a scene's status (used by Kanban drag-and-drop). */
export async function updateSceneStatus(
  sceneId: string,
  status: KanbanStatus,
): Promise<void> {
  const now = new Date().toISOString();
  db.prepare('UPDATE scenes SET status = ?, updated_at = ? WHERE id = ?').run(status, now, sceneId);

  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);

  if (row) {
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, row.project_id);
    revalidatePath(`/projects/${row.project_id}`);
  }
}

/** Update scene content fields. */
export async function updateScene(
  sceneId: string,
  data: Partial<{
    title: string;
    heading: string;
    description: string;
    dialogue: string;
    technicalNotes: string;
    videoUrl: string;
    videoDurationSeconds: number;
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
  if (data.heading !== undefined) { fields.push('heading = ?'); values.push(data.heading); }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
  if (data.dialogue !== undefined) { fields.push('dialogue = ?'); values.push(data.dialogue); }
  if (data.technicalNotes !== undefined) { fields.push('technical_notes = ?'); values.push(data.technicalNotes); }
  if (data.videoUrl !== undefined) { fields.push('video_url = ?'); values.push(data.videoUrl); }
  if (data.videoDurationSeconds !== undefined) { fields.push('video_duration_seconds = ?'); values.push(data.videoDurationSeconds); }

  values.push(sceneId);
  db.prepare(`UPDATE scenes SET ${fields.join(', ')} WHERE id = ?`).run(...(values as Parameters<typeof db.prepare>[0][]));

  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);
  if (row) {
    revalidatePath(`/projects/${row.project_id}`);
    generateSceneSuggestions(row.project_id, sceneId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to generate scene suggestions (updateScene)', err);
    });
  }
}

/** Delete a scene. */
export async function deleteScene(sceneId: string): Promise<void> {
  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);

  db.prepare('DELETE FROM scenes WHERE id = ?').run(sceneId);

  if (row) revalidatePath(`/projects/${row.project_id}`);
}

// ─── Keyframe Actions ─────────────────────────────────────────────────────────

/** Add a keyframe to a scene. */
export async function createKeyframe(data: {
  sceneId: string;
  source: Keyframe['source'];
  prompt?: string;
  denoiseStrength?: number;
  styleStrength?: number;
  aspectRatio?: string;
}): Promise<string> {
  const id = newId('kf');
  const now = new Date().toISOString();

  const maxRow = db
    .prepare<[string], { max_ord: number | null }>(
      'SELECT MAX(sequence_order) as max_ord FROM keyframes WHERE scene_id = ?',
    )
    .get(data.sceneId);

  const sequenceOrder = (maxRow?.max_ord ?? 0) + 1;

  db.prepare(`
    INSERT INTO keyframes
      (id, scene_id, sequence_order, source, status, prompt,
       denoise_strength, style_strength, aspect_ratio, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.sceneId, sequenceOrder, data.source,
    data.prompt ?? null, data.denoiseStrength ?? null,
    data.styleStrength ?? null, data.aspectRatio ?? null,
    now, now,
  );

  const sceneRow = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(data.sceneId);
  if (sceneRow) revalidatePath(`/projects/${sceneRow.project_id}`);

  return id;
}

/** Update keyframe image paths and/or prompt (called after generation or selection). */
export async function updateKeyframeOutput(
  keyframeId: string,
  data: {
    draftImagePath?: string;
    finalImagePath?: string;
    status?: Keyframe['status'];
    prompt?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (data.draftImagePath !== undefined) { fields.push('draft_image_path = ?'); values.push(data.draftImagePath); }
  if (data.finalImagePath !== undefined) { fields.push('final_image_path = ?'); values.push(data.finalImagePath); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.prompt !== undefined) { fields.push('prompt = ?'); values.push(data.prompt); }

  values.push(keyframeId);
  db.prepare(`UPDATE keyframes SET ${fields.join(', ')} WHERE id = ?`).run(...(values as Parameters<typeof db.prepare>[0][]));

  const row = db
    .prepare<[string], { scene_id: string }>('SELECT scene_id FROM keyframes WHERE id = ?')
    .get(keyframeId);
  if (row) {
    const sceneRow = db
      .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
      .get(row.scene_id);
    if (sceneRow) revalidatePath(`/projects/${sceneRow.project_id}`);
  }
}

// ─── Generation Jobs ──────────────────────────────────────────────────────────

/** Create a generation job record when video generation starts. */
export async function createGenerationJob(data: {
  sceneId: string;
  providerId: string;
  backendJobId?: string;
}): Promise<string> {
  const id = newId('job');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO generation_jobs
      (id, scene_id, backend_job_id, provider_id, status, progress_percent, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', 0, ?, ?)
  `).run(id, data.sceneId, data.backendJobId ?? null, data.providerId, now, now);

  return id;
}

/** Clear a scene's video and move it back to DRAFT_QUEUE (Redo Video). */
export async function clearSceneVideo(sceneId: string): Promise<void> {
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE scenes SET video_url = NULL, status = ?, updated_at = ? WHERE id = ?',
  ).run('DRAFT_QUEUE', now, sceneId);

  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);
  if (row) {
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, row.project_id);
    revalidatePath(`/projects/${row.project_id}`);
  }
}

/** Clear a scene's video AND all keyframes, moving it back to KEYFRAME status (Recreate Keyframe). */
export async function clearSceneVideoAndKeyframes(sceneId: string): Promise<void> {
  const now = new Date().toISOString();

  db.prepare('DELETE FROM keyframes WHERE scene_id = ?').run(sceneId);
  db.prepare(
    'UPDATE scenes SET video_url = NULL, status = ?, updated_at = ? WHERE id = ?',
  ).run('KEYFRAME', now, sceneId);

  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);
  if (row) {
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, row.project_id);
    revalidatePath(`/projects/${row.project_id}`);
  }
}

/** Approve a scene video — move it to FINAL. */
export async function approveSceneVideo(sceneId: string): Promise<void> {
  const now = new Date().toISOString();
  db.prepare('UPDATE scenes SET status = ?, updated_at = ? WHERE id = ?').run('FINAL', now, sceneId);

  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);
  if (row) {
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, row.project_id);
    revalidatePath(`/projects/${row.project_id}`);
  }
}

/** Assign (or clear) a ComfyUI image workflow to a scene. */
export async function setSceneComfyImageWorkflow(
  sceneId: string,
  workflowId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  db.prepare('UPDATE scenes SET comfy_image_workflow_id = ?, updated_at = ? WHERE id = ?')
    .run(workflowId, now, sceneId);
  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);
  if (row) revalidatePath(`/projects/${row.project_id}`);
}

/** Assign (or clear) a ComfyUI video workflow to a scene. */
export async function setSceneComfyVideoWorkflow(
  sceneId: string,
  workflowId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  db.prepare('UPDATE scenes SET comfy_video_workflow_id = ?, updated_at = ? WHERE id = ?')
    .run(workflowId, now, sceneId);
  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
    .get(sceneId);
  if (row) revalidatePath(`/projects/${row.project_id}`);
}

/** Update job status and output path. */
export async function updateGenerationJob(
  jobId: string,
  data: {
    backendJobId?: string;
    status?: string;
    progressPercent?: number;
    message?: string;
    outputPath?: string;
    error?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (data.backendJobId !== undefined) { fields.push('backend_job_id = ?'); values.push(data.backendJobId); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.progressPercent !== undefined) { fields.push('progress_percent = ?'); values.push(data.progressPercent); }
  if (data.message !== undefined) { fields.push('message = ?'); values.push(data.message); }
  if (data.outputPath !== undefined) { fields.push('output_path = ?'); values.push(data.outputPath); }
  if (data.error !== undefined) { fields.push('error = ?'); values.push(data.error); }

  values.push(jobId);
  db.prepare(`UPDATE generation_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...(values as Parameters<typeof db.prepare>[0][]));

  // If job completed, also save output path back to scene
  if (data.status === 'completed' && data.outputPath) {
    const jobRow = db
      .prepare<[string], { scene_id: string }>('SELECT scene_id FROM generation_jobs WHERE id = ?')
      .get(jobId);
    if (jobRow) {
      db.prepare('UPDATE scenes SET video_url = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(`/api/outputs/${data.outputPath}`, 'FINAL', now, jobRow.scene_id);

      const sceneRow = db
        .prepare<[string], { project_id: string }>('SELECT project_id FROM scenes WHERE id = ?')
        .get(jobRow.scene_id);
      if (sceneRow) {
        revalidatePath(`/projects/${sceneRow.project_id}`);
        generateVideoSuggestions(sceneRow.project_id, jobRow.scene_id).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('Failed to generate video suggestions', err);
        });
      }
    }
  }
}
