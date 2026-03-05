export type MuseAgent = 'STORY_MUSE' | 'VISUAL_MUSE' | 'MOTION_MUSE';
export type ProjectStage = 'STORYLINE' | 'SCRIPT' | 'KEYFRAME_VIDEO';
export type StorylineSource = 'UPLOAD' | 'MUSE_GENERATED' | 'MANUAL';
export type KanbanStatus =
  | 'SCRIPT'
  | 'KEYFRAME'
  | 'DRAFT_QUEUE'
  | 'GENERATING'
  | 'PENDING_APPROVAL'
  | 'FINAL';
export type KeyframeStatus = 'DRAFT' | 'REFINING' | 'APPROVED';
export type KeyframeSource = 'UPLOAD' | 'VISUAL_MUSE';
export type MuseControlLevel = 'OBSERVER' | 'ASSISTANT' | 'COLLABORATOR';
export type SuggestionType = 'CONSISTENCY' | 'ENHANCEMENT' | 'VISUAL_STYLE' | 'PACING';
export type SuggestionAction =
  | 'REVIEW'
  | 'FIX'
  | 'PREVIEW'
  | 'ACCEPT'
  | 'EDIT'
  | 'DISMISS'
  | 'VIEW_DETAILS'
  | 'ADJUST';

export interface ImageAsset {
  id: string;
  url: string;
  width: number;
  height: number;
  alt?: string;
}

// ── Character sheets ───────────────────────────────────────────────────────────

export type CharacterImageKind =
  | 'FACE'
  | 'FULL_BODY'
  | 'EXPRESSION'
  | 'OUTFIT'
  | 'TURNAROUND'
  | 'ACTION'
  | 'OTHER';

export type CharacterImageSource = 'UPLOAD' | 'KEYFRAME' | 'EXTERNAL';

export interface CharacterImage {
  id: string;
  characterId: string;
  kind: CharacterImageKind;
  image: ImageAsset;
  source: CharacterImageSource;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  shortBio?: string;
  designNotes?: string;
  primaryRole?: string;
  sortOrder: number;
  promptPositive?: string;
  promptNegative?: string;
  tags: string[];
  images: CharacterImage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerationParams {
  prompt?: string;
  denoiseStrength?: number;
  styleStrength?: number;
  aspectRatio?: string;
  referenceWeight?: number;
}

export interface Keyframe {
  keyframeId: string;
  sequenceOrder: number;
  source: KeyframeSource;
  draftImage?: ImageAsset;
  finalImage?: ImageAsset;
  referenceImages: ImageAsset[];
  generationParams: GenerationParams;
  status: KeyframeStatus;
}

export interface Scene {
  id: string;
  sceneNumber: number;
  title: string;
  heading: string;
  description: string;
  dialogue?: string;
  technicalNotes?: string;
  status: KanbanStatus;
  keyframes: Keyframe[];
  videoUrl?: string;
  videoDurationSeconds?: number;
  comfyImageWorkflowId?: string;
  comfyVideoWorkflowId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StorylineContent {
  logline?: string;
  plotOutline: string;
  characters: string[];
  themes: string[];
  genre?: string;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  storyline?: StorylineContent;
  storylineSource: StorylineSource;
  storylineConfirmed: boolean;
  currentStage: ProjectStage;
  activeMuse: MuseAgent;
  scenes: Scene[];
  museControlLevel: MuseControlLevel;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal project data for the read-only overview sheet (title, description, storyline, source, scenes). */
export type ProjectOverview = Pick<
  Project,
  'title' | 'description' | 'storyline' | 'storylineSource' | 'scenes'
>;

export interface MuseSuggestion {
  id: string;
  type: SuggestionType;
  muse: MuseAgent;
  message: string;
  sceneId?: string;
  actions: SuggestionAction[];
  createdAt: Date;
  isRead: boolean;
}
