import { NextRequest, NextResponse } from 'next/server';
import { getComfyWorkflowJson } from '@/lib/actions/comfyui';

export const dynamic = 'force-dynamic';

interface ComfyGeneratePayload {
  workflow_id: string;
  scene_id: string;
  kind: 'image' | 'video';
  /** User-provided input values keyed by nodeId */
  inputValues: Record<string, string | number | null>;
}

/**
 * Patch user-provided input values into the base workflow JSON.
 * For each (Input) node:
 *  - image/audio: store as `inputs.image` / `inputs.audio` (base64 data URL)
 *  - others: store as `inputs.value` (primitive wrapper) or `inputs.text` (CLIPTextEncode)
 */
function patchWorkflow(
  baseJson: Record<string, Record<string, unknown>>,
  inputValues: Record<string, string | number | null>,
): Record<string, Record<string, unknown>> {
  const patched = structuredClone(baseJson) as Record<string, Record<string, unknown>>;

  // Frontend origin used to turn relative URLs (e.g. "/api/outputs/...") into absolute URLs
  // that ComfyUI can fetch from. Configure via MUSE_FRONTEND_BASE_URL or NEXT_PUBLIC_APP_BASE_URL.
  const frontendBase =
    process.env.MUSE_FRONTEND_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_BASE_URL ??
    'http://localhost:3000';

  for (const [nodeId, value] of Object.entries(inputValues)) {
    const node = patched[nodeId];
    if (!node) continue;
    if (value === null || value === undefined) continue;

    const inputs = (node.inputs ?? {}) as Record<string, unknown>;
    const classType = (node.class_type as string) ?? '';

    const imageClasses = ['LoadImage', 'ImageLoader', 'ETN_LoadImageBase64'];
    const imageUrlClasses = ['Load Image From Url (mtb)'];
    const audioClasses = ['LoadAudio', 'VHS_LoadAudio'];
    const textAreaClasses = ['CLIPTextEncode', 'Note', 'ShowText'];

    if (imageClasses.includes(classType)) {
      inputs.image = value;
    } else if (imageUrlClasses.includes(classType)) {
      // URL-based image loader: write into the `url` field
      // so the node pulls the image from the given URL.
      let urlValue = value;
      if (typeof urlValue === 'string' && urlValue.startsWith('/')) {
        // Convert relative URL like "/api/outputs/..." → "http://host:port/api/outputs/..."
        urlValue = `${frontendBase}${urlValue}`;
      }
      (inputs as Record<string, unknown>).url = urlValue;
    } else if (audioClasses.includes(classType)) {
      inputs.audio = value;
    } else if (textAreaClasses.includes(classType)) {
      inputs.text = value;
    } else {
      inputs.value = value;
    }

    node.inputs = inputs;
  }

  return patched;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ComfyGeneratePayload;
    const { workflow_id, scene_id, kind, inputValues } = body;

    if (!workflow_id || !scene_id || !kind) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const workflowRecord = await getComfyWorkflowJson(workflow_id);
    if (!workflowRecord) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    let baseJson: Record<string, Record<string, unknown>>;
    try {
      baseJson = JSON.parse(workflowRecord.json);
    } catch {
      return NextResponse.json({ error: 'Stored workflow JSON is invalid' }, { status: 500 });
    }

    const patchedWorkflow = patchWorkflow(baseJson, inputValues ?? {});

    // Use the same backend URL setting as the shared backend client:
    // MUSE_BACKEND_URL (see muse-studio/.env.local and lib/backend-client.ts)
    const backendUrl = process.env.MUSE_BACKEND_URL ?? 'http://localhost:8000';
    const backendRes = await fetch(`${backendUrl}/generate/comfyui`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scene_id,
        kind,
        workflow_name: workflowRecord.name,
        workflow: patchedWorkflow,
      }),
    });

    const data = await backendRes.json();
    if (!backendRes.ok) {
      return NextResponse.json(
        { error: data?.detail ?? data?.error ?? 'Backend error' },
        { status: backendRes.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[/api/generate/comfyui]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
