'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { SceneCard } from './SceneCard';
import { AddSceneDialog } from './AddSceneDialog';
import { SceneMuseDialog } from './SceneMuseDialog';
import { VideoReviewDialog } from './VideoReviewDialog';
import { FinalSceneDialog } from './FinalSceneDialog';
import { ComfyWorkflowSelectDialog } from './ComfyWorkflowSelectDialog';
import { ComfyGenerateDialog } from './ComfyGenerateDialog';
import { KANBAN_COLUMNS } from '@/lib/constants';
import {
  updateScene,
  updateSceneStatus,
  setSceneComfyImageWorkflow,
  setSceneComfyVideoWorkflow,
} from '@/lib/actions/scenes';
import type { Scene, KanbanStatus, Keyframe, Character } from '@/lib/types';
import type { JobResult } from '@/lib/backend-client';
import type { ComfyWorkflowSummary } from '@/lib/actions/comfyui';
import { useProjectStatus } from '@/components/layout/ProjectStatusContext';
import { deriveActiveMuse } from '@/lib/derive-active-muse';

interface KanbanBoardProps {
  initialScenes: Scene[];
  projectId: string;
  comfyImageWorkflows?: ComfyWorkflowSummary[];
  comfyVideoWorkflows?: ComfyWorkflowSummary[];
  characters?: Character[];
}

// Poll background video generation jobs infrequently — ComfyUI runs can take a while.
// 3 minutes is enough to avoid spamming the backend while still updating the UI.
const POLL_INTERVAL_MS = 1 * 60 * 1000;

