import { AskMusePage } from '@/components/muse/AskMusePage';
import { getProjects } from '@/lib/actions/projects';

export const dynamic = 'force-dynamic';

interface AskMusePageRouteProps {
  searchParams: Promise<{ sceneId?: string; sceneTitle?: string; stage?: string; projectId?: string }>;
}

export default async function AskMuseRoute({ searchParams }: AskMusePageRouteProps) {
  const params = await searchParams;
  const hasContext =
    params.sceneId != null || params.sceneTitle != null || params.stage != null;

  const initialContext = hasContext
    ? {
        sceneId: params.sceneId,
        sceneTitle: params.sceneTitle,
        stage: params.stage,
      }
    : undefined;

  const projects = await getProjects();

  return (
    <AskMusePage
      initialContext={initialContext}
      projectId={params.projectId ?? undefined}
      projects={projects.map((p) => ({ id: p.id, title: p.title }))}
    />
  );
}
