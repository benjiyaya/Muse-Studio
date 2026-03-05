import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const OUTPUTS_ROOT = path.join(process.cwd(), 'outputs');
const REFS_DIR = 'refs';
// Allow both image and audio references; filenames are later passed to ComfyUI
const ALLOWED_EXT = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac',
];
const MAX_FILES = 4;
// 5 MB per image
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function getExt(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return ALLOWED_EXT.includes(ext) ? ext : '.png';
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const sceneId = formData.get('sceneId');
    const files = formData.getAll('files') as File[];

    if (!sceneId || typeof sceneId !== 'string') {
      return NextResponse.json({ error: 'Missing sceneId' }, { status: 400 });
    }

    // Basic validation — accept images and audio
    const validFiles = files.filter(
      (f) =>
        f &&
        typeof f === 'object' &&
        f.size > 0 &&
        (f.type.startsWith('image/') ||
          f.type.startsWith('audio/') ||
          ALLOWED_EXT.includes(getExt(f.name))),
    );
    if (validFiles.length === 0) {
      return NextResponse.json({ error: 'No valid image files' }, { status: 400 });
    }
    // Enforce 5 MB per image
    const tooLarge = validFiles.find((f) => f.size > MAX_FILE_BYTES);
    if (tooLarge) {
      return NextResponse.json(
        { error: 'Each reference image must be 5 MB or smaller.' },
        { status: 400 },
      );
    }
    if (validFiles.length > MAX_FILES) {
      return NextResponse.json({ error: `Maximum ${MAX_FILES} reference images allowed` }, { status: 400 });
    }

    const sceneDir = path.join(OUTPUTS_ROOT, REFS_DIR, sceneId);
    if (!fs.existsSync(sceneDir)) {
      fs.mkdirSync(sceneDir, { recursive: true });
    }

    const paths: string[] = [];
    for (const file of validFiles) {
      const ext = getExt(file.name);
      const baseName = `${randomUUID()}${ext}`;
      const filePath = path.join(sceneDir, baseName);
      const buf = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buf);
      paths.push(`${REFS_DIR}/${sceneId}/${baseName}`);
    }

    return NextResponse.json({ paths });
  } catch (err) {
    console.error('Reference upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
