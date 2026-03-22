'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  X,
  Workflow,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Image as ImageIcon,
  FileImage,
  FileAudio,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Character, CharacterImage } from '@/lib/types';
import type { ComfyWorkflowSummary, ComfyWorkflowFull } from '@/lib/actions/comfyui';
import { parseDynamicInputs, type WorkflowNode, type ComfyDynamicInput } from '@/lib/comfy-parser';
import { addCharacterImage } from '@/lib/actions/characters';
import { ProjectLibraryStrip } from '@/components/media/ProjectLibraryStrip';

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
  const [inputs, setInputs] = useState<ComfyDynamicInput[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string | number | null>>({});
  const [filePaths, setFilePaths] = useState<Record<string, string>>({});
  const [fileDataUrls, setFileDataUrls] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hasUnsupportedInputs, setHasUnsupportedInputs] = useState(false);

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
    setInputs([]);
    setInputValues({});
    setFilePaths({});
    setFileDataUrls({});
    setFieldErrors({});
    setHasUnsupportedInputs(false);
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
    setInputs([]);
    setInputValues({});
    setFilePaths({});
    setFileDataUrls({});
    setFieldErrors({});
    setHasUnsupportedInputs(false);

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

        const parsedInputs = parseDynamicInputs(json);
        setInputs(parsedInputs);

        // For v1: we intentionally do not render/handle `image_url` inputs.
        const unsupported = parsedInputs.filter((i) => i.kind === 'image_url');
        if (unsupported.length > 0) {
          setHasUnsupportedInputs(true);
          setError(
            `Selected workflow contains unsupported input type "${unsupported[0].kind}". This dialog supports only text/textarea, number, image, and audio inputs for now.`
          );
          setPhase('error');
          return;
        }
        setHasUnsupportedInputs(false);

        const initialValues: Record<string, string | number | null> = {};
        const prompt = character.promptPositive?.trim() ?? '';
        const firstText = parsedInputs.find((i) => i.kind === 'textarea' || i.kind === 'text');

        for (const inp of parsedInputs) {
          if (inp.kind === 'number') {
            if (typeof inp.defaultValue === 'number') {
              initialValues[inp.nodeId] = inp.defaultValue;
            } else if (typeof inp.defaultValue === 'string') {
              const n = Number(inp.defaultValue);
              initialValues[inp.nodeId] = Number.isFinite(n) ? n : 0;
            } else {
              initialValues[inp.nodeId] = 0;
            }
            continue;
          }

          if (inp.kind === 'text' || inp.kind === 'textarea') {
            if (firstText && inp.nodeId === firstText.nodeId && prompt) {
              initialValues[inp.nodeId] = prompt;
              continue;
            }
            if (typeof inp.defaultValue === 'string') {
              initialValues[inp.nodeId] = inp.defaultValue;
              continue;
            }
            if (typeof inp.defaultValue === 'number') {
              initialValues[inp.nodeId] = String(inp.defaultValue);
              continue;
            }
            initialValues[inp.nodeId] = '';
          }
        }

        setInputValues(initialValues);
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

  function clearFieldError(nodeId: string) {
    setFieldErrors((prev) => {
      if (!prev[nodeId]) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }

  function setInputValue(nodeId: string, value: string | number) {
    setInputValues((prev) => ({ ...prev, [nodeId]: value }));
    clearFieldError(nodeId);
  }

  async function handleFileChange(nodeId: string, files: FileList | null) {
    if (!character || !files || files.length === 0) return;
    const file = files[0];
    setError(null);

    try {
      const form = new FormData();
      form.append('sceneId', character.id);
      form.append('files', file);

      const res = await fetch('/api/upload/reference', {
        method: 'POST',
        body: form,
      });

      const data = await res.json();
      if (!res.ok || !data?.paths?.[0]) {
        throw new Error(data?.error ?? 'Upload failed');
      }

      const relPath: string = data.paths[0];
      setFilePaths((prev) => ({ ...prev, [nodeId]: relPath }));

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setFileDataUrls((prev) => ({ ...prev, [nodeId]: dataUrl }));
        clearFieldError(nodeId);
      };
      reader.readAsDataURL(file);
    } catch {
      setError('Upload failed — please try again.');
      setPhase('error');
    }
  }

  function validateInputs(): boolean {
    const errors: Record<string, string> = {};

    for (const inp of inputs) {
      if (!inp.required) continue;
      if (inp.kind === 'image') {
        if (!filePaths[inp.nodeId]) errors[inp.nodeId] = `${inp.label} image is required.`;
      } else if (inp.kind === 'audio') {
        if (!filePaths[inp.nodeId]) errors[inp.nodeId] = `${inp.label} audio is required.`;
      } else {
        const val = inputValues[inp.nodeId];
        if (val === undefined || val === null || String(val).trim() === '') {
          errors[inp.nodeId] = `${inp.label} is required.`;
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleGenerate() {
    if (!character || !workflow) return;
    if (hasUnsupportedInputs) {
      setError('This workflow has unsupported input nodes (image_url). Please select a different workflow.');
      setPhase('error');
      return;
    }

    if (!validateInputs()) {
      setError('Please complete all required workflow inputs.');
      setPhase('error');
      return;
    }

    setPhase('submitting');
    setError(null);

    try {
      const mergedValues: Record<string, string | number | null> = { ...inputValues, ...filePaths };

      const res = await fetch('/api/generate/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: workflow.id,
          scene_id: character.id,
          kind: 'image',
          inputValues: mergedValues,
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

          {/* Workflow inputs */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Workflow Inputs</p>

            {inputs.length === 0 && phase === 'ready' && (
              <p className="text-xs text-muted-foreground/70">No (Input) nodes found in this workflow.</p>
            )}

            {inputs
              .filter((i) => i.kind !== 'image_url')
              .map((inp) => {
                const hasError = !!fieldErrors[inp.nodeId];
                const requiredBadge = (
                  <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-400">
                    required
                  </span>
                );

                if (inp.kind === 'number') {
                  return (
                    <div key={inp.nodeId} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[11px] font-medium text-muted-foreground">{inp.label}</label>
                        {requiredBadge}
                      </div>
                      <input
                        type="number"
                        value={String(inputValues[inp.nodeId] ?? 0)}
                        onChange={(e) => setInputValue(inp.nodeId, Number(e.target.value))}
                        disabled={phase === 'loading' || phase === 'submitting' || phase === 'polling'}
                        className={`w-full rounded-lg border bg-black/20 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50 ${
                          hasError ? 'border-red-500/50' : 'border-white/10'
                        }`}
                      />
                      {hasError && <p className="text-[10px] text-red-400">{fieldErrors[inp.nodeId]}</p>}
                    </div>
                  );
                }

                if (inp.kind === 'image') {
                  const charImages = character.images ?? [];
                  const quickPickImages = charImages.filter((img) => !!img.image?.url);

                  return (
                    <div key={inp.nodeId} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[11px] font-medium text-muted-foreground">{inp.label}</label>
                        {requiredBadge}
                      </div>

                      {fileDataUrls[inp.nodeId] ? (
                        <div className="space-y-2">
                          <div className="relative group rounded-lg overflow-hidden border border-white/10">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={fileDataUrls[inp.nodeId]}
                              alt="Preview"
                              className="max-h-40 w-full object-contain bg-black/30"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setFilePaths((p) => {
                                  const next = { ...p };
                                  delete next[inp.nodeId];
                                  return next;
                                });
                                setFileDataUrls((p) => {
                                  const next = { ...p };
                                  delete next[inp.nodeId];
                                  return next;
                                });
                                clearFieldError(inp.nodeId);
                              }}
                              className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/70 opacity-100 transition-opacity"
                              title="Remove"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/10 bg-white/3 py-6 cursor-pointer hover:border-violet-500/30 hover:bg-violet-500/5 transition-colors">
                          <FileImage className="h-6 w-6 text-muted-foreground/40" />
                          <span className="text-xs text-muted-foreground/60">Click to upload image</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleFileChange(inp.nodeId, e.target.files)}
                            disabled={phase === 'loading' || phase === 'submitting' || phase === 'polling'}
                          />
                        </label>
                      )}

                      {quickPickImages.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground/50">Quick-pick from character images</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {quickPickImages.slice(0, 8).map((img) => {
                              const match = img.image.url.match(/\/api\/outputs\/(.+)$/);
                              if (!match?.[1]) return null;
                              const relPath = match[1];
                              const selected = filePaths[inp.nodeId] === relPath;
                              return (
                                <button
                                  key={img.id}
                                  type="button"
                                  onClick={() => {
                                    setFilePaths((p) => ({ ...p, [inp.nodeId]: relPath }));
                                    setFileDataUrls((p) => ({ ...p, [inp.nodeId]: img.image.url }));
                                    clearFieldError(inp.nodeId);
                                  }}
                                  className={`h-10 w-10 overflow-hidden rounded-md border transition-colors ${
                                    selected ? 'border-violet-400' : 'border-white/10 hover:border-violet-500/40'
                                  } bg-black/40`}
                                  title={`${img.kind.toLowerCase()} (${img.source.toLowerCase()})`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={img.image.url} alt="" className="h-full w-full object-cover" />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <ProjectLibraryStrip
                        projectId={character.projectId}
                        filter="image"
                        onPick={async (item) => {
                          if (item.kind !== 'image') return;
                          setFilePaths((p) => ({ ...p, [inp.nodeId]: item.path }));
                          clearFieldError(inp.nodeId);
                          try {
                            const res = await fetch(`/api/outputs/${item.path}`);
                            const blob = await res.blob();
                            const reader = new FileReader();
                            reader.onload = (e) => {
                              setFileDataUrls((p) => ({
                                ...p,
                                [inp.nodeId]: e.target?.result as string,
                              }));
                            };
                            reader.readAsDataURL(blob);
                          } catch {
                            setFileDataUrls((p) => ({
                              ...p,
                              [inp.nodeId]: `/api/outputs/${item.path}`,
                            }));
                          }
                        }}
                        className="pt-1"
                      />

                      {hasError && <p className="text-[10px] text-red-400">{fieldErrors[inp.nodeId]}</p>}
                    </div>
                  );
                }

                if (inp.kind === 'audio') {
                  return (
                    <div key={inp.nodeId} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[11px] font-medium text-muted-foreground">{inp.label}</label>
                        {requiredBadge}
                      </div>

                      {fileDataUrls[inp.nodeId] ? (
                        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                          <FileAudio className="h-4 w-4 text-green-400 shrink-0" />
                          <audio controls src={fileDataUrls[inp.nodeId]} className="flex-1" />
                          <button
                            type="button"
                            onClick={() => {
                              setFilePaths((p) => {
                                const next = { ...p };
                                delete next[inp.nodeId];
                                return next;
                              });
                              setFileDataUrls((p) => {
                                const next = { ...p };
                                delete next[inp.nodeId];
                                return next;
                              });
                              clearFieldError(inp.nodeId);
                            }}
                            className="text-muted-foreground/50 hover:text-foreground"
                            title="Remove"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/10 bg-white/3 py-6 cursor-pointer hover:border-violet-500/30 hover:bg-violet-500/5 transition-colors">
                          <FileAudio className="h-6 w-6 text-muted-foreground/40" />
                          <span className="text-xs text-muted-foreground/60">Click to upload audio</span>
                          <input
                            type="file"
                            accept="audio/*"
                            className="hidden"
                            onChange={(e) => handleFileChange(inp.nodeId, e.target.files)}
                            disabled={phase === 'loading' || phase === 'submitting' || phase === 'polling'}
                          />
                        </label>
                      )}

                      {hasError && <p className="text-[10px] text-red-400">{fieldErrors[inp.nodeId]}</p>}
                    </div>
                  );
                }

                // text / textarea
                return (
                  <div key={inp.nodeId} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[11px] font-medium text-muted-foreground">{inp.label}</label>
                      {requiredBadge}
                    </div>
                    <Textarea
                      rows={inp.kind === 'textarea' ? 6 : 3}
                      value={String(inputValues[inp.nodeId] ?? '')}
                      onChange={(e) => setInputValue(inp.nodeId, e.target.value)}
                      disabled={phase === 'loading' || phase === 'submitting' || phase === 'polling'}
                      placeholder={`Enter ${inp.label}…`}
                      className={`resize-none bg-black/30 border-white/12 text-xs placeholder:text-muted-foreground/50 ${
                        hasError ? 'border-red-500/30' : ''
                      }`}
                    />
                    {hasError && <p className="text-[10px] text-red-400">{fieldErrors[inp.nodeId]}</p>}
                  </div>
                );
              })}
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
              This generates a character sheet image using the selected ComfyUI workflow and your workflow inputs.
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
                disabled={
                  !selectedWorkflowId || comfyImageWorkflows.length === 0 || hasUnsupportedInputs || inputs.length === 0
                }
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

