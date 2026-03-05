import { NextRequest, NextResponse } from 'next/server';
import { backendClient, BackendError, type ImageRefineRequest } from '@/lib/backend-client';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ImageRefineRequest;
    const data = await backendClient.refineImage(body);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
