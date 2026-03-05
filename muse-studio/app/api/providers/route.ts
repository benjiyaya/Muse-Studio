import { NextResponse } from 'next/server';
import { backendClient, BackendError } from '@/lib/backend-client';

export async function GET() {
  try {
    const data = await backendClient.providers();
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
