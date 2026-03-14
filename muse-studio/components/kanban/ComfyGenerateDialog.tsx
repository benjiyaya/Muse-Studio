'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  X, Workflow, AlertCircle, CheckCircle2, Image as ImageIcon,
  Video, Loader2, Copy, Check, FileImage, FileAudio,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { updateSceneStatus, createKeyframe, updateKeyframeOutput } from '@/lib/actions/scenes';
import type { Scene, Character } from '@/lib/types';
import type { ComfyWorkflowFull } from '@/lib/actions/comfyui';
import {
  parseDynamicInputs,
  parseDynamicOutputs,
  type ComfyDynamicInput,
  type ComfyDynamicOutput,
  type WorkflowNode,
} from '@/lib/comfy-parser';

interface ComfyGenerateDialogProps {
  isOpen: boolean;
  scene: Scene | null;
  kind: 'image' | 'video' | null;
  workflowId: string | null;
  onClose: () => void;
  onGenerationStarted?: (sceneId: string, jobId: string) => void;
  onWorkflowInvalid?: (sceneId: string, kind: 'image' | 'video') => void;
  characters?: Character[];
}

type Phase = 'loading' | 'idle' | 'submitting' | 'polling' | 'result' | 'error';

interface JobResult {
  status: string;
  output_path?: string;
  error?: string;
}

const POLL_INTERVAL = 2500;

