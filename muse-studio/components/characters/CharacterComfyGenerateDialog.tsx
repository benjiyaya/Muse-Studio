'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Workflow, AlertCircle, Loader2, CheckCircle2, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Character, CharacterImage } from '@/lib/types';
import type { ComfyWorkflowSummary, ComfyWorkflowFull } from '@/lib/actions/comfyui';
import { parseDynamicInputs, type WorkflowNode } from '@/lib/comfy-parser';
import { addCharacterImage } from '@/lib/actions/characters';

type Phase = 'idle' | 'loading' | 'ready' | 'submitting' | 'polling' | 'result' | 'error';

interface JobResult {
  status: string;
  output_path?: string;
  error?: string;
}

interface CharacterComfyGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  character: Character | null;
  comfyImageWorkflows: ComfyWorkflowSummary[];
  onImageAttached?: (image: CharacterImage) => void;
}

const POLL_INTERVAL_MS = 2500;

export function CharacterComfyGenerateDialog({
  open,
  onClose,
  character,
  comfyImageWorkflows,
  onImageAttached,
}: CharacterComfyGenerateDialogProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<ComfyWorkflowFull | null>(null);
  const [textNodeId, setTextNodeId] = useState<string | null>(null);
  const [promptValue, setPromptValue] = useState<string>('');

  const [jobId, setJobId] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [resultOutputPath, setResultOutputPath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset dialog state whenever it is reopened or target character changes
  useEffect(() => {
    if (!open) return;
    setPhase('idle');
    setError(null);
    setWorkflow(null);
    setTextNodeId(null);
    setPromptValue(character?.promptPositive?.trim() ?? '');
    setJobId(null);
    setResultImageUrl(null);
    setResultOutputPath(null);

    // Default to the first image workflow if none selected yet
    if (!selectedWorkflowId && comfyImageWorkflows.length > 0) {
      setSelectedWorkflowId(comfyImageWorkflows[0].id);
    }
  }, [open, character, comfyImageWorkflows, selectedWorkflowId]);

  // Load and parse the selected workflow
  useEffect(() => {
    if (!open || !selectedWorkflowId || !character) return;

    setPhase('loading');
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/comfy-workflow/${selectedWorkflowId}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? 'Failed to load workflow.');
        }

        const wf = data as ComfyWorkflowFull;
        setWorkflow(wf);

        let json: Record<string, WorkflowNode>;
        try {
          json = JSON.parse(wf.json);
        } catch {
          setError('Stored workflow JSON is invalid.');
          setPhase('error');
          return;
        }

        const inputs = parseDynamicInputs(json);
        const firstText = inputs.find((i) => i.kind === 'textarea' || i.kind === 'text');
        if (!firstText) {
          setError('Selected workflow has no text input (Input) node.');
          setPhase('error');
          return;
        }

        setTextNodeId(firstText.nodeId);

        const initialPrompt =
          character.promptPositive?.trim() ||
          (typeof firstText.defaultValue === 'string' ? firstText.defaultValue : '');
        setPromptValue(initialPrompt);
        setPhase('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workflow.');
        setPhase('error');
      }
    })();
  }, [open, selectedWorkflowId, character]);

  const startPolling = useCallback((jid: string) => {
    setPhase('polling');
    setJobId(jid);

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jid}`);
        if (!res.ok) return;
        const job = (await res.json()) as JobResult;

        if (job.status === 'completed' && job.output_path) {
          clearInterval(timer);
          setResultOutputPath(job.output_path);
          setResultImageUrl(`/api/outputs/${job.output_path}`);
          setPhase('result');
        } else if (job.status === 'failed') {
          clearInterval(timer);
          setError(job.error ?? 'Generation failed.');
          setPhase('error');
        }
      } catch {
        // transient network error; keep polling
      }
    }, POLL_INTERVAL_MS);
  }, []);

  async function handleGenerate() {
    if (!character || !workflow || !textNodeId) return;
    const trimmed = promptValue.trim();
    if (!trimmed) {
      setError('Prompt is required.');
      setPhase('error');
      return;
    }

    setPhase('submitting');
    setError(null);

    try {
      const res = await fetch('/api/generate/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: workflow.id,
          scene_id: character.id,
          kind: 'image',
          inputValues: { [textNodeId]: trimmed },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Generation request failed.');
        setPhase('error');
        return;
      }

      const jid: string | undefined = data.job_id;
      if (!jid) {
        setError('Backend did not return a job id.');
        setPhase('error');
        return;
      }

      startPolling(jid);
    } catch {
      setError('Network error. Is the backend running?');
      setPhase('error');
    }
  }

  async function handleAttachToCharacter() {
    if (!character || !resultOutputPath) return;
    setIsSaving(true);
    setError(null);
    try {
      const image = await addCharacterImage({
        characterId: character.id,
        kind: 'FACE',
        imagePath: resultOutputPath,
      });
      onImageAttached?.(image);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to attach image to character.');
      setPhase('error');
    } finally {
      setIsSaving(false);
    }
  }

  if (!open || !character) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-white/10 bg-[oklch(0.13_0.012_264)] shadow-2xl shadow-black/70 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
              <Workflow className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Generate character image
              </p>
              <p className="text-xs text-muted-foreground/80">
                {character.name} · {workflow ? workflow.name : 'Select a workflow'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Workflow selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              ComfyUI image workflow
            </label>
            {comfyImageWorkflows.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">
                No image workflows available. Register a ComfyUI workflow in Settings → ComfyUI first.
              </p>
            ) : (
              <select
                value={selectedWorkflowId ?? ''}
                onChange={(e) => setSelectedWorkflowId(e.target.value || null)}
                className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                disabled={phase === 'submitting' || phase === 'polling'}
              >
                {comfyImageWorkflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Prompt textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-medium text-muted-foreground">
                Visual prompt
              </label>
              <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-400">
                required
              </span>
            </div>
            <Textarea
              rows={6}
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              disabled={phase === 'loading' || phase === 'submitting' || phase === 'polling'}
              placeholder="Use the Muse-generated visual prompt as a starting point, then tweak as needed."
              className="resize-none bg-black/30 border-white/12 text-xs placeholder:text-muted-foreground/50"
            />
          </div>

          {/* Polling indicator */}
          {phase === 'polling' && (
            <div className="flex items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
              <div>
                <p className="text-sm font-medium text-violet-200">Generating image…</p>
                <p className="text-xs text-muted-foreground/70">
                  {jobId ? `Job ${jobId.slice(0, 12)}…` : 'Waiting for ComfyUI'}
                </p>
              </div>
            </div>
          )}

          {/* Result */}
          {phase === 'result' && resultImageUrl && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm font-medium">Generation complete</span>
              </div>
              <button
                type="button"
                onClick={() => window.open(resultImageUrl, '_blank', 'noreferrer')}
                className="group w-full rounded-xl border border-white/10 bg-black/30 overflow-hidden cursor-zoom-in"
                title="Open full-size image"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resultImageUrl}
                  alt="Generated character"
                  className="w-full max-h-64 object-contain transition-transform group-hover:scale-[1.02]"
                />
              </button>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <AlertCircle className="h-4 w-4 text-red-300 mt-0.5" />
              <p className="text-xs text-red-200">{error}</p>
            </div>
          )}

          {/* Hint */}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
            <ImageIcon className="h-3.5 w-3.5" />
            <span>
              This generates a character sheet image using the selected ComfyUI workflow and your visual prompt.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/8 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>

          <div className="flex items-center gap-2">
            {phase === 'result' && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
                disabled={isSaving}
                onClick={handleAttachToCharacter}
              >
                {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Attach to character
              </Button>
            )}

            {(phase === 'ready' || phase === 'error' || phase === 'idle') && (
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-500 text-white"
                disabled={!selectedWorkflowId || comfyImageWorkflows.length === 0}
                onClick={handleGenerate}
              >
                Generate image
              </Button>
            )}

            {(phase === 'submitting' || phase === 'polling') && (
              <Button size="sm" disabled className="bg-violet-600/60 text-white/80">
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {phase === 'submitting' ? 'Submitting…' : 'Generating…'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

