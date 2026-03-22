'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles, FolderOpen, MessageCircle } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MuseAgent } from '@/lib/types';
import { MuseChatPanel } from '@/components/muse/MuseChatPanel';

const ASK_MUSE_ALLOWED: MuseAgent[] = ['STORY_MUSE', 'VISUAL_MUSE', 'MOTION_MUSE'];

export interface AskMusePageProps {
  initialContext?: {
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  };
  projectId?: string;
  projects: Array<{ id: string; title: string }>;
}

export function AskMusePage({ initialContext, projectId, projects }: AskMusePageProps) {
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);

  const projectIds = new Set(projects.map((p) => p.id));
  const initialSelected =
    projectId && projectIds.has(projectId) ? projectId : null;
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialSelected);

  useEffect(() => {
    if (projectId && projects.some((p) => p.id === projectId) && selectedProjectId !== projectId) {
      setSelectedProjectId(projectId);
    }
  }, [projectId, projects, selectedProjectId]);

  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : null;

  function handleSelectProject(id: string | null) {
    setSelectedProjectId(id);
    setPanelOpen(false);
    const params = new URLSearchParams();
    if (id) params.set('projectId', id);
    const query = params.toString();
    router.replace(query ? `/ask-muse?${query}` : '/ask-muse');
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader />

      <div className="flex min-h-0 flex-1">
        {/* Left panel: project list */}
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-white/8 bg-white/[0.02]',
            'hidden w-[260px] md:flex',
          )}
        >
          <div className="border-b border-white/8 p-3">
            <h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Project context
            </h2>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => handleSelectProject(null)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                !selectedProjectId
                  ? 'border-violet-500/30 bg-violet-500/20 text-violet-300'
                  : 'border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground',
              )}
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              <span className="truncate">General chat</span>
            </button>
            {projects.map((p) => {
              const selected = selectedProjectId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProject(p.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'border-violet-500/30 bg-violet-500/20 text-violet-300'
                      : 'border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground',
                  )}
                >
                  <FolderOpen className="h-4 w-4 shrink-0" />
                  <span className="truncate">{p.title || p.id}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Mobile: Projects toggle + drawer */}
        <div className="fixed left-0 right-0 top-14 z-10 flex border-b border-white/8 bg-background/95 px-2 py-2 backdrop-blur md:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPanelOpen((o) => !o)}
            className="border-white/8"
          >
            <FolderOpen className="mr-1.5 h-4 w-4" />
            {selectedProject ? selectedProject.title : 'General chat'}
          </Button>
        </div>
        {panelOpen && (
          <div
            className="fixed inset-0 top-14 z-20 bg-black/50"
            onClick={() => setPanelOpen(false)}
            aria-hidden
          />
        )}
        {panelOpen && (
          <div className="fixed bottom-0 left-0 top-14 z-30 w-[260px] overflow-y-auto border-r border-white/8 bg-background p-2 space-y-0.5">
            <button
              type="button"
              onClick={() => handleSelectProject(null)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                !selectedProjectId ? 'bg-violet-500/20 text-violet-300' : 'text-muted-foreground',
              )}
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              General chat
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProject(p.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                  selectedProjectId === p.id ? 'bg-violet-500/20 text-violet-300' : 'text-muted-foreground',
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate">{p.title || p.id}</span>
              </button>
            ))}
          </div>
        )}

        <main
          className={cn(
            'mx-auto flex w-[90%] max-w-5xl min-h-0 flex-1 flex-col px-4 py-6',
            'pt-20 md:pt-6',
          )}
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20">
              <Sparkles className="h-4 w-4 text-violet-400" />
            </div>
            <h1 className="text-lg font-semibold">Ask Muse</h1>
            <span className="hidden text-xs text-muted-foreground sm:inline">⌘M</span>
          </div>

          {(selectedProject || initialContext?.sceneTitle) && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {selectedProject && (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/5 px-2.5 py-1 text-xs text-muted-foreground">
                  Project: <span className="font-medium text-foreground">{selectedProject.title}</span>
                </span>
              )}
              {initialContext?.sceneTitle && (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/5 px-2.5 py-1 text-xs text-muted-foreground">
                  Scene: <span className="font-medium text-foreground">{initialContext.sceneTitle}</span>
                </span>
              )}
            </div>
          )}

          {(selectedProjectId ?? projectId) && (
            <div className="mb-3">
              <Link
                href={`/projects/${selectedProjectId ?? projectId}`}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                ← Back to project
              </Link>
            </div>
          )}

          <MuseChatPanel
            projectId={selectedProjectId}
            allowedMuses={ASK_MUSE_ALLOWED}
            initialContext={initialContext}
            showLlmReminder
            showKanbanHint
          />
        </main>
      </div>
    </div>
  );
}
