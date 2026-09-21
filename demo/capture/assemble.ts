import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bookendSpans, parseVtt } from '../src/vtt.js';
import { writeTakeAss } from './ass.js';
import {
  captionsAssPath,
  demoRawPath,
  demoRoot,
  demoVttPath,
  ensureDirs,
  introPath,
  outroPath,
  publicDir,
  takePath,
  timingsPath,
} from './paths.js';

interface TimingsFile {
  take: { file: string; durationSec: number };
}

function runInherit(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args[0] ?? ''} exited ${code}`));
    });
  });
}

function escapeFilterPath(file: string): string {
  return file.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''");
}

async function renderCard(composition: string, output: string): Promise<void> {
  console.info(`Remotion ${composition} → ${output}`);
  await runInherit(
    'npx',
    ['remotion', 'render', 'src/index.ts', composition, output, '--gl=swangle', '--concurrency=8'],
    demoRoot,
  );
}

async function assemble(): Promise<void> {
  await ensureDirs();
  await access(timingsPath);
  await access(demoVttPath);
  await access(takePath);

  const timings = JSON.parse(await readFile(timingsPath, 'utf8')) as TimingsFile;
  const cues = parseVtt(await readFile(demoVttPath, 'utf8'));
  const spans = bookendSpans(cues);
  const fontsDir = '/usr/share/fonts/truetype/dejavu';

  const cueCount = await writeTakeAss(cues, timings.take.durationSec, captionsAssPath);
  console.info(`Wrote ${captionsAssPath} (${cueCount} take captions)`);

  if (process.argv.includes('--skip-cards')) {
    await access(introPath);
    await access(outroPath);
    console.info('Skipping Remotion cards (--skip-cards)');
  } else {
    await renderCard('Demo', introPath);
    await renderCard('Outro', outroPath);
  }

  const ass = escapeFilterPath(captionsAssPath);
  const fonts = escapeFilterPath(fontsDir);
  const filter = [
    '[0:v]fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[intro]',
    `[1:v]ass='${ass}':fontsdir='${fonts}',fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[take]`,
    '[2:v]fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[outro]',
    '[intro][take][outro]concat=n=3:v=1:a=0[v]',
  ].join(';');

  console.info(
    `Concat intro (${spans.titleSec + spans.conceptSec}s) + captioned take (${timings.take.durationSec.toFixed(1)}s) + outro (${spans.outroSec}s)`,
  );
  await runInherit('ffmpeg', [
    '-y',
    '-i',
    introPath,
    '-i',
    resolve(publicDir, timings.take.file),
    '-i',
    outroPath,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '0',
    '-movflags',
    '+faststart',
    demoRawPath,
  ]);
  console.info(`Wrote ${demoRawPath}`);
}

await assemble();
