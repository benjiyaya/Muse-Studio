import { NextRequest } from 'next/server';
import { getProjectById } from '@/lib/actions/projects';
import type { Project } from '@/lib/types';

/**
 * POST /api/generate/story
 *
 * Calls LLM providers DIRECTLY from Next.js — does NOT require the Python backend.
 * Supports: Ollama (local), OpenAI, Anthropic Claude (OpenAI-compat)
 *
 * SSE response format (same as before — hook/UI unchanged):
 *   data: {"text": "...", "is_final": false}
 *   data: {"text": "...", "is_final": true}
 *
 * When project_id is present in the body, the project's storyline and script are
 * injected as project_context for RAG.
 */

// ── System prompts per task ──────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<string, string> = {
  generate_storyline: `You are Story Muse, a creative AI assistant specializing in film narrative development.

Generate a complete storyline outline. Structure your response using EXACTLY these section headers:

## LOGLINE
(one cinematic sentence capturing the core premise and emotional hook)

## PLOT OUTLINE
(2–3 paragraphs: setup → confrontation → resolution)

## CHARACTERS
- Character Name — Role and brief description
- Character Name — Role and brief description
(list all major characters, one per line starting with -)

## THEMES
- Theme 1
- Theme 2
- Theme 3
(list 3–5 thematic elements, one per line starting with -)

## GENRE
(genre / subgenre)

Be cinematic, evocative and specific. Do not include any commentary outside these sections.`,

  write_scene_script: `You are Story Muse, a professional screenwriter AI.
Write a properly formatted scene script: scene heading (INT./EXT. LOCATION — TIME), action lines, and dialogue.
Follow standard screenplay format. Be cinematic and specific.`,

  refine_dialogue: `You are Story Muse, an expert dialogue editor.
Improve the provided dialogue for naturalness, character voice, and dramatic impact.
Preserve original intent while enhancing subtext and rhythm.`,

  general_query: `You are Story Muse, a creative AI assistant for filmmakers.
Help with any aspect of film narrative, script writing, character development, or story structure.
Be concise, specific, and cinematically literate.`,

  rewrite_scene: `You are Story Muse, a professional screenplay writer.
You are given an existing scene. Rewrite or improve it according to the user's specific instructions.
Preserve the scene heading (INT./EXT. LOCATION — TIME) unless explicitly told to change it.
Apply all requested changes and output the COMPLETE rewritten scene in standard screenplay format:
  - Scene heading line
  - Action/description paragraphs
  - Dialogue blocks (CHARACTER NAME on its own line, then dialogue)
Do not include any commentary, preamble, or explanation — output only the rewritten scene script.`,

  visual_keyframe_prompt: `You are Visual Muse, an expert in cinematic imagery and AI image generation.
Your job is to write a single rich text-to-image prompt based on the scene provided.
Write the prompt as one flowing paragraph that covers: the main subject and their action, the environment and set design, the lighting quality and source, the camera angle and lens, the mood and atmosphere, the color palette, and end with comma-separated quality/style tags such as: cinematic, film grain, 4K, photorealistic, award-winning cinematography.
Write the prompt directly — do not add a label, heading, or explanation before or after it.`,

  visual_query: `You are Visual Muse, an expert in cinematic imagery, composition, and visual style for film.
Answer questions about keyframe ideas, visual style, color palettes, lighting, composition, and reference imagery.
Be concise and specific. For actual keyframe image generation, the user uses the Keyframe Creation scene cards on the Kanban board.`,

  motion_query: `You are Motion Muse, an expert in video production, pacing, and motion design for film.
Answer questions about video duration, camera movement, pacing, editing, and video generation parameters.
Be concise and specific. For actual video generation, the user uses the Video Draft Queue scene cards on the Kanban board.`,

  default: `You are Story Muse, a creative AI assistant for filmmakers.
Help with film narrative, script writing, and story development.`,
};

// ── SSE helpers ───────────────────────────────────────────────────────────────

