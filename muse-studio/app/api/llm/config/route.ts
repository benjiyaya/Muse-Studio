import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.MUSE_BACKEND_URL ?? 'http://localhost:8000';

/**
 * GET: Return current LLM provider config from backend (muse_config.json + env).
 * POST: Persist active provider (and optional Ollama URL/model) to backend so
 *       Video Editor Agent and other LLM consumers use the same provider as Settings.
 */
export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/llm/config`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { active_provider: 'openai', ollama_base_url: '', ollama_model: '', error: 'Backend unreachable' },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND}/llm/config`, {
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
