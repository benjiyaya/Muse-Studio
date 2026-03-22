import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Remotion CLI only loads http(s) video URLs, not file://
const sampleMp4 =
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

const doc = {
  version: 1,
  fps: 24,
  width: 1280,
  height: 720,
  projectTitle: 'Fixture',
  sequences: [
    {
      id: 'fixture-1',
      sceneId: 'scene-fixture',
      sceneNumber: 1,
      title: 'Part A',
      renderSrc: sampleMp4,
      previewSrc: '/api/outputs/videos/fixture.mp4',
      trimStartSec: 0,
      trimEndSec: 2,
      transitionOut: { type: 'fade', durationSec: 0.5 },
    },
    {
      id: 'fixture-2',
      sceneId: 'scene-fixture',
      sceneNumber: 1,
      title: 'Part B',
      renderSrc: sampleMp4,
      previewSrc: '/api/outputs/videos/fixture.mp4',
      trimStartSec: 2,
      trimEndSec: 4.5,
    },
  ],
  overlays: [],
};

writeFileSync(join(root, 'timeline.fixtures.json'), JSON.stringify(doc, null, 2), 'utf-8');
console.log('Wrote timeline.fixtures.json');
