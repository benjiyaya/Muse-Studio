'use server';

import { revalidatePath } from 'next/cache';
import { getProjectById } from '@/lib/actions/projects';
import type { Project, Scene } from '@/lib/types';
import {
  buildSceneSuggestions,
  buildStorySuggestions,
  buildVideoSuggestions,
} from '@/lib/muse/suggestion-engine';
import { createMuseSuggestions } from '@/lib/actions/muse-suggestions';
import { db } from '@/db';

async function loadScene(projectId: string, sceneId: string): Promise<Scene | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;
  const scene = project.scenes.find((s) => s.id === sceneId);
  return scene ?? null;
}

export async function generateStorySuggestions(projectId: string): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;

  const suggestions = buildStorySuggestions(project, project.museControlLevel);
  await createMuseSuggestions(project.id, suggestions);
}

export async function generateSceneSuggestions(
  projectId: string,
  sceneId: string,
): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return;

  const suggestions = buildSceneSuggestions(project, scene, project.museControlLevel);
  await createMuseSuggestions(project.id, suggestions);
}

export async function generateVideoSuggestions(
  projectId: string,
  sceneId: string,
): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return;

  const suggestions = buildVideoSuggestions(project, scene, project.museControlLevel);
  await createMuseSuggestions(project.id, suggestions);
}

/**
 * Regenerate suggestions for a project on demand (used by Refresh button).
 * Currently focuses on storyline + all scenes. Video suggestions are regenerated
 * only for scenes that already have a video_url.
 */
export async function refreshMuseSuggestions(projectId: string): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;

  const controlLevel = project.museControlLevel;
  const storylineSuggestions = buildStorySuggestions(project, controlLevel);

  const sceneSuggestions = project.scenes.flatMap((scene) =>
    buildSceneSuggestions(project, scene, controlLevel),
  );

  const videoScenes = project.scenes.filter((s) => s.videoUrl);
  const videoSuggestions = videoScenes.flatMap((scene) =>
    buildVideoSuggestions(project, scene, controlLevel),
  );

  await createMuseSuggestions(project.id, [
    ...storylineSuggestions,
    ...sceneSuggestions,
    ...videoSuggestions,
  ]);
}

