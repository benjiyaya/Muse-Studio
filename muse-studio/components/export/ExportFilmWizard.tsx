'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ChevronRight, Film, Loader2, CheckCircle2, AlertCircle, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ExportMode = 'SIMPLE_STITCH' | 'SMART_EDIT';

interface ExportFilmWizardProps {
  projectId: string;
  projectTitle: string;
}

export function ExportFilmWizard({ projectId, projectTitle }: ExportFilmWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<ExportMode | null>(null);
  const [loading, setLoading] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{
    status: string;
    outputPath?: string;
    totalDuration?: number;
    clipCount?: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  async function handleRun() {
    if (!mode) return;
    setLoading(true);
    setResult(null);
    setLogLines([]);

    const useStream = mode === 'SMART_EDIT';

    try {
      if (useStream) {
        const res = await fetch('/api/agent/video-editor/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, mode }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setResult({ status: 'failed', error: data?.error ?? 'Export failed.' });
          return;
        }
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        if (!reader) {
          setResult({ status: 'failed', error: 'No response body.' });
          return;
        }
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as { type?: string; text?: string; status?: string };
                if (data.type === 'log' && typeof data.text === 'string') {
                  setLogLines((prev) => [...prev, data.text!]);
                } else if (typeof data.status === 'string') {
                  setResult({
                    status: data.status ?? 'failed',
                    outputPath: data.outputPath,
                    totalDuration: data.totalDuration,
                    clipCount: data.clipCount,
                    error: data.error,
                  });
                }
              } catch {
                // skip non-JSON or comment lines
              }
            }
          }
        }
      } else {
        const res = await fetch('/api/agent/video-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, mode }),
        });
        const data = await res.json();
        if (!res.ok) {
          setResult({ status: 'failed', error: data?.error ?? 'Export failed.' });
          return;
        }
        setResult({
          status: data.status ?? 'failed',
          outputPath: data.outputPath,
          totalDuration: data.totalDuration,
          clipCount: data.clipCount,
          error: data.error,
        });
      }
    } catch (err) {
      setResult({
        status: 'failed',
        error: err instanceof Error ? err.message : 'Export request failed.',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-8">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={step >= 1 ? 'text-violet-400 font-medium' : ''}>1. Choose mode</span>
        <ChevronRight className="h-4 w-4 opacity-50" />
        <span className={step >= 2 ? 'text-violet-400 font-medium' : ''}>2. Run export</span>
      </div>

      {step === 1 && (
        <>
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-1">Export mode</h2>
            <p className="text-sm text-muted-foreground">
              How should the full film be assembled from your final scene clips?
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('SIMPLE_STITCH')}
              className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors ${
                mode === 'SIMPLE_STITCH'
                  ? 'border-violet-500 bg-violet-500/15 text-violet-200'
                  : 'border-white/10 bg-white/3 hover:border-white/20 hover:bg-white/5'
              }`}
            >
              <Film className="h-5 w-5 shrink-0 opacity-80" />
              <span className="font-medium">Simple Stitch</span>
              <span className="text-xs text-muted-foreground leading-relaxed">
                Concatenate all final scene videos in order. Fast and reliable.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMode('SMART_EDIT')}
              className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors ${
                mode === 'SMART_EDIT'
                  ? 'border-violet-500 bg-violet-500/15 text-violet-200'
                  : 'border-white/10 bg-white/3 hover:border-white/20 hover:bg-white/5'
              }`}
            >
              <Film className="h-5 w-5 shrink-0 opacity-80" />
              <span className="font-medium">Smart Edit (Beta)</span>
              <span className="text-xs text-muted-foreground leading-relaxed">
                Director + Editor pipeline: per-scene analysis and optional trimming, then stitch.
              </span>
            </button>
          </div>

          <div className="flex justify-end">
            <Button
              disabled={!mode}
              onClick={() => setStep(2)}
              className="bg-violet-600 hover:bg-violet-500 text-white"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div>
            <p className="text-sm text-muted-foreground">
              Mode: <span className="font-medium text-foreground">{mode === 'SMART_EDIT' ? 'Smart Edit (Beta)' : 'Simple Stitch'}</span>
            </p>
          </div>

          {!result ? (
            <div className="rounded-xl border border-white/10 bg-white/3 p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                This may take a few minutes. The agent will collect all final scene clips and assemble the full film.
                {mode === 'SMART_EDIT' && ' Progress will stream below.'}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={loading}
                  onClick={handleRun}
                  className="bg-violet-600 hover:bg-violet-500 text-white"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Exporting…
                    </>
                  ) : (
                    'Run export'
                  )}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={loading}>
                  Back
                </Button>
              </div>
              {mode === 'SMART_EDIT' && (loading || logLines.length > 0) && (
                <div className="rounded-lg border border-white/10 bg-black/40 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8 bg-white/5">
                    <Terminal className="h-4 w-4 text-violet-400" />
                    <span className="text-xs font-medium text-muted-foreground">Agent log (live)</span>
                  </div>
                  <div className="max-h-[280px] min-h-[120px] overflow-y-auto p-3 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-words">
                    {logLines.length === 0 && loading && (
                      <span className="text-muted-foreground">Starting…</span>
                    )}
                    {logLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {result.status === 'completed' && result.outputPath && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-emerald-200">Export complete</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {result.clipCount != null && `${result.clipCount} clip(s)`}
                          {result.totalDuration != null && ` · ${result.totalDuration.toFixed(1)}s`}
                        </p>
                        <a
                          href={`/api/outputs/${result.outputPath}`}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="inline-flex items-center gap-1 mt-2 text-sm text-violet-300 hover:text-violet-200"
                        >
                          Download <span aria-hidden>&gt;&gt;</span>
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                    <p className="text-xs font-medium text-muted-foreground px-3 py-2 border-b border-white/8">
                      Output preview
                    </p>
                    <video
                      src={`/api/outputs/${result.outputPath}`}
                      controls
                      className="w-full max-w-[1280px] h-[720px] max-h-[720px] object-contain bg-black"
                      width={1280}
                      height={720}
                      preload="metadata"
                      playsInline
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                </div>
              )}

              {(result.status === 'no_final_scenes' || result.status === 'failed') && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-200">
                        {result.status === 'no_final_scenes' ? 'No final scenes' : 'Export failed'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {result.error ?? 'No clips could be collected or the agent reported an error.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setResult(null); setStep(1); }}>
                  Choose another mode
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/projects/${projectId}`}>Back to project</Link>
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
