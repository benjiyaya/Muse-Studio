import { NextRequest, NextResponse } from 'next/server';
import { backendClient, BackendError } from '@/lib/backend-client';

// This is a runtime-only polling endpoint — never statically generated.
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const data = await backendClient.getJob(id);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
