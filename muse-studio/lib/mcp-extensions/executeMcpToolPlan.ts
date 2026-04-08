import {
  callEnabledPluginsForCapability,
  listMcpExtensionToolsForLlm,
  type McpExtensionToolDescriptor,
} from '@/lib/actions/plugins';
import { getProjectById } from '@/lib/actions/projects';
import { getLLMSettings } from '@/lib/actions/settings';
import { openRouterOptionalHeaders } from '@/lib/generation/openRouterHeaders';
import {
  formatProjectForRag,
  STORY_GENERATION_SYSTEM_PROMPTS,
  streamStoryLMStudio,
  streamStoryOllama,
  streamStoryOpenAICompat,
  storySseError,
} from '@/lib/generation/storyGenerationInternals';
import {
  runPluginImageGeneration,
  runPluginVideoGeneration,
} from '@/lib/plugin-extension/provider-adapter';
import type {
  MuseImageGenerateInput,
  MuseVideoGenerateInput,
} from '@/lib/plugin-extension/provider-contracts';
import { extractImageGenParamsFromText } from '@/lib/mcp-extensions/extractImageGenParamsFromText';
import { mergeAttachmentsIntoToolInput } from '@/lib/mcp-extensions/mergeAttachmentInput';
import type {
  McpAttachmentPayload,
  McpChatResponse,
  McpToolCallLogEntry,
  McpToolCallPreview,
} from '@/lib/mcp-extensions/mcpChatTypes';

const MCP_CONSOLE_OUTPUT_DIR = 'drafts/mcp-extensions/global';
const BUILTIN_MUSE_PLUGIN_ID = 'builtin.muse';

async function collectSseText(res: Response): Promise<string> {
  if (!res.ok || !res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (typeof value === 'string') {
      // Some SSE implementations emit text chunks directly.
      buffer += value;
    } else {
      buffer += decoder.decode(value, { stream: true });
    }
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        const chunk = JSON.parse(json) as { text?: string; error?: string };
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.text) out += chunk.text;
      } catch {
        // ignore malformed non-JSON events
      }
    }
  }
  return out.trim();
}

async function runBuiltInMuseTool(params: {
  capability: string;
  prompt: string;
  projectId?: string;
  sceneId?: string;
}): Promise<string> {
  const { capability, prompt, projectId, sceneId } = params;
  const task =
    capability === 'muse.visual' ? 'visual_query' : capability === 'muse.motion' ? 'motion_query' : 'general_query';
  const systemPrompt = STORY_GENERATION_SYSTEM_PROMPTS[task] ?? STORY_GENERATION_SYSTEM_PROMPTS.default;
  const settings = await getLLMSettings();
  const provider = settings.llmProvider;
  const context: Record<string, unknown> = {};
  if (sceneId) context.sceneId = sceneId;
  if (projectId) {
    const project = await getProjectById(projectId);
    if (project) context.project_context = formatProjectForRag(project);
  }
  const withContext =
    Object.keys(context).length > 0
      ? `Context:\n${Object.entries(context)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')}\n\nRequest:\n${prompt}`
      : prompt;

  let res: Response;
  switch (provider) {
    case 'ollama':
      res = await streamStoryOllama({
        baseUrl: settings.ollamaBaseUrl,
        model: settings.ollamaModel,
        systemPrompt,
        userMessage: withContext,
      });
      break;
    case 'lmstudio':
      res = await streamStoryLMStudio({
        baseUrl: settings.lmstudioBaseUrl,
        model: settings.lmstudioModel || settings.openaiModel || 'gpt-4o-mini',
        systemPrompt,
        userMessage: withContext,
      });
      break;
    case 'openai':
      res = await streamStoryOpenAICompat({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY ?? '',
        model: settings.openaiModel,
        systemPrompt,
        userMessage: withContext,
        providerName: 'OpenAI',
      });
      break;
    case 'claude':
      res = await streamStoryOpenAICompat({
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY ?? '',
        model: settings.claudeModel,
        systemPrompt,
        userMessage: withContext,
        providerName: 'Claude',
      });
      break;
    case 'openrouter':
      res = await streamStoryOpenAICompat({
        baseUrl: settings.openrouterBaseUrl,
        apiKey: process.env.OPENROUTER_API_KEY ?? '',
        model: settings.openrouterModel,
        systemPrompt,
        userMessage: withContext,
        providerName: 'OpenRouter',
        extraHeaders: openRouterOptionalHeaders(),
      });
      break;
    default:
      res = storySseError(`Unsupported LLM provider for Muse built-in tool: ${provider}`);
      break;
  }
  return collectSseText(res);
}

