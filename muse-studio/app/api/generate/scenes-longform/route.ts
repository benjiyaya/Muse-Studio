import { NextRequest } from 'next/server';
import { db } from '@/db';

const BACKEND_URL = process.env.MUSE_BACKEND_URL ?? 'http://localhost:8000';

/**
 * POST /api/generate/scenes-longform
 *
 * Proxy to backend long-form scene generation (targetTotal > 24). Loads project
 * storyline and existing scenes from DB, calls backend POST /agent/generate-scenes,
 * streams SSE back. Frontend should persist each "scene" event via POST /api/scenes.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId, targetScenes: rawTarget } = body as { projectId?: string; targetScenes?: number };

  if (!projectId) {
    return new Response(JSON.stringify({ error: 'Missing projectId' }), { status: 400 });
  }

  const targetTotal =
    typeof rawTarget === 'number' && Number.isFinite(rawTarget)
      ? Math.max(25, Math.min(120, Math.floor(rawTarget)))
      : 24;
  if (targetTotal <= 24) {
    return new Response(
      JSON.stringify({ error: 'Use /api/generate/scenes for 24 or fewer scenes' }),
      { status: 400 },
    );
  }

  const projectRow = db
    .prepare<[string], {
      storyline_logline: string | null;
      storyline_plot_outline: string | null;
      storyline_characters: string | null;
      storyline_themes: string | null;
      storyline_genre: string | null;
    }>(
      'SELECT storyline_logline, storyline_plot_outline, storyline_characters, storyline_themes, storyline_genre FROM projects WHERE id = ?',
    )
    .get(projectId);

  if (!projectRow?.storyline_plot_outline) {
    return new Response(JSON.stringify({ error: 'Project has no confirmed storyline' }), { status: 400 });
  }

  const storyline = {
    logline: projectRow.storyline_logline ?? '',
    plotOutline: projectRow.storyline_plot_outline,
    characters: projectRow.storyline_characters ? (JSON.parse(projectRow.storyline_characters) as string[]) : [],
    themes: projectRow.storyline_themes ? (JSON.parse(projectRow.storyline_themes) as string[]) : [],
    genre: projectRow.storyline_genre ?? '',
  };

  const sceneRows = db
    .prepare<
      [string],
      { id: string; scene_number: number; title: string; heading: string; description: string }
    >(
      'SELECT id, scene_number, title, heading, description FROM scenes WHERE project_id = ? ORDER BY scene_number',
    )
    .all(projectId);

  const existingScenes = sceneRows.map((s) => ({
    sceneNumber: s.scene_number,
    title: s.title,
    description: s.description,
  }));

  const backendUrl = `${BACKEND_URL.replace(/\/+$/, '')}/agent/generate-scenes`;
  const res = await fetch(backendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      projectId,
      targetTotal,
      batchSize: 24,
      storyline,
      existingScenes,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return new Response(
      JSON.stringify({ error: 'Backend long-form generation failed', detail: text || res.statusText }),
      { status: res.status >= 500 ? 502 : res.status },
    );
  }

  if (!res.body) {
    return new Response(JSON.stringify({ error: 'Backend returned no body' }), { status: 502 });
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
