'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilmCutPreview } from '@/components/export/FilmCutPreview';
import type { FilmSequenceJSON, FilmTimelineJSON } from '@/types/film-timeline';

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** Last clip never carries transitionOut in our contract (no successor). */
function ensureLastHasNoTransition(tl: FilmTimelineJSON): FilmTimelineJSON {
  if (!tl.sequences.length) return tl;
  const sequences = tl.sequences.map((s, i) =>
    i === tl.sequences.length - 1 ? { ...s, transitionOut: undefined } : s,
  );
  return { ...tl, sequences };
}

export type ExportModeForEditor = 'SMART_EDIT' | 'SMART_EDIT_REMOTION';

export interface FilmTimelineEditorProps {
  projectId: string;
  exportMode: ExportModeForEditor;
  initialTimeline: FilmTimelineJSON;
  onApplied: (payload: {
    outputPath: string;
    totalDuration: number;
    clipCount: number;
    filmTimeline: FilmTimelineJSON;
  }) => void;
}

function parseApplyError(data: Record<string, unknown>): string {
  if (typeof data.error === 'string') return data.error;
  const d = data.detail;
  if (d && typeof d === 'object' && 'error' in d && typeof (d as { error: unknown }).error === 'string') {
    return (d as { error: string }).error;
  }
  if (typeof d === 'string') return d;
  return 'Request failed';
}

