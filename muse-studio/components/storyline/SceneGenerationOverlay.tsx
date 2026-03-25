'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Feather,
  Film,
  Clapperboard,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  activeLlmProviderLabel,
  isLocalLlmProvider,
  streamFirstDataTimeoutMessage,
} from '@/lib/llm-display';
import { useLLMSettings } from '@/hooks/useSettings';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImportField {
  field: string;
  label: string;
  value: string;
  index: number;
  total: number;
}

interface SceneCard {
  sceneId: string;
  sceneNumber: number;
  title: string;
  heading: string;
  description: string;
}

type Phase = 'connecting' | 'importing' | 'generating' | 'done' | 'error';

interface Props {
  projectId: string;
  /** Optional target number of scenes requested by the user. */
  targetScenes?: number;
}

// ── Field icon map ────────────────────────────────────────────────────────────

const FIELD_ICONS: Record<string, string> = {
  logline: '💬',
  plotOutline: '📄',
  characters: '👥',
  themes: '🎭',
  genre: '🎬',
};

const FIELD_LABELS: Record<string, string> = {
  logline: 'Logline',
  plotOutline: 'Plot Outline',
  characters: 'Characters',
  themes: 'Themes',
  genre: 'Genre',
};

/** No SSE bytes (including `: ping`) — LLM offline, proxy stall, or hung server. */
const STREAM_FIRST_DATA_TIMEOUT_MS = 120_000;

// ── Component ─────────────────────────────────────────────────────────────────

