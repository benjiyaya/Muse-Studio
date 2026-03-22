import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.MUSE_BACKEND_URL ?? 'http://localhost:8000';

/**
 * POST /api/agent/film/apply-timeline
 * Body: { projectId, filmTimeline, outputKind: "remotion" | "ffmpeg" }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${BACKEND_URL}/agent/film/apply-timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        (data?.detail?.error ?? data?.detail ?? data?.error) || `HTTP ${res.status}`;
      return NextResponse.json(
        { error: typeof message === 'string' ? message : JSON.stringify(message) },
        { status: res.status >= 500 ? 502 : res.status },
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Apply timeline failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
