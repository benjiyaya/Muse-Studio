import { NextRequest } from 'next/server';
import { db } from '@/db';

/**
 * POST /api/generate/scenes
 *
 * Reads the confirmed storyline from DB for a project, then streams an LLM
 * to generate a set of scene scripts. Saves each scene to the DB as it's parsed.
 *
 * Large scene counts (e.g. 40) can cause timeouts and stream issues. We cap at
 * MAX_SCENES_PER_REQUEST and scale Ollama num_predict/timeout by count.
 *
 * SSE events (named):
 *   event: import  — storyline field imported (for the checklist animation)
 *   event: text    — raw LLM text delta (for optional display)
 *   event: scene   — a complete parsed + saved scene
 *   event: done    — all done
 *   event: error   — fatal error
 *   : ping         — keep-alive comment while model loads
 */

const MAX_SCENES_PER_REQUEST = 24;

function openRouterOptionalHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  const title = process.env.OPENROUTER_APP_TITLE?.trim();
  if (referer) h['HTTP-Referer'] = referer;
  if (title) h['X-Title'] = title;
  return h;
}

/** Manual storylines can be huge; oversized prompts slow or overload local LLMs. Full text stays in DB. */
const MAX_SCENE_PROMPT_PLOT_CHARS = 26_000;
const MAX_SCENE_PROMPT_CHAR_BLOCK_CHARS = 3_200;
const MAX_SCENE_PROMPT_LOGLINE_CHARS = 1_600;
const MAX_SCENE_PROMPT_THEMES_CHARS = 2_000;

function clipForScenePrompt(text: string, max: number, note: string): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[${note}]`;
}

// ── Scene generation system prompt ───────────────────────────────────────────

function buildSceneSystemPrompt(targetScenes: number): string {
  const n = Math.max(1, Math.floor(targetScenes));
  return `You are Story Muse, a professional screenplay writer.

Given a film storyline, generate approximately ${n} scene scripts that faithfully adapt the full story arc: setup, rising action, midpoint, climax, and resolution.

CRITICAL: Format each scene using EXACTLY this structure. Use <<<SCENE>>> and <<<END>>> as delimiters — nothing else:

<<<SCENE>>>
SCENE_NUM: 1
TITLE: The exact scene title
HEADING: INT./EXT. LOCATION NAME — TIME OF DAY
DESCRIPTION: 2–4 sentences of vivid visual description — what happens, atmosphere, character actions, emotional beats.
DIALOGUE: CHARACTER_NAME: (optional stage direction) Dialogue line.
ANOTHER_CHARACTER: Response line.
NOTES: Brief cinematography / lighting / technical notes.
<<<END>>>

