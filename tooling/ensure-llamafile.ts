import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, '.llamafile');
const filename = 'Ministral-3-3B-Instruct-2512-Q4_K_M.llamafile';
const destination = resolve(directory, filename);
const url =
  'https://huggingface.co/mozilla-ai/llamafile_0.10/resolve/main/Ministral-3-3B-Instruct-2512-Q4_K_M.llamafile';
const expectedSha256 = 'c46334e2f284e9eec3bb5bf9ad59e552aaf2ad3ee789de50f3e883fa657efe3c';
const apeLoaderPath = resolve(directory, 'ape');
const apeMachine = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const apeLoaderUrl = `https://cosmo.zip/pub/cosmos/bin/ape-${apeMachine}.elf`;
const apeLoaderSha256 = '7c1cf8b24e1b6dd6ad7da3817045d582ada146b4d6ec0c6a45bea830e3a65f4d';

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyExecutable(path: string): Promise<void> {
  const file = await stat(path);
  if ((file.mode & 0o111) === 0) {
    throw new Error(`${path} is not executable`);
  }
}

async function downloadVerifiedFile(
  url: string,
  destinationPath: string,
  expectedDigest: string,
): Promise<void> {
  const temporaryPath = `${destinationPath}.download`;
  await rm(temporaryPath, { force: true });

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const hash = createHash('sha256');
  const file = await open(temporaryPath, 'wx');
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      hash.update(bytes);
      await file.write(bytes);
    }
  } finally {
    await file.close();
  }

  const digest = hash.digest('hex');
  if (digest !== expectedDigest) {
    await rm(temporaryPath, { force: true });
    throw new Error(`Checksum mismatch for ${url}: expected ${expectedDigest}, received ${digest}`);
  }

  await chmod(temporaryPath, 0o755);
  await rename(temporaryPath, destinationPath);
}

async function ensureVerifiedFile(
  path: string,
  url: string,
  expectedDigest: string,
  label: string,
): Promise<void> {
  if (existsSync(path)) {
    const digest = await sha256(path);
    if (digest === expectedDigest) {
      await verifyExecutable(path);
      console.info(`${label} is already downloaded and verified.`);
      return;
    }
  }

  await downloadVerifiedFile(url, path, expectedDigest);
  console.info(`Downloaded and verified ${label}.`);
}

await mkdir(directory, { recursive: true });
await ensureVerifiedFile(apeLoaderPath, apeLoaderUrl, apeLoaderSha256, 'APE loader');
await ensureVerifiedFile(destination, url, expectedSha256, filename);