/** Format a project as a single string for LLM RAG context. */
function formatProjectForRag(project: Project): string {
  const lines: string[] = [];

  lines.push(`Project: ${project.title}`);
  if (project.description) {
    lines.push(`Description: ${project.description}`);
  }

  if (project.storyline) {
    lines.push('---');
    lines.push('Storyline');
    if (project.storyline.logline) {
      lines.push(`Logline: ${project.storyline.logline}`);
    }
    lines.push(`Plot: ${project.storyline.plotOutline}`);
    if (project.storyline.genre) {
      lines.push(`Genre: ${project.storyline.genre}`);
    }
    if (project.storyline.characters?.length) {
      lines.push(`Characters: ${project.storyline.characters.join(', ')}`);
    }
    if (project.storyline.themes?.length) {
      lines.push(`Themes: ${project.storyline.themes.join(', ')}`);
    }
  }

  if (project.scenes?.length) {
    lines.push('---');
    lines.push('Scenes');
    const sorted = [...project.scenes].sort((a, b) => a.sceneNumber - b.sceneNumber);
    for (const scene of sorted) {
      lines.push(`Scene ${scene.sceneNumber}: ${scene.title || scene.heading || 'Untitled'}`);
      if (scene.heading && scene.heading !== scene.title) {
        lines.push(`  Heading: ${scene.heading}`);
      }
      if (scene.description) {
        lines.push(`  Description: ${scene.description}`);
      }
      if (scene.dialogue) {
        lines.push(`  Dialogue: ${scene.dialogue}`);
      }
      if (scene.technicalNotes) {
        lines.push(`  Notes: ${scene.technicalNotes}`);
      }
    }
  }

  return lines.join('\n');
}

function sseChunk(text: string, isFinal = false): string {
  return `data: ${JSON.stringify({ text, is_final: isFinal })}\n\n`;
}

function sseError(message: string): Response {
  const body = `data: ${JSON.stringify({ error: message, is_final: true })}\n\n`;
  return new Response(body, {
    status: 503,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function sseStream(stream: ReadableStream<string>): Response {
  return new Response(stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}

// ── Ollama provider ───────────────────────────────────────────────────────────

async function streamOllama(opts: {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  /** When true, disable extended thinking mode on supported Ollama models. */
  disableThinking?: boolean;
}): Promise<Response> {
  const { baseUrl, model, systemPrompt, userMessage, maxTokens, temperature, disableThinking } =
    opts;
  const cleanUrl = baseUrl.replace(/\/+$/, '');

  // Large models (e.g. qwen3-vl:32b at 21 GB) can take several minutes to load from disk.
  // We use a generous 15-minute overall timeout. While the model is loading, Ollama holds
  // the connection open — we send keep-alive SSE comments so the browser doesn't time out.
  const OLLAMA_TIMEOUT_MS = 15 * 60 * 1000;

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${cleanUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        stream: true,
        // For image prompt creation we disable extended thinking mode (Qwen3 / qwen3.5 models).
        // Without this, thinking models stream everything through message.thinking and leave
        // message.content empty, resulting in a blank UI response.
        ...(disableThinking && { think: false }),
        // Only include options when there's something to set — empty options {} can
        // cause 400 errors with certain Ollama cloud-backed models.
        ...( (temperature != null || maxTokens != null) && {
          options: {
            ...(temperature != null && { temperature }),
            ...(maxTokens != null && { num_predict: maxTokens }),
          },
        }),
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return sseError(
      isTimeout
        ? `Ollama timed out loading model "${model}". The model may be too large. Try a smaller model in Settings → LLM.`
        : `Cannot connect to Ollama at ${cleanUrl}. Is it running? Try: ollama serve`,
    );
  }

  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try {
      detail = await upstream.clone().text();
    } catch { /* ignore */ }
    const msg = detail ? `Ollama HTTP ${upstream.status}: ${detail.slice(0, 200)}` : `Ollama returned HTTP ${upstream.status}`;
    return sseError(msg);
  }

  // Convert Ollama ndjson stream → our SSE format.
  // Send SSE keep-alive comments while waiting for first tokens (model loading).
  const readable = new ReadableStream<string>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let firstTokenReceived = false;

      // Keep-alive: send a comment every 5 seconds while model is loading
      // SSE comments (": ping\n\n") are ignored by the hook but keep the connection alive
      const keepAliveInterval = setInterval(() => {
        if (!firstTokenReceived) {
          controller.enqueue(': ping\n\n');
        }
      }, 5000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line) as {
                message?: { content?: string; thinking?: string };
                done?: boolean;
              };
              const text = json.message?.content ?? '';
              const isFinal = json.done === true;

              if (text) {
                firstTokenReceived = true;
                controller.enqueue(sseChunk(text, false));
              }
              if (isFinal) {
                controller.enqueue(sseChunk('', true));
              }
            } catch {
              // skip malformed line
            }
          }
        }
        controller.enqueue(sseChunk('', true));
      } catch (err) {
        controller.enqueue(
          `data: ${JSON.stringify({ error: String(err), is_final: true })}\n\n`,
        );
      } finally {
        clearInterval(keepAliveInterval);
        controller.close();
      }
    },
  });

  return sseStream(readable);
}

