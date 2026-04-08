import { AppHeader } from '@/components/layout/AppHeader';
import { McpExtensionsConsoleClient } from '@/components/mcp-extensions/McpExtensionsConsoleClient';
import { getMcpExtensionsChatInitialState } from '@/lib/actions/mcpExtensionsChat';
import { listMcpExtensionsConsolePlugins, listMcpExtensionToolsForLlm } from '@/lib/actions/plugins';
import { getProjects } from '@/lib/actions/projects';
import type { ProjectStage } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function McpExtensionsConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; sceneId?: string; sceneTitle?: string; stage?: string }>;
}) {
  const params = await searchParams;
  const [chatState, projects, pluginGroups, toolCatalog] = await Promise.all([
    getMcpExtensionsChatInitialState(),
    getProjects(),
    listMcpExtensionsConsolePlugins(),
    listMcpExtensionToolsForLlm(),
  ]);

  const projectSummaries = projects.map((p) => ({
    id: p.id,
    title: p.title,
    currentStage: p.currentStage as ProjectStage,
    logline: p.storyline?.logline,
  }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <AppHeader />
      <McpExtensionsConsoleClient
        initialLines={chatState.initialLines}
        initialSessions={chatState.sessions}
        initialSessionId={chatState.activeSessionId}
        initialContextFromQuery={{
          projectId: params.projectId,
          sceneId: params.sceneId,
          sceneTitle: params.sceneTitle,
          stage: params.stage,
        }}
        projects={projectSummaries}
        initialPluginGroups={pluginGroups}
        toolCatalog={toolCatalog}
      />
    </div>
  );
}