You must generate AT LEAST ${n - 1 > 0 ? `${n - 1}` : '1'} scenes and AT MOST ${n + 2} scenes. Do NOT add any text or commentary outside the <<<SCENE>>> blocks.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sseNamedEvent(eventName: string, data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseKeepAlive(): Uint8Array {
  return encoder.encode(': ping\n\n');
}

function newSceneId(): string {
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Scene block parser ────────────────────────────────────────────────────────

interface ParsedScene {
  sceneNumber: number;
  title: string;
  heading: string;
  description: string;
  dialogue: string;
  technicalNotes: string;
}

function extractField(block: string, fieldName: string): string {
  // Match: FIELD_NAME: value (multi-line until next UPPERCASE_FIELD: or end)
  const regex = new RegExp(
    `^${fieldName}:\\s*([\\s\\S]*?)(?=^[A-Z_]+:|$)`,
    'im',
  );
  return (block.match(regex)?.[1] ?? '').trim();
}

function parseSceneBlock(block: string, fallbackNumber: number): ParsedScene | null {
  const title = extractField(block, 'TITLE');
  const heading = extractField(block, 'HEADING');
  const description = extractField(block, 'DESCRIPTION');
  if (!title || !heading || !description) return null;

  const rawNum = extractField(block, 'SCENE_NUM') || extractField(block, 'NUMBER');
  const sceneNumber = parseInt(rawNum) || fallbackNumber;
  const dialogue = extractField(block, 'DIALOGUE');
  const technicalNotes = extractField(block, 'NOTES');

  return { sceneNumber, title, heading, description, dialogue, technicalNotes };
}

// ── LLM generators (return raw text AsyncGenerators) ────────────────────────

async function* generateOllamaText(opts: {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  /** Max tokens to generate; scaled by scene count when not set. */
  numPredict?: number;
  /** Request timeout in ms; scaled by scene count when not set. */
  timeoutMs?: number;
}): AsyncGenerator<string> {
  const cleanUrl = opts.baseUrl.replace(/\/+$/, '');
  const numPredict = opts.numPredict ?? 8000;
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;

  let res: globalThis.Response;
  try {
    res = await fetch(`${cleanUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userMessage },
        ],
        stream: true,
        options: { temperature: 0.75, num_predict: numPredict },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = (err instanceof Error && err.name === 'TimeoutError')
      ? `Ollama timed out (${Math.round(timeoutMs / 60000)} min). Try fewer scenes or a faster model.`
      : `Cannot connect to Ollama at ${cleanUrl}. Is it running?`;
    throw new Error(msg);
  }

  if (!res.ok) {
    let bodySnippet = '';
    try {
      bodySnippet = (await res.text()).trim().slice(0, 280);
    } catch {
      /* ignore */
    }
    if (res.status === 429) {
      throw new Error(
        'Ollama returned 429 (too many requests). The GPU is busy, another tab is generating, or limits are tight — wait a minute, stop parallel runs, then retry.',
      );
    }
    throw new Error(
      `Ollama HTTP ${res.status}${bodySnippet ? ` — ${bodySnippet}` : ''}`,
    );
  }

  if (!res.body) throw new Error('Ollama returned no response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        const text = j.message?.content ?? '';
        if (text) yield text;
      } catch { /* skip */ }
    }
  }
}

async function* generateOpenAICompatText(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  providerName?: string;
  /** Output token budget; default too small for many scenes. */
  maxOutputTokens?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  /** Appended to missing-key error (e.g. where to set env). */
  missingKeyHint?: string;
}): AsyncGenerator<string> {
  const cleanBase = opts.baseUrl.replace(/\/+$/, '');
  const keyHint = opts.missingKeyHint ?? 'Set the key in muse-studio/.env.local and restart the dev server.';
  if (!opts.apiKey) {
    throw new Error(`${opts.providerName ?? 'API'} key not configured. ${keyHint}`);
  }

  const maxTokens = opts.maxOutputTokens ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  let res: globalThis.Response;
  try {
    res = await fetch(`${cleanBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
        ...(cleanBase.includes('anthropic') && { 'anthropic-version': '2023-06-01' }),
        ...opts.extraHeaders,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userMessage },
        ],
        max_tokens: maxTokens,
        temperature: 0.75,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`Cannot connect to ${opts.providerName ?? 'API'}.`);
  }

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try { detail = ((await res.clone().json()) as { error?: { message?: string } })?.error?.message ?? detail; } catch { /**/ }
    throw new Error(`${opts.providerName ?? 'API'} error: ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const text = j.choices?.[0]?.delta?.content ?? '';
        if (text) yield text;
      } catch { /* skip */ }
    }
  }
}

async function* generateLMStudioText(opts: {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): AsyncGenerator<string> {
  const cleanUrl = opts.baseUrl.replace(/\/+$/, "");
  const maxTokens = opts.maxOutputTokens ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  let res: globalThis.Response;
  try {
    res = await fetch(`${cleanUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userMessage },
        ],
        max_tokens: maxTokens,
        temperature: 0.75,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`Cannot connect to LM Studio at ${cleanUrl}.`);
  }

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try {
      detail =
        ((await res.clone().json()) as { error?: { message?: string } })
          ?.error?.message ?? detail;
    } catch {
      /**/
    }
    throw new Error(`LM Studio error: ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const j = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const text = j.choices?.[0]?.delta?.content ?? "";
        if (text) yield text;
      } catch {
        /* skip */
      }
    }
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Read raw body once so we can both log and parse it safely
  const rawBody = await req.text();

  // #region agent log
  fetch('http://127.0.0.1:7792/ingest/28803232-41f8-4ca2-8286-1055ebb53327', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': 'ccff78',
    },
    body: JSON.stringify({
      sessionId: 'ccff78',
      runId: 'initial',
      hypothesisId: 'H1',
      location: 'app/api/generate/scenes/route.ts:POST:entry',
      message: 'scenes POST raw body',
      data: {
        method: req.method,
        url: req.url,
        contentType: req.headers.get('content-type'),
        contentLength: req.headers.get('content-length'),
        rawSnippet: rawBody.slice(0, 200),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  let body: { projectId?: string; targetScenes?: number } = {};
  try {
    body = rawBody ? (JSON.parse(rawBody) as { projectId?: string; targetScenes?: number }) : {};
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7792/ingest/28803232-41f8-4ca2-8286-1055ebb53327', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'ccff78',
      },
      body: JSON.stringify({
        sessionId: 'ccff78',
        runId: 'initial',
        hypothesisId: 'H2',
        location: 'app/api/generate/scenes/route.ts:POST:parseError',
        message: 'Failed to parse scenes POST body as JSON',
        data: {
          error: err instanceof Error ? err.message : String(err),
          rawSnippet: rawBody.slice(0, 200),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return new Response(JSON.stringify({ error: 'Invalid JSON body for scenes generation' }), {
      status: 400,
    });
  }
  const { projectId } = body;

  if (!projectId) {
    return new Response(JSON.stringify({ error: 'Missing projectId' }), { status: 400 });
  }

  // Load project + storyline from DB
  const projectRow = db
    .prepare<[string], {
      storyline_logline: string | null;
      storyline_plot_outline: string | null;
      storyline_characters: string | null;
      storyline_themes: string | null;
      storyline_genre: string | null;
    }>('SELECT storyline_logline, storyline_plot_outline, storyline_characters, storyline_themes, storyline_genre FROM projects WHERE id = ?')
    .get(projectId);

  if (!projectRow?.storyline_plot_outline) {
    return new Response(JSON.stringify({ error: 'Project has no confirmed storyline' }), { status: 400 });
  }

  const loglineRaw = projectRow.storyline_logline ?? '';
  const plotOutlineRaw = projectRow.storyline_plot_outline;
  const charactersRaw: string[] = projectRow.storyline_characters ? JSON.parse(projectRow.storyline_characters) : [];
  const themes: string[] = projectRow.storyline_themes ? JSON.parse(projectRow.storyline_themes) : [];
  const genre = projectRow.storyline_genre ?? '';

  const logline = loglineRaw
    ? clipForScenePrompt(
        loglineRaw,
        MAX_SCENE_PROMPT_LOGLINE_CHARS,
        'Logline truncated for scene-generation prompt; full line is stored in the project.',
      )
    : '';
  const plotOutline = clipForScenePrompt(
    plotOutlineRaw,
    MAX_SCENE_PROMPT_PLOT_CHARS,
    'Plot truncated for scene-generation prompt; full outline is stored in the project.',
  );
  const characters = charactersRaw.map((c, i) =>
    clipForScenePrompt(
      c,
      MAX_SCENE_PROMPT_CHAR_BLOCK_CHARS,
      `Character ${i + 1} truncated for scene-generation prompt; full bio is stored in the project.`,
    ),
  );

  // Load LLM settings
  const settingRows = db
    .prepare<[], { key: string; value: string }>('SELECT key, value FROM settings')
    .all();
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));

  const provider = settings.llm_provider ?? 'ollama';
  const ollamaUrl = settings.ollama_base_url ?? 'http://localhost:11434';
  const ollamaModel = settings.ollama_model ?? 'qwen3-vl:latest';
  const openaiModel = settings.openai_model ?? 'gpt-4o';
  const claudeModel = settings.claude_model ?? 'claude-sonnet-4-6';
  const lmstudioBaseUrl = settings.lmstudio_base_url ?? 'http://127.0.0.1:1234';
  const lmstudioModel = settings.lmstudio_model ?? 'gpt-4o-mini';
  const openrouterModel = settings.openrouter_model ?? 'openai/gpt-4o-mini';
  const openrouterBaseUrl = settings.openrouter_base_url ?? 'https://openrouter.ai/api/v1';


  // Resolve requested scene count (fallback to 5 for compatibility); cap to avoid timeouts/stream issues
  const requested = Number.isFinite(body.targetScenes as number)
    ? Math.max(1, Math.floor(body.targetScenes as number))
    : 5;
  if (requested > MAX_SCENES_PER_REQUEST) {
    return new Response(
      JSON.stringify({
        error: `Requested ${requested} scenes. For stability, generate at most ${MAX_SCENES_PER_REQUEST} scenes per run. Use ${MAX_SCENES_PER_REQUEST} and add more from the Kanban.`,
      }),
      { status: 400 },
    );
  }
  const targetScenes = requested;

  // OpenAI-style APIs need enough output tokens for N scene blocks; 3k cuts off around 1–2 scenes.
  const openaiMaxOutput = Math.min(16_384, Math.max(4_096, Math.round(600 * targetScenes)));
  const openaiStreamTimeoutMs = Math.min(60 * 60 * 1000, 120_000 + targetScenes * 25_000);
  const claudeMaxOutput = Math.min(8_192, Math.max(4_096, Math.round(520 * targetScenes)));

  const sceneSystemPrompt = buildSceneSystemPrompt(targetScenes);

  // Scale Ollama token limit and timeout for large scene counts
  const ollamaNumPredict = Math.min(32_000, Math.max(3_000, 500 * targetScenes));
  const ollamaTimeoutMs = 15 * 60 * 1000 + Math.max(0, targetScenes - 10) * 60 * 1000;
  const ollamaTimeoutCapped = Math.min(60 * 60 * 1000, ollamaTimeoutMs);

  const themesJoined = themes.join(', ');
  const themesClipped =
    themesJoined.length > MAX_SCENE_PROMPT_THEMES_CHARS
      ? `${themesJoined.slice(0, MAX_SCENE_PROMPT_THEMES_CHARS)}… [themes truncated for prompt]`
      : themesJoined;

  // Build the user message from storyline
  const userMessage = [
    `PROJECT STORYLINE`,
    logline ? `LOGLINE: ${logline}` : '',
    `PLOT OUTLINE:\n${plotOutline}`,
    characters.length ? `CHARACTERS:\n${characters.map((c) => `- ${c}`).join('\n')}` : '',
    themes.length ? `THEMES: ${themesClipped}` : '',
    genre ? `GENRE: ${genre}` : '',
    '',
    `Generate between ${Math.max(1, targetScenes - 1)} and ${targetScenes + 2} scenes as specified.`,
  ].filter(Boolean).join('\n\n');

  // Build the streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (bytes: Uint8Array) => controller.enqueue(bytes);

      // ── Phase 1: Import events ────────────────────────────────────────────
      const importFields = [
        {
          field: 'logline',
          label: 'Logline',
          value: loglineRaw
            ? loglineRaw.slice(0, 80) + (loglineRaw.length > 80 ? '…' : '')
            : '(none)',
        },
        {
          field: 'plotOutline',
          label: 'Plot Outline',
          value: plotOutlineRaw.slice(0, 60) + (plotOutlineRaw.length > 60 ? '…' : ''),
        },
        {
          field: 'characters',
          label: 'Characters',
          value: `${charactersRaw.length} character${charactersRaw.length !== 1 ? 's' : ''}`,
        },
        { field: 'themes', label: 'Themes', value: `${themes.length} theme${themes.length !== 1 ? 's' : ''}` },
        { field: 'genre', label: 'Genre', value: genre || 'Unspecified' },
      ];

      for (let i = 0; i < importFields.length; i++) {
        enqueue(sseNamedEvent('import', { ...importFields[i], index: i, total: importFields.length }));
      }

      enqueue(sseNamedEvent('generating', { message: 'Story Muse is writing your scene scripts…' }));

      // ── Phase 2: LLM scene generation ────────────────────────────────────
      let generator: AsyncGenerator<string>;

      try {
        if (provider === 'openai') {
          generator = generateOpenAICompatText({
            baseUrl: 'https://api.openai.com/v1',
            apiKey: process.env.OPENAI_API_KEY ?? '',
            model: openaiModel,
            systemPrompt: sceneSystemPrompt,
            userMessage,
            providerName: 'OpenAI',
            maxOutputTokens: openaiMaxOutput,
            timeoutMs: openaiStreamTimeoutMs,
          });
        } else if (provider === 'claude') {
          generator = generateOpenAICompatText({
            baseUrl: 'https://api.anthropic.com/v1',
            apiKey: process.env.ANTHROPIC_API_KEY ?? '',
            model: claudeModel,
            systemPrompt: sceneSystemPrompt,
            userMessage,
            providerName: 'Claude',
            maxOutputTokens: claudeMaxOutput,
            timeoutMs: openaiStreamTimeoutMs,
          });
        } else if (provider === 'lmstudio') {
          generator = generateLMStudioText({
            baseUrl: lmstudioBaseUrl,
            model: lmstudioModel,
            systemPrompt: sceneSystemPrompt,
            userMessage,
            maxOutputTokens: openaiMaxOutput,
            timeoutMs: openaiStreamTimeoutMs,
          });
        } else if (provider === 'openrouter') {
          generator = generateOpenAICompatText({
            baseUrl: openrouterBaseUrl,
            apiKey: process.env.OPENROUTER_API_KEY ?? '',
            model: openrouterModel,
            systemPrompt: sceneSystemPrompt,
            userMessage,
            providerName: 'OpenRouter',
            maxOutputTokens: openaiMaxOutput,
            timeoutMs: openaiStreamTimeoutMs,
            extraHeaders: openRouterOptionalHeaders(),
            missingKeyHint: 'Set OPENROUTER_API_KEY in muse-studio/.env.local.',
          });
        } else {
          generator = generateOllamaText({
            baseUrl: ollamaUrl,
            model: ollamaModel,
            systemPrompt: sceneSystemPrompt,
            userMessage,
            numPredict: ollamaNumPredict,
            timeoutMs: ollamaTimeoutCapped,
          });
        }
      } catch (err) {
        enqueue(sseNamedEvent('error', { message: String(err) }));
        controller.close();
        return;
      }

      // Keep-alive while model is loading (Ollama can take a while to load the model)
      let firstTokenReceived = false;
      let streamClosed = false;
      const keepAlive = setInterval(() => {
        if (streamClosed || firstTokenReceived) return;
        try {
          controller.enqueue(sseKeepAlive());
        } catch {
          streamClosed = true;
          clearInterval(keepAlive);
        }
      }, 5000);

      let accumulated = '';
      let parsedCount = 0;
      const now = new Date().toISOString();

      const insertScene = db.prepare(`
        INSERT INTO scenes
          (id, project_id, scene_number, title, heading, description,
           dialogue, technical_notes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCRIPT', ?, ?)
      `);

      const safeEnqueue = (bytes: Uint8Array) => {
        try {
          controller.enqueue(bytes);
        } catch {
          streamClosed = true;
          clearInterval(keepAlive);
        }
      };

      try {
        for await (const chunk of generator) {
          if (streamClosed) break;
          firstTokenReceived = true;
          accumulated += chunk;

          // Send raw text delta so overlay can optionally show it (client may have disconnected)
          safeEnqueue(sseNamedEvent('text', { delta: chunk }));

          // Parse complete <<<SCENE>>>...<<<END>>> blocks
          while (true) {
            const endIdx = accumulated.indexOf('<<<END>>>');
            if (endIdx === -1) break;
            const startIdx = accumulated.lastIndexOf('<<<SCENE>>>', endIdx);
            if (startIdx === -1) break;

            const block = accumulated.substring(startIdx + 11, endIdx);
            accumulated = accumulated.substring(endIdx + 9);

            const scene = parseSceneBlock(block, parsedCount + 1);
            if (!scene) {
              console.warn('[scenes] Unable to parse scene block, skipping.');
              continue;
            }

            parsedCount++;
            const sceneId = newSceneId();

            try {
              insertScene.run(
                sceneId, projectId, scene.sceneNumber,
                scene.title, scene.heading, scene.description,
                scene.dialogue || null, scene.technicalNotes || null,
                now, now,
              );

              safeEnqueue(sseNamedEvent('scene', {
                sceneId,
                sceneNumber: scene.sceneNumber,
                title: scene.title,
                heading: scene.heading,
                description: scene.description.slice(0, 120) + (scene.description.length > 120 ? '…' : ''),
              }));
            } catch (dbErr) {
              console.error('[scenes] DB insert error:', dbErr);
            }
          }
        }
      } catch (err) {
        if (!streamClosed) safeEnqueue(sseNamedEvent('error', { message: String(err) }));
      } finally {
        streamClosed = true;
        clearInterval(keepAlive);
        // Final attempt to parse any remaining complete blocks in the buffer
        while (true) {
          const endIdx = accumulated.indexOf('<<<END>>>');
          if (endIdx === -1) break;
          const startIdx = accumulated.lastIndexOf('<<<SCENE>>>', endIdx);
          if (startIdx === -1) break;

          const block = accumulated.substring(startIdx + 11, endIdx);
          accumulated = accumulated.substring(endIdx + 9);

          const scene = parseSceneBlock(block, parsedCount + 1);
          if (!scene) {
            console.warn('[scenes] Unable to parse trailing scene block, skipping.');
            continue;
          }

          parsedCount++;
          const sceneId = newSceneId();
          try {
            insertScene.run(
              sceneId, projectId, scene.sceneNumber,
              scene.title, scene.heading, scene.description,
              scene.dialogue || null, scene.technicalNotes || null,
              now, now,
            );

            safeEnqueue(sseNamedEvent('scene', {
              sceneId,
              sceneNumber: scene.sceneNumber,
              title: scene.title,
              heading: scene.heading,
              description: scene.description.slice(0, 120) + (scene.description.length > 120 ? '…' : ''),
            }));
          } catch (dbErr) {
            console.error('[scenes] DB insert error (final pass):', dbErr);
          }
        }

        const underfilled = parsedCount > 0 && parsedCount < targetScenes;
        try {
          if (!streamClosed) controller.enqueue(sseNamedEvent('done', { totalScenes: parsedCount, underfilled }));
          controller.close();
        } catch {
          // Client may have disconnected; ignore
        }
      }
    },
  });

  return new Response(stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
