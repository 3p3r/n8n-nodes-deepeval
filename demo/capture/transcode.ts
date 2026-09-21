import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bookendSpans, parseVtt, retargetSceneCues, serializeVtt } from '../src/vtt.js';
import { encodeH264Take, probeDuration } from './ffmpeg-encode.js';
import {
  demoVttPath,
  ensureDirs,
  publicDir,
  recordingsDir,
  timestampsPath,
  timingsPath,
} from './paths.js';

interface TimestampFile {
  file: string;
  scenes: Array<{ id: string; startSec: number; endSec: number }>;
}

async function main(): Promise<void> {
  await ensureDirs();
  await access(timestampsPath);
  await access(demoVttPath);
  const timestamps = JSON.parse(await readFile(timestampsPath, 'utf8')) as TimestampFile;
  const source = resolve(recordingsDir, timestamps.file);
  await access(source);

  const scenes = timestamps.scenes;
  if (scenes.length === 0) throw new Error('timestamps.json has no scenes');
  const originSec = scenes[0]?.startSec ?? 0;
  const endSec = scenes[scenes.length - 1]?.endSec ?? originSec + 1;
  console.info(`Encoding one-shot take ${originSec.toFixed(2)}–${endSec.toFixed(2)}s`);

  for (const entry of [
    'take.mp4',
    'tables-take.mp4',
    'tables-source.raw.mp4',
    'tables-editor.raw.mp4',
    'tables-results.raw.mp4',
    'tables-concat.txt',
  ]) {
    await rm(resolve(publicDir, entry), { force: true });
  }

  const takePath = resolve(publicDir, 'take.mp4');
  await encodeH264Take(source, originSec, endSec, takePath);

  const durationSec = await probeDuration(takePath);
  const cues = parseVtt(await readFile(demoVttPath, 'utf8'));
  const spans = bookendSpans(cues);
  const retargeted = retargetSceneCues(
    cues,
    scenes.map((scene) => ({
      id: scene.id,
      takeStartSec: scene.startSec - originSec,
      takeEndSec: scene.endSec - originSec,
    })),
    spans.takeOffsetSec,
  );
  await writeFile(demoVttPath, serializeVtt(retargeted));
  await writeFile(
    timingsPath,
    `${JSON.stringify({ fps: 30, take: { file: 'take.mp4', durationSec } }, null, 2)}\n`,
  );
  console.info(`Wrote ${timingsPath} (${durationSec.toFixed(2)}s); retargeted ${demoVttPath}`);
}

await main();
