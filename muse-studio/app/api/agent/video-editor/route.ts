import { NextResponse } from 'next/server';
import { getProjectById } from '@/lib/actions/projects';

const BACKEND_URL = process.env.MUSE_BACKEND_URL ?? 'http://localhost:8000';

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
      mode === 'SMART_EDIT_REMOTION'
        ? 'SMART_EDIT_REMOTION'
        : mode === 'SMART_EDIT'
          ? 'SMART_EDIT'
          : 'SIMPLE_STITCH';

    const project = await getProjectById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    const projectPayload = JSON.parse(
      JSON.stringify(project),
    ) as Record<string, unknown>;

    const res = await fetch(`${BACKEND_URL}/agent/video-editor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: projectPayload,
        mode: resolvedMode,
      }),
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
    const message = err instanceof Error ? err.message : 'Video editor request failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
