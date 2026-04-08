'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileAudio,
  FileImage,
  FlaskConical,
  Image as ImageIcon,
  Images,
  Loader2,
  Video,
  Workflow,
  X,
} from 'lucide-react';
import { MuseChatPanel } from '@/components/muse/MuseChatPanel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getProjectById } from '@/lib/actions/projects';
import { listCharacters } from '@/lib/actions/characters';
import {
  listProjectMediaLibrary,
  listPlaygroundGlobalLibrary,
  promotePlaygroundAssetToKeyframe,
  promotePlaygroundAssetToCharacterImage,
  promotePlaygroundVideoToScene,
  type MediaLibraryItem,
} from '@/lib/actions/projectMediaLibrary';
import type { CharacterImageKind } from '@/lib/types';
import type { ComfyWorkflowFull, ComfyWorkflowSummary } from '@/lib/actions/comfyui';
import type { ProjectStage } from '@/lib/types';
import {
  parseDynamicInputs,
  parseDynamicOutputs,
  type ComfyDynamicInput,
  type ComfyDynamicOutput,
  type WorkflowNode,
} from '@/lib/comfy-parser';
import { cn } from '@/lib/utils';
import { JOB_POLL_INTERVAL_MS } from '@/lib/jobs/jobPolling';
import { useSingleJobPoll } from '@/hooks/useJobPoll';
import {
  buildComfyUiGeneratePayload,
  mergeComfyMergedValues,
} from '@/lib/generation/comfyPluginGeneration';

const PLAYGROUND_SCENE_ID = 'playground';

export interface PlaygroundProjectSummary {
  id: string;
  title: string;
  currentStage: ProjectStage;
  logline?: string;
}

interface PlaygroundPageClientProps {
  workflows: ComfyWorkflowSummary[];
  projects: PlaygroundProjectSummary[];
}

type Phase = 'loading' | 'idle' | 'submitting' | 'polling' | 'result' | 'error';

const STAGE_LABEL: Record<ProjectStage, string> = {
  STORYLINE: 'Storyline',
  SCRIPT: 'Script',
  KEYFRAME_VIDEO: 'Production',
};

const CHARACTER_KIND_OPTIONS: CharacterImageKind[] = [
  'FACE',
  'FULL_BODY',
  'EXPRESSION',
  'OUTFIT',
  'TURNAROUND',
  'ACTION',
  'OTHER',
];

