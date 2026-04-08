import { getLLMSettings } from '@/lib/actions/settings';
import { listMcpExtensionToolsForOrchestration, getMcpHookMcpPolicy } from '@/lib/actions/plugins';
import { completeJsonOrchestration } from '@/lib/mcp-extensions/llmJsonCompletion';
import { executeMcpToolPlan, resolveToolTarget } from '@/lib/mcp-extensions/executeMcpToolPlan';
import type { McpExtensionToolDescriptor } from '@/lib/actions/plugins';
import type {
  McpAttachmentPayload,
  McpChatMessage,
  McpChatResponse,
  McpToolCallLogEntry,
} from '@/lib/mcp-extensions/mcpChatTypes';

export type {
  McpAttachmentPayload,
  McpChatMessage,
  McpToolCallPreview,
  McpToolCallLogEntry,
  McpChatResponse,
  McpPendingApproval,
} from '@/lib/mcp-extensions/mcpChatTypes';

const MAX_SCHEMA_JSON_CHARS = 8000;
const BUILTIN_MUSE_PLUGIN_ID = 'builtin.muse';

function builtInMuseCatalog(): McpExtensionToolDescriptor[] {
  return [
    {
      pluginId: BUILTIN_MUSE_PLUGIN_ID,
      pluginName: 'Muse',
      capability: 'muse.story',
      method: 'BUILTIN',
      path: 'muse.story',
      mcpDescription: 'Story Muse for narrative ideation and script-focused creative guidance.',
      mcpInputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' },
          projectId: { type: 'string' },
          sceneId: { type: 'string' },
        },
      },
    },
    {
      pluginId: BUILTIN_MUSE_PLUGIN_ID,
      pluginName: 'Muse',
      capability: 'muse.visual',
      method: 'BUILTIN',
      path: 'muse.visual',
      mcpDescription: 'Visual Muse for shot design, composition, and visual style direction.',
      mcpInputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' },
          projectId: { type: 'string' },
          sceneId: { type: 'string' },
        },
      },
    },
    {
      pluginId: BUILTIN_MUSE_PLUGIN_ID,
      pluginName: 'Muse',
      capability: 'muse.motion',
      method: 'BUILTIN',
      path: 'muse.motion',
      mcpDescription: 'Motion Muse for camera movement, pacing, and motion direction guidance.',
      mcpInputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' },
          projectId: { type: 'string' },
          sceneId: { type: 'string' },
        },
      },
    },
  ];
}

function truncateSchemaForLlm(schema: unknown): unknown {
  if (schema === undefined) return undefined;
  try {
    const s = JSON.stringify(schema);
    if (s.length <= MAX_SCHEMA_JSON_CHARS) return schema;
    return {
      _note: 'Schema truncated for prompt size',
      preview: `${s.slice(0, MAX_SCHEMA_JSON_CHARS)}…`,
    };
  } catch {
    return { _note: 'Schema not serializable' };
  }
}

type OrchestratorPlan = {
  reply?: string;
  tool?: {
    capability: string;
    pluginId?: string;
    input?: unknown;
  } | null;
};

export async function orchestrateMcpExtensionsChat(params: {
  messages: McpChatMessage[];
  /** Structured attachments for the latest user turn (same order as composer). */
  attachments?: McpAttachmentPayload[];
  sessionContext?: {
    projectId?: string;
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  };
}): Promise<McpChatResponse> {
  const { messages, attachments, sessionContext } = params;
  if (messages.length === 0) {
    return { assistantText: 'Send a message to start.', toolCalls: [] };
  }

  const lastUserIdx = [...messages].map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0).pop();
  if (lastUserIdx === undefined) {
    return { assistantText: 'No user message found.', toolCalls: [] };
  }

  const latestUser = messages[lastUserIdx]!.content;
  const history = messages.slice(0, lastUserIdx);

  const [settings, mcpCatalog] = await Promise.all([
    getLLMSettings(),
    listMcpExtensionToolsForOrchestration(),
  ]);
  const catalog = [...builtInMuseCatalog(), ...mcpCatalog];
  const catalogForPrompt = catalog.map((c) => ({
    ...c,
    mcpInputSchema: truncateSchemaForLlm(c.mcpInputSchema),
  }));
  const catalogJson = JSON.stringify(catalogForPrompt, null, 2);

  const rawJson = await completeJsonOrchestration({
    settings,
    catalogJson,
    history,
    latestUserMessage: latestUser,
    sessionContext,
    attachments,
  });

  let plan: OrchestratorPlan;
  try {
    plan = JSON.parse(rawJson) as OrchestratorPlan;
  } catch {
    return {
      assistantText: `The model did not return valid JSON. Raw response:\n\n${rawJson.slice(0, 2000)}`,
      toolCalls: [],
    };
  }

  const assistantText = typeof plan.reply === 'string' ? plan.reply : '';

  if (!plan.tool || plan.tool === null) {
    return {
      assistantText: assistantText || 'No action taken.',
      toolCalls: [],
    };
  }

  const { capability, pluginId: requestedPluginId, input } = plan.tool;
  if (!capability || typeof capability !== 'string') {
    return { assistantText: assistantText || 'Invalid tool plan (missing capability).', toolCalls: [] };
  }

  const target = resolveToolTarget(catalog, capability, requestedPluginId);
  if (!target) {
    const toolCalls: McpToolCallLogEntry[] = [
      {
        capability,
        pluginId: requestedPluginId,
        status: 'error',
        error: `No enabled extension provides capability "${capability}".`,
        previews: [],
      },
    ];
    return {
      assistantText:
        assistantText ||
        `I could not run "${capability}" — no matching extension is installed and enabled.`,
      toolCalls,
    };
  }

  const policy =
    target.method === 'BUILTIN'
      ? 'auto'
      : await getMcpHookMcpPolicy(target.pluginId, capability);
  if (policy === 'ask') {
    return {
      assistantText:
        assistantText ||
        `**${target.pluginName}** · \`${capability}\` is set to **Ask** — confirm below to run it on the server.`,
      toolCalls: [],
      pendingApproval: {
        capability,
        pluginId: target.pluginId,
        pluginName: target.pluginName,
        input: input ?? {},
      },
    };
  }

  return executeMcpToolPlan({
    capability,
    pluginId: target.pluginId,
    input,
    latestUserMessage: latestUser,
    attachments,
    sessionContext,
  });
}
