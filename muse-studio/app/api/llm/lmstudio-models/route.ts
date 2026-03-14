import { NextRequest, NextResponse } from 'next/server';

/**
 * Fetches available LM Studio models via the OpenAI-compatible /v1/models endpoint.
 * This talks directly to the LM Studio local server and does NOT go through the Python backend.
 */
export async function GET(request: NextRequest) {
  // Use a distinct query param name so we don't collide with the Ollama
  // `/api/llm/models` route, which also uses `base_url`.
  const baseUrl =
    request.nextUrl.searchParams.get('lmstudio_base_url') ??
    process.env.NEXT_PUBLIC_LMSTUDIO_BASE_URL ??
    'http://127.0.0.1:1234';
  const cleanUrl = baseUrl.replace(/\/+$/, '');

  try {
    // Prefer OpenAI-compatible /v1/models, but fall back to native /api/v1/models.
    const tryPaths = ['/v1/models', '/api/v1/models'];
    let lastError: string | null = null;

    for (const path of tryPaths) {
      try {
        const res = await fetch(`${cleanUrl}${path}`, {
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        });

        if (!res.ok) {
          lastError = `HTTP ${res.status} on ${path}`;
          continue;
        }

        const data = await res.json();

        // LM Studio may return either:
        // - OpenAI-compatible shape: { data: [{ id: "model-id", ... }, ...] }
        // - Native REST v1 shape:    { models: [{ id: "model-id", ... }, ...] }
        const dataArray: unknown[] = Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.models)
            ? data.models
            : [];

        const models = (dataArray as { id?: string }[])
          .map((m) => m.id)
          .filter((id): id is string => Boolean(id));

        return NextResponse.json({ ok: true, base_url: cleanUrl, models });
      } catch (err) {
        lastError = `Cannot connect to ${cleanUrl}${path}`;
      }
    }

    return NextResponse.json(
      { ok: false, base_url: cleanUrl, models: [], error: lastError ?? `Cannot reach LM Studio at ${cleanUrl}` },
      { status: 503 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, base_url: cleanUrl, models: [], error: `Cannot connect to ${cleanUrl}` },
      { status: 503 },
    );
  }
}