export function SceneGenerationOverlay({ projectId, targetScenes }: Props) {
  const router = useRouter();
  const llmSettings = useLLMSettings();
  const llmSettingsRef = useRef(llmSettings);
  llmSettingsRef.current = llmSettings;
  const [phase, setPhase] = useState<Phase>('connecting');
  const [importFields, setImportFields] = useState<ImportField[]>([]);
  const [checkedCount, setCheckedCount] = useState(0);
  const [scenes, setScenes] = useState<SceneCard[]>([]);
  const [generatingMsg, setGeneratingMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [totalExpected, setTotalExpected] = useState(targetScenes ?? 5);
  const [underfilled, setUnderfilled] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [rawOutputExpanded, setRawOutputExpanded] = useState(false);
  const [batchCompleted, setBatchCompleted] = useState(0); // long-form: number of batches finished
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamContainerRef = useRef<HTMLDivElement | null>(null);
  const scenesPanelRef = useRef<HTMLDivElement | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [generatingElapsedSec, setGeneratingElapsedSec] = useState(0);

  useEffect(() => {
    if (phase !== 'generating') {
      setGeneratingElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => {
      setGeneratingElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    setPhase('connecting');
    setImportFields([]);
    setCheckedCount(0);
    setScenes([]);
    setGeneratingMsg('');
    setErrorMsg('');
    setTotalExpected(targetScenes ?? 5);
    setUnderfilled(false);
    setStreamedText('');
    setRawOutputExpanded(false);
    setBatchCompleted(0);
    abortRef.current = new AbortController();

    const useLongform = Number.isFinite(targetScenes) && (targetScenes as number) > 24;
    const apiUrl = useLongform ? '/api/generate/scenes-longform' : '/api/generate/scenes';

    async function run() {
      let streamWatchdog: ReturnType<typeof setTimeout> | null = null;
      let abortedForStreamTimeout = false;

      const clearStreamWatchdog = () => {
        if (streamWatchdog) {
          clearTimeout(streamWatchdog);
          streamWatchdog = null;
        }
      };

      const armStreamWatchdog = () => {
        clearStreamWatchdog();
        streamWatchdog = setTimeout(() => {
          abortedForStreamTimeout = true;
          abortRef.current?.abort();
        }, STREAM_FIRST_DATA_TIMEOUT_MS);
      };

      try {
        armStreamWatchdog();

        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, targetScenes }),
          signal: abortRef.current!.signal,
          cache: 'no-store',
        });

        if (!res.ok) {
          clearStreamWatchdog();
          let detail = `Server returned ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) detail = j.error;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }

        if (!res.body) {
          clearStreamWatchdog();
          throw new Error('No response body');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        /** Must persist across stream chunks — `event:` and `data:` often arrive in separate reads. */
        let currentEvent = '';
        let gotTerminalEvent = false;
        /** Local count — React state is async; used to detect full runs when SSE `done` is dropped. */
        let receivedSceneCount = 0;
        // We collect import fields then animate them in sequence
        const pendingImports: ImportField[] = [];
        let importAnimTimer: ReturnType<typeof setTimeout> | null = null;

        const animateImports = (fields: ImportField[]) => {
          setImportFields(fields);
          setPhase('importing');
          // Stagger the checkmarks — one every 500ms
          fields.forEach((_, i) => {
            setTimeout(() => setCheckedCount(i + 1), 500 + i * 500);
          });
        };

        const processSseLine = (line: string) => {
          if (line.startsWith(':')) return; // keep-alive ping

          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            return;
          }

          if (!line.startsWith('data:')) return;

          const raw = line.slice(5).trim();
          if (!raw) return;

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(raw);
          } catch {
            return;
          }

          switch (currentEvent) {
            case 'import': {
              const field = payload as unknown as ImportField & { message?: string };
              if ('field' in field && field.field) {
                pendingImports.push(field);
                if (importAnimTimer) clearTimeout(importAnimTimer);
                importAnimTimer = setTimeout(() => animateImports([...pendingImports]), 100);
              } else if (useLongform && field.message) {
                setGeneratingMsg(field.message);
                setTimeout(() => setPhase('generating'), 300);
              }
              break;
            }

            case 'generating': {
              const msg = (payload as { message?: string }).message ?? 'Writing scenes…';
              setGeneratingMsg(msg);
              setTimeout(() => setPhase('generating'), 500 + pendingImports.length * 500 + 300);
              break;
            }

            case 'text': {
              const delta = (payload as { delta?: string }).delta ?? '';
              setStreamedText((prev) => prev + delta);
              break;
            }

            case 'batch_done': {
              const idx = (payload as { batch_index?: number }).batch_index;
              if (typeof idx === 'number' && idx > 0) {
                setBatchCompleted(idx);
              }
              break;
            }

            case 'scene': {
              const card = payload as unknown as SceneCard & { dialogue?: string; technicalNotes?: string };
              receivedSceneCount += 1;
              setScenes((prev) => [...prev, card]);
              if (useLongform) {
                fetch('/api/scenes', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    projectId,
                    scene: {
                      sceneId: card.sceneId,
                      sceneNumber: card.sceneNumber,
                      title: card.title,
                      heading: card.heading,
                      description: card.description,
                      dialogue: card.dialogue ?? null,
                      technicalNotes: card.technicalNotes ?? null,
                    },
                  }),
                }).catch((err) => console.error('Failed to persist scene', err));
              }
              break;
            }

            case 'done': {
              gotTerminalEvent = true;
              const { totalScenes, underfilled: underfillFlag } = payload as unknown as {
                totalScenes?: number;
                underfilled?: boolean;
              };
              const total = totalScenes ?? 0;
              setTotalExpected(total > 0 ? total : targetScenes ?? totalExpected);
              setUnderfilled(Boolean(underfillFlag) && !!totalScenes && !!targetScenes && totalScenes < targetScenes);
              setPhase('done');
              doneTimerRef.current = setTimeout(() => {
                router.replace(`/projects/${projectId}`);
              }, 1800);
              break;
            }

            case 'error': {
              gotTerminalEvent = true;
              const msg = (payload as { message?: string }).message ?? 'Unknown error';
              setErrorMsg(msg);
              setPhase('error');
              break;
            }
          }
          currentEvent = '';
        };

        while (true) {
          const { done, value } = await reader.read();
          if (value?.byteLength) clearStreamWatchdog();
          if (done) {
            if (value?.byteLength) buffer += decoder.decode(value, { stream: true });
            buffer += decoder.decode();
            for (const line of buffer.split('\n')) processSseLine(line);
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) processSseLine(line);
        }

        clearStreamWatchdog();

        if (!gotTerminalEvent) {
          // Single-request flow: proxies / HTTP stacks sometimes close the stream right after the last
          // scene chunk, so `event: done` never reaches the client even though the server finished.
          const want =
            typeof targetScenes === 'number' && Number.isFinite(targetScenes) && targetScenes > 0
              ? Math.floor(targetScenes)
              : 5;
          if (!useLongform && receivedSceneCount >= want && receivedSceneCount > 0) {
            setTotalExpected(receivedSceneCount);
            setUnderfilled(false);
            setPhase('done');
            doneTimerRef.current = setTimeout(() => {
              router.replace(`/projects/${projectId}`);
            }, 1800);
          } else {
            setErrorMsg(
              'The connection closed before generation finished (timeout, proxy, or network drop). ' +
                'Reload the project — scenes already saved are kept.',
            );
            setPhase('error');
          }
        }
      } catch (err) {
        clearStreamWatchdog();
        if ((err as Error).name === 'AbortError') {
          if (abortedForStreamTimeout) {
            setErrorMsg(streamFirstDataTimeoutMessage(llmSettingsRef.current));
            setPhase('error');
          }
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : 'Connection failed');
        setPhase('error');
      }
    }

    run();

    return () => {
      abortRef.current?.abort();
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, targetScenes, retryNonce]);

  // Auto-scroll stream container to bottom when new text arrives
  useEffect(() => {
    const el = streamContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamedText]);

  // Auto-scroll right panel to bottom when new scene card appears (so progress is visible)
  useEffect(() => {
    const el = scenesPanelRef.current;
    if (el && scenes.length > 0) el.scrollTop = el.scrollHeight;
  }, [scenes.length]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col overflow-hidden">

      {/* Top status bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/8 bg-[oklch(0.12_0.01_264)] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/20',
            phase !== 'done' && phase !== 'error' && 'animate-pulse',
          )}>
            <Feather className="h-3.5 w-3.5 text-violet-400" />
          </div>
          <span className="text-sm font-medium text-violet-300">Story Muse</span>
          <span className="text-xs text-muted-foreground/60">
            {phase === 'connecting' && 'connecting…'}
            {phase === 'importing' && 'importing storyline…'}
            {phase === 'generating' && 'writing scene scripts…'}
            {phase === 'done' && `${totalExpected} scenes ready`}
            {phase === 'error' && 'generation failed'}
          </span>
        </div>
        {scenes.length > 0 && phase !== 'done' && (
          <span className="text-xs text-muted-foreground/40 tabular-nums">
            {scenes.length} of {totalExpected} scenes
          </span>
        )}
      </div>

      {/* Two-column main area */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel: Storyline Imported + LLM Response (narrow, scrolls independently) */}
        {(phase === 'importing' || phase === 'generating' || phase === 'done') && (
          <div className="w-80 shrink-0 flex flex-col border-r border-white/8 bg-[oklch(0.11_0.01_264)] overflow-hidden">
            <div className="overflow-y-auto px-4 py-6 space-y-6">
              {/* ── Import checklist ───────────────────────────────────────── */}
              {importFields.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Film className="h-4 w-4 text-violet-400/60 shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-widest text-violet-400/60">
                      Storyline Imported
                    </span>
                  </div>
                  <div className="space-y-2 rounded-xl border border-white/8 bg-white/3 p-3">
                    {importFields.map((field, i) => {
                      const checked = i < checkedCount;
                      return (
                        <div
                          key={field.field}
                          className={cn(
                            'flex items-start gap-2 transition-opacity duration-500',
                            checked ? 'opacity-100' : 'opacity-30',
                          )}
                          style={{ transitionDelay: `${i * 80}ms` }}
                        >
                          <div className="mt-0.5 shrink-0">
                            {checked ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs">{FIELD_ICONS[field.field] ?? '·'}</span>
                              <span className="text-[11px] font-medium text-foreground/80">
                                {FIELD_LABELS[field.field] ?? field.label}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground/50 line-clamp-2">
                              {field.value}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── LLM response ──────────────────────────────────────────── */}
              {(phase === 'generating' || (phase === 'done' && streamedText)) && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-widest text-violet-400/60">
                      LLM response
                    </span>
                    {phase === 'done' && streamedText && (
                      <button
                        type="button"
                        onClick={() => setRawOutputExpanded((e) => !e)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground/80 transition-colors"
                      >
                        {rawOutputExpanded ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                        {rawOutputExpanded ? 'Hide' : 'View'} raw
                      </button>
                    )}
                  </div>
                  {(phase === 'generating' || (phase === 'done' && rawOutputExpanded)) && (
                    <div
                      ref={streamContainerRef}
                      className="max-h-52 overflow-auto rounded-lg border border-white/8 bg-black/20 p-2.5 font-mono text-[11px] text-foreground/80 whitespace-pre-wrap break-words"
                    >
                      {streamedText
                        ? streamedText
                        : phase === 'generating'
                          ? (() => {
                              const useLongform = Number.isFinite(targetScenes) && (targetScenes as number) > 24;
                              const totalBatches = Math.ceil((targetScenes ?? totalExpected) / 24);
                              if (useLongform) {
                                if (batchCompleted > 0) {
                                  return `Batch ${batchCompleted} of ${totalBatches} complete. Generating next batch…`;
                                }
                                return `Generating in batches (24 per batch). First batch in progress… This may take a few minutes.`;
                              }
                              return 'Waiting for LLM…';
                            })()
                          : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right panel: Script of Scenes + progress (wider, scrolls so new cards stay visible) */}
        <div ref={scenesPanelRef} className="flex-1 min-w-0 overflow-y-auto">
          <div className="px-6 py-6 max-w-3xl">

            {/* ── Connecting spinner ─────────────────────────────────────── */}
            {phase === 'connecting' && (
              <div className="flex flex-col items-center justify-center gap-4 pt-24 px-4">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-2 border-violet-500/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-t-violet-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                  <Feather className="h-6 w-6 text-violet-400/70" />
                </div>
                <p className="text-sm text-muted-foreground/60 text-center">Connecting to Story Muse…</p>
                <p className="text-[11px] text-muted-foreground/40 text-center max-w-sm">
                  First LLM data should appear within a few minutes (cold models can be slow). If this hangs, we’ll show a timeout and you can retry.
                </p>
              </div>
            )}

            {/* ── Scene generation loading (before first scene) ───────────── */}
            {phase === 'generating' && scenes.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-12 px-4">
                <div className="flex gap-1.5">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="h-1.5 w-1.5 rounded-full bg-violet-400/60 animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground/60 text-center max-w-sm">
                  {Number.isFinite(targetScenes) && (targetScenes as number) > 24
                    ? `Generating first batch (scenes 1–24)… For ${targetScenes} scenes this may take several minutes.`
                    : generatingMsg || 'Story Muse is writing your scene scripts…'}
                </p>
                <p className="text-xs text-muted-foreground/45 tabular-nums">
                  Elapsed {Math.floor(generatingElapsedSec / 60)}:
                  {String(generatingElapsedSec % 60).padStart(2, '0')}
                </p>
                {generatingElapsedSec >= 45 && (
                  <p className="text-[11px] text-muted-foreground/50 text-center max-w-md leading-relaxed">
                    The first scene card appears only after the model finishes a full{' '}
                    <span className="font-mono text-muted-foreground/70">{'<<<SCENE>>>'}…{'<<<END>>>'}</span> block.
                    {isLocalLlmProvider(llmSettings) ? (
                      <>
                        {' '}
                        On a local model ({activeLlmProviderLabel(llmSettings)}) that can take many minutes; watch the{' '}
                        <span className="text-muted-foreground/70">LLM response</span> panel on the left for streaming
                        text. If you see rate limits (e.g. HTTP <span className="text-muted-foreground/70">429</span>
                        ), wait and use <span className="text-muted-foreground/70">Try again</span>.
                      </>
                    ) : (
                      <>
                        {' '}
                        Using {activeLlmProviderLabel(llmSettings)} — the first block can still take a minute or two;
                        watch the <span className="text-muted-foreground/70">LLM response</span> panel for streaming
                        text. If you hit rate limits (e.g. HTTP <span className="text-muted-foreground/70">429</span>
                        ), wait and use <span className="text-muted-foreground/70">Try again</span>.
                      </>
                    )}
                  </p>
                )}
              </div>
            )}

            {/* ── Script of Scenes (cards pop up here, scroll to see progress; also show when error with partial scenes) ─ */}
            {(phase === 'generating' || phase === 'done' || (phase === 'error' && scenes.length > 0)) && scenes.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4 sticky top-0 py-2 bg-[oklch(0.13_0.01_264)]/95 backdrop-blur z-10 -mx-2 px-2">
                  <Clapperboard className="h-4 w-4 text-blue-400/60 shrink-0" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-blue-400/60">
                    Script of Scenes
                    {phase === 'error' && ' (saved before error)'}
                  </span>
                  {phase === 'generating' && (
                    <span className="ml-auto text-xs text-muted-foreground/40 animate-pulse">
                      writing…
                    </span>
                  )}
                  {phase === 'done' && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {scenes.length} scenes ready
                    </span>
                  )}
                  {phase === 'error' && (
                    <span className="ml-auto text-xs text-amber-400/80">
                      {scenes.length} scenes saved
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {scenes.map((scene, i) => (
                    <SceneCardItem key={scene.sceneId} scene={scene} index={i} isDone={phase === 'done' || phase === 'error'} />
                  ))}

                  {phase === 'generating' && scenes.length < totalExpected && (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/2 px-4 py-3 flex items-center gap-3">
                      <div className="flex gap-1">
                        {[0, 150, 300].map((d) => (
                          <span
                            key={d}
                            className="h-1 w-1 rounded-full bg-violet-400/40 animate-bounce"
                            style={{ animationDelay: `${d}ms` }}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground/40">
                        Writing scene {scenes.length + 1}…
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Done flash ───────────────────────────────────────────────── */}
            {phase === 'done' && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 flex items-center gap-3 mt-6">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-300">
                    {scenes.length} scene scripts generated
                    {targetScenes && ` (requested ${targetScenes})`}
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">
                    {underfilled && targetScenes && scenes.length < targetScenes
                      ? 'Story Muse generated fewer scenes than requested. You can add more in Script of Scenes.'
                      : 'Opening the Script board…'}
                  </p>
                </div>
              </div>
            )}

            {/* ── Error state ─────────────────────────────────────────────── */}
            {phase === 'error' && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4">
                <p className="text-sm font-medium text-red-300 mb-1">Scene generation failed</p>
                {(() => {
                  const isConnectionError = /status code:\s*-1|Internal Server Error/i.test(errorMsg);
                  const summary = isConnectionError ? 'Connection or server error.' : null;
                  return (
                    <>
                      {summary && <p className="text-xs text-red-300/90 mb-0.5">{summary}</p>}
                      <p className="text-xs text-red-300/70">{errorMsg}</p>
                    </>
                  );
                })()}
                {scenes.length > 0 && (
                  <p className="text-xs text-foreground/70 mt-2">
                    {scenes.length} scene{scenes.length !== 1 ? 's' : ''} were saved before the error. You can open the Script board to use them or continue generating more.
                  </p>
                )}
                <p className="text-xs text-muted-foreground/50 mt-2">
                  Check your LLM settings in{' '}
                  <a href="/settings/llm" className="text-violet-400 hover:underline">
                    Settings → LLM
                  </a>{' '}
                  and make sure the service is running.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRetryNonce((n) => n + 1)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-200 hover:bg-violet-500/20 transition-colors"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Try again
                  </button>
                  {scenes.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/projects/${projectId}?generating=scenes&targetScenes=${targetScenes ?? totalExpected}`,
                        )
                      }
                      className="text-xs font-medium text-violet-300 hover:text-violet-200 underline transition-colors"
                    >
                      Continue generating
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => router.replace(`/projects/${projectId}`)}
                    className="text-xs text-muted-foreground/60 hover:text-foreground underline transition-colors"
                  >
                    Skip and open Script board anyway
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ── Scene card sub-component ──────────────────────────────────────────────────

function SceneCardItem({
  scene,
  index,
  isDone,
}: {
  scene: SceneCard;
  index: number;
  isDone: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-white/4 px-4 py-3',
        'animate-in slide-in-from-top-2 fade-in duration-400',
        isDone ? 'border-white/10' : 'border-violet-500/20',
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start gap-3">
        {/* Scene number badge */}
        <div className="shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 text-[11px] font-bold">
          {scene.sceneNumber}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90 truncate">
              {scene.title}
            </span>
            {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/70 shrink-0" />}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground/50 font-mono truncate">
            {scene.heading}
          </p>
          {scene.description && (
            <p className="mt-1.5 text-xs text-muted-foreground/60 line-clamp-2">
              {scene.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
