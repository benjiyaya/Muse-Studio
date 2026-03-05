import type { KanbanStatus, MuseAgent } from './types';

export interface KanbanColumnConfig {
  id: KanbanStatus;
  label: string;
  statusCode: string;
  muse: MuseAgent | null;
  accentColor: string;
  borderTopClass: string;
  dotClass: string;
  badgeBg: string;
  badgeText: string;
}

export const KANBAN_COLUMNS: KanbanColumnConfig[] = [
  {
    id: 'SCRIPT',
    label: 'Script of Scenes',
    statusCode: 'SCRIPT',
    muse: 'STORY_MUSE',
    accentColor: '#8B5CF6',
    borderTopClass: 'border-t-violet-500',
    dotClass: 'bg-violet-500',
    badgeBg: 'bg-violet-500/15',
    badgeText: 'text-violet-400',
  },
  {
    id: 'KEYFRAME',
    label: 'Keyframe Creation',
    statusCode: 'KEYFRAME',
    muse: 'VISUAL_MUSE',
    accentColor: '#3B82F6',
    borderTopClass: 'border-t-blue-500',
    dotClass: 'bg-blue-500',
    badgeBg: 'bg-blue-500/15',
    badgeText: 'text-blue-400',
  },
  {
    id: 'DRAFT_QUEUE',
    label: 'Video Draft Queue',
    statusCode: 'DRAFT_QUEUE',
    muse: 'MOTION_MUSE',
    accentColor: '#F59E0B',
    borderTopClass: 'border-t-amber-500',
    dotClass: 'bg-amber-500',
    badgeBg: 'bg-amber-500/15',
    badgeText: 'text-amber-400',
  },
  {
    id: 'GENERATING',
    label: 'Video Generating',
    statusCode: 'GENERATING',
    muse: 'MOTION_MUSE',
    accentColor: '#F97316',
    borderTopClass: 'border-t-orange-500',
    dotClass: 'bg-orange-500',
    badgeBg: 'bg-orange-500/15',
    badgeText: 'text-orange-400',
  },
  {
    id: 'PENDING_APPROVAL',
    label: 'Awaiting Approval',
    statusCode: 'PENDING_APPROVAL',
    muse: 'MOTION_MUSE',
    accentColor: '#EAB308',
    borderTopClass: 'border-t-yellow-500',
    dotClass: 'bg-yellow-500',
    badgeBg: 'bg-yellow-500/15',
    badgeText: 'text-yellow-400',
  },
  {
    id: 'FINAL',
    label: 'Final Scene',
    statusCode: 'FINAL',
    muse: null,
    accentColor: '#10B981',
    borderTopClass: 'border-t-emerald-500',
    dotClass: 'bg-emerald-500',
    badgeBg: 'bg-emerald-500/15',
    badgeText: 'text-emerald-400',
  },
];

export const MUSE_CONFIG = {
  STORY_MUSE: {
    name: 'Story Muse',
    shortName: 'Story',
    description: 'Narrative & Writing',
    emoji: '✦',
    bgClass: 'bg-violet-500/15',
    textClass: 'text-violet-400',
    borderClass: 'border-violet-500/30',
    dotClass: 'bg-violet-400',
    color: '#8B5CF6',
  },
  VISUAL_MUSE: {
    name: 'Visual Muse',
    shortName: 'Visual',
    description: 'Visual Creation',
    emoji: '◈',
    bgClass: 'bg-blue-500/15',
    textClass: 'text-blue-400',
    borderClass: 'border-blue-500/30',
    dotClass: 'bg-blue-400',
    color: '#3B82F6',
  },
  MOTION_MUSE: {
    name: 'Motion Muse',
    shortName: 'Motion',
    description: 'Video Production',
    emoji: '▶',
    bgClass: 'bg-amber-500/15',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
    dotClass: 'bg-amber-400',
    color: '#F59E0B',
  },
} as const;

export const STAGE_CONFIG = {
  STORYLINE: {
    label: 'Storyline',
    step: 1,
    textClass: 'text-violet-400',
    bgClass: 'bg-violet-500/10',
    borderClass: 'border-violet-500/30',
  },
  SCRIPT: {
    label: 'Script',
    step: 2,
    textClass: 'text-blue-400',
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/30',
  },
  KEYFRAME_VIDEO: {
    label: 'Production',
    step: 3,
    textClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
  },
} as const;

export const CONTROL_LEVEL_CONFIG = {
  OBSERVER: {
    label: 'Observer',
    description: 'Muse monitors only',
  },
  ASSISTANT: {
    label: 'Assistant',
    description: 'Muse suggests on request',
  },
  COLLABORATOR: {
    label: 'Collaborator',
    description: 'Muse auto-generates',
  },
} as const;

export const SUGGESTION_TYPE_CONFIG = {
  CONSISTENCY: {
    label: 'Consistency',
    bgClass: 'bg-violet-500/15',
    textClass: 'text-violet-400',
    borderClass: 'border-violet-500/30',
  },
  ENHANCEMENT: {
    label: 'Enhancement',
    bgClass: 'bg-blue-500/15',
    textClass: 'text-blue-400',
    borderClass: 'border-blue-500/30',
  },
  VISUAL_STYLE: {
    label: 'Visual Style',
    bgClass: 'bg-cyan-500/15',
    textClass: 'text-cyan-400',
    borderClass: 'border-cyan-500/30',
  },
  PACING: {
    label: 'Pacing',
    bgClass: 'bg-amber-500/15',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
  },
} as const;
