import type { LLMSettings } from '@/lib/actions/settings';
import type { McpAttachmentPayload } from '@/lib/mcp-extensions/mcpChatTypes';
import { DEFAULT_MISSING_API_KEY_MSG } from '@/lib/generation/storyGenerationInternals';
import { openRouterOptionalHeaders } from '@/lib/generation/openRouterHeaders';

const ORCHESTRATION_SYSTEM = `You are the Extensions orchestrator for Muse Studio.
You must respond with a single JSON object only (no markdown fences).

Schema:
{
  "reply": string (optional, shown to the user),
  "tool": null | {
    "capability": string (must match one from the catalog),
    "pluginId": string (optional; pick a plugin from the catalog when multiple support the same capability),
    "input": object (payload for that capability)
  }
}

For capability "image.generate", "input" MUST include:
- "prompt": string — the full visual description for the image model (scene, style, subject). You may omit technical sizing words from prompt if you also pass structured fields below.
- When the user asks for size or quality steps, ALSO include any of these numeric fields so the HTTP extension receives them (not only inside the prose prompt):
  - "width": number (e.g. 1280),
  - "height": number (e.g. 720),
  - "numInferenceSteps": number (1–50, often called "steps"; Z-Image Turbo defaults to ~9 if omitted),
  - "seed": number (only if the user asks for a fixed seed / reproducibility)

Parse sizes from phrases like "1280x720", "width 1280", "height 720", and step counts from "15 steps" or "using 15 steps".

For "video.generate", include "prompt" and any generation params the user specified.

MCP tools (method "MCP" in the catalog) include "mcpDescription" and "mcpInputSchema" when available.
You MUST set "input" to an object that satisfies the JSON Schema for that tool only — no extra keys.
Servers often validate with strict Pydantic and reject unknown arguments.
When the user attached images/videos/text (STRUCTURED ATTACHMENTS), copy each file into the correct
schema property names (e.g. reference image URL field). Muse serves files at "/api/outputs/<relPath>"
(relative to the app origin). Build that URL from each attachment's "relPath" when the schema expects a URL.

Built-in Muse tools (method "BUILTIN") are first-party capabilities (\`muse.story\`, \`muse.visual\`, \`muse.motion\`).
For these, prefer the active session context and include:
- "prompt": string (required)
- "projectId": string (optional; include when project context is active)
- "sceneId": string (optional)

Rules:
- If the user only wants information or small talk, set "tool" to null and put your answer in "reply".
- If the user wants generation or an action an extension provides, set "tool" with the correct capability and input.
- Prefer "image.generate" or "video.generate" when the user asks for images or video and those capabilities exist in the catalog.
- Do not invent capabilities or plugin IDs — only use values from the TOOLS CATALOG below.`;

function attachmentPromptSlice(a: McpAttachmentPayload) {
  const rel = a.relPath.replace(/^\/+/, '');
  return {
    ...a,
    /** App-served URL path; resolve with the same origin as Muse (prepend public base if the tool needs an absolute URL). */
    apiUrl: `/api/outputs/${rel}`,
  };
}

function buildUserPayload(
  catalogJson: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  latestUser: string,
  sessionContext?: {
    projectId?: string;
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  },
  attachments?: McpAttachmentPayload[],
): string {
  const hist = history
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');
  const attachBlock =
    attachments && attachments.length > 0
      ? `\n\n---\nSTRUCTURED ATTACHMENTS (JSON; copy fields into MCP "input" per mcpInputSchema only):\n${JSON.stringify(attachments.map(attachmentPromptSlice), null, 2)}`
      : '';
  const contextBlock =
    sessionContext && (sessionContext.projectId || sessionContext.sceneId || sessionContext.sceneTitle || sessionContext.stage)
      ? `\n\n---\nACTIVE SESSION CONTEXT:\n${JSON.stringify(sessionContext, null, 2)}`
      : '';
  return `TOOLS CATALOG (JSON array):\n${catalogJson}\n\n---\nCONVERSATION:\n${hist || '(no prior messages)'}\n\n---\nLATEST USER MESSAGE:\n${latestUser}${contextBlock}${attachBlock}`;
}

export async function completeJsonOrchestration(opts: {
  settings: LLMSettings;
  catalogJson: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  latestUserMessage: string;
  sessionContext?: {
    projectId?: string;
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  };
  attachments?: McpAttachmentPayload[];
}): Promise<string> {
  const { settings, catalogJson, history, latestUserMessage, sessionContext, attachments } = opts;
  const userContent = buildUserPayload(catalogJson, history, latestUserMessage, sessionContext, attachments);
  const provider = settings.llmProvider;

  if (provider === 'ollama') {
    const base = settings.ollamaBaseUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ollamaModel,
        messages: [
          { role: 'system', content: ORCHESTRATION_SYSTEM },
          { role: 'user', content: userContent },
        ],
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Ollama error: ${res.status} ${t}`);
    }
    const json = (await res.json()) as { message?: { content?: string } };
    const text = json.message?.content ?? '';
    if (!text.trim()) throw new Error('Ollama returned empty JSON content.');
    return text.trim();
  }

  if (provider === 'lmstudio') {
    const base = settings.lmstudioBaseUrl.replace(/\/+$/, '');
    const model = settings.lmstudioModel || settings.openaiModel || 'gpt-4o-mini';
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: ORCHESTRATION_SYSTEM },
          { role: 'user', content: userContent },
        ],
        temperature: 0.4,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`LM Studio error: ${res.status} ${t}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new Error('LM Studio returned empty content.');
    return text.trim();
  }

  let baseUrl: string;
  let apiKey: string;
  let model: string;
  let providerName: string;
  let extraHeaders: Record<string, string> | undefined;

  switch (provider) {
    case 'openai':
      baseUrl = 'https://api.openai.com/v1';
      apiKey = process.env.OPENAI_API_KEY ?? '';
      model = settings.openaiModel;
      providerName = 'OpenAI';
      break;
    case 'claude':
      baseUrl = 'https://api.anthropic.com/v1';
      apiKey = process.env.ANTHROPIC_API_KEY ?? '';
      model = settings.claudeModel;
      providerName = 'Claude';
      break;
    case 'openrouter':
      baseUrl = settings.openrouterBaseUrl.replace(/\/+$/, '');
      apiKey = process.env.OPENROUTER_API_KEY ?? '';
      model = settings.openrouterModel;
      providerName = 'OpenRouter';
      extraHeaders = openRouterOptionalHeaders();
      break;
    default:
      throw new Error(`Unsupported LLM provider for Extensions orchestration: "${provider}".`);
  }

  if (!apiKey) {
    throw new Error(`${providerName} API key not configured. ${DEFAULT_MISSING_API_KEY_MSG}`);
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${cleanBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(cleanBase.includes('anthropic') && { 'anthropic-version': '2023-06-01' }),
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: ORCHESTRATION_SYSTEM },
        { role: 'user', content: userContent },
      ],
      max_tokens: 2048,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.clone().json();
      detail = (body as { error?: { message?: string } })?.error?.message ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${providerName} error: ${detail}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error(`${providerName} returned empty content.`);
  return text.trim();
}
