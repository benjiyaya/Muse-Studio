import { NextRequest, NextResponse } from 'next/server';

/**
 * Tests Ollama connectivity directly from Next.js — does NOT go through the Python backend.
 * This means it works even when muse_backend is not running.
 */
export async function POST(request: NextRequest) {
  const { base_url = 'http://localhost:11434', model = '' } = await request.json();
  const cleanUrl = (base_url as string).replace(/\/+$/, '');

  const start = Date.now();

  try {
    const res = await fetch(`${cleanUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        message: `Ollama returned HTTP ${res.status}`,
        models: [],
        latency_ms: Date.now() - start,
      });
    }

    const data = await res.json();
    const latency_ms = Date.now() - start;
    const availableModels: string[] = (data.models ?? []).map((m: { name: string }) => m.name);

    // Check if the requested model is available (partial name match)
    if (model) {
      const modelName = (model as string).split(':')[0];
      const found = availableModels.some((m) => m.startsWith(modelName));
      if (!found) {
        return NextResponse.json({
          ok: false,
          message: `Model "${model}" not found. Available: ${availableModels.slice(0, 5).join(', ') || 'none'}. Run: ollama pull ${model}`,
          models: availableModels,
          latency_ms,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Connected to Ollama at ${cleanUrl} (${latency_ms}ms). ${availableModels.length} model(s) available.`,
      models: availableModels,
      latency_ms,
    });
  } catch (err) {
    const latency_ms = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return NextResponse.json({
      ok: false,
      message: isTimeout
        ? `Timeout connecting to ${cleanUrl}. Is Ollama running? Try: ollama serve`
        : `Cannot connect to ${cleanUrl}. Is Ollama running? Try: ollama serve`,
      models: [],
      latency_ms,
    });
  }
}
