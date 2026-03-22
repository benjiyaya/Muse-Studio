/**
 * Duplicate of packages/remotion-film/src/computeFilmMasterDuration.ts — keep logic identical.
 */

export type FilmSequenceTiming = {
  trimStartSec: number;
  trimEndSec: number;
  transitionOut?: { type: string; durationSec: number };
};

export function segmentDurationInFrames(seq: FilmSequenceTiming, fps: number): number {
  const safeFps = fps > 0 ? fps : 24;
  const startFrom = Math.max(0, Math.round(seq.trimStartSec * safeFps));
  const endAt = Math.max(startFrom + 1, Math.round(seq.trimEndSec * safeFps));
  return endAt - startFrom;
}

export function fadeOverlapFramesBetween(
  left: FilmSequenceTiming,
  right: FilmSequenceTiming,
  fps: number,
): number {
  const safeFps = fps > 0 ? fps : 24;
  const t = left.transitionOut;
  if (!t) {
    return 0;
  }
  const kind = String(t.type || '').toLowerCase();
  if (kind !== 'fade') {
    return 0;
  }
  const dur = Number(t.durationSec);
  if (!Number.isFinite(dur) || dur <= 0) {
    return 0;
  }
  const leftDurSec = Math.max(0, left.trimEndSec - left.trimStartSec);
  const rightDurSec = Math.max(0, right.trimEndSec - right.trimStartSec);
  const capSec = Math.min(leftDurSec, rightDurSec, dur);
  if (capSec < 0.05) {
    return 0;
  }
  const frames = Math.round(capSec * safeFps);
  return frames >= 1 ? frames : 0;
}

export function endFadeOutOverlapFrames(
  last: FilmSequenceTiming,
  endFadeOutSec: number | undefined,
  fps: number,
): number {
  const safeFps = fps > 0 ? fps : 24;
  const dur = Number(endFadeOutSec);
  if (!Number.isFinite(dur) || dur <= 0) {
    return 0;
  }
  const leftDurSec = Math.max(0, last.trimEndSec - last.trimStartSec);
  const capSec = Math.min(leftDurSec, dur);
  if (capSec < 0.05) {
    return 0;
  }
  const frames = Math.round(capSec * safeFps);
  return frames >= 1 ? frames : 0;
}

export function computeFilmMasterDurationInFrames(input: {
  fps: number;
  sequences: FilmSequenceTiming[];
  endFadeOutSec?: number;
}): number {
  const { fps, sequences } = input;
  if (!sequences.length) {
    return 1;
  }
  let total = 0;
  for (const seq of sequences) {
    total += segmentDurationInFrames(seq, fps);
  }
  for (let i = 0; i < sequences.length - 1; i++) {
    total -= fadeOverlapFramesBetween(sequences[i], sequences[i + 1], fps);
  }
  return Math.max(1, total);
}
