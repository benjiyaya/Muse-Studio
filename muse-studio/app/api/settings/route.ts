import { NextResponse } from 'next/server';
import { getLLMSettings } from '@/lib/actions/settings';

export async function GET() {
  const llm = await getLLMSettings();
  return NextResponse.json({ llm });
}
