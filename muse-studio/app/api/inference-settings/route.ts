import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.MUSE_BACKEND_URL ?? 'http://localhost:8000';

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/inference/settings`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { flux_klein_offload: 'none', pipeline_loaded: false, error: 'Backend unreachable' },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND}/inference/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 });
  }
}
