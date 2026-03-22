import { NextRequest, NextResponse } from 'next/server';
import { ingestScene } from '@/lib/actions/scenes';

/**
 * POST /api/scenes — Ingest one scene (e.g. from backend long-form scene generation).
 * Body: { projectId: string, scene: { sceneId, sceneNumber, title, heading, description, dialogue?, technicalNotes? } }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, scene } = body as {
      projectId: string;
      scene: {
        sceneId: string;
        sceneNumber: number;
        title: string;
        heading: string;
        description: string;
        dialogue?: string | null;
        technicalNotes?: string | null;
      };
    };
    if (!projectId || !scene?.sceneId || scene.sceneNumber == null || !scene.title || !scene.heading || !scene.description) {
      return NextResponse.json(
        { error: 'Missing projectId or scene fields (sceneId, sceneNumber, title, heading, description)' },
        { status: 400 },
      );
    }
    await ingestScene(projectId, scene);
    return NextResponse.json({ ok: true, sceneId: scene.sceneId });
  } catch (err) {
    console.error('[POST /api/scenes]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to ingest scene' },
      { status: 500 },
    );
  }
}
