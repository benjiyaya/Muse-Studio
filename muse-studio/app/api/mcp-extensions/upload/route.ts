import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

const OUTPUTS_ROOT = path.join(process.cwd(), 'outputs');
const SESSION_DIR = path.join('drafts', 'mcp-extensions', 'session');
const PROJECTS_DIR = path.join('drafts', 'mcp-extensions', 'projects');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv']);
const TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.tsv',
  '.srt',
  '.vtt',
  '.yaml',
  '.yml',
]);

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;

function normalizeExt(file: File): string {
  const fromName = path.extname(file.name || '').toLowerCase();
  if (fromName) return fromName;
  if (file.type.startsWith('image/')) return '.png';
  if (file.type.startsWith('video/')) return '.mp4';
  return '.txt';
}

function inferKind(file: File, forcedKind?: string): 'image' | 'video' | 'text' | null {
  if (forcedKind === 'image' || forcedKind === 'video' || forcedKind === 'text') return forcedKind;
  const ext = normalizeExt(file);
  if (IMAGE_EXT.has(ext) || file.type.startsWith('image/')) return 'image';
  if (VIDEO_EXT.has(ext) || file.type.startsWith('video/')) return 'video';
  if (TEXT_EXT.has(ext) || file.type.startsWith('text/')) return 'text';
  return null;
}

function isSafeProjectId(projectId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(projectId);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const target = String(formData.get('target') ?? 'session');
    const projectIdRaw = String(formData.get('projectId') ?? '');
    const forcedKind = String(formData.get('kind') ?? '');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    }
    if (target !== 'session' && target !== 'project') {
      return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
    }

    const kind = inferKind(file, forcedKind);
    if (!kind) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    const limit = kind === 'image' ? MAX_IMAGE_BYTES : kind === 'video' ? MAX_VIDEO_BYTES : MAX_TEXT_BYTES;
    if (file.size > limit) {
      return NextResponse.json(
        { error: `File too large for ${kind} upload (max ${Math.round(limit / (1024 * 1024))}MB)` },
        { status: 400 },
      );
    }

    const projectId = projectIdRaw.trim();
    let relDir = SESSION_DIR;
    if (target === 'project') {
      if (!projectId || !isSafeProjectId(projectId)) {
        return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
      }
      relDir = path.join(PROJECTS_DIR, projectId);
    }

    const ext = normalizeExt(file);
    const fallbackExt = kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : '.txt';
    const finalExt = ext.length <= 10 ? ext : fallbackExt;
    const filename = `${Date.now()}-${randomUUID()}${finalExt}`;

    const absDir = path.join(OUTPUTS_ROOT, relDir);
    fs.mkdirSync(absDir, { recursive: true });
    const absPath = path.join(absDir, filename);
    const relPath = path.posix.join(relDir.replace(/\\/g, '/'), filename);

    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(absPath, buf);

    return NextResponse.json({
      ok: true,
      item: {
        name: file.name || filename,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        kind,
        target,
        projectId: projectId || undefined,
        relPath,
        previewUrl: `/api/outputs/${relPath}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
