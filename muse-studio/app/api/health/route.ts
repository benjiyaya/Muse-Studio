import { NextResponse } from 'next/server';
import { backendClient, BackendError } from '@/lib/backend-client';

export async function GET() {
  try {
    const data = await backendClient.health();
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(
        { error: 'Backend unavailable', detail: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: 'Backend unreachable', detail: 'Could not connect to the Muse Python backend.' },
      { status: 503 },
    );
  }
}