export function KanbanBoard({
  initialScenes,
  projectId,
  comfyImageWorkflows = [],
  comfyVideoWorkflows = [],
  characters,
}: KanbanBoardProps) {
  const [scenes, setScenes] = useState<Scene[]>(initialScenes);
  const { setActiveMuse } = useProjectStatus();

  // Sync local state whenever router.refresh() delivers updated server data
  useEffect(() => {
    setScenes(initialScenes);
  }, [initialScenes]);

  // Push derived project status badge whenever scene statuses change
  useEffect(() => {
    setActiveMuse(deriveActiveMuse(scenes));
  }, [scenes, setActiveMuse]);

  // On first mount, revert any GENERATING scenes that have no tracked job.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const orphans = scenes.filter(
      (s) => s.status === 'GENERATING' && !pendingJobs[s.id],
    );
    if (orphans.length === 0) return;

    orphans.forEach((s) => {
      updateSceneStatus(s.id, 'DRAFT_QUEUE').catch(console.error);
    });
    setScenes((prev) =>
      prev.map((s) =>
        s.status === 'GENERATING' && !pendingJobs[s.id]
          ? { ...s, status: 'DRAFT_QUEUE' as KanbanStatus, updatedAt: new Date() }
          : s,
      ),
    );
    if (orphans.length > 0) {
      toast('Generation jobs reset', {
        description: `${orphans.length} scene(s) moved back to Video Draft Queue — backend was restarted.`,
        duration: 6000,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dialog state ─────────────────────────────────────────────────────────────

  const [activeScene, setActiveScene] = useState<Scene | null>(null);
  const [addSceneOpen, setAddSceneOpen] = useState(false);
  const [sceneMuseOpen, setSceneMuseOpen] = useState(false);
  const [sceneMuseTarget, setSceneMuseTarget] = useState<Scene | null>(null);
  const [videoReviewOpen, setVideoReviewOpen] = useState(false);
  const [videoReviewSceneTarget, setVideoReviewSceneTarget] = useState<Scene | null>(null);
  const [finalSceneOpen, setFinalSceneOpen] = useState(false);
  const [finalSceneTarget, setFinalSceneTarget] = useState<Scene | null>(null);

  // ComfyUI workflow selection (shown first time a scene has no workflow assigned)
  const [comfySelectOpen, setComfySelectOpen] = useState(false);
  const [comfySelectKind, setComfySelectKind] = useState<'image' | 'video' | null>(null);
  const [comfySelectScene, setComfySelectScene] = useState<Scene | null>(null);

  // ComfyUI dynamic generation dialog (shown after a workflow is assigned)
  const [comfyGenerateOpen, setComfyGenerateOpen] = useState(false);
  const [comfyGenerateScene, setComfyGenerateScene] = useState<Scene | null>(null);
  const [comfyGenerateKind, setComfyGenerateKind] = useState<'image' | 'video' | null>(null);
  const [comfyGenerateWorkflowId, setComfyGenerateWorkflowId] = useState<string | null>(null);

  // sceneId → jobId for background polling of GENERATING scenes
  const [pendingJobs, setPendingJobs] = useState<Record<string, string>>({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(false);

  // ── Background job polling ────────────────────────────────────────────────────

  const revertToDraftQueue = useCallback(
    async (sceneId: string, reason: string) => {
      setScenes((prev) =>
        prev.map((s) =>
          s.id === sceneId
            ? { ...s, status: 'DRAFT_QUEUE' as KanbanStatus, updatedAt: new Date() }
            : s,
        ),
      );
      setPendingJobs((prev) => {
        const next = { ...prev };
        delete next[sceneId];
        return next;
      });
      await updateSceneStatus(sceneId, 'DRAFT_QUEUE');
      toast.error('Generation failed', { description: reason, duration: 8000 });
    },
    [],
  );

  const pollJobs = useCallback(
    async (jobs: Record<string, string>) => {
      const entries = Object.entries(jobs);
      if (entries.length === 0) return;

      for (const [sceneId, jobId] of entries) {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);

          if (res.status === 404) {
            await revertToDraftQueue(
              sceneId,
              'The backend restarted and the job was lost. Please try again.',
            );
            continue;
          }

          if (!res.ok) continue;

          const job = (await res.json()) as JobResult;

          if (job.status === 'completed' && job.output_path) {
            const videoUrl = `/api/outputs/${job.output_path}`;
            setScenes((prev) =>
              prev.map((s) =>
                s.id === sceneId
                  ? { ...s, status: 'PENDING_APPROVAL' as KanbanStatus, videoUrl, updatedAt: new Date() }
                  : s,
              ),
            );
            setPendingJobs((prev) => {
              const next = { ...prev };
              delete next[sceneId];
              return next;
            });
            await Promise.all([
              updateScene(sceneId, { videoUrl }),
              updateSceneStatus(sceneId, 'PENDING_APPROVAL'),
            ]);
            const scene = scenes.find((s) => s.id === sceneId);
            toast.success('Video ready for review', {
              description: scene
                ? `Scene #${String(scene.sceneNumber).padStart(2, '0')} — ${scene.title}`
                : undefined,
              duration: 6000,
            });
          } else if (job.status === 'failed') {
            const reason = (job as { error?: string }).error ?? 'The generation pipeline returned an error.';
            await revertToDraftQueue(sceneId, reason);
          }
        } catch {
          // transient network error — keep polling
        }
      }
    },
    [revertToDraftQueue, scenes],
  );

  useEffect(() => {
    if (Object.keys(pendingJobs).length === 0) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    if (!pollingRef.current) {
      pollingRef.current = setInterval(() => {
        setPendingJobs((current) => {
          pollJobs(current);
          return current;
        });
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [pendingJobs, pollJobs]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // ── Drag ─────────────────────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const scene = scenes.find((s) => s.id === event.active.id);
    setActiveScene(scene ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveScene(null);

    if (!over) return;

    const scene = scenes.find((s) => s.id === active.id);
    if (scene && scene.status === 'GENERATING') return;

    const overId = over.id as KanbanStatus;
    const isColumnTarget = KANBAN_COLUMNS.some((c) => c.id === overId);

    if (isColumnTarget && active.id !== overId) {
      setScenes((prev) =>
        prev.map((s) =>
          s.id === active.id ? { ...s, status: overId, updatedAt: new Date() } : s,
        ),
      );
      updateSceneStatus(active.id as string, overId).catch(console.error);
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleAskMuse(scene: Scene) {
    setSceneMuseTarget(scene);
    setSceneMuseOpen(true);
  }

  function openComfyGenerate(scene: Scene, kind: 'image' | 'video', workflowId: string) {
    setComfyGenerateScene(scene);
    setComfyGenerateKind(kind);
    setComfyGenerateWorkflowId(workflowId);
    setComfyGenerateOpen(true);
  }

  function handleOpenKeyframePanel(scene: Scene) {
    if (scene.comfyImageWorkflowId) {
      openComfyGenerate(scene, 'image', scene.comfyImageWorkflowId);
    } else {
      setComfySelectKind('image');
      setComfySelectScene(scene);
      setComfySelectOpen(true);
    }
  }

  function handleOpenVideoGenerate(scene: Scene) {
    if (scene.comfyVideoWorkflowId) {
      openComfyGenerate(scene, 'video', scene.comfyVideoWorkflowId);
    } else {
      setComfySelectKind('video');
      setComfySelectScene(scene);
      setComfySelectOpen(true);
    }
  }

  function handleOpenVideoReview(scene: Scene) {
    setVideoReviewSceneTarget(scene);
    setVideoReviewOpen(true);
  }

  function handleOpenFinalScene(scene: Scene) {
    setFinalSceneTarget(scene);
    setFinalSceneOpen(true);
  }

  function handleSceneUpdatedFromReview(
    sceneId: string,
    status: KanbanStatus,
    clearVideo = false,
    clearKeyframes = false,
  ) {
    setScenes((prev) =>
      prev.map((s) => {
        if (s.id !== sceneId) return s;
        return {
          ...s,
          status,
          videoUrl: clearVideo ? undefined : s.videoUrl,
          keyframes: clearKeyframes ? [] : s.keyframes,
          updatedAt: new Date(),
        };
      }),
    );
  }

  function handleVideoGenerationStarted(sceneId: string, jobId: string) {
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId ? { ...s, status: 'GENERATING' as KanbanStatus, updatedAt: new Date() } : s,
      ),
    );
    setPendingJobs((prev) => ({ ...prev, [sceneId]: jobId }));
  }

  function handleSceneRewritten(
    sceneId: string,
    updates: { heading: string; description: string },
  ) {
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId ? { ...s, ...updates, updatedAt: new Date() } : s,
      ),
    );
    setSceneMuseTarget((prev) =>
      prev?.id === sceneId ? { ...prev, ...updates, updatedAt: new Date() } : prev,
    );
  }

  function handleKeyframeSaved(sceneId: string, keyframeId: string, prompt: string) {
    const newKeyframe: Keyframe = {
      keyframeId,
      sequenceOrder: 1,
      source: 'VISUAL_MUSE',
      status: 'DRAFT',
      referenceImages: [],
      generationParams: { prompt },
    };
    setScenes((prev) =>
      prev.map((s) => {
        if (s.id !== sceneId) return s;
        return {
          ...s,
          status: 'KEYFRAME' as KanbanStatus,
          keyframes: [...s.keyframes, newKeyframe],
          updatedAt: new Date(),
        };
      }),
    );
  }

  function handleWorkflowInvalid(sceneId: string, kind: 'image' | 'video') {
    // Clear the stale workflow id on this scene (both locally and in the DB),
    // then reopen the workflow selector so the user can pick a new one.
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              comfyImageWorkflowId: kind === 'image' ? undefined : s.comfyImageWorkflowId,
              comfyVideoWorkflowId: kind === 'video' ? undefined : s.comfyVideoWorkflowId,
            }
          : s,
      ),
    );

    if (kind === 'image') {
      setSceneComfyImageWorkflow(sceneId, null).catch(console.error);
    } else {
      setSceneComfyVideoWorkflow(sceneId, null).catch(console.error);
    }

    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) return;

    toast('ComfyUI workflow reset', {
      description:
        'The saved workflow for this scene is missing or invalid. Please select a new workflow from the library.',
      duration: 7000,
    });

    setComfyGenerateOpen(false);
    setComfyGenerateScene(null);
    setComfyGenerateKind(null);
    setComfyGenerateWorkflowId(null);

    setComfySelectKind(kind);
    setComfySelectScene(scene);
    setComfySelectOpen(true);
  }

  const columnMap = KANBAN_COLUMNS.reduce<Record<KanbanStatus, Scene[]>>(
    (acc, col) => {
      acc[col.id] = scenes.filter((s) => s.status === col.id);
      return acc;
    },
    {} as Record<KanbanStatus, Scene[]>,
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-6 px-6 pt-4 min-h-0 flex-1">
          {KANBAN_COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              scenes={columnMap[column.id]}
              onAskMuse={handleAskMuse}
              onAddScene={column.id === 'SCRIPT' ? () => setAddSceneOpen(true) : undefined}
              onOpenKeyframe={column.id === 'KEYFRAME' ? handleOpenKeyframePanel : undefined}
              onOpenVideoGenerate={column.id === 'DRAFT_QUEUE' ? handleOpenVideoGenerate : undefined}
              onOpenVideoReview={column.id === 'PENDING_APPROVAL' ? handleOpenVideoReview : undefined}
              onOpenFinalScene={column.id === 'FINAL' ? handleOpenFinalScene : undefined}
            />
          ))}
        </div>

        <DragOverlay>
          {activeScene ? (
            <div className="rotate-2 scale-105 opacity-95 shadow-2xl shadow-violet-500/30">
              <SceneCard scene={activeScene} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Add Scene */}
      <AddSceneDialog
        isOpen={addSceneOpen}
        projectId={projectId}
        nextSceneNumber={scenes.length + 1}
        onClose={() => setAddSceneOpen(false)}
        onCreated={(scene) => setScenes((prev) => [...prev, scene])}
      />

      {/* Scene Muse */}
      <SceneMuseDialog
        key={sceneMuseTarget?.id ?? 'none'}
        isOpen={sceneMuseOpen}
        scene={sceneMuseTarget}
        onClose={() => {
          setSceneMuseOpen(false);
          setSceneMuseTarget(null);
        }}
        onSceneRewritten={handleSceneRewritten}
        onKeyframeSaved={handleKeyframeSaved}
      />

      {/* Video review */}
      <VideoReviewDialog
        isOpen={videoReviewOpen}
        scene={videoReviewSceneTarget}
        onClose={() => {
          setVideoReviewOpen(false);
          setVideoReviewSceneTarget(null);
        }}
        onSceneUpdated={handleSceneUpdatedFromReview}
      />

      {/* Final scene read-only review */}
      <FinalSceneDialog
        isOpen={finalSceneOpen}
        scene={finalSceneTarget}
        onClose={() => {
          setFinalSceneOpen(false);
          setFinalSceneTarget(null);
        }}
      />

      {/* ComfyUI workflow selector — first-time assignment per scene */}
      <ComfyWorkflowSelectDialog
        open={comfySelectOpen}
        kind={comfySelectKind ?? 'image'}
        scene={comfySelectScene}
        workflows={comfySelectKind === 'video' ? comfyVideoWorkflows : comfyImageWorkflows}
        onClose={() => {
          setComfySelectOpen(false);
          setComfySelectScene(null);
          setComfySelectKind(null);
        }}
        onSelected={async (workflow) => {
          if (!comfySelectScene) return;
          const sceneId = comfySelectScene.id;
          const kind = comfySelectKind ?? 'image';

          try {
            if (kind === 'video') {
              await setSceneComfyVideoWorkflow(sceneId, workflow.id);
              setScenes((prev) =>
                prev.map((s) => (s.id === sceneId ? { ...s, comfyVideoWorkflowId: workflow.id } : s)),
              );
            } else {
              await setSceneComfyImageWorkflow(sceneId, workflow.id);
              setScenes((prev) =>
                prev.map((s) => (s.id === sceneId ? { ...s, comfyImageWorkflowId: workflow.id } : s)),
              );
            }
          } catch (err) {
            console.error('Failed to assign ComfyUI workflow to scene:', err);
          }

          // Close selector, then open the generate dialog immediately
          const targetScene = scenes.find((s) => s.id === sceneId) ?? comfySelectScene;
          setComfySelectOpen(false);
          setComfySelectScene(null);
          setComfySelectKind(null);
          openComfyGenerate(targetScene, kind, workflow.id);
        }}
      />

      {/* ComfyUI dynamic generation dialog */}
      <ComfyGenerateDialog
        isOpen={comfyGenerateOpen}
        scene={comfyGenerateScene}
        kind={comfyGenerateKind}
        workflowId={comfyGenerateWorkflowId}
        workflows={comfyGenerateKind === 'video' ? comfyVideoWorkflows : comfyImageWorkflows}
        onWorkflowChange={async (nextWorkflowId) => {
          if (!comfyGenerateScene || !comfyGenerateKind) return;
          const sceneId = comfyGenerateScene.id;

          try {
            if (comfyGenerateKind === 'video') {
              await setSceneComfyVideoWorkflow(sceneId, nextWorkflowId);
              setScenes((prev) =>
                prev.map((s) => (s.id === sceneId ? { ...s, comfyVideoWorkflowId: nextWorkflowId } : s)),
              );
            } else {
              await setSceneComfyImageWorkflow(sceneId, nextWorkflowId);
              setScenes((prev) =>
                prev.map((s) => (s.id === sceneId ? { ...s, comfyImageWorkflowId: nextWorkflowId } : s)),
              );
            }
            setComfyGenerateWorkflowId(nextWorkflowId);
          } catch (err) {
            console.error('Failed to update ComfyUI workflow for scene:', err);
            toast('Workflow update failed', { description: 'Please try selecting the workflow again.', duration: 5000 });
          }
        }}
        characters={characters}
        onClose={() => {
          setComfyGenerateOpen(false);
          setComfyGenerateScene(null);
          setComfyGenerateKind(null);
          setComfyGenerateWorkflowId(null);
        }}
        onGenerationStarted={handleVideoGenerationStarted}
        onWorkflowInvalid={handleWorkflowInvalid}
      />
    </>
  );
}
