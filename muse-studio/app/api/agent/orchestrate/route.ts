import { NextResponse } from 'next/server';
import { getProjectById } from '@/lib/actions/projects';

const BACKEND_URL = process.env.MUSE_BACKEND_URL ?? 'http://localhost:8000';

/**
 * POST /api/agent/orchestrate
 * Runs the Supervisor graph; returns next_task, history, and optional targetTotal for script_longform.
 * Body: { projectId: string, goal?: 'next_step' | 'full_pipeline' | 'generate_scenes', targetTotal?: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectId, goal = 'next_step', targetTotal } = body as {
      projectId?: string;
      goal?: string;
      targetTotal?: number;
    };

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json({ error: 'projectId is required.' }, { status: 400 });
    }

    const project = await getProjectById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    const projectPayload = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;

    const res = await fetch(`${BACKEND_URL}/agent/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        project: projectPayload,
        goal: goal === 'full_pipeline' || goal === 'generate_scenes' ? goal : 'next_step',
        targetTotal: targetTotal ?? null,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const message =
        (data?.detail as { error?: string })?.error ??
        (typeof data?.detail === 'string' ? data.detail : null) ??
        (data?.error as string) ??
        `HTTP ${res.status}`;
      return NextResponse.json(
        { error: typeof message === 'string' ? message : JSON.stringify(message) },
        { status: res.status >= 500 ? 502 : res.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Orchestrate request failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
