import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const demoRoot = resolve(here, '..');
export const repoRoot = resolve(demoRoot, '..');
export const recordingsDir = resolve(demoRoot, 'recordings');
export const debugDir = resolve(recordingsDir, 'debug');
export const publicDir = resolve(demoRoot, 'public');
export const outDir = resolve(demoRoot, 'out');
export const voiceDir = resolve(recordingsDir, 'voice');
export const timingsPath = resolve(demoRoot, 'src/scene-timings.generated.json');
export const timestampsPath = resolve(recordingsDir, 'timestamps.json');
export const demoVttPath = resolve(demoRoot, 'src/n8n-nodes-deepeval-demo.vtt');
export const voiceMixPath = resolve(publicDir, 'voice.wav');
export const voiceCuesPath = resolve(publicDir, 'voice-cues.json');
export const ambientPath = resolve(publicDir, 'ambient.mp3');
export const demoRawPath = resolve(outDir, 'n8n-nodes-deepeval-demo.raw.mp4');
export const demoOutPath = resolve(outDir, 'n8n-nodes-deepeval-demo.mp4');
export const takePath = resolve(publicDir, 'take.mp4');
export const introPath = resolve(publicDir, 'intro.mp4');
export const outroPath = resolve(publicDir, 'outro.mp4');
export const captionsAssPath = resolve(recordingsDir, 'captions.ass');

export const SCENE_IDS = [
  'dt-01-workflow',
  'dt-02-tables',
  'dt-03-trigger',
  'dt-04-metrics',
  'dt-05-persist',
  'dt-06-execute',
  'dt-07-results',
  'dt-08-dashboard',
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

export async function ensureDirs(): Promise<void> {
  await mkdir(recordingsDir, { recursive: true });
  await mkdir(debugDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(voiceDir, { recursive: true });
}