export function ComfyGenerateDialog({
  isOpen,
  scene,
  kind,
  workflowId,
  onClose,
  onGenerationStarted,
  onWorkflowInvalid,
  characters = [],
}: ComfyGenerateDialogProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [workflow, setWorkflow] = useState<ComfyWorkflowFull | null>(null);
  const [inputs, setInputs] = useState<ComfyDynamicInput[]>([]);
  const [outputs, setOutputs] = useState<ComfyDynamicOutput[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string | number>>({});
  const [fileDataUrls, setFileDataUrls] = useState<Record<string, string>>({});
  const [filePaths, setFilePaths] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [resultOutputPath, setResultOutputPath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showValidationBanner, setShowValidationBanner] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstErrorRef = useRef<HTMLDivElement | null>(null);

  // ── Load workflow on open ──────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !workflowId || !scene || !kind) return;

    setPhase('loading');
    setWorkflow(null);
    setInputs([]);
    setOutputs([]);
    setInputValues({});
    setFileDataUrls({});
    setFilePaths({});
    setError(null);
    setJobId(null);
    setResultImageUrl(null);
    setResultOutputPath(null);
    setFieldErrors({});
    setShowValidationBanner(false);

    (async () => {
      try {
        const res = await fetch(`/api/comfy-workflow/${workflowId}`);
        const data = await res.json();

        if (!res.ok) {
          const msg: string = data?.error ?? 'Failed to load workflow.';
          if (
            (msg === 'Workflow not found' || msg === 'Stored workflow JSON is invalid.') &&
            onWorkflowInvalid
          ) {
            onWorkflowInvalid(scene.id, kind);
            return;
          }
          throw new Error(msg);
        }

        const wf = data as ComfyWorkflowFull;
        setWorkflow(wf);

        let json: Record<string, WorkflowNode>;
        try {
          json = JSON.parse(wf.json);
        } catch {
          const msg = 'Stored workflow JSON is invalid.';
          if (onWorkflowInvalid) {
            onWorkflowInvalid(scene.id, kind);
            return;
          }
          setError(msg);
          setPhase('error');
          return;
        }

        const parsedInputs = parseDynamicInputs(json);
        const parsedOutputs = parseDynamicOutputs(json);
        setInputs(parsedInputs);
        setOutputs(parsedOutputs);

        // Pre-populate defaults
        const imagePrompt =
          scene.keyframes?.[0]?.generationParams?.prompt ?? scene.description ?? '';

        const keyframeImage =
          scene.keyframes?.find((kf) => kf.finalImage || kf.draftImage)?.finalImage ??
          scene.keyframes?.find((kf) => kf.finalImage || kf.draftImage)?.draftImage ??
          null;
        const keyframeUrl = keyframeImage?.url ?? '';

        const defaults: Record<string, string | number> = {};
        for (const inp of parsedInputs) {
          if (inp.kind === 'image' || inp.kind === 'audio') continue;

          if (inp.kind === 'number') {
            defaults[inp.nodeId] = typeof inp.defaultValue === 'number' ? inp.defaultValue : 0;
            continue;
          }

          // URL-based image loader (e.g. "Load Image From Url (mtb)")
          if (inp.kind === 'image_url') {
            defaults[inp.nodeId] =
              typeof inp.defaultValue === 'string' && inp.defaultValue.trim().length > 0
                ? inp.defaultValue
                : keyframeUrl;
            continue;
          }

          // For text/textarea: prefer LLM image prompt for first text field, then default, then description
          const isFirstTextInput =
            (inp.kind === 'text' || inp.kind === 'textarea') &&
            Object.values(defaults).every((v) => typeof v !== 'string' || v === '');

          defaults[inp.nodeId] =
            isFirstTextInput && imagePrompt
              ? imagePrompt
              : typeof inp.defaultValue === 'string'
              ? inp.defaultValue
              : '';
        }
        setInputValues(defaults);
        setPhase('idle');
      } catch {
        setError('Failed to load workflow.');
        setPhase('error');
      }
    })();
  }, [isOpen, workflowId, scene, kind, onWorkflowInvalid]);

  // ── Cleanup polling on close ───────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [isOpen]);

  // ── Input handlers ─────────────────────────────────────────────────────────

  function setInputValue(nodeId: string, value: string | number) {
    setInputValues((prev) => ({ ...prev, [nodeId]: value }));
    clearFieldError(nodeId);
  }

  function clearFieldError(nodeId: string) {
    setFieldErrors((prev) => {
      if (!prev[nodeId]) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }

  async function handleFileChange(nodeId: string, files: FileList | null) {
    if (!files || files.length === 0 || !scene) return;
    const file = files[0];

    try {
      const form = new FormData();
      form.append('sceneId', scene.id);
      form.append('files', file);

      const res = await fetch('/api/upload/reference', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data?.paths?.[0]) {
        throw new Error(data?.error ?? 'Upload failed');
      }

      const relPath: string = data.paths[0]; // e.g. "refs/scene-001/<uuid>.png" or ".mp3"
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

  // ── Validation ─────────────────────────────────────────────────────────────

  function validateInputs(): boolean {
    const errors: Record<string, string> = {};

    for (const inp of inputs) {
      if (!inp.required) continue;
      if (inp.kind === 'image') {
        if (!filePaths[inp.nodeId]) {
          errors[inp.nodeId] = `${inp.label} image is required.`;
        }
      } else if (inp.kind === 'audio') {
        if (!filePaths[inp.nodeId]) {
          errors[inp.nodeId] = `${inp.label} audio is required.`;
        }
      } else {
        const val = inputValues[inp.nodeId];
        if (val === undefined || val === null || String(val).trim() === '') {
          errors[inp.nodeId] = `${inp.label} is required.`;
        }
      }
    }

    setFieldErrors(errors);
    const hasErrors = Object.keys(errors).length > 0;
    setShowValidationBanner(hasErrors);

    if (hasErrors) {
      setTimeout(() => firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }

    return !hasErrors;
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  const startPolling = useCallback(
    (jid: string) => {
      if (pollingRef.current) clearInterval(pollingRef.current);

      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jid}`);
          if (!res.ok) return;
          const job = (await res.json()) as JobResult;

          if (job.status === 'completed' && job.output_path) {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setResultImageUrl(`/api/outputs/${job.output_path}`);
            setResultOutputPath(job.output_path);
            setPhase('result');
          } else if (job.status === 'failed') {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setError(job.error ?? 'Generation failed.');
            setPhase('error');
          }
        } catch {
          // transient
        }
      }, POLL_INTERVAL);
    },
    [],
  );

  // ── Generate ───────────────────────────────────────────────────────────────

  async function handleGenerate() {
    if (!scene || !workflowId) return;
    if (!validateInputs()) return;

    setPhase('submitting');
    setError(null);

    // Merge uploaded file paths (for image/audio) into inputValues for submission
    const mergedValues: Record<string, string | number | null> = { ...inputValues };
    for (const [nodeId, relPath] of Object.entries(filePaths)) {
      mergedValues[nodeId] = relPath;
    }

    try {
      const res = await fetch('/api/generate/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: workflowId,
          scene_id: scene.id,
          kind,
          inputValues: mergedValues,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg: string = data?.error ?? 'Generation request failed.';
        if (
          (msg === 'Workflow not found' || msg === 'Stored workflow JSON is invalid') &&
          scene &&
          kind &&
          onWorkflowInvalid
        ) {
          onWorkflowInvalid(scene.id, kind);
          return;
        }
        setError(msg);
        setPhase('error');
        return;
      }

      const jid: string = data.job_id;
      setJobId(jid);

      if (kind === 'video') {
        // Hand off polling to KanbanBoard; close dialog
        await updateSceneStatus(scene.id, 'GENERATING');
        onGenerationStarted?.(scene.id, jid);
        router.refresh();
        onClose();
      } else {
        // Image: poll internally
        setPhase('polling');
        startPolling(jid);
      }
    } catch {
      setError('Network error. Is the backend running?');
      setPhase('error');
    }
  }

  // ── Save keyframe ──────────────────────────────────────────────────────────

  async function handleSaveKeyframe() {
    if (!scene || !resultOutputPath) return;
    setIsSaving(true);
    try {
      const kfId = await createKeyframe({
        sceneId: scene.id,
        source: 'VISUAL_MUSE',
        prompt:
          typeof inputValues[
            inputs.find((i) => i.kind === 'textarea' || i.kind === 'text')?.nodeId ?? ''
          ] === 'string'
          ? String(inputValues[inputs.find((i) => i.kind === 'textarea' || i.kind === 'text')?.nodeId ?? ''] ?? '')
          : '',
      });
      await updateKeyframeOutput(kfId, { draftImagePath: resultOutputPath });
      await updateSceneStatus(scene.id, 'DRAFT_QUEUE');
      router.refresh();
      onClose();
    } catch {
      setError('Failed to save keyframe.');
    } finally {
      setIsSaving(false);
    }
  }

  // ── Copy prompt ───────────────────────────────────────────────────────────

  async function handleCopyPrompt(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch { /* ignore */ }
  }

  if (!isOpen || !scene) return null;

  const kindLabel = kind === 'image' ? 'Keyframe Image' : 'Video';
  const imagePrompt = scene?.keyframes?.[0]?.generationParams?.prompt;
  const errorCount = Object.keys(fieldErrors).length;
  const emptyOptionalCount = 0; // all inputs are required
  const firstTextInput = inputs.find((i) => i.kind === 'textarea' || i.kind === 'text');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[1024] max-h-[88vh] flex flex-col rounded-2xl border border-white/10 bg-[oklch(0.13_0.01_264)] shadow-2xl shadow-black/50">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <Workflow className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{kindLabel} Generation</p>
              <p className="text-xs text-muted-foreground">
                {workflow ? workflow.name : 'Loading…'} · {scene.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className={kind === 'video' ? 'flex items-start gap-5' : 'flex flex-col gap-5'}>
            {/* Main column */}
            <div className="flex-1 space-y-5">
              {/* Loading spinner */}
              {phase === 'loading' && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
                </div>
              )}

              {/* LLM image prompt pill (shown above inputs for image mode only) */}
              {kind === 'image' && imagePrompt && phase !== 'loading' && (
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/8 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-400 mb-1">
                        LLM Image Prompt
                      </p>
                      <p className="text-xs text-blue-200/80 leading-relaxed line-clamp-3">{imagePrompt}</p>
                    </div>
                    <button
                      title="Copy prompt"
                      onClick={() => handleCopyPrompt(imagePrompt)}
                      className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-blue-400/60 transition-colors hover:bg-blue-500/15 hover:text-blue-400"
                    >
                      {copiedPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Dynamic input form */}
              {(phase === 'idle' || phase === 'submitting' || phase === 'polling') && inputs.length > 0 && (
                <div className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Workflow Inputs
                  </p>
                  {inputs.map((inp, idx) => {
                    const hasError = !!fieldErrors[inp.nodeId];
                    const isOptionalEmpty = false; // all inputs are required

                    return (
                      <div
                        key={inp.nodeId}
                        ref={
                          hasError && idx === inputs.findIndex((i) => fieldErrors[i.nodeId])
                            ? firstErrorRef
                            : undefined
                        }
                        className={`space-y-1.5 rounded-xl p-3 transition-colors ${
                          hasError
                            ? 'bg-red-500/5 border border-red-500/20'
                            : isOptionalEmpty
                            ? 'bg-amber-500/4 border border-amber-500/15'
                            : 'bg-white/3 border border-white/6'
                        }`}
                      >
                        {/* Label row */}
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-foreground/80">{inp.label}</label>
                          {inp.required ? (
                            <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-400">
                              required
                            </span>
                          ) : (
                            <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground/60">
                              optional
                            </span>
                          )}
                        </div>

                        {/* Input controls */}
                        {(inp.kind === 'textarea' || inp.kind === 'text') && (
                          <Textarea
                            value={String(inputValues[inp.nodeId] ?? '')}
                            onChange={(e) => setInputValue(inp.nodeId, e.target.value)}
                            rows={4}
                            disabled={phase !== 'idle'}
                            placeholder={`Enter ${inp.label.toLowerCase()}…`}
                            className={`resize-none text-sm bg-black/20 border-white/10 ${
                              hasError ? 'border-red-500/50 focus-visible:ring-red-500/30' : ''
                            }`}
                          />
                        )}

                        {inp.kind === 'image_url' && (
                          <div className="space-y-2">
                            {/* Hidden field carries the URL value for form semantics; value is driven by state */}
                            <input type="hidden" value={String(inputValues[inp.nodeId] ?? '')} readOnly />

                            {/* Live preview only (no visible textbox) */}
                            {String(inputValues[inp.nodeId] ?? '').trim() && (
                              <div className="rounded-lg border border-white/10 bg-black/30 overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={String(inputValues[inp.nodeId])}
                                  alt="Preview from URL"
                                  className="w-full max-h-40 object-contain"
                                />
                              </div>
                            )}

                            {/* Keyframe thumbnail picker (for image URL) */}
                            {scene.keyframes.some((kf) => kf.draftImage || kf.finalImage) && (
                              <div className="space-y-1">
                                <p className="text-[10px] text-muted-foreground/50">Or use scene keyframe:</p>
                                <div className="flex gap-1.5 flex-wrap">
                                  {scene.keyframes.flatMap((kf) => {
                                    const img = kf.finalImage ?? kf.draftImage;
                                    if (!img) return [];
                                    const isSelected = String(inputValues[inp.nodeId] ?? '') === img.url;
                                    return (
                                      <button
                                        key={kf.keyframeId}
                                        type="button"
                                        onClick={() => {
                                          setInputValue(inp.nodeId, img.url);
                                        }}
                                        className={`h-10 w-10 overflow-hidden rounded-md border transition-colors ${
                                          isSelected
                                            ? 'border-violet-500 ring-1 ring-violet-500/60'
                                            : 'border-white/10 hover:border-violet-500/40'
                                        }`}
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={img.url} alt="" className="h-full w-full object-cover" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Character image picker (for image URL) */}
                            {characters.length > 0 &&
                              characters.some((c) => c.images && c.images.length > 0) && (
                                <div className="space-y-1">
                                  <p className="text-[10px] text-muted-foreground/50">Or use character image:</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {characters.flatMap((c) =>
                                      (c.images ?? []).map((img) => {
                                        if (!img.image?.url) return [];
                                        const isSelected =
                                          String(inputValues[inp.nodeId] ?? '') === img.image.url;
                                        return (
                                          <button
                                            key={img.id}
                                            type="button"
                                            onClick={() => {
                                              setInputValue(inp.nodeId, img.image.url);
                                            }}
                                            className={`h-9 w-9 overflow-hidden rounded-md border transition-colors ${
                                              isSelected
                                                ? 'border-violet-500 ring-1 ring-violet-500/60'
                                                : 'border-white/10 hover:border-violet-500/40'
                                            }`}
                                            title={`${c.name} · ${img.kind.toLowerCase()}`}
                                          >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                              src={img.image.url}
                                              alt={c.name}
                                              className="h-full w-full object-cover"
                                            />
                                          </button>
                                        );
                                      }),
                                    )}
                                  </div>
                                </div>
                              )}
                          </div>
                        )}

                        {inp.kind === 'number' && (
                          <input
                            type="number"
                            value={String(inputValues[inp.nodeId] ?? 0)}
                            onChange={(e) => setInputValue(inp.nodeId, Number(e.target.value))}
                            disabled={phase !== 'idle'}
                            className={`w-full rounded-lg border bg-black/20 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50 ${
                              hasError ? 'border-red-500/50' : 'border-white/10'
                            }`}
                          />
                        )}

                        {inp.kind === 'image' && (
                          <div className="space-y-2">
                            {fileDataUrls[inp.nodeId] ? (
                              <div className="relative group rounded-lg overflow-hidden border border-white/10">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={fileDataUrls[inp.nodeId]}
                                  alt="Preview"
                                  className="max-h-40 w-full object-contain bg-black/30"
                                />
                                <button
                                  onClick={() =>
                                    setFileDataUrls((p) => {
                                      const n = { ...p };
                                      delete n[inp.nodeId];
                                      return n;
                                    })
                                  }
                                  className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
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
                                />
                              </label>
                            )}
                            {/* Quick-pick from scene keyframes */}
                            {scene.keyframes.some((kf) => kf.draftImage || kf.finalImage) && (
                              <div className="space-y-1">
                                <p className="text-[10px] text-muted-foreground/50">Or use scene keyframe:</p>
                                <div className="flex gap-1.5 flex-wrap">
                                  {scene.keyframes.flatMap((kf) => {
                                    const img = kf.finalImage ?? kf.draftImage;
                                    if (!img) return [];
                                    return (
                                      <button
                                        key={kf.keyframeId}
                                        type="button"
                                        onClick={async () => {
                                          // Derive backend-relative path from /api/outputs/<relPath>
                                          const match = img.url.match(/\/api\/outputs\/(.+)$/);
                                          if (match?.[1]) {
                                            const relPath = match[1];
                                            setFilePaths((prev) => ({ ...prev, [inp.nodeId]: relPath }));
                                            clearFieldError(inp.nodeId);
                                          }

                                          // Also load into preview for better UX
                                          const res = await fetch(img.url);
                                          const blob = await res.blob();
                                          const reader = new FileReader();
                                          reader.onload = (e) => {
                                            const dataUrl = e.target?.result as string;
                                            setFileDataUrls((prev) => ({ ...prev, [inp.nodeId]: dataUrl }));
                                          };
                                          reader.readAsDataURL(blob);
                                        }}
                                        className="h-10 w-10 overflow-hidden rounded-md border border-white/10 hover:border-violet-500/40 transition-colors"
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={img.url} alt="" className="h-full w-full object-cover" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Character image picker */}
                            {characters.length > 0 &&
                              characters.some((c) => c.images && c.images.length > 0) && (
                                <div className="space-y-1">
                                  <p className="text-[10px] text-muted-foreground/50">Or use character image:</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {characters.flatMap((c) =>
                                      (c.images ?? []).map((img) => {
                                        if (!img.image?.url) return [];

                                        return (
                                          <button
                                            key={img.id}
                                            type="button"
                                            onClick={async () => {
                                              const match = img.image.url.match(/\/api\/outputs\/(.+)$/);
                                              if (match?.[1]) {
                                                const relPath = match[1];
                                                setFilePaths((prev) => ({ ...prev, [inp.nodeId]: relPath }));
                                                clearFieldError(inp.nodeId);
                                              }

                                              // For preview we can use the served URL directly
                                              setFileDataUrls((prev) => ({
                                                ...prev,
                                                [inp.nodeId]: img.image.url,
                                              }));
                                            }}
                                            className="h-9 w-9 overflow-hidden rounded-md border border-white/10 hover:border-violet-500/40 transition-colors"
                                            title={`${c.name} · ${img.kind.toLowerCase()}`}
                                          >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                              src={img.image.url}
                                              alt={c.name}
                                              className="h-full w-full object-cover"
                                            />
                                          </button>
                                        );
                                      }),
                                    )}
                                  </div>
                                </div>
                              )}
                          </div>
                        )}

                        {inp.kind === 'audio' && (
                          <div className="space-y-1.5">
                            {fileDataUrls[inp.nodeId] ? (
                              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                                <FileAudio className="h-4 w-4 text-green-400 shrink-0" />
                                <span className="text-xs text-muted-foreground flex-1 truncate">Audio loaded</span>
                                <button
                                  onClick={() =>
                                    setFileDataUrls((p) => {
                                      const n = { ...p };
                                      delete n[inp.nodeId];
                                      return n;
                                    })
                                  }
                                  className="text-muted-foreground/50 hover:text-foreground"
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
                                />
                              </label>
                            )}
                          </div>
                        )}

                        {/* Field error */}
                        {hasError && (
                          <p className="flex items-center gap-1 text-[10px] text-red-400">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            {fieldErrors[inp.nodeId]}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Outputs section */}
              {outputs.length > 0 && phase !== 'loading' && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Expected Outputs
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {outputs.map((out) => (
                      <span
                        key={out.nodeId}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                          out.kind === 'video'
                            ? 'border-blue-500/20 bg-blue-500/10 text-blue-300'
                            : out.kind === 'image'
                            ? 'border-violet-500/20 bg-violet-500/10 text-violet-300'
                            : 'border-white/10 bg-white/6 text-muted-foreground'
                        }`}
                      >
                        {out.kind === 'video' ? (
                          <Video className="h-3 w-3" />
                        ) : out.kind === 'image' ? (
                          <ImageIcon className="h-3 w-3" />
                        ) : null}
                        {out.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Polling indicator */}
              {phase === 'polling' && (
                <div className="flex items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/8 px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-violet-300">Generating…</p>
                    <p className="text-xs text-muted-foreground/60">
                      {jobId ? `Job ${jobId.slice(0, 12)}…` : 'Waiting for ComfyUI'}
                    </p>
                  </div>
                </div>
              )}

              {/* Result image */}
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
                      alt="Generated output"
                      className="w-full max-h-64 object-contain transition-transform group-hover:scale-[1.02]"
                    />
                  </button>
                </div>
              )}
            </div>

            {/* Right column: scene context (video only) */}
            {kind === 'video' && (
              <aside className="w-72 shrink-0 space-y-3 rounded-xl border border-white/10 bg-white/3 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Scene Context
                </p>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div>
                    <p className="font-semibold text-foreground">{scene.title}</p>
                    {scene.heading && (
                      <p className="text-[11px] text-muted-foreground/80 mt-0.5">{scene.heading}</p>
                    )}
                  </div>
                  {scene.description && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                        Description
                      </p>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed max-h-40 overflow-y-auto">
                        {scene.description}
                      </p>
                    </div>
                  )}
                  {scene.dialogue && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                        Dialogue
                      </p>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed max-h-32 overflow-y-auto">
                        {scene.dialogue}
                      </p>
                    </div>
                  )}
                  {scene.notes && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                        Notes
                      </p>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed max-h-32 overflow-y-auto">
                        {scene.notes}
                      </p>
                    </div>
                  )}
                </div>

                {/* LLM image prompt pill (video mode: shown below scene context) */}
                {imagePrompt && phase !== 'loading' && (
                  <div className="mt-3 rounded-xl border border-blue-500/25 bg-blue-500/10 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-300 mb-1">
                          LLM Image Prompt
                        </p>
                        <p className="text-xs text-blue-100/80 leading-relaxed line-clamp-5">{imagePrompt}</p>
                      </div>
                      <button
                        title="Copy prompt"
                        onClick={() => handleCopyPrompt(imagePrompt)}
                        className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-blue-200/70 transition-colors hover:bg-blue-500/20 hover:text-blue-50"
                      >
                        {copiedPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}
              </aside>
            )}
          </div>
        </div>

        {/* ── Status bar + Footer ────────────────────────────────────────────── */}

        {/* Validation / error status bar — fixed above footer */}
        {(showValidationBanner && errorCount > 0) || phase === 'error' ? (
          <div className="shrink-0 border-t border-white/6 px-5 py-2">
            {showValidationBanner && errorCount > 0 && phase !== 'error' && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-300">
                  {errorCount} required field{errorCount > 1 ? 's are' : ' is'} missing.
                </p>
              </div>
            )}
            {phase === 'error' && error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}
          </div>
        ) : null}

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {phase === 'result' ? 'Done' : 'Cancel'}
          </Button>

          <div className="flex items-center gap-2">
            {/* Hint about optional empty fields */}
            {emptyOptionalCount > 0 && (phase === 'idle') && (
              <p className="text-[10px] text-amber-400/60">
                {emptyOptionalCount} optional input{emptyOptionalCount > 1 ? 's' : ''} empty
              </p>
            )}

            {phase === 'result' && kind === 'image' && (
              <Button
                size="sm"
                disabled={isSaving}
                onClick={handleSaveKeyframe}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Save as Keyframe
              </Button>
            )}

            {(phase === 'idle' || phase === 'error') && (
              <Button
                size="sm"
                disabled={phase === 'error' && !error?.includes('Network')}
                onClick={handleGenerate}
                className="bg-violet-600 hover:bg-violet-500 text-white"
              >
                {kind === 'image' ? 'Generate Image' : 'Generate Video'}
              </Button>
            )}

            {(phase === 'submitting' || phase === 'polling') && (
              <Button size="sm" disabled className="bg-violet-600/50 text-white/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                {phase === 'submitting' ? 'Submitting…' : 'Generating…'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