export function FilmTimelineEditor({
  projectId,
  exportMode,
  initialTimeline,
  onApplied,
}: FilmTimelineEditorProps) {
  const [draft, setDraft] = useState<FilmTimelineJSON>(() =>
    ensureLastHasNoTransition(deepClone(initialTimeline)),
  );
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(ensureLastHasNoTransition(deepClone(initialTimeline)));
    setError(null);
  }, [initialTimeline]);

  const outputKind = exportMode === 'SMART_EDIT_REMOTION' ? 'remotion' : 'ffmpeg';

  const applyLabel =
    exportMode === 'SMART_EDIT_REMOTION'
      ? 'Apply edits & re-render (Remotion)'
      : 'Apply edits & re-stitch (ffmpeg)';

  const hint =
    exportMode === 'SMART_EDIT'
      ? 'ffmpeg uses hard cuts only; crossfades and end-of-film fade apply when you use Polished (Remotion) export.'
      : null;

  const updateSeq = useCallback((index: number, patch: Partial<FilmSequenceJSON>) => {
    setDraft((prev) => {
      const sequences = prev.sequences.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return ensureLastHasNoTransition({ ...prev, sequences });
    });
  }, []);

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const payload = ensureLastHasNoTransition(draft);
      const res = await fetch('/api/agent/film/apply-timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          filmTimeline: payload,
          outputKind,
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(parseApplyError(data));
        return;
      }
      if (
        data.status === 'completed' &&
        typeof data.outputPath === 'string' &&
        data.filmTimeline &&
        typeof data.filmTimeline === 'object'
      ) {
        onApplied({
          outputPath: data.outputPath,
          totalDuration: typeof data.totalDuration === 'number' ? data.totalDuration : 0,
          clipCount:
            typeof data.clipCount === 'number' ? data.clipCount : payload.sequences.length,
          filmTimeline: data.filmTimeline as FilmTimelineJSON,
        });
        toast.success(
          outputKind === 'remotion' ? 'New render finished' : 'Export updated',
          {
            description:
              outputKind === 'remotion'
                ? 'Final export below now shows your latest Remotion master.'
                : 'Final export below shows your re-stitched file.',
            duration: 6000,
          },
        );
      } else {
        setError(typeof data.error === 'string' ? data.error : 'Unexpected response');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 overflow-hidden p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-violet-200">Refine timeline</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Adjust trims and transitions, then apply without re-running the AI agent.
        </p>
        {hint && <p className="text-xs text-amber-200/80 mt-2">{hint}</p>}
      </div>

      {/* xl+: explicit columns — controls left (1–4), live Remotion preview right (5–12). Same row via row-start-1. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:gap-6 xl:h-[min(78vh,900px)] xl:min-h-0">
        {/* Mobile: preview first; xl+: right column */}
        <div className="order-1 flex min-h-0 min-w-0 flex-col xl:order-none xl:col-span-8 xl:col-start-5 2xl:col-span-9 2xl:col-start-4 xl:row-start-1">
          <div className="flex h-full min-h-0 flex-col rounded-lg border border-white/10 bg-black/20 p-2">
            <div className="mb-2 shrink-0">
              <p className="text-xs font-medium text-muted-foreground">Live preview</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                Remotion — trims, transitions, end fade. Picture includes project and scene titles for reference; the encoded file below does not.
              </p>
            </div>
            <div className="min-h-0 min-w-0 flex-1">
              <FilmCutPreview timeline={draft} variant="editor" fillHeight />
            </div>
          </div>
        </div>

        {/* Left column: scene controls + actions */}
        <div className="order-2 flex min-h-0 min-w-0 flex-col gap-3 xl:order-none xl:col-span-4 xl:col-start-1 2xl:col-span-3 2xl:col-start-1 xl:row-start-1">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {draft.sequences.map((seq, i) => {
          const isLast = i === draft.sequences.length - 1;
          const tr = seq.transitionOut;
          const endFade = draft.endFadeOutSec ?? 0;
          return (
            <div
              key={seq.id}
              className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2"
            >
              <p className="text-xs font-medium text-foreground">
                Scene {seq.sceneNumber}
                {seq.title ? ` · ${seq.title}` : ''}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Trim start (s)
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={seq.trimStartSec}
                    onChange={(e) =>
                      updateSeq(i, { trimStartSec: parseFloat(e.target.value) || 0 })
                    }
                    className="mt-1 w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Trim end (s)
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={seq.trimEndSec}
                    onChange={(e) =>
                      updateSeq(i, { trimEndSec: parseFloat(e.target.value) || 0 })
                    }
                    className="mt-1 w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
              </div>
              {!isLast && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide col-span-2">
                    Into next clip
                    <select
                      value={tr?.type === 'fade' ? 'fade' : 'cut'}
                      onChange={(e) => {
                        const t = e.target.value;
                        if (t === 'cut') {
                          updateSeq(i, { transitionOut: { type: 'cut', durationSec: 0 } });
                        } else {
                          updateSeq(i, {
                            transitionOut: {
                              type: 'fade',
                              durationSec: tr?.type === 'fade' ? tr.durationSec : 0.5,
                            },
                          });
                        }
                      }}
                      className="mt-1 w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-foreground"
                    >
                      <option value="cut">Cut</option>
                      <option value="fade">Fade</option>
                    </select>
                  </label>
                  {tr?.type === 'fade' && (
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide col-span-2">
                      Fade duration (s)
                      <input
                        type="number"
                        step={0.05}
                        min={0.05}
                        max={2}
                        value={tr.durationSec}
                        onChange={(e) =>
                          updateSeq(i, {
                            transitionOut: {
                              type: 'fade',
                              durationSec: parseFloat(e.target.value) || 0.5,
                            },
                          })
                        }
                        className="mt-1 w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-foreground"
                      />
                    </label>
                  )}
                </div>
              )}
              {isLast && (
                <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-1">
                  <label className="col-span-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    End of film
                    <select
                      value={endFade > 0 ? 'fade' : 'cut'}
                      onChange={(e) => {
                        const t = e.target.value;
                        setDraft((prev) =>
                          ensureLastHasNoTransition({
                            ...prev,
                            endFadeOutSec:
                              t === 'cut'
                                ? 0
                                : Math.min(
                                    5,
                                    Math.max(0.05, prev.endFadeOutSec ?? 0.5),
                                  ),
                          }),
                        );
                      }}
                      className="mt-1 w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-foreground"
                    >
                      <option value="cut">Cut (no fade)</option>
                      <option value="fade">Fade to black</option>
                    </select>
                  </label>
                  {endFade > 0 && (
                    <label className="col-span-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Fade duration (s)
                      <input
                        type="number"
                        step={0.05}
                        min={0.05}
                        max={5}
                        value={endFade}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          const next =
                            Number.isFinite(v) ? Math.min(5, Math.max(0.05, v)) : 0.5;
                          setDraft((prev) =>
                            ensureLastHasNoTransition({ ...prev, endFadeOutSec: next }),
                          );
                        }}
                        className="mt-1 w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-sm text-foreground"
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
          </div>

          {error && (
            <p className="shrink-0 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="flex shrink-0 flex-col gap-2 border-t border-white/10 pt-1 sm:flex-row xl:flex-col xl:border-t-0 xl:pt-0">
            <Button
              type="button"
              disabled={applying}
              onClick={handleApply}
              className="bg-violet-600 hover:bg-violet-500 text-white w-full sm:w-auto xl:w-full"
            >
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Applying…
                </>
              ) : (
                applyLabel
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={applying}
              onClick={() => setDraft(ensureLastHasNoTransition(deepClone(initialTimeline)))}
              className="w-full sm:w-auto xl:w-full justify-center"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset to AI timeline
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
