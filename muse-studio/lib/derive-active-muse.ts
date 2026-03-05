import type { Scene, MuseAgent, KanbanStatus } from './types';

// Production (Motion Muse — amber):  any scene in Draft Queue, Generating, or Awaiting Approval
// Script   (Visual Muse — blue):     any scene in Keyframe Creation (and none in production)
// Story    (Story Muse — purple):    default

const PRODUCTION_STATUSES: KanbanStatus[] = ['DRAFT_QUEUE', 'GENERATING', 'PENDING_APPROVAL'];
const SCRIPT_STATUSES: KanbanStatus[] = ['KEYFRAME'];

export function deriveActiveMuse(scenes: Scene[]): MuseAgent {
  if (scenes.some((s) => PRODUCTION_STATUSES.includes(s.status))) return 'MOTION_MUSE';
  if (scenes.some((s) => SCRIPT_STATUSES.includes(s.status))) return 'VISUAL_MUSE';
  return 'STORY_MUSE';
}
