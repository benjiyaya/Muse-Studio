'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, Feather, Film, Clapperboard } from 'lucide-react';
import { cn } from '@/lib/utils';

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

// ── Component ─────────────────────────────────────────────────────────────────

export function SceneGenerationOverlay({ projectId, targetScenes }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('connecting');
  const [importFields, setImportFields] = useState<ImportField[]>([]);
  const [checkedCount, setCheckedCount] = useState(0);
  const [scenes, setScenes] = useState<SceneCard[]>([]);
  const [generatingMsg, setGeneratingMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [totalExpected, setTotalExpected] = useState(targetScenes ?? 5);
  const [underfilled, setUnderfilled] = useState(false);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setTotalExpected(targetScenes ?? 5);
    setUnderfilled(false);
    abortRef.current = new AbortController();

    async function run() {
      try {
        const res = await fetch('/api/generate/scenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, targetScenes }),
          signal: abortRef.current!.signal,
          // Don't allow Next.js to cache this SSE response
          cache: 'no-store',
        });

        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let currentEvent = '';

          for (const line of lines) {
            if (line.startsWith(':')) continue; // keep-alive ping

            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
              continue;
            }

            if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              if (!raw) continue;

              let payload: Record<string, unknown>;
              try {
                payload = JSON.parse(raw);
              } catch {
                continue;
              }

              switch (currentEvent) {
                case 'import': {
                  const field = payload as unknown as ImportField;
                  pendingImports.push(field);
                  // Wait until we have all 5 (or start after a short delay)
                  if (importAnimTimer) clearTimeout(importAnimTimer);
                  importAnimTimer = setTimeout(() => {
                    animateImports([...pendingImports]);
                  }, 100);
                  break;
                }

                case 'generating': {
                  const msg = (payload as { message?: string }).message ?? 'Writing scenes…';
                  setGeneratingMsg(msg);
                  // Allow the import animation to finish before switching phase
                  setTimeout(() => setPhase('generating'), 500 + pendingImports.length * 500 + 300);
                  break;
                }

                case 'scene': {
                  const card = payload as unknown as SceneCard;
                  setScenes((prev) => [...prev, card]);
                  break;
                }

                case 'done': {
                  const { totalScenes, underfilled: underfillFlag } = payload as unknown as {
                    totalScenes?: number;
                    underfilled?: boolean;
                  };
                  const total = totalScenes ?? 0;
                  setTotalExpected(total > 0 ? total : targetScenes ?? totalExpected);
                  setUnderfilled(Boolean(underfillFlag) && !!totalScenes && !!targetScenes && totalScenes < targetScenes);
                  setPhase('done');
                  // After brief "done" flash, navigate to the Kanban board
                  doneTimerRef.current = setTimeout(() => {
                    router.replace(`/projects/${projectId}`);
                  }, 1800);
                  break;
                }

                case 'error': {
                  const msg = (payload as { message?: string }).message ?? 'Unknown error';
                  setErrorMsg(msg);
                  setPhase('error');
                  break;
                }
              }
              currentEvent = '';
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setErrorMsg(err instanceof Error ? err.message : 'Connection failed');
          setPhase('error');
        }
      }
    }

    run();

    return () => {
      abortRef.current?.abort();
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, targetScenes]);

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

      {/* Main scroll area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">

          {/* ── Connecting spinner ─────────────────────────────────────────── */}
          {phase === 'connecting' && (
            <div className="flex flex-col items-center justify-center gap-4 pt-24">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-violet-500/20" />
                <div className="absolute inset-0 rounded-full border-2 border-t-violet-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                <Feather className="h-6 w-6 text-violet-400/70" />
              </div>
              <p className="text-sm text-muted-foreground/60">Connecting to Story Muse…</p>
            </div>
          )}

          {/* ── Import checklist ───────────────────────────────────────────── */}
          {(phase === 'importing' || phase === 'generating' || phase === 'done') && importFields.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Film className="h-4 w-4 text-violet-400/60" />
                <span className="text-xs font-semibold uppercase tracking-widest text-violet-400/60">
                  Storyline Imported
                </span>
              </div>

              <div className="space-y-2 rounded-xl border border-white/8 bg-white/3 p-4">
                {importFields.map((field, i) => {
                  const checked = i < checkedCount;
                  return (
                    <div
                      key={field.field}
                      className={cn(
                        'flex items-start gap-3 transition-opacity duration-500',
                        checked ? 'opacity-100' : 'opacity-30',
                      )}
                      style={{ transitionDelay: `${i * 80}ms` }}
                    >
                      <div className="mt-0.5 shrink-0">
                        {checked ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground/30" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{FIELD_ICONS[field.field] ?? '·'}</span>
                          <span className="text-xs font-medium text-foreground/80">
                            {FIELD_LABELS[field.field] ?? field.label}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground/50 truncate">
                          {field.value}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Scene generation loading (before first scene) ──────────────── */}
          {phase === 'generating' && scenes.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="flex gap-1.5">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="h-1.5 w-1.5 rounded-full bg-violet-400/60 animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
              <p className="text-sm text-muted-foreground/60">
                {generatingMsg || 'Story Muse is writing your scene scripts…'}
              </p>
            </div>
          )}

          {/* ── Scene cards ────────────────────────────────────────────────── */}
          {(phase === 'generating' || phase === 'done') && scenes.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Clapperboard className="h-4 w-4 text-blue-400/60" />
                <span className="text-xs font-semibold uppercase tracking-widest text-blue-400/60">
                  Script of Scenes
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
              </div>

              <div className="space-y-2">
                {scenes.map((scene, i) => (
                  <SceneCardItem key={scene.sceneId} scene={scene} index={i} isDone={phase === 'done'} />
                ))}

                {/* "writing next scene" skeleton rows */}
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

          {/* ── Done flash ────────────────────────────────────────────────── */}
          {phase === 'done' && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 flex items-center gap-3">
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

          {/* ── Error state ───────────────────────────────────────────────── */}
          {phase === 'error' && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4">
              <p className="text-sm font-medium text-red-300 mb-1">Scene generation failed</p>
              <p className="text-xs text-red-300/70">{errorMsg}</p>
              <p className="text-xs text-muted-foreground/50 mt-2">
                Check your LLM settings in{' '}
                <a href="/settings/llm" className="text-violet-400 hover:underline">
                  Settings → LLM
                </a>{' '}
                and make sure the service is running.
              </p>
              <button
                onClick={() => router.replace(`/projects/${projectId}`)}
                className="mt-4 text-xs text-muted-foreground/60 hover:text-foreground underline transition-colors"
              >
                Skip and open Script board anyway
              </button>
            </div>
          )}

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
