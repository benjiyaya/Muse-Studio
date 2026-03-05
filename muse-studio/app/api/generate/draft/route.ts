import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { backendClient, BackendError, type ImageDraftRequest } from '@/lib/backend-client';

const OUTPUTS_ROOT = path.join(process.cwd(), 'outputs');

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ImageDraftRequest;
    // Resolve relative reference paths (e.g. refs/sceneId/file.png) to absolute for the backend
    if (body.reference_image_paths?.length) {
      body.reference_image_paths = body.reference_image_paths.map((p) => {
        if (path.isAbsolute(p)) return p;
        return path.join(OUTPUTS_ROOT, p);
      });
    }
    const data = await backendClient.generateDraft(body);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
