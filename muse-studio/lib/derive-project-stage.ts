import type { ProjectStage, Scene, KanbanStatus } from './types';

/**
 * Derive the high-level project stage (Storyline / Script / Production)
 * from the project's scenes and current stored stage.
 *
 * Rules:
 * - STORYLINE stays active while the storyline is being authored
 *   (currentStage === 'STORYLINE' and not yet confirmed).
 * - Once scenes exist:
 *   - If ANY scene has moved beyond SCRIPT into visual / video work
 *     (KEYFRAME, DRAFT_QUEUE, GENERATING, PENDING_APPROVAL, FINAL)
 *     → project is in KEYFRAME_VIDEO (Production).
 *   - Otherwise (all scenes still SCRIPT) → project is in SCRIPT.
 * - When there are no scenes yet, we keep whatever stage the project
 *   currently reports (typically STORYLINE or SCRIPT).
 */
export function deriveProjectStage(params: {
  currentStage: ProjectStage;
  storylineConfirmed: boolean;
  scenes: Scene[];
}): ProjectStage {
  const { currentStage, storylineConfirmed, scenes } = params;

  // Preserve explicit STORYLINE stage while storyline is still pending.
  if (currentStage === 'STORYLINE' && !storylineConfirmed) {
    return 'STORYLINE';
  }

  if (!scenes || scenes.length === 0) {
    return currentStage;
  }

  const productionStatuses: KanbanStatus[] = [
    'KEYFRAME',
    'DRAFT_QUEUE',
    'GENERATING',
    'PENDING_APPROVAL',
    'FINAL',
  ];

  const hasProductionScene = scenes.some((s) => productionStatuses.includes(s.status));

  if (hasProductionScene) {
    return 'KEYFRAME_VIDEO';
  }

  return 'SCRIPT';
}

