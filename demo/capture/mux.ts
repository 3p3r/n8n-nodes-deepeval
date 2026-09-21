import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { ambientPath, demoOutPath, demoRawPath, ensureDirs, voiceMixPath } from './paths.js';

const AMBIENT_BED = 0.14;
const AMBIENT_FADE_IN_SEC = 1.8;
const AMBIENT_FADE_OUT_SEC = 3;

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

function runInherit(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

async function hasAmbient(): Promise<boolean> {
  try {
    await access(ambientPath);
    return true;
  } catch {
    return false;
  }
}

function duckingFilter(durationSec: number): string {
  const fadeOutStart = Math.max(0, durationSec - AMBIENT_FADE_OUT_SEC);
  const duration = durationSec.toFixed(3);
  return [
    '[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000,asplit=2[voice][sc]',
    `[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000,atrim=0:${duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${AMBIENT_FADE_IN_SEC},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${AMBIENT_FADE_OUT_SEC},volume=${AMBIENT_BED}[bed]`,
    '[bed][sc]sidechaincompress=threshold=0.02:ratio=10:attack=180:release=750:knee=2.5:level_sc=1[ducked]',
    '[ducked][voice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]',
  ].join(';');
}

export async function runMux(): Promise<string> {
  await ensureDirs();
  const raw = demoRawPath;
  const finalPath = demoOutPath;
  const voice = voiceMixPath;
  await access(raw);
  await access(voice);

  const videoDur = await probeDuration(raw);
  const audioDur = await probeDuration(voice);
  const mixDur = Math.max(videoDur, audioDur);
  const pad = audioDur - videoDur;
  const withAmbient = await hasAmbient();

  const encodeAudio = [
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-t',
    mixDur.toFixed(3),
    finalPath,
  ];

  if (withAmbient) {
    const duck = duckingFilter(mixDur);
    const args =
      pad > 0.05
        ? [
            '-y',
            '-i',
            raw,
            '-i',
            voice,
            '-stream_loop',
            '-1',
            '-i',
            ambientPath,
            '-filter_complex',
            `[0:v]tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}[v];${duck}`,
            '-map',
            '[v]',
            '-map',
            '[a]',
            '-c:v',
            'libx264',
            '-preset',
            'fast',
            '-crf',
            '18',
            '-pix_fmt',
            'yuv420p',
            ...encodeAudio,
          ]
        : [
            '-y',
            '-i',
            raw,
            '-i',
            voice,
            '-stream_loop',
            '-1',
            '-i',
            ambientPath,
            '-filter_complex',
            duck,
            '-map',
            '0:v',
            '-map',
            '[a]',
            '-c:v',
            'copy',
            ...encodeAudio,
          ];
    await runInherit('ffmpeg', args);
    console.info(`Wrote ${finalPath} (ambient ducked under VO)`);
    return finalPath;
  }

  const args =
    pad > 0.05
      ? [
          '-y',
          '-i',
          raw,
          '-i',
          voice,
          '-filter_complex',
          `[0:v]tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}[v]`,
          '-map',
          '[v]',
          '-map',
          '1:a',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          finalPath,
        ]
      : [
          '-y',
          '-i',
          raw,
          '-i',
          voice,
          '-map',
          '0:v',
          '-map',
          '1:a',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          finalPath,
        ];
  await runInherit('ffmpeg', args);
  console.info(`Wrote ${finalPath}`);
  return finalPath;
}

export async function main(): Promise<void> {
  await runMux();
}
