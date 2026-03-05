import { NextRequest, NextResponse } from 'next/server';
import { getComfyWorkflowJson } from '@/lib/actions/comfyui';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workflow = await getComfyWorkflowJson(id);
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }
  return NextResponse.json(workflow);
}
