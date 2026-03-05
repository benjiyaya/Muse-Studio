import { getProjects } from '@/lib/actions/projects';
import { ProjectsClientPage } from '@/components/projects/ProjectsClientPage';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await getProjects();
  return <ProjectsClientPage initialProjects={projects} />;
}
