import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const OUTPUTS_ROOT = path.join(process.cwd(), 'outputs');

const MIME_TYPES: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime',
  '.mkv':  'video/x-matroska',
};

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { path: segments } = await params;

  // Prevent path traversal
  const filePath = path.normalize(path.join(OUTPUTS_ROOT, ...segments));
  if (!filePath.startsWith(OUTPUTS_ROOT)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  if (!fs.existsSync(filePath)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const fileBuffer = fs.readFileSync(filePath);

  return new NextResponse(fileBuffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
