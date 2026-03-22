/** Mirrors backend `FilmTimeline` JSON (camelCase). */

export type FilmSequenceJSON = {
  id: string;
  sceneId: string;
  sceneNumber: number;
  title: string;
  renderSrc: string;
  previewSrc: string;
  trimStartSec: number;
  trimEndSec: number;
  transitionOut?: { type: string; durationSec: number };
  lowerThirdTitle?: string;
};

export type FilmTimelineJSON = {
  version: number;
  fps: number;
  width: number;
  height: number;
  projectTitle?: string;
  /** Final clip fades to black over this many seconds (Remotion / preview; ffmpeg stitch ignores). */
  endFadeOutSec?: number;
  sequences: FilmSequenceJSON[];
  overlays?: Array<{
    type: string;
    text: string;
    startSec: number;
    durationSec: number;
  }>;
};
