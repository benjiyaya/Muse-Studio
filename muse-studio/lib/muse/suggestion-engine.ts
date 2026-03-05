import type {
  MuseAgent,
  MuseControlLevel,
  MuseSuggestion,
  SuggestionAction,
  SuggestionType,
  Project,
  Scene,
} from '@/lib/types';

export interface NewSuggestion {
  type: SuggestionType;
  muse: MuseAgent;
  message: string;
  sceneId?: string;
  actions: SuggestionAction[];
}

function limitSuggestions(items: NewSuggestion[], max = 3): NewSuggestion[] {
  return items.slice(0, max);
}

function filterByControlLevel(
  controlLevel: MuseControlLevel,
  suggestions: NewSuggestion[],
): NewSuggestion[] {
  if (controlLevel === 'OBSERVER') {
    // In observer mode, only allow low-risk, advisory suggestions.
    return suggestions.filter((s) => s.type === 'CONSISTENCY' || s.type === 'PACING');
  }
  // ASSISTANT and COLLABORATOR can see all suggestion types for now.
  return suggestions;
}

export function buildStorySuggestions(
  project: Project,
  controlLevel: MuseControlLevel,
): NewSuggestion[] {
  const out: NewSuggestion[] = [];
  const storyline = project.storyline;

  if (!storyline) {
    return [];
  }

  const plotLength = storyline.plotOutline?.length ?? 0;
  if (plotLength > 0 && plotLength < 400) {
    out.push({
      type: 'PACING',
      muse: 'STORY_MUSE',
      message:
        'The main storyline outline is quite short. Consider expanding the middle act to better set up conflicts and reversals.',
      actions: ['REVIEW', 'EDIT', 'DISMISS'],
    });
  }

  if (!storyline.themes || storyline.themes.length === 0) {
    out.push({
      type: 'ENHANCEMENT',
      muse: 'STORY_MUSE',
      message:
        'No explicit themes are captured yet. Defining 3–5 thematic ideas can help guide later scene writing and visual choices.',
      actions: ['REVIEW', 'EDIT', 'DISMISS'],
    });
  }

  if (!storyline.characters || storyline.characters.length < 2) {
    out.push({
      type: 'ENHANCEMENT',
      muse: 'STORY_MUSE',
      message:
        'The character list is very small. Consider adding supporting characters or antagonistic forces to deepen the story dynamics.',
      actions: ['REVIEW', 'EDIT', 'DISMISS'],
    });
  }

  const scenesNeedingDetail =
    project.scenes?.filter((s) => (s.description?.length ?? 0) < 120).length ?? 0;
  if (scenesNeedingDetail > 0) {
    out.push({
      type: 'CONSISTENCY',
      muse: 'STORY_MUSE',
      message:
        `${scenesNeedingDetail} scene(s) have very short descriptions. Adding a few lines of concrete action will make later keyframes and video drafts more precise.`,
      actions: ['REVIEW', 'EDIT', 'DISMISS'],
    });
  }

  return limitSuggestions(filterByControlLevel(controlLevel, out));
}

export function buildSceneSuggestions(
  project: Project,
  scene: Scene,
  controlLevel: MuseControlLevel,
): NewSuggestion[] {
  const out: NewSuggestion[] = [];

  if (!scene.description || scene.description.length < 80) {
    out.push({
      type: 'ENHANCEMENT',
      muse: 'STORY_MUSE',
      message:
        `Scene ${scene.sceneNumber} “${scene.title}” has a very short description. Consider adding more concrete action beats and sensory detail.`,
      sceneId: scene.id,
      actions: ['REVIEW', 'EDIT', 'DISMISS'],
    });
  }

  if (!scene.dialogue && project.currentStage !== 'STORYLINE') {
    out.push({
      type: 'PACING',
      muse: 'STORY_MUSE',
      message:
        `Scene ${scene.sceneNumber} currently has no dialogue. Decide whether this is intentional silence or if a short exchange would help pacing.`,
      sceneId: scene.id,
      actions: ['REVIEW', 'EDIT', 'DISMISS'],
    });
  }

  if (scene.status === 'KEYFRAME' || scene.status === 'DRAFT_QUEUE') {
    const hasKeyframes = scene.keyframes && scene.keyframes.length > 0;
    if (!hasKeyframes) {
      out.push({
        type: 'VISUAL_STYLE',
        muse: 'VISUAL_MUSE',
        message:
          `Scene ${scene.sceneNumber} is in visual production but has no approved keyframes yet. Locking at least one keyframe will stabilize the look of the sequence.`,
        sceneId: scene.id,
        actions: ['VIEW_DETAILS', 'ADJUST', 'DISMISS'],
      });
    }
  }

  return limitSuggestions(filterByControlLevel(controlLevel, out));
}

export function buildVideoSuggestions(
  project: Project,
  scene: Scene,
  controlLevel: MuseControlLevel,
): NewSuggestion[] {
  const out: NewSuggestion[] = [];

  const duration = scene.videoDurationSeconds ?? 0;
  if (duration > 0) {
    if (duration > 45) {
      out.push({
        type: 'PACING',
        muse: 'MOTION_MUSE',
        message:
          `The video draft for Scene ${scene.sceneNumber} runs about ${Math.round(
            duration,
          )} seconds. For short-form pacing, consider trimming to around 30–35 seconds.`,
        sceneId: scene.id,
        actions: ['PREVIEW', 'ADJUST', 'DISMISS'],
      });
    } else if (duration < 15) {
      out.push({
        type: 'PACING',
        muse: 'MOTION_MUSE',
        message:
          `The video draft for Scene ${scene.sceneNumber} is very short. Double-check that all key beats of the scene are visually represented.`,
        sceneId: scene.id,
        actions: ['PREVIEW', 'ADJUST', 'DISMISS'],
      });
    }
  }

  if (scene.status === 'FINAL') {
    const keyframePrompts = scene.keyframes
      ?.map((kf) => kf.generationParams.prompt ?? '')
      .filter(Boolean);
    if (keyframePrompts && keyframePrompts.length > 0) {
      out.push({
        type: 'VISUAL_STYLE',
        muse: 'VISUAL_MUSE',
        message:
          `Scene ${scene.sceneNumber} has an approved video. Review keyframe prompts vs the final video to ensure tone, color palette, and framing still match your intent.`,
        sceneId: scene.id,
        actions: ['VIEW_DETAILS', 'ADJUST', 'DISMISS'],
      });
    }
  }

  return limitSuggestions(filterByControlLevel(controlLevel, out));
}

