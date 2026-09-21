import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';

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

export async function probeDuration(file: string): Promise<number> {
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

const X264 = [
  '-an',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-r',
  '30',
  '-threads',
  '2',
];

function concatListEntry(file: string): string {
  return `file '${file.replaceAll("'", "'\\''")}'`;
}

/**
 * Re-encode a webm/mp4 span to H.264 CFR 30fps.
 * Playwright VP8 decode is effectively single-threaded, so one ffmpeg process
 * leaves most cores idle. Split into ~12s chunks and encode in parallel.
 */
export async function encodeH264Take(
  input: string,
  start: number,
  end: number,
  output: string,
): Promise<void> {
  const duration = Math.max(0.1, end - start);
  const maxJobs = Math.min(16, Math.max(1, cpus().length));
  const chunkCount = duration < 12 ? 1 : Math.min(maxJobs, Math.max(2, Math.round(duration / 12)));
  console.info(`Encoding ${duration.toFixed(1)}s with ${chunkCount} parallel ffmpeg job(s)`);

  if (chunkCount === 1) {
    await run('ffmpeg', [
      '-y',
      '-ss',
      start.toFixed(3),
      '-t',
      duration.toFixed(3),
      '-i',
      input,
      ...X264,
      '-movflags',
      '+faststart',
      output,
    ]);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), 'deepeval-encode-'));
  try {
    const chunkDur = duration / chunkCount;
    const files = Array.from({ length: chunkCount }, (_, index) =>
      join(dir, `chunk-${String(index).padStart(3, '0')}.mp4`),
    );
    await Promise.all(
      files.map((file, index) => {
        const ss = start + index * chunkDur;
        const t = index === chunkCount - 1 ? end - ss : chunkDur;
        return run('ffmpeg', [
          '-y',
          '-ss',
          ss.toFixed(3),
          '-t',
          t.toFixed(3),
          '-i',
          input,
          ...X264,
          file,
        ]);
      }),
    );
    const list = join(dir, 'concat.txt');
    await writeFile(list, `${files.map(concatListEntry).join('\n')}\n`);
    await run('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      output,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
