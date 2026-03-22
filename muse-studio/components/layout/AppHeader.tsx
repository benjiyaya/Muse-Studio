'use client';

import { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Film, Sparkles, ChevronRight, Settings, LayoutGrid, BookOpen, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AskMuseModal } from '@/components/muse/AskMuseModal';
import { MuseSuggestsPanel } from '@/components/muse/MuseSuggestsPanel';
import { cn } from '@/lib/utils';
import { CONTROL_LEVEL_CONFIG } from '@/lib/constants';
import type { MuseAgent, MuseControlLevel, MuseSuggestion, SuggestionAction, ProjectOverview } from '@/lib/types';
import { useProjectStatus } from './ProjectStatusContext';
import { dismissSuggestion } from '@/lib/actions/muse-suggestions';
import { refreshMuseSuggestions } from '@/lib/actions/muse-agent';
import { updateProject } from '@/lib/actions/projects';
import { ProjectOverviewSheet } from '@/components/projects/ProjectOverviewSheet';
import { OrchestrateButton } from '@/components/agent/OrchestrateButton';

// Stable empty array reference to avoid re-creating [] on every render.
const EMPTY_SUGGESTIONS: MuseSuggestion[] = [];

interface AppHeaderProps {
  projectTitle?: string;
  projectId?: string;
  activeMuse?: MuseAgent;
  controlLevel?: MuseControlLevel;
  initialSuggestions?: MuseSuggestion[];
  overviewProject?: ProjectOverview;
}