export function PlaygroundPageClient({ workflows, projects }: PlaygroundPageClientProps) {
  const router = useRouter();
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const filteredWorkflows = useMemo(
    () => workflows.filter((w) => w.kind === kind),
    [workflows, kind],
  );

  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [workflow, setWorkflow] = useState<ComfyWorkflowFull | null>(null);
  const [inputs, setInputs] = useState<ComfyDynamicInput[]>([]);
  const [outputs, setOutputs] = useState<ComfyDynamicOutput[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string | number>>({});
  const [filePaths, setFilePaths] = useState<Record<string, string>>({});
  const [fileDataUrls, setFileDataUrls] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  /** When set, right column shows Visual/Motion Muse chat for that project. */
  const [chatProjectId, setChatProjectId] = useState<string | null>(null);

  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteMode, setPromoteMode] = useState<'keyframe' | 'character' | 'video' | null>(null);
  const [promoteScenes, setPromoteScenes] = useState<
    Array<{ id: string; title: string; sceneNumber: number }>
  >([]);
  const [promoteCharacters, setPromoteCharacters] = useState<Array<{ id: string; name: string }>>([]);
  const [promoteSceneId, setPromoteSceneId] = useState('');
  const [promoteCharacterId, setPromoteCharacterId] = useState('');
  const [promoteCharKind, setPromoteCharKind] = useState<CharacterImageKind>('FACE');
  const [promoteLoadingData, setPromoteLoadingData] = useState(false);
  const [promoteSubmitting, setPromoteSubmitting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  /** When true, project comes from dialog dropdown (no sidebar selection). */
  const [promoteUsePickedProject, setPromoteUsePickedProject] = useState(false);
  const [promotePickedProjectId, setPromotePickedProjectId] = useState('');

  const [playgroundLibPicker, setPlaygroundLibPicker] = useState<{
    nodeId: string;
    mode: 'image' | 'image_url';
  } | null>(null);
  const [playgroundLibItems, setPlaygroundLibItems] = useState<MediaLibraryItem[]>([]);
  const [playgroundLibLoading, setPlaygroundLibLoading] = useState(false);
  const [projectLibItems, setProjectLibItems] = useState<MediaLibraryItem[]>([]);
  const [projectLibLoading, setProjectLibLoading] = useState(false);
  const [libraryTab, setLibraryTab] = useState<'media' | 'project'>('media');

  const firstErrorRef = useRef<HTMLDivElement | null>(null);

  const { start: startPolling } = useSingleJobPoll({
    intervalMs: JOB_POLL_INTERVAL_MS.fast,
    onCompleted: (job) => {
      if (!job.output_path) return;
      setResultUrl(`/api/outputs/${job.output_path}`);
      setResultPath(job.output_path);
      setPhase('result');
    },
    onFailed: (job) => {
      setError(job.error ?? 'Generation failed.');
      setPhase('error');
    },
  });

  // Pick first workflow when kind or list changes
  useEffect(() => {
    if (filteredWorkflows.length === 0) {
      setActiveWorkflowId(null);
      return;
    }
    setActiveWorkflowId((prev) =>
      prev && filteredWorkflows.some((w) => w.id === prev) ? prev : filteredWorkflows[0]!.id,
    );
  }, [kind, filteredWorkflows]);

  // Load workflow JSON + parse inputs
  useEffect(() => {
    if (!activeWorkflowId) {
      setPhase('idle');
      setWorkflow(null);
      setInputs([]);
      setOutputs([]);
      setInputValues({});
      setFilePaths({});
      setFileDataUrls({});
      setFieldErrors({});
      setError(null);
      setJobId(null);
      setResultUrl(null);
      setResultPath(null);
      return;
    }

    let cancelled = false;
    setPhase('loading');
    setWorkflow(null);
    setInputs([]);
    setOutputs([]);
    setInputValues({});
    setFilePaths({});
    setFileDataUrls({});
    setFieldErrors({});
    setError(null);
    setJobId(null);
    setResultUrl(null);
    setResultPath(null);

    (async () => {
      try {
        const res = await fetch(`/api/comfy-workflow/${activeWorkflowId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? 'Failed to load workflow.');
          setPhase('error');
          return;
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
        const parsedOutputs = parseDynamicOutputs(json);
        setInputs(parsedInputs);
        setOutputs(parsedOutputs);

        const defaults: Record<string, string | number> = {};
        for (const inp of parsedInputs) {
          if (inp.kind === 'image' || inp.kind === 'audio') continue;
          if (inp.kind === 'number') {
            defaults[inp.nodeId] =
              typeof inp.defaultValue === 'number' ? inp.defaultValue : 0;
            continue;
          }
          defaults[inp.nodeId] =
            typeof inp.defaultValue === 'string' ? inp.defaultValue : '';
        }
        setInputValues(defaults);
        setPhase('idle');
      } catch {
        if (!cancelled) {
          setError('Failed to load workflow.');
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeWorkflowId]);

  useEffect(() => {
    if (!playgroundLibPicker) {
      setPlaygroundLibItems([]);
      setProjectLibItems([]);
      setLibraryTab('media');
      return;
    }
    let cancelled = false;
    setPlaygroundLibLoading(true);
    setPlaygroundLibItems([]);
    setProjectLibLoading(Boolean(chatProjectId));
    setProjectLibItems([]);
    setLibraryTab('media');
    listPlaygroundGlobalLibrary()
      .then((all) => {
        if (cancelled) return;
        setPlaygroundLibItems(all.filter((i) => i.kind === 'image'));
      })
      .catch(() => {
        if (!cancelled) setPlaygroundLibItems([]);
      })
      .finally(() => {
        if (!cancelled) setPlaygroundLibLoading(false);
      });

    if (chatProjectId) {
      listProjectMediaLibrary(chatProjectId)
        .then((all) => {
          if (cancelled) return;
          setProjectLibItems(all.filter((i) => i.kind === 'image'));
        })
        .catch(() => {
          if (!cancelled) setProjectLibItems([]);
        })
        .finally(() => {
          if (!cancelled) setProjectLibLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [playgroundLibPicker, chatProjectId]);

  function applyPlaygroundLibrarySelection(relPath: string) {
    const pick = playgroundLibPicker;
    if (!pick) return;
    const { nodeId, mode } = pick;
    if (mode === 'image') {
      setFilePaths((p) => ({ ...p, [nodeId]: relPath }));
      setFieldErrors((p) => {
        const n = { ...p };
        delete n[nodeId];
        return n;
      });
      void (async () => {
        try {
          const res = await fetch(`/api/outputs/${relPath}`);
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onload = (e) => {
            setFileDataUrls((p) => ({ ...p, [nodeId]: (e.target?.result as string) ?? '' }));
          };
          reader.readAsDataURL(blob);
        } catch {
          setFileDataUrls((p) => ({ ...p, [nodeId]: `/api/outputs/${relPath}` }));
        }
      })();
    } else {
      setInputValue(nodeId, `/api/outputs/${relPath}`);
    }
    setPlaygroundLibPicker(null);
  }

  function setInputValue(nodeId: string, value: string | number) {
    setInputValues((prev) => ({ ...prev, [nodeId]: value }));
    setFieldErrors((prev) => {
      if (!prev[nodeId]) return prev;
      const n = { ...prev };
      delete n[nodeId];
      return n;
    });
  }

  async function handleFileChange(nodeId: string, files: FileList | null) {
    if (!files?.length) return;
    const file = files[0]!;
    try {
      const form = new FormData();
      form.append('sceneId', PLAYGROUND_SCENE_ID);
      form.append('files', file);
      const res = await fetch('/api/upload/reference', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data?.paths?.[0]) {
        throw new Error(data?.error ?? 'Upload failed');
      }
      const relPath: string = data.paths[0];
      setFilePaths((prev) => ({ ...prev, [nodeId]: relPath }));
      const reader = new FileReader();
      reader.onload = (e) => {
        setFileDataUrls((prev) => ({ ...prev, [nodeId]: (e.target?.result as string) ?? '' }));
        setFieldErrors((prev) => {
          const n = { ...prev };
          delete n[nodeId];
          return n;
        });
      };
      reader.readAsDataURL(file);
    } catch {
      setError('Upload failed — try again.');
      setPhase('error');
    }
  }

  function validateInputs(): boolean {
    const errors: Record<string, string> = {};
    for (const inp of inputs) {
      if (!inp.required) continue;
      if (inp.kind === 'image' || inp.kind === 'audio') {
        if (!filePaths[inp.nodeId]) {
          errors[inp.nodeId] = `${inp.label} file is required.`;
        }
      } else {
        const val = inputValues[inp.nodeId];
        if (val === undefined || val === null || String(val).trim() === '') {
          errors[inp.nodeId] = `${inp.label} is required.`;
        }
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setTimeout(() => firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return false;
    }
    return true;
  }

  async function loadPromoteContext(
    projectId: string,
    mode: 'keyframe' | 'character' | 'video',
  ): Promise<void> {
    setPromoteLoadingData(true);
    try {
      if (mode === 'character') {
        const chars = await listCharacters(projectId);
        setPromoteCharacters(chars.map((c) => ({ id: c.id, name: c.name })));
        setPromoteCharacterId(chars[0]?.id ?? '');
        setPromoteCharKind('FACE');
      } else {
        const p = await getProjectById(projectId);
        const sc = (p?.scenes ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          sceneNumber: s.sceneNumber,
        }));
        setPromoteScenes(sc);
        setPromoteSceneId(sc[0]?.id ?? '');
      }
    } finally {
      setPromoteLoadingData(false);
    }
  }

  async function openPromoteKeyframe() {
    if (!chatProjectId || !resultPath) return;
    setPromoteUsePickedProject(false);
    setPromoteError(null);
    setPromoteMode('keyframe');
    setPromoteOpen(true);
    await loadPromoteContext(chatProjectId, 'keyframe');
  }

  async function openPromoteCharacter() {
    if (!chatProjectId || !resultPath) return;
    setPromoteUsePickedProject(false);
    setPromoteError(null);
    setPromoteMode('character');
    setPromoteOpen(true);
    await loadPromoteContext(chatProjectId, 'character');
  }

  async function openPromoteVideo() {
    if (!chatProjectId || !resultPath) return;
    setPromoteUsePickedProject(false);
    setPromoteError(null);
    setPromoteMode('video');
    setPromoteOpen(true);
    await loadPromoteContext(chatProjectId, 'video');
  }

  /** Assign output when no project is selected in the right panel — pick project in the dialog. */
  async function openAssignToProject(mode: 'keyframe' | 'character' | 'video') {
    if (!resultPath || projects.length === 0) return;
    const firstId = projects[0]!.id;
    setPromoteUsePickedProject(true);
    setPromotePickedProjectId(firstId);
    setPromoteError(null);
    setPromoteMode(mode);
    setPromoteOpen(true);
    await loadPromoteContext(firstId, mode);
  }

  async function handlePromoteConfirm() {
    const projectId = promoteUsePickedProject ? promotePickedProjectId : chatProjectId;
    if (!projectId || !resultPath || !promoteMode) return;
    setPromoteSubmitting(true);
    setPromoteError(null);
    try {
      if (promoteMode === 'keyframe') {
        if (!promoteSceneId) throw new Error('Pick a scene');
        await promotePlaygroundAssetToKeyframe({
          projectId,
          sceneId: promoteSceneId,
          sourceRelPath: resultPath,
        });
      } else if (promoteMode === 'character') {
        if (!promoteCharacterId) throw new Error('Pick a character');
        await promotePlaygroundAssetToCharacterImage({
          projectId,
          characterId: promoteCharacterId,
          sourceRelPath: resultPath,
          kind: promoteCharKind,
        });
      } else if (promoteMode === 'video') {
        if (!promoteSceneId) throw new Error('Pick a scene');
        await promotePlaygroundVideoToScene({
          projectId,
          sceneId: promoteSceneId,
          sourceRelPath: resultPath,
        });
      }
      setPromoteOpen(false);
      setPromoteMode(null);
      setPromoteUsePickedProject(false);
      router.refresh();
    } catch (e) {
      setPromoteError(e instanceof Error ? e.message : 'Promotion failed');
    } finally {
      setPromoteSubmitting(false);
    }
  }

  async function handleGenerate() {
    if (!validateInputs()) return;
    if (!activeWorkflowId) return;
    setPhase('submitting');
    setError(null);
    const merged = mergeComfyMergedValues(inputValues, filePaths);
    try {
      const payload = buildComfyUiGeneratePayload({
        workflowId: activeWorkflowId,
        sceneId: PLAYGROUND_SCENE_ID,
        kind,
        mergedValues: merged,
        projectId: chatProjectId,
      });

      const res = await fetch('/api/generate/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Generation request failed.');
        setPhase('error');
        return;
      }
      const jid = data.job_id as string | undefined;
      if (!jid) {
        setError('No job id returned.');
        setPhase('error');
        return;
      }
      setJobId(jid);
      setPhase('polling');
      startPolling(jid);
    } catch {
      setError('Network error. Is the backend running?');
      setPhase('error');
    }
  }

  const isBusy = phase === 'submitting' || phase === 'polling';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/8 bg-[oklch(0.11_0.01_264)] px-4 py-3">
        <div className="flex w-full flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
              <FlaskConical className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground">Media playground</h1>
              <p className="text-[11px] text-muted-foreground">
                ComfyUI workflows only (use{' '}
                <Link href="/mcp-extensions" className="text-violet-400 hover:underline">
                  Extensions
                </Link>{' '}
                for extension tools). Outputs go to{' '}
                <code className="rounded bg-white/10 px-1">
                  {chatProjectId ? `drafts/playground/${chatProjectId}/` : 'drafts/playground/'}
                </code>
                {chatProjectId
                  ? ' (project library). Use the buttons below a result to attach to Kanban or characters.'
                  : '. Select a project on the right to scope files and enable promotion.'}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="ml-auto text-xs" asChild>
            <Link href="/settings/comfyui">Manage workflows</Link>
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[minmax(280px,400px)_minmax(0,1fr)_minmax(380px,560px)]">
        {/* Left — mode + workflow + inputs */}
        <aside className="order-1 flex min-h-0 flex-col border-white/8 lg:border-r overflow-y-auto">
          <div className="space-y-4 p-4">
            <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
              <button
                type="button"
                onClick={() => setKind('image')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors',
                  kind === 'image'
                    ? 'bg-violet-600 text-white'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                Image
              </button>
              <button
                type="button"
                onClick={() => setKind('video')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors',
                  kind === 'video'
                    ? 'bg-violet-600 text-white'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Video className="h-3.5 w-3.5" />
                Video
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              ComfyUI workflows for image/video inference. Extension tools run in{' '}
              <Link href="/mcp-extensions" className="text-violet-400 hover:underline">
                Extensions
              </Link>
              .
            </p>

            {filteredWorkflows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No {kind} workflows registered. Add one under Settings → ComfyUI.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground">Workflow</label>
                  <select
                    value={activeWorkflowId ?? ''}
                    onChange={(e) => setActiveWorkflowId(e.target.value || null)}
                    disabled={phase === 'loading' || isBusy}
                    className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs"
                  >
                    {filteredWorkflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name}
                      </option>
                    ))}
                  </select>
                </div>

                {phase === 'loading' && (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
                  </div>
                )}

                {phase !== 'loading' && inputs.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Inputs
                    </p>
                    {inputs.map((inp, idx) => {
                      const hasError = !!fieldErrors[inp.nodeId];
                      return (
                        <div
                          key={inp.nodeId}
                          ref={
                            hasError && idx === inputs.findIndex((i) => fieldErrors[i.nodeId])
                              ? firstErrorRef
                              : undefined
                          }
                          className={cn(
                            'space-y-1.5 rounded-lg border p-3',
                            hasError ? 'border-red-500/30 bg-red-500/5' : 'border-white/8 bg-white/5',
                          )}
                        >
                          <label className="text-xs font-medium text-foreground/85">
                            {inp.label}
                          </label>
                          {(inp.kind === 'textarea' || inp.kind === 'text') && (
                            <Textarea
                              value={String(inputValues[inp.nodeId] ?? '')}
                              onChange={(e) => setInputValue(inp.nodeId, e.target.value)}
                              rows={inp.kind === 'textarea' ? 4 : 2}
                              disabled={isBusy}
                              className="resize-none border-white/10 bg-black/30 text-xs"
                            />
                          )}
                          {inp.kind === 'image_url' && (
                            <div className="space-y-2">
                              <Textarea
                                value={String(inputValues[inp.nodeId] ?? '')}
                                onChange={(e) => setInputValue(inp.nodeId, e.target.value)}
                                rows={2}
                                disabled={isBusy}
                                className="resize-none border-white/10 bg-black/30 text-xs"
                                placeholder="Image URL or /api/outputs/..."
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full border-white/12 text-xs"
                                disabled={isBusy}
                                onClick={() =>
                                  setPlaygroundLibPicker({ nodeId: inp.nodeId, mode: 'image_url' })
                                }
                              >
                                <Images className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                                Choose from media library…
                              </Button>
                            </div>
                          )}
                          {inp.kind === 'number' && (
                            <input
                              type="number"
                              value={String(inputValues[inp.nodeId] ?? 0)}
                              onChange={(e) => setInputValue(inp.nodeId, Number(e.target.value))}
                              disabled={isBusy}
                              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs"
                            />
                          )}
                          {inp.kind === 'image' && (
                            <div className="space-y-2">
                              {fileDataUrls[inp.nodeId] ? (
                                <div className="relative overflow-hidden rounded-lg border border-white/10">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={fileDataUrls[inp.nodeId]}
                                    alt=""
                                    className="max-h-36 w-full object-contain bg-black/40"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFileDataUrls((p) => {
                                        const n = { ...p };
                                        delete n[inp.nodeId];
                                        return n;
                                      });
                                      setFilePaths((p) => {
                                        const n = { ...p };
                                        delete n[inp.nodeId];
                                        return n;
                                      });
                                    }}
                                    className="absolute right-2 top-2 rounded-full bg-black/70 p-1"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ) : (
                                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-white/15 py-6">
                                  <FileImage className="h-6 w-6 text-muted-foreground/50" />
                                  <span className="text-[11px] text-muted-foreground">Upload image</span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    disabled={isBusy}
                                    onChange={(e) => handleFileChange(inp.nodeId, e.target.files)}
                                  />
                                </label>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full border-white/12 text-xs"
                                disabled={isBusy}
                                onClick={() =>
                                  setPlaygroundLibPicker({ nodeId: inp.nodeId, mode: 'image' })
                                }
                              >
                                <Images className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                                Choose from media library…
                              </Button>
                            </div>
                          )}
                          {inp.kind === 'audio' && (
                            <div>
                              {fileDataUrls[inp.nodeId] ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <FileAudio className="h-4 w-4 text-green-400" />
                                  Audio loaded
                                </div>
                              ) : (
                                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-white/15 py-6">
                                  <FileAudio className="h-6 w-6 text-muted-foreground/50" />
                                  <span className="text-[11px] text-muted-foreground">Upload audio</span>
                                  <input
                                    type="file"
                                    accept="audio/*"
                                    className="hidden"
                                    disabled={isBusy}
                                    onChange={(e) => handleFileChange(inp.nodeId, e.target.files)}
                                  />
                                </label>
                              )}
                            </div>
                          )}
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

                {outputs.length > 0 && phase !== 'loading' && (
                  <div className="flex flex-wrap gap-1.5">
                    {outputs.map((out) => (
                      <span
                        key={out.nodeId}
                        className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {out.label}
                      </span>
                    ))}
                  </div>
                )}

                <Button
                  className="w-full bg-violet-600 hover:bg-violet-500"
                  disabled={
                    !activeWorkflowId ||
                    filteredWorkflows.length === 0 ||
                    phase === 'loading' ||
                    isBusy
                  }
                  onClick={handleGenerate}
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {phase === 'polling' ? 'Generating…' : 'Starting…'}
                    </>
                  ) : (
                    <>
                      <Workflow className="mr-2 h-4 w-4" />
                      Generate
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </aside>

        {/* Center — preview */}
        <main className="order-2 flex min-h-[50vh] flex-col border-white/8 lg:border-r bg-[oklch(0.1_0.01_264)]">
          <div className="flex flex-1 flex-col items-center justify-center p-6">
            {error && (
              <p className="mb-4 max-w-md rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-xs text-red-200">
                {error}
              </p>
            )}
            {phase === 'polling' && (
              <div className="mb-4 flex items-center gap-3 text-violet-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">
                  {jobId ? `Job ${jobId.slice(0, 14)}…` : 'Queued…'}
                </span>
              </div>
            )}
            {phase === 'result' && resultUrl && (
              <div className="flex w-full flex-col items-center gap-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Done</span>
                </div>
                {kind === 'video' ? (
                  <video
                    src={resultUrl}
                    controls
                    className="max-h-[min(70vh,720px)] w-full rounded-lg border border-white/10 bg-black"
                  />
                ) : (
                  <button type="button" onClick={() => window.open(resultUrl, '_blank')} className="max-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resultUrl}
                      alt="Result"
                      className="max-h-[min(70vh,720px)] w-auto rounded-lg border border-white/10 object-contain"
                    />
                  </button>
                )}
                {resultPath && (
                  <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
                    <code className="rounded bg-white/10 px-2 py-1">{resultPath}</code>
                    <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                      <a href={resultUrl} target="_blank" rel="noreferrer">
                        Open file
                      </a>
                    </Button>
                  </div>
                )}
                {resultPath && chatProjectId && (
                  <div className="flex max-w-lg flex-wrap justify-center gap-2">
                    {kind === 'image' && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="text-xs"
                          onClick={() => void openPromoteKeyframe()}
                        >
                          Attach as keyframe…
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={() => void openPromoteCharacter()}
                        >
                          Add to character…
                        </Button>
                      </>
                    )}
                    {kind === 'video' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="text-xs"
                        onClick={() => void openPromoteVideo()}
                      >
                        Set as scene video…
                      </Button>
                    )}
                  </div>
                )}
                {resultPath && !chatProjectId && projects.length > 0 && (
                  <div className="flex max-w-lg flex-col items-center gap-2">
                    <p className="text-center text-[11px] text-muted-foreground">
                      No project selected on the right — pick one here to attach this output to a project.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {kind === 'image' && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="text-xs"
                            onClick={() => void openAssignToProject('keyframe')}
                          >
                            Assign as keyframe…
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => void openAssignToProject('character')}
                          >
                            Add to project character…
                          </Button>
                        </>
                      )}
                      {kind === 'video' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="text-xs"
                          onClick={() => void openAssignToProject('video')}
                        >
                          Assign video to scene…
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {resultPath && !chatProjectId && projects.length === 0 && (
                  <p className="max-w-md text-center text-[11px] text-muted-foreground">
                    Create a project under Projects to attach this file to a scene or character.
                  </p>
                )}
              </div>
            )}
            {phase === 'idle' && !error && (
              <p className="text-center text-sm text-muted-foreground">
                Configure inputs on the left, then Generate. Preview appears here.
              </p>
            )}
          </div>
        </main>

        {/* Right — project list or inline Visual/Motion Muse chat */}
        <aside className="order-3 flex min-h-0 flex-col bg-[oklch(0.12_0.01_264)]">
          {!chatProjectId ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                Your projects
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                Tap a project for Visual / Motion Muse chat (same history as Ask Muse). Use Open project
                for the Kanban.
              </p>
              <ul className="mt-4 space-y-2">
                {projects.length === 0 ? (
                  <li className="text-xs text-muted-foreground">No projects yet.</li>
                ) : (
                  projects.map((p) => (
                    <li key={p.id}>
                      <div className="rounded-lg border border-white/8 bg-white/5 transition-colors hover:border-violet-500/30 hover:bg-violet-500/10">
                        <button
                          type="button"
                          onClick={() => setChatProjectId(p.id)}
                          className="w-full rounded-lg p-3 text-left"
                        >
                          <p className="text-xs font-medium text-foreground line-clamp-2">{p.title}</p>
                          <p className="mt-1 text-[10px] text-violet-400/90">{STAGE_LABEL[p.currentStage]}</p>
                          {p.logline && (
                            <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground/80">
                              {p.logline}
                            </p>
                          )}
                        </button>
                        <div className="border-t border-white/6 px-3 py-1.5">
                          <Link
                            href={`/projects/${p.id}`}
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-violet-300"
                          >
                            Open project
                            <ExternalLink className="h-3 w-3 opacity-70" />
                          </Link>
                        </div>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : (
            <div className="flex min-h-[50vh] flex-1 flex-col p-4 lg:min-h-0">
              <div className="mb-3 shrink-0 space-y-2 border-b border-white/8 pb-3">
                <button
                  type="button"
                  onClick={() => setChatProjectId(null)}
                  className="text-left text-[11px] font-medium text-violet-300 transition-colors hover:text-violet-200"
                >
                  ← Back to projects
                </button>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-foreground">
                    {projects.find((x) => x.id === chatProjectId)?.title ?? chatProjectId}
                  </p>
                  <Link
                    href={`/projects/${chatProjectId}`}
                    className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-violet-300"
                  >
                    Open project
                    <ExternalLink className="h-3 w-3 opacity-70" />
                  </Link>
                </div>
              </div>
              <MuseChatPanel
                key={chatProjectId}
                projectId={chatProjectId}
                allowedMuses={['VISUAL_MUSE', 'MOTION_MUSE']}
                compact
                showLlmReminder
                showKanbanHint
                className="min-h-[280px]"
              />
            </div>
          )}
        </aside>
      </div>

      <Dialog
        open={playgroundLibPicker !== null}
        onOpenChange={(open) => {
          if (!open) setPlaygroundLibPicker(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col border-white/10 bg-[oklch(0.13_0.012_264)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Media Library</DialogTitle>
          </DialogHeader>
          {chatProjectId ? (
            <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5">
              <button
                type="button"
                onClick={() => setLibraryTab('media')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  libraryTab === 'media'
                    ? 'bg-violet-600 text-white'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Media Library
              </button>
              <button
                type="button"
                onClick={() => setLibraryTab('project')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  libraryTab === 'project'
                    ? 'bg-violet-600 text-white'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Project Library
              </button>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {libraryTab === 'project' && chatProjectId ? (
              <>
                Images from the selected project only (
                <code className="rounded bg-white/10 px-1">drafts/playground/{chatProjectId}/</code> and{' '}
                <code className="rounded bg-white/10 px-1">drafts/{chatProjectId}/library/</code>).
              </>
            ) : (
              <>
                Images generated in Media Playground under{' '}
                <code className="rounded bg-white/10 px-1">drafts/playground/</code> (all folders, not filtered by
                project).
              </>
            )}
          </p>

          {(libraryTab === 'project' && chatProjectId ? projectLibLoading : playgroundLibLoading) ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            </div>
          ) : (libraryTab === 'project' && chatProjectId ? projectLibItems : playgroundLibItems).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {libraryTab === 'project' && chatProjectId
                ? 'No project library images yet for the selected project.'
                : 'No media library images yet. Run a generation here first, or check files under outputs/drafts/playground/.'}
            </p>
          ) : (
            <div className="grid max-h-[min(50vh,420px)] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
              {(libraryTab === 'project' && chatProjectId ? projectLibItems : playgroundLibItems).map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => applyPlaygroundLibrarySelection(item.path)}
                  title={item.path}
                  className="aspect-square overflow-hidden rounded-md border border-white/10 transition-colors hover:border-violet-500/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/outputs/${item.path}`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setPlaygroundLibPicker(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={promoteOpen}
        onOpenChange={(open) => {
          setPromoteOpen(open);
          if (!open) {
            setPromoteMode(null);
            setPromoteError(null);
            setPromoteUsePickedProject(false);
            setPromotePickedProjectId('');
          }
        }}
      >
        <DialogContent className="border-white/10 bg-[oklch(0.13_0.012_264)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {promoteMode === 'keyframe' &&
                (promoteUsePickedProject ? 'Assign image as keyframe' : 'Attach image as keyframe')}
              {promoteMode === 'character' &&
                (promoteUsePickedProject ? 'Add image to project character' : 'Add image to character')}
              {promoteMode === 'video' &&
                (promoteUsePickedProject ? 'Assign video to scene' : 'Set video on scene')}
            </DialogTitle>
          </DialogHeader>
          {promoteLoadingData ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-3 text-sm">
              {promoteUsePickedProject && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Project</label>
                  <select
                    value={promotePickedProjectId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPromotePickedProjectId(id);
                      if (promoteMode) void loadPromoteContext(id, promoteMode);
                    }}
                    className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(promoteMode === 'keyframe' || promoteMode === 'video') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Scene</label>
                  {promoteScenes.length === 0 ? (
                    <p className="text-xs text-amber-400/90">No scenes in this project yet.</p>
                  ) : (
                    <select
                      value={promoteSceneId}
                      onChange={(e) => setPromoteSceneId(e.target.value)}
                      className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs"
                    >
                      {promoteScenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.sceneNumber}. {s.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {promoteMode === 'character' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Character</label>
                    {promoteCharacters.length === 0 ? (
                      <p className="text-xs text-amber-400/90">No characters in this project yet.</p>
                    ) : (
                      <select
                        value={promoteCharacterId}
                        onChange={(e) => setPromoteCharacterId(e.target.value)}
                        className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs"
                      >
                        {promoteCharacters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Image kind</label>
                    <select
                      value={promoteCharKind}
                      onChange={(e) => setPromoteCharKind(e.target.value as CharacterImageKind)}
                      className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs"
                    >
                      {CHARACTER_KIND_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {k.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <p className="text-[11px] text-muted-foreground/70">
                Files are copied into your project drafts library or character refs so Kanban and sheets
                keep stable paths (the playground original is left in place).
              </p>
              {promoteError && (
                <p className="text-xs text-red-400">{promoteError}</p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPromoteOpen(false)}
              disabled={promoteSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-violet-600 hover:bg-violet-500"
              disabled={
                promoteSubmitting ||
                promoteLoadingData ||
                (promoteUsePickedProject && !promotePickedProjectId) ||
                (promoteMode === 'character' && promoteCharacters.length === 0) ||
                ((promoteMode === 'keyframe' || promoteMode === 'video') && promoteScenes.length === 0)
              }
              onClick={() => void handlePromoteConfirm()}
            >
              {promoteSubmitting ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
