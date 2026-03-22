import React from 'react';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AbsoluteFill, OffthreadVideo } from 'remotion';
import {
  endFadeOutOverlapFrames,
  fadeOverlapFramesBetween,
} from '../computeFilmMasterDuration';

export type FilmSequence = {
  id: string;
  sceneId: string;
  sceneNumber: number;
  title: string;
  renderSrc: string;
  previewSrc: string;
  trimStartSec: number;
  trimEndSec: number;
  transitionOut?: { type: string; durationSec: number };
};

export type FilmTimelineProps = {
  version: number;
  fps: number;
  width: number;
  height: number;
  projectTitle?: string;
  sequences: FilmSequence[];
  /** Legacy JSON field; not rendered. */
  overlays?: unknown[];
  /** Crossfade final clip into black (Remotion). */
  endFadeOutSec?: number;
};

export const FilmMaster: React.FC<FilmTimelineProps> = ({
  fps,
  sequences,
  endFadeOutSec,
}) => {
  const safeFps = fps > 0 ? fps : 24;

  const parts: React.ReactNode[] = [];
  for (let i = 0; i < sequences.length; i++) {
    const seq = sequences[i];
    const startFrom = Math.max(0, Math.round(seq.trimStartSec * safeFps));
    const endAt = Math.max(
      startFrom + 1,
      Math.round(seq.trimEndSec * safeFps),
    );
    const durationInFrames = endAt - startFrom;

    parts.push(
      <TransitionSeries.Sequence key={seq.id} durationInFrames={durationInFrames}>
        <AbsoluteFill>
          <OffthreadVideo
            src={seq.renderSrc}
            startFrom={startFrom}
            endAt={endAt}
          />
        </AbsoluteFill>
      </TransitionSeries.Sequence>,
    );

    if (i < sequences.length - 1) {
      const overlap = fadeOverlapFramesBetween(seq, sequences[i + 1], safeFps);
      if (overlap > 0) {
        parts.push(
          <TransitionSeries.Transition
            key={`${seq.id}__tr`}
            timing={linearTiming({ durationInFrames: overlap })}
            presentation={fade()}
          />,
        );
      }
    }
  }

  if (sequences.length > 0) {
    const last = sequences[sequences.length - 1]!;
    const endOverlap = endFadeOutOverlapFrames(last, endFadeOutSec, safeFps);
    if (endOverlap > 0) {
      parts.push(
        <TransitionSeries.Transition
          key="__end_fade_to_black"
          timing={linearTiming({ durationInFrames: endOverlap })}
          presentation={fade()}
        />,
      );
      parts.push(
        <TransitionSeries.Sequence key="__black_end" durationInFrames={endOverlap}>
          <AbsoluteFill style={{ backgroundColor: '#000' }} />
        </TransitionSeries.Sequence>,
      );
    }
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <TransitionSeries>{parts}</TransitionSeries>
    </AbsoluteFill>
  );
};