export function resolveToolTarget(
  catalog: McpExtensionToolDescriptor[],
  capability: string,
  pluginId?: string,
): McpExtensionToolDescriptor | null {
  const matches = catalog.filter((t) => t.capability === capability);
  if (matches.length === 0) return null;
  if (pluginId) {
    const exact = matches.find((t) => t.pluginId === pluginId);
    if (exact) return exact;
  }
  return matches[0] ?? null;
}

function extractJsonPreviews(data: unknown): McpToolCallPreview[] {
  if (data === null || data === undefined) return [];
  if (typeof data === 'string') {
    return [{ kind: 'json', label: data.length > 400 ? `${data.slice(0, 400)}…` : data }];
  }
  if (typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const out: McpToolCallPreview[] = [];
    const fi = o.finalImage as { url?: string } | undefined;
    const fv = o.finalVideo as { url?: string } | undefined;
    if (fi?.url) out.push({ kind: 'image', url: String(fi.url) });
    if (fv?.url) out.push({ kind: 'video', url: String(fv.url) });
    if (out.length > 0) return out;
  }
  try {
    const s = JSON.stringify(data, null, 2);
    return [{ kind: 'json', label: s.length > 1200 ? `${s.slice(0, 1200)}…` : s }];
  } catch {
    return [{ kind: 'json', label: String(data) }];
  }
}

function toPreviewUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('/api/outputs/')) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const trimmed = pathOrUrl.replace(/^\/+/, '');
  return `/api/outputs/${trimmed}`;
}

/**
 * Run a single MCP / extension tool (used by the Extensions chat after LLM planning, approval, or quick-run).
 */