export function AppHeader({
  projectTitle,
  projectId,
  activeMuse: activeMuseFromServer = 'STORY_MUSE',
  controlLevel = 'ASSISTANT',
  initialSuggestions = EMPTY_SUGGESTIONS,
  overviewProject,
}: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [askMuseOpen, setAskMuseOpen] = useState(false);
  const [askMuseContext, setAskMuseContext] = useState<{ sceneId?: string; sceneTitle?: string; stage?: string } | undefined>();
  const [suggestions, setSuggestions] = useState<MuseSuggestion[]>(initialSuggestions);
  const [overviewOpen, setOverviewOpen] = useState(false);

  // Sync when server passes new initial suggestions (e.g. after navigation).
  useEffect(() => {
    setSuggestions(initialSuggestions);
  }, [initialSuggestions]);

  // Use live context when available (driven by KanbanBoard scene statuses),
  // fall back to the server-rendered prop for non-kanban pages.
  const { activeMuse: contextMuse } = useProjectStatus();
  const activeMuse = contextMuse ?? activeMuseFromServer;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault();
        router.push('/ask-muse');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);
  const isProjectView = !!projectTitle;
  const isPlayground = pathname === '/playground';

  async function handleDismiss(id: string) {
    await dismissSuggestion(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }

  function handleRefreshSuggestions() {
    if (!projectId) return;
    startTransition(async () => {
      try {
        await refreshMuseSuggestions(projectId);
      } finally {
        router.refresh();
      }
    });
  }

  function handleSuggestionAction(id: string, action: SuggestionAction) {
    const suggestion = suggestions.find((s) => s.id === id);
    if (!suggestion) return;
    if (action === 'DISMISS') return; // Handled by Dismiss button
    if (['REVIEW', 'FIX', 'EDIT'].includes(action)) {
      setAskMuseContext(suggestion.sceneId ? { sceneId: suggestion.sceneId } : undefined);
      setAskMuseOpen(true);
    } else if (projectId && ['PREVIEW', 'VIEW_DETAILS', 'ADJUST', 'ACCEPT'].includes(action)) {
      const focus = suggestion.sceneId ? `?focus=${suggestion.sceneId}` : '';
      router.push(`/projects/${projectId}${focus}`);
    }
  }

  function handleControlLevelChange(level: MuseControlLevel) {
    if (!projectId) return;
    startTransition(() => {
      updateProject(projectId, { museControlLevel: level }).then(() => router.refresh());
    });
  }

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center border-b border-white/8 bg-background/80 backdrop-blur-xl px-4 gap-3">
        {/* Logo */}
        <Link href="/projects" className="flex items-center gap-2.5 shrink-0 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/20 border border-violet-500/30 transition-all group-hover:bg-violet-500/30 group-hover:muse-glow">
            <Film className="h-4 w-4 text-violet-400" />
          </div>
          <span className="font-bold text-sm tracking-tight hidden sm:block">
            Muse <span className="text-violet-400">Studio</span>
          </span>
        </Link>

        {/* Breadcrumb */}
        {isProjectView && (
          <div className="flex items-center gap-1.5 text-sm min-w-0">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            <span className="text-muted-foreground hidden sm:block">Projects</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 hidden sm:block" />
            <span className="font-medium truncate max-w-[160px] sm:max-w-[260px]">
              {projectTitle}
            </span>
          </div>
        )}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-2">

          {/* Control Level */}
          {isProjectView && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  className="h-8 rounded-xl border border-white/8 bg-white/3 px-3 text-xs text-muted-foreground hover:bg-white/8 hidden md:flex"
                >
                  {CONTROL_LEVEL_CONFIG[controlLevel].label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-[oklch(0.15_0.012_264)] border-white/10">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Muse Control Level
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/8" />
                {(Object.keys(CONTROL_LEVEL_CONFIG) as MuseControlLevel[]).map((level) => (
                  <DropdownMenuItem
                    key={level}
                    className={cn(
                      'text-sm cursor-pointer',
                      level === controlLevel && 'text-violet-400 bg-violet-500/10',
                    )}
                    onClick={() => handleControlLevelChange(level)}
                  >
                    <div>
                      <div className="font-medium">{CONTROL_LEVEL_CONFIG[level].label}</div>
                      <div className="text-xs text-muted-foreground">
                        {CONTROL_LEVEL_CONFIG[level].description}
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Orchestrate / Next step (project view only) */}
          {isProjectView && projectId && (
            <OrchestrateButton projectId={projectId} />
          )}

          {/* Project overview (project view only) */}
          {isProjectView && overviewProject && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl hover:bg-white/8"
                  onClick={() => setOverviewOpen(true)}
                  aria-label="Project overview"
                >
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Project overview</TooltipContent>
            </Tooltip>
          )}

          {/* Muse Suggests bell */}
          <MuseSuggestsPanel
            suggestions={suggestions}
            onDismiss={handleDismiss}
            onAction={handleSuggestionAction}
            onRefresh={projectId ? handleRefreshSuggestions : undefined}
            scenes={overviewProject?.scenes ?? []}
          />

          {/* Playground (global) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-9 w-9 rounded-xl hover:bg-white/8',
                  isPlayground && 'bg-violet-500/15 text-violet-300',
                )}
                asChild
              >
                <Link href="/playground" aria-label="Media playground">
                  <FlaskConical
                    className={cn(
                      'h-4 w-4',
                      isPlayground ? 'text-violet-300' : 'text-muted-foreground',
                    )}
                  />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Media playground</TooltipContent>
          </Tooltip>

          {/* Nav: Projects */}
          {!isProjectView && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl hover:bg-white/8"
                  asChild
                >
                  <Link href="/projects">
                    <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Projects</TooltipContent>
            </Tooltip>
          )}

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-9 w-9 rounded-xl hover:bg-white/8',
                  pathname?.startsWith('/settings') && 'bg-violet-500/15 text-violet-400',
                )}
                asChild
              >
                <Link href="/settings">
                  <Settings className={cn(
                    'h-4 w-4',
                    pathname?.startsWith('/settings') ? 'text-violet-400' : 'text-muted-foreground',
                  )} />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>

          {/* Ask Muse CTA → full-page chat */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                className="h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-sm px-4 gap-2 muse-glow transition-all"
                title="Ask Muse (⌘M)"
              >
                <Link href="/ask-muse">
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden sm:block">Ask Muse</span>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ask Muse (⌘M)</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <AskMuseModal
        isOpen={askMuseOpen}
        onClose={() => setAskMuseOpen(false)}
        defaultMuse={activeMuse}
        context={askMuseContext}
      />
      {overviewProject && (
        <ProjectOverviewSheet
          project={overviewProject}
          open={overviewOpen}
          onOpenChange={setOverviewOpen}
        />
      )}
    </>
  );
}
