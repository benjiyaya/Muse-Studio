'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface OrchestrateResult {
  next_task: string;
  current_phase?: string;
  history?: Array<{ task: string; result: unknown }>;
  error?: string;
  targetTotal?: number;
  message?: string;
}

interface OrchestrateButtonProps {
  projectId: string;
}

export function OrchestrateButton({ projectId }: OrchestrateButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrchestrateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOrchestrate() {
    setLoading(true);
    setError(null);
    setResult(null);
    setOpen(true);
    try {
      const res = await fetch('/api/agent/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, goal: 'next_step' }),
      });
      const data = (await res.json()) as OrchestrateResult | { error?: string };
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Request failed');
        return;
      }
      setResult(data as OrchestrateResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  function handleGenerateScenes(targetTotal: number) {
    setOpen(false);
    router.push(
      `/projects/${projectId}?generating=scenes&targetScenes=${targetTotal}`,
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-xl border border-white/8 bg-white/3 px-3 text-xs text-muted-foreground hover:bg-white/8 gap-1.5"
            onClick={handleOrchestrate}
            disabled={loading}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {loading ? '…' : 'Next step'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ask Supervisor for next step (storyline → scenes → keyframes → video)</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[oklch(0.14_0.02_264)] border-white/10 text-sm max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-violet-300">Supervisor</DialogTitle>
          </DialogHeader>
          {loading && (
            <p className="text-muted-foreground py-2">Running Supervisor…</p>
          )}
          {error && (
            <p className="text-red-400 py-2">{error}</p>
          )}
          {result && !loading && (
            <div className="space-y-2 py-1">
              <p className="font-medium text-violet-300">
                Next: {result.next_task === 'done' ? 'All caught up' : result.next_task}
              </p>
              {result.message && (
                <p className="text-muted-foreground text-xs">{result.message}</p>
              )}
              {result.next_task === 'script_longform' && result.targetTotal != null && (
                <Button
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => handleGenerateScenes(result.targetTotal!)}
                >
                  Generate {result.targetTotal} scenes
                </Button>
              )}
              {result.history && result.history.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-0.5 pt-1 border-t border-white/8">
                  {result.history.map((h, i) => (
                    <li key={i}>
                      {h.task}: {typeof h.result === 'object' && h.result && 'message' in h.result
                        ? String((h.result as { message?: string }).message)
                        : String(h.result)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