export async function executeMcpToolPlan(params: {
  capability: string;
  pluginId?: string;
  input?: unknown;
  /** For image.generate, merged with structured fields from this message when present. */
  latestUserMessage?: string;
  attachments?: McpAttachmentPayload[];
  sessionContext?: {
    projectId?: string;
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  };
}): Promise<McpChatResponse> {
  const { capability, pluginId, input, latestUserMessage, attachments, sessionContext } = params;
  const toolCalls: McpToolCallLogEntry[] = [];

  if (capability === 'muse.story' || capability === 'muse.visual' || capability === 'muse.motion') {
    try {
      const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      const prompt = typeof o.prompt === 'string' && o.prompt.trim() ? o.prompt.trim() : latestUserMessage?.trim() || '';
      if (!prompt) throw new Error(`Tool input must include a non-empty "prompt" for ${capability}.`);
      const text = await runBuiltInMuseTool({
        capability,
        prompt,
        projectId:
          (typeof o.projectId === 'string' ? o.projectId : undefined) ??
          sessionContext?.projectId,
        sceneId:
          (typeof o.sceneId === 'string' ? o.sceneId : undefined) ??
          sessionContext?.sceneId,
      });
      toolCalls.push({
        capability,
        pluginId: BUILTIN_MUSE_PLUGIN_ID,
        pluginName: 'Muse',
        status: 'ok',
        previews: text ? [{ kind: 'json', label: text }] : [],
      });
      return {
        assistantText: text || `Executed built-in Muse tool: ${capability}.`,
        toolCalls,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toolCalls.push({
        capability,
        pluginId: BUILTIN_MUSE_PLUGIN_ID,
        pluginName: 'Muse',
        status: 'error',
        error: msg,
        previews: [],
      });
      return { assistantText: `Error: ${msg}`, toolCalls };
    }
  }

  if (!pluginId) {
    return {
      assistantText: `Missing pluginId for capability "${capability}".`,
      toolCalls: [
        { capability, status: 'error', error: 'Missing pluginId', previews: [] },
      ],
    };
  }
  const catalog = await listMcpExtensionToolsForLlm();
  const target = resolveToolTarget(catalog, capability, pluginId);

  if (!target) {
    toolCalls.push({
      capability,
      pluginId,
      status: 'error',
      error: `No enabled extension provides capability "${capability}".`,
      previews: [],
    });
    return {
      assistantText: `No matching enabled tool for "${capability}".`,
      toolCalls,
    };
  }

  let assistantText = '';

  try {
    if (capability === 'image.generate') {
      const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      const fromUserText = latestUserMessage ? extractImageGenParamsFromText(latestUserMessage) : {};
      const merged: Record<string, unknown> = {
        ...fromUserText,
        ...raw,
      };
      if (typeof merged.prompt !== 'string' || !merged.prompt.trim()) {
        throw new Error('Tool input must include a string "prompt" for image.generate.');
      }
      const inp = merged as unknown as MuseImageGenerateInput;
      const out = await runPluginImageGeneration({
        pluginId: target.pluginId,
        input: inp,
        targetRelDir: MCP_CONSOLE_OUTPUT_DIR,
      });
      const previewUrl = toPreviewUrl(`/api/outputs/${out.outputRelPath}`);
      toolCalls.push({
        capability,
        pluginId: out.pluginId ?? target.pluginId,
        pluginName: target.pluginName,
        status: 'ok',
        previews: [{ kind: 'image', url: previewUrl, label: out.response.finalImage?.alt ?? 'Image output' }],
      });
      assistantText = `Generated image via **${target.pluginName}** (\`${capability}\`). Output is shown below.`;
      return { assistantText, toolCalls };
    }

    if (capability === 'video.generate') {
      const inp = (input && typeof input === 'object' ? input : {}) as MuseVideoGenerateInput;
      const out = await runPluginVideoGeneration({
        pluginId: target.pluginId,
        input: inp,
        targetRelDir: MCP_CONSOLE_OUTPUT_DIR,
      });
      const previewUrl = toPreviewUrl(`/api/outputs/${out.outputRelPath}`);
      toolCalls.push({
        capability,
        pluginId: out.pluginId ?? target.pluginId,
        pluginName: target.pluginName,
        status: 'ok',
        previews: [{ kind: 'video', url: previewUrl, label: 'Video output' }],
      });
      assistantText = `Generated video via **${target.pluginName}** (\`${capability}\`). Output is shown below.`;
      return { assistantText, toolCalls };
    }

    const mergedMcp = mergeAttachmentsIntoToolInput(input, attachments, {
      method: target.method === 'MCP' ? 'MCP' : 'HTTP',
    });

    const call = await callEnabledPluginsForCapability({
      capability,
      pluginId: target.pluginId,
      input: mergedMcp,
    });

    if (!call.ok) {
      toolCalls.push({
        capability,
        pluginId: target.pluginId,
        pluginName: target.pluginName,
        status: 'error',
        error: call.error ?? 'Unknown error',
        previews: [],
      });
      return {
        assistantText: `Extension call failed: ${call.error ?? 'unknown error'}`,
        toolCalls,
      };
    }

    const previews = extractJsonPreviews(call.data).map((p) =>
      p.kind === 'image' && p.url
        ? { ...p, url: toPreviewUrl(p.url) }
        : p.kind === 'video' && p.url
          ? { ...p, url: toPreviewUrl(p.url) }
          : p,
    );

    toolCalls.push({
      capability,
      pluginId: call.pluginId ?? target.pluginId,
      pluginName: target.pluginName,
      status: 'ok',
      previews,
    });
    assistantText = `Executed **${target.pluginName}** — \`${capability}\`. Result below.`;
    return { assistantText, toolCalls };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    toolCalls.push({
      capability,
      pluginId: target.pluginId,
      pluginName: target.pluginName,
      status: 'error',
      error: msg,
      previews: [],
    });
    return {
      assistantText: `Error: ${msg}`,
      toolCalls,
    };
  }
}
