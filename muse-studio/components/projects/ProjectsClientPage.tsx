'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Film, Sparkles } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { NewProjectDialog } from '@/components/projects/NewProjectDialog';
import { Button } from '@/components/ui/button';
import type { Project } from '@/lib/types';

interface ProjectsClientPageProps {
  initialProjects: Project[];
}

export function ProjectsClientPage({ initialProjects }: ProjectsClientPageProps) {
  const router = useRouter();
  const projects = initialProjects;
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const inProduction = projects.filter((p) => p.currentStage === 'KEYFRAME_VIDEO').length;
  const inScript     = projects.filter((p) => p.currentStage === 'SCRIPT').length;
  const inStoryline  = projects.filter((p) => p.currentStage === 'STORYLINE').length;

  function handleProjectCreated(id: string) {
    setNewProjectOpen(false);
    router.push(`/projects/${id}`);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main className="flex-1 px-6 py-8 max-w-7xl mx-auto w-full">
        {/* Page header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Muse <span className="text-violet-400">Studio</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your creative partner, not your replacement.
            </p>
          </div>
          <Button
            onClick={() => setNewProjectOpen(true)}
            className="shrink-0 bg-violet-600 hover:bg-violet-500 gap-2 font-medium muse-glow"
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>

        {/* Stats row */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total Projects', value: projects.length,  color: 'text-foreground'  },
            { label: 'In Production',  value: inProduction,     color: 'text-amber-400'   },
            { label: 'Scripting',      value: inScript,         color: 'text-blue-400'    },
            { label: 'Storyline',      value: inStoryline,      color: 'text-violet-400'  },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-white/8 bg-[oklch(0.13_0.012_264)] px-4 py-3"
            >
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Projects grid */}
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/8 py-24 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 border border-violet-500/20">
              <Film className="h-8 w-8 text-violet-400" />
            </div>
            <h3 className="text-base font-semibold">No projects yet</h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-xs">
              Start your first film project and let the Muses guide your creative journey.
            </p>
            <Button
              onClick={() => setNewProjectOpen(true)}
              className="mt-6 bg-violet-600 hover:bg-violet-500 gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Create first project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}

            {/* Add new project card */}
            <button
              onClick={() => setNewProjectOpen(true)}
              className="group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/8 p-8 text-center transition-all hover:border-violet-500/30 hover:bg-violet-500/5 min-h-[260px]"
            >
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-all group-hover:bg-violet-500/20 group-hover:border-violet-500/30">
                <Plus className="h-5 w-5 text-muted-foreground group-hover:text-violet-400 transition-colors" />
              </div>
              <p className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                New Project
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Start creating with Muse
              </p>
            </button>
          </div>
        )}
      </main>

      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={handleProjectCreated}
      />
    </div>
  );
}
