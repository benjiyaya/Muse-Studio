'use client';

import React from 'react';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AbsoluteFill, OffthreadVideo } from 'remotion';
import {
  endFadeOutOverlapFrames,
  fadeOverlapFramesBetween,
} from '@/lib/computeFilmMasterDuration';
import type { FilmTimelineJSON } from '@/types/film-timeline';

type Props = FilmTimelineJSON & {
  /** Refine-timeline editor only — not used by CLI `FilmMaster` export. */
  showPreviewLabels?: boolean;
};

function PreviewLabelsOverlay({
  projectTitle,
  sceneNumber,
  title,
  compWidth,
}: {
  projectTitle?: string;
  sceneNumber: number;
  title: string;
  compWidth: number;
}) {
  const w = compWidth > 0 ? compWidth : 1920;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {projectTitle ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '16%',
            textAlign: 'center',
            fontFamily: 'Georgia, ui-serif, serif',
            fontWeight: 700,
            fontSize: w * 0.055,
            lineHeight: 1.12,
            color: '#fff',
            textShadow:
              '0 0 48px rgba(0,0,0,1), 0 4px 28px rgba(0,0,0,0.95), 0 0 2px #000',
            padding: '0 5%',
          }}
        >
          {projectTitle}
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: '9%',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
          fontSize: w * 0.024,
          color: '#f5f5f5',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          textShadow: '0 2px 22px rgba(0,0,0,1), 0 0 2px #000',
        }}
      >
        Scene {sceneNumber}
        {title ? ` · ${title}` : ''}
      </div>
    </AbsoluteFill>
  );
}

/**
 * In-browser preview (mirrors packages/remotion-film FilmMaster timing).
 * Optional `showPreviewLabels` adds project + scene titles on picture for Refine UI only.
 */
export const FilmMasterPreview: React.FC<Props> = ({
  fps,
  sequences,
  endFadeOutSec,
  projectTitle,
  width,
  showPreviewLabels = false,
}) => {
  const safeFps = fps > 0 ? fps : 24;
  const compWidth = width > 0 ? width : 1920;

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
          {showPreviewLabels ? (
            <PreviewLabelsOverlay
              projectTitle={projectTitle}
              sceneNumber={seq.sceneNumber}
              title={seq.title}
              compWidth={compWidth}
            />
          ) : null}
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
