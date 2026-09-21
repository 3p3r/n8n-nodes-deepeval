import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { bookendSpans, parseVtt } from '../src/vtt.js';
import { demoVttPath, ensureDirs, timingsPath, voiceCuesPath, voiceMixPath } from './paths.js';
import { type ModelSize, synthesize, type VoiceEngine } from './voicebox.js';

interface TimingsFile {
  take: { file: string; durationSec: number };
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr}`));
    });
  });
}

async function probeDuration(file: string): Promise<number> {
  const output = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const duration = Number.parseFloat(output);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not probe duration for ${file}: ${output}`);
  }
  return duration;
}

interface Clip {
  file: string;
  startSec: number;
  durationSec: number;
}

function schedule(clips: Clip[]): Clip[] {
  const scheduled: Clip[] = [];
  let cursor = 0;
  for (const clip of clips) {
    const startSec = Math.max(clip.startSec, cursor);
    scheduled.push({ ...clip, startSec });
    cursor = startSec + clip.durationSec + 0.15;
  }
  return scheduled;
}

async function mix(clips: Clip[], durationSec: number, output: string): Promise<void> {
  if (clips.length === 0) throw new Error('No narration clips to mix');
  const args: string[] = ['-y'];
  for (const clip of clips) args.push('-i', clip.file);
  const filters = clips.map((clip, index) => {
    const delay = Math.max(0, Math.round(clip.startSec * 1000));
    return `[${index}:a]adelay=${delay}|${delay},aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000[a${index}]`;
  });
  const mixInputs = clips.map((_, index) => `[a${index}]`).join('');
  filters.push(
    `${mixInputs}amix=inputs=${clips.length}:dropout_transition=0:normalize=0,apad=whole_dur=${durationSec.toFixed(3)}[out]`,
  );
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-c:a',
    'pcm_s16le',
    '-t',
    durationSec.toFixed(3),
    output,
  );
  await run('ffmpeg', args);
}

function opt(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('-')) return undefined;
  return value;
}

export interface NarrateOptions {
  engine?: VoiceEngine;
  modelSize?: ModelSize;
}

export async function runNarrate(options: NarrateOptions = {}): Promise<string> {
  await ensureDirs();
  await access(timingsPath);
  await access(demoVttPath);
  const timings = JSON.parse(await readFile(timingsPath, 'utf8')) as TimingsFile;
  const cues = parseVtt(await readFile(demoVttPath, 'utf8'));
  const spans = bookendSpans(cues);
  const compositionSec = spans.takeOffsetSec + timings.take.durationSec + spans.outroSec;

  const generated: Clip[] = [];
  for (const cue of cues) {
    if (!cue.narrator) continue;
    const file = await synthesize(cue.narrator, {
      engine: options.engine,
      modelSize: options.modelSize,
    });
    generated.push({
      file,
      startSec: cue.startSec,
      durationSec: await probeDuration(file),
    });
  }

  const placed = schedule(generated);
  const last = placed[placed.length - 1];
  const mixDuration = Math.max(
    compositionSec,
    last ? last.startSec + last.durationSec + 0.4 : compositionSec,
  );
  await mix(placed, mixDuration, voiceMixPath);
  await writeFile(
    voiceCuesPath,
    `${JSON.stringify({ durationSec: mixDuration, clips: placed, engine: options.engine, modelSize: options.modelSize }, null, 2)}\n`,
  );
  console.info(`Wrote ${voiceMixPath} (${mixDuration.toFixed(2)}s, ${placed.length} clips)`);
  return voiceMixPath;
}

export async function main(): Promise<void> {
  await runNarrate({
    engine: opt('--engine') as VoiceEngine | undefined,
    modelSize: opt('--model-size') as ModelSize | undefined,
  });
}
