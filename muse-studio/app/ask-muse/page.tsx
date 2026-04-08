import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface AskMusePageRouteProps {
  searchParams: Promise<{ sceneId?: string; sceneTitle?: string; stage?: string; projectId?: string }>;
}

export default async function AskMuseRoute({ searchParams }: AskMusePageRouteProps) {
  const params = await searchParams;
  const qp = new URLSearchParams();
  if (params.projectId) qp.set('projectId', params.projectId);
  if (params.sceneId) qp.set('sceneId', params.sceneId);
  if (params.sceneTitle) qp.set('sceneTitle', params.sceneTitle);
  if (params.stage) qp.set('stage', params.stage);
  const url = qp.toString() ? `/mcp-extensions?${qp.toString()}` : '/mcp-extensions';
  redirect(url);
}
