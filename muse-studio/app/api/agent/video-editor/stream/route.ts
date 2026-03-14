import { NextResponse } from 'next/server';
import { getProjectById } from '@/lib/actions/projects';

const BACKEND_URL = process.env.MUSE_BACKEND_URL ?? 'http://localhost:8000';

/**
 * POST /api/agent/video-editor/stream
 * Proxies to backend SSE stream; returns progress events then final result.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectId, mode } = body as { projectId?: string; mode?: string };

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { error: 'projectId is required.' },
        { status: 400 },
      );
    }

    const resolvedMode =
      mode === 'SMART_EDIT' ? 'SMART_EDIT' : 'SIMPLE_STITCH';

    const project = await getProjectById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    const projectPayload = JSON.parse(
      JSON.stringify(project),
    ) as Record<string, unknown>;

    const res = await fetch(`${BACKEND_URL}/agent/video-editor/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: projectPayload,
        mode: resolvedMode,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message =
        (data?.detail?.error ?? data?.detail ?? data?.error) || `HTTP ${res.status}`;
      return NextResponse.json(
        { error: typeof message === 'string' ? message : JSON.stringify(message) },
        { status: res.status >= 500 ? 502 : res.status },
      );
    }

    if (!res.body) {
      return NextResponse.json(
        { error: 'Backend returned no body.' },
        { status: 502 },
      );
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stream request failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
