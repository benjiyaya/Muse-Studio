import { NextRequest, NextResponse } from 'next/server';

/**
 * Fetches available Ollama models directly — does NOT go through the Python backend.
 * Works even when muse_backend is not running.
 */
export async function GET(request: NextRequest) {
  const baseUrl =
    request.nextUrl.searchParams.get('base_url') ??
    process.env.NEXT_PUBLIC_OLLAMA_BASE_URL ??
    'http://127.0.0.1:11434';

  const cleanUrl = baseUrl.replace(/\/+$/, '');

  try {
    const res = await fetch(`${cleanUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, base_url: cleanUrl, models: [], error: `HTTP ${res.status}` });
    }

    const data = await res.json();
    const models = (data.models ?? []).map((m: { name: string; size: number; modified_at: string }) => ({
      name: m.name,
      size: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : 'unknown',
      modified_at: m.modified_at ?? '',
    }));

    return NextResponse.json({ ok: true, base_url: cleanUrl, models });
  } catch {
    return NextResponse.json(
      { ok: false, base_url: cleanUrl, models: [], error: `Cannot connect to ${cleanUrl}` },
      { status: 503 },
    );
  }
}
