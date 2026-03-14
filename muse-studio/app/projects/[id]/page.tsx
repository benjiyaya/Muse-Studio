import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppHeader } from '@/components/layout/AppHeader';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { StorylineStageWrapper } from '@/components/storyline/StorylineStageWrapper';
import { SceneGenerationOverlay } from '@/components/storyline/SceneGenerationOverlay';
import { ProjectStatusProvider } from '@/components/layout/ProjectStatusContext';
import { deriveActiveMuse } from '@/lib/derive-active-muse';
import { getProjectById } from '@/lib/actions/projects';
import { getLLMSettings } from '@/lib/actions/settings';
import { listComfyWorkflows } from '@/lib/actions/comfyui';
import { listMuseSuggestions } from '@/lib/actions/muse-suggestions';
import { STAGE_CONFIG } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { deriveProjectStage } from '@/lib/derive-project-stage';
import { listCharacters } from '@/lib/actions/characters';
import { ProjectCharactersButton } from '@/components/characters/ProjectCharactersButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ generating?: string; targetScenes?: string }>;
}

export default async function ProjectKanbanPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { generating, targetScenes } = await searchParams;

  const [project, llmSettings, allWorkflows, suggestions, characters] = await Promise.all([
    getProjectById(id),
    getLLMSettings(),
    listComfyWorkflows(),
    listMuseSuggestions(id),
    listCharacters(id),
  ]);

  if (!project) notFound();

  const stages = Object.entries(STAGE_CONFIG) as [
    keyof typeof STAGE_CONFIG,
    (typeof STAGE_CONFIG)[keyof typeof STAGE_CONFIG],
  ][];

  const isStorylinePending =
    project.currentStage === 'STORYLINE' && !project.storylineConfirmed;

  // Show scene generation overlay when ?generating=scenes is present
  // (triggered after confirming storyline — overlay lives here so it
  //  survives the stage transition from STORYLINE → SCRIPT)
  const isGeneratingScenes = generating === 'scenes' && project.storylineConfirmed;
  const targetScenesNumber =
    targetScenes && !Number.isNaN(Number(targetScenes)) ? Number(targetScenes) : undefined;

  // Compute initial status from scenes so SSR renders the correct badge
  const initialMuse = deriveActiveMuse(project.scenes);

  const derivedStage = deriveProjectStage({
    currentStage: project.currentStage,
    storylineConfirmed: project.storylineConfirmed,
    scenes: project.scenes,
  });

  const allScenesFinal =
    project.scenes.length > 0 &&
    project.scenes.every((s) => s.status === 'FINAL');

  const comfyImageWorkflows = allWorkflows.filter((w: { kind: string }) => w.kind === 'image');
  const comfyVideoWorkflows = allWorkflows.filter((w: { kind: string }) => w.kind === 'video');

  return (
    <ProjectStatusProvider initialMuse={initialMuse}>
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader
        projectTitle={project.title}
        projectId={project.id}
        activeMuse={initialMuse}
        controlLevel={project.museControlLevel}
        initialSuggestions={suggestions}
        overviewProject={{
          title: project.title,
          description: project.description,
          storyline: project.storyline,
          storylineSource: project.storylineSource,
          scenes: project.scenes,
        }}
      />

      {/* Stage progress bar */}
      <div className="flex items-center gap-0 border-b border-white/8 bg-[oklch(0.11_0.01_264)] px-6 py-2">
        {stages.map(([stageKey, stageConfig], index) => {
          const stageOrder = { STORYLINE: 0, SCRIPT: 1, KEYFRAME_VIDEO: 2 } as const;
          const activeStage = derivedStage;
          const isActive = activeStage === stageKey;
          const isPast = stageOrder[activeStage] > stageOrder[stageKey];

          return (
            <div key={stageKey} className="flex items-center">
              <div
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  isActive
                    ? `${stageConfig.bgClass} ${stageConfig.textClass} border ${stageConfig.borderClass}`
                    : isPast
                    ? 'text-emerald-500/60'
                    : 'text-muted-foreground/40',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold',
                    isActive
                      ? 'bg-current/20'
                      : isPast
                      ? 'bg-emerald-500/20 text-emerald-500/60'
                      : 'bg-white/8',
                  )}
                >
                  {stageConfig.step}
                </span>
                {stageConfig.label}
                {isActive && (
                  <span className="rounded-full bg-current/15 px-1.5 py-0.5 text-[10px]">
                    Active
                  </span>
                )}
              </div>
              {index < stages.length - 1 && (
                <div className="mx-1 h-px w-6 bg-white/8" />
              )}
            </div>
          );
        })}

        <ProjectCharactersButton
          projectId={id}
          projectTitle={project.title}
        />

        {/* Export Full Film (when all scenes final) or Storyline badge */}
        <div className="ml-auto">
          {allScenesFinal ? (
            <Link
              href={`/projects/${id}/export`}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-black shadow-[0_0_18px_rgba(16,185,129,0.65)] hover:bg-emerald-400 hover:shadow-[0_0_22px_rgba(16,185,129,0.9)] transition-colors transition-shadow"
            >
              Export Full Film <span aria-hidden>&rarr;</span>
            </Link>
          ) : project.storylineConfirmed ? (
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[10px] font-medium text-emerald-400">
              ✓ Storyline confirmed
            </span>
          ) : (
            <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[10px] font-medium text-amber-400">
              Storyline pending
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {isGeneratingScenes ? (
          // Scene generation overlay — Story Muse writes scene scripts
          <SceneGenerationOverlay projectId={id} targetScenes={targetScenesNumber} />
        ) : isStorylinePending ? (
          // Storyline creation workspace
          <StorylineStageWrapper project={project} llmSettings={llmSettings} />
        ) : (
          // Kanban board with scenes
          <KanbanBoard
            initialScenes={project.scenes}
            projectId={id}
            comfyImageWorkflows={comfyImageWorkflows}
            comfyVideoWorkflows={comfyVideoWorkflows}
            characters={characters}
          />
        )}
      </div>
    </div>
    </ProjectStatusProvider>
  );
}
