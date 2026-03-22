import { AppHeader } from '@/components/layout/AppHeader';
import { PlaygroundPageClient } from '@/components/playground/PlaygroundPageClient';
import { listComfyWorkflows } from '@/lib/actions/comfyui';
import { getProjects } from '@/lib/actions/projects';

export const dynamic = 'force-dynamic';

export default async function PlaygroundPage() {
  const [workflows, projects] = await Promise.all([listComfyWorkflows(), getProjects()]);

  const projectSummaries = projects.map((p) => ({
    id: p.id,
    title: p.title,
    currentStage: p.currentStage,
    logline: p.storyline?.logline,
  }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <AppHeader />

      <PlaygroundPageClient workflows={workflows} projects={projectSummaries} />
    </div>
  );
}