// ── OpenAI-compatible provider (OpenAI + Claude) ──────────────────────────────

async function streamOpenAICompat(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  providerName?: string;
}): Promise<Response> {
  const {
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    userMessage,
    maxTokens = 2048,
    temperature = 0.8,
    providerName = 'API',
  } = opts;

  if (!apiKey) {
    return sseError(
      `${providerName} API key not configured. Set it in muse_backend/.env and restart the backend.`,
    );
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // Anthropic needs this header
        ...(baseUrl.includes('anthropic') && { 'anthropic-version': '2023-06-01' }),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: maxTokens,
        temperature: Math.min(temperature, 1.0),
        stream: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return sseError(`Cannot connect to ${providerName} API.`);
  }

  if (!upstream.ok || !upstream.body) {
    let detail = `HTTP ${upstream.status}`;
    try {
      const body = await upstream.clone().json();
      detail = body?.error?.message ?? detail;
    } catch {
      // ignore
    }
    return sseError(`${providerName} error: ${detail}`);
  }

  // Convert OpenAI SSE → our SSE format
  const readable = new ReadableStream<string>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              controller.enqueue(sseChunk('', true));
              continue;
            }
            try {
              const json = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
              };
              const choice = json.choices?.[0];
              const text = choice?.delta?.content ?? '';
              const isFinal = choice?.finish_reason != null && choice.finish_reason !== '';

              if (text) controller.enqueue(sseChunk(text, false));
              if (isFinal) controller.enqueue(sseChunk('', true));
            } catch {
              // skip malformed
            }
          }
        }
        controller.enqueue(sseChunk('', true));
      } catch (err) {
        controller.enqueue(
          `data: ${JSON.stringify({ error: String(err), is_final: true })}\n\n`,
        );
      } finally {
        controller.close();
      }
    },
  });

  return sseStream(readable);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    task = 'default',
    prompt,
    context: contextFromBody,
    project_id: projectId,
    provider_id = 'ollama',
    ollama_base_url = 'http://localhost:11434',
    ollama_model = 'qwen3-vl',
    openai_model = 'gpt-4o',
    claude_model = 'claude-sonnet-4-6',
    max_tokens,
    temperature,
  } = body as {
    task?: string;
    prompt: string;
    context?: Record<string, unknown>;
    project_id?: string;
    provider_id?: string;
    ollama_base_url?: string;
    ollama_model?: string;
    openai_model?: string;
    claude_model?: string;
    max_tokens?: number;
    temperature?: number;
  };

  const systemPrompt = SYSTEM_PROMPTS[task] ?? SYSTEM_PROMPTS.default;

  let context: Record<string, unknown> = contextFromBody ? { ...contextFromBody } : {};

  if (projectId) {
    const project = await getProjectById(projectId);
    if (project) {
      context.project_context = formatProjectForRag(project);
    }
  }

  let userMessage = prompt;
  if (Object.keys(context).length > 0) {
    const ctx = Object.entries(context)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    userMessage = `Context:\n${ctx}\n\nRequest:\n${prompt}`;
  }

  switch (provider_id) {
    case 'ollama':
      return streamOllama({
        baseUrl: ollama_base_url,
        model: ollama_model,
        systemPrompt,
        userMessage,
        maxTokens: max_tokens,
        temperature,
        disableThinking: task === 'visual_keyframe_prompt',
      });

    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY ?? '';
      return streamOpenAICompat({
        baseUrl: 'https://api.openai.com/v1',
        apiKey,
        model: openai_model,
        systemPrompt,
        userMessage,
        maxTokens: max_tokens,
        temperature,
        providerName: 'OpenAI',
      });
    }

    case 'claude': {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
      return streamOpenAICompat({
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey,
        model: claude_model,
        systemPrompt,
        userMessage,
        maxTokens: max_tokens,
        temperature,
        providerName: 'Claude',
      });
    }

    default:
      return sseError(`Unknown provider: "${provider_id}". Choose: ollama, openai, claude`);
  }
}
