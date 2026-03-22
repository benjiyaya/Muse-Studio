import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppHeader } from '@/components/layout/AppHeader';
import { ExportFilmWizard } from '@/components/export/ExportFilmWizard';
import { getProjectById } from '@/lib/actions/projects';
import { ChevronRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ExportFilmPage({ params }: PageProps) {
  const { id } = await params;
  const project = await getProjectById(id);

  if (!project) notFound();

  const allScenesFinal =
    project.scenes.length > 0 &&
    project.scenes.every((s) => s.status === 'FINAL');

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader
        projectTitle={project.title}
        projectId={project.id}
        activeMuse="MOTION_MUSE"
        controlLevel={project.museControlLevel}
        initialSuggestions={[]}
        overviewProject={{
          title: project.title,
          description: project.description,
          storyline: project.storyline,
          storylineSource: project.storylineSource,
          scenes: project.scenes,
        }}
      />

      <div className="flex-1 overflow-y-auto border-t border-white/8 bg-[oklch(0.11_0.01_264)]">
        <div className="mx-auto w-full max-w-[1920px] px-6 py-8">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
            <Link
              href={`/projects/${id}`}
              className="hover:text-foreground transition-colors"
            >
              {project.title}
            </Link>
            <ChevronRight className="h-4 w-4 opacity-50" />
            <span className="text-foreground font-medium">Export full film</span>
          </nav>

          <h1 className="text-xl font-semibold text-foreground mb-2">
            Export full film by agent
          </h1>
          <p className="text-sm text-muted-foreground mb-8">
            {allScenesFinal
              ? 'Choose a mode and run the Video Editor Agent to stitch your final scene clips into one master video.'
              : 'All scenes must be in Final Scene status to export. Some scenes are not yet final.'}
          </p>

          {allScenesFinal ? (
            <ExportFilmWizard
              projectId={id}
              projectTitle={project.title}
            />
          ) : (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Finish moving all scenes to the Final Scene column, then return here to export.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
