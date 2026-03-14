'use server';

import { getProjectById } from '@/lib/actions/projects';
import type { Project, Scene } from '@/lib/types';
import {
  buildSceneSuggestions,
  buildStorySuggestions,
  buildVideoSuggestions,
} from '@/lib/muse/suggestion-engine';
import { createMuseSuggestions } from '@/lib/actions/muse-suggestions';
import { backendClient } from '@/lib/backend-client';
import type { NewSuggestion } from '@/lib/muse/suggestion-engine';

/** Convert project to JSON-serializable dict for backend. */
function projectToDict(project: Project): Record<string, unknown> {
  return JSON.parse(JSON.stringify(project));
}

/** Map backend suggestion to NewSuggestion. */
function toNewSuggestion(s: {
  type: string;
  muse: string;
  message: string;
  sceneId?: string;
  actions: string[];
}): NewSuggestion {
  return {
    type: s.type as NewSuggestion['type'],
    muse: s.muse as NewSuggestion['muse'],
    message: s.message,
    sceneId: s.sceneId,
    actions: s.actions as NewSuggestion['actions'],
  };
}

/** Get suggestions from backend agent; fall back to rule-based on error. */
async function getSuggestionsForProject(project: Project): Promise<NewSuggestion[]> {
  try {
    const res = await backendClient.getAgentSuggestions({
      project: projectToDict(project),
      control_level: project.museControlLevel,
    });
    if (res.error && (!res.suggestions || res.suggestions.length === 0)) {
      if (res.fallback_suggestions?.length) {
        return res.fallback_suggestions.map(toNewSuggestion);
      }
      throw new Error(res.error);
    }
    return (res.suggestions || []).map(toNewSuggestion);
  } catch {
    return [
      ...buildStorySuggestions(project, project.museControlLevel),
      ...project.scenes.flatMap((scene) =>
        buildSceneSuggestions(project, scene, project.museControlLevel),
      ),
      ...project.scenes
        .filter((s) => s.videoUrl)
        .flatMap((scene) =>
          buildVideoSuggestions(project, scene, project.museControlLevel),
        ),
    ];
  }
}

export async function generateStorySuggestions(projectId: string): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;

  const suggestions = await getSuggestionsForProject(project);
  await createMuseSuggestions(project.id, suggestions.slice(0, 5));
}

export async function generateSceneSuggestions(
  projectId: string,
  sceneId: string,
): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return;

  const suggestions = await getSuggestionsForProject(project);
  const sceneSuggestions = suggestions.filter((s) => s.sceneId === sceneId);
  await createMuseSuggestions(project.id, sceneSuggestions.slice(0, 5));
}

export async function generateVideoSuggestions(
  projectId: string,
  sceneId: string,
): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return;

  const suggestions = await getSuggestionsForProject(project);
  const videoSuggestions = suggestions.filter(
    (s) => s.sceneId === sceneId && s.muse === 'MOTION_MUSE',
  );
  await createMuseSuggestions(project.id, videoSuggestions.slice(0, 5));
}

/**
 * Regenerate suggestions for a project on demand (used by Refresh button).
 * Always uses backend LangGraph agent; falls back to rule-based on error.
 */
export async function refreshMuseSuggestions(projectId: string): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;

  const suggestions = await getSuggestionsForProject(project);
  await createMuseSuggestions(project.id, suggestions.slice(0, 10));
}

