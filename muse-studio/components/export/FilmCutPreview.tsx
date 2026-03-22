'use client';

import { useEffect, useMemo, useState } from 'react';
import { Player } from '@remotion/player';
import { FilmMasterPreview } from '@/components/remotion/FilmMasterPreview';
import { computeFilmMasterDurationInFrames } from '@/lib/computeFilmMasterDuration';
import { cn } from '@/lib/utils';
import type { FilmTimelineJSON } from '@/types/film-timeline';

function timelineForBrowser(origin: string, timeline: FilmTimelineJSON): FilmTimelineJSON {
  return {
    ...timeline,
    sequences: timeline.sequences.map((s) => ({
      ...s,
      renderSrc:
        s.previewSrc.startsWith('http://') || s.previewSrc.startsWith('https://')
          ? s.previewSrc
          : `${origin}${s.previewSrc.startsWith('/') ? '' : '/'}${s.previewSrc}`,
    })),
  };
}

export function FilmCutPreview({
  timeline,
  variant = 'default',
  /** When true, stretch to fill a flex parent (Refine timeline two-column row). */
  fillHeight = false,
}: {
  timeline: FilmTimelineJSON;
  /** `editor` = taller player for timeline refine layout */
  variant?: 'default' | 'editor';
  fillHeight?: boolean;
}) {
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const inputProps = useMemo(() => {
    const base = origin ? timelineForBrowser(origin, timeline) : timeline;
    return {
      ...base,
      /** Editor-only: project + scene titles on picture. CLI `FilmMaster` render omits these. */
      showPreviewLabels: variant === 'editor',
    };
  }, [origin, timeline, variant]);

  const durationInFrames = useMemo(
    () =>
      computeFilmMasterDurationInFrames({
        fps: inputProps.fps > 0 ? inputProps.fps : 24,
        sequences: inputProps.sequences,
        endFadeOutSec: inputProps.endFadeOutSec,
      }),
    [inputProps.endFadeOutSec, inputProps.fps, inputProps.sequences],
  );

  if (!origin) {
    return (
      <div
        className={cn(
          'rounded-lg border border-white/10 bg-black/40 px-4 py-8 text-center text-xs text-muted-foreground',
          fillHeight && 'flex h-full min-h-[120px] items-center justify-center',
        )}
      >
        Loading preview…
      </div>
    );
  }

  if (!inputProps.sequences.length) {
    return (
      <p
        className={cn(
          'text-xs text-muted-foreground',
          fillHeight && 'flex h-full min-h-[120px] items-center justify-center',
        )}
      >
        No sequences in film timeline.
      </p>
    );
  }

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-lg border border-white/10 bg-black',
        fillHeight && 'flex h-full min-h-0 flex-col',
      )}
    >
      <div className={cn(fillHeight && 'flex min-h-0 flex-1 flex-col')}>
        <Player
          component={FilmMasterPreview}
          inputProps={inputProps}
          durationInFrames={durationInFrames}
          compositionWidth={inputProps.width || 1920}
          compositionHeight={inputProps.height || 1080}
          fps={inputProps.fps > 0 ? inputProps.fps : 24}
          controls
          style={{
            width: '100%',
            ...(fillHeight
              ? { height: '100%', maxHeight: '100%', flex: 1, minHeight: 0 }
              : {
                  maxHeight:
                    variant === 'editor' ? 'min(82vh, 920px)' : 'min(70vh, 720px)',
                }),
          }}
        />
      </div>
    </div>
  );
}
