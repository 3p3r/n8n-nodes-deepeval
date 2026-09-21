import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { voiceDir } from './paths.js';

const PROFILE_NAME = 'harvard';
export const DEFAULT_ENGINE = 'chatterbox_turbo' as const;
const LANGUAGE = 'en';

export type VoiceEngine =
  | 'qwen'
  | 'qwen_custom_voice'
  | 'luxtts'
  | 'chatterbox'
  | 'chatterbox_turbo'
  | 'tada'
  | 'kokoro';

export type ModelSize = '1.7B' | '0.6B' | '1B' | '3B';

export interface SynthesizeOptions {
  engine?: VoiceEngine;
  modelSize?: ModelSize;
}

export interface TtsVariant {
  slug: string;
  engine: VoiceEngine;
  modelSize?: ModelSize;
  modelName: string;
}

/** Generate-API TTS engines / sizes, mapped to Voicebox `/models/status` ids. */
export const TTS_VARIANTS: TtsVariant[] = [
  { slug: 'qwen-1.7B', engine: 'qwen', modelSize: '1.7B', modelName: 'qwen-tts-1.7B' },
  { slug: 'qwen-0.6B', engine: 'qwen', modelSize: '0.6B', modelName: 'qwen-tts-0.6B' },
  {
    slug: 'qwen-custom-voice-1.7B',
    engine: 'qwen_custom_voice',
    modelSize: '1.7B',
    modelName: 'qwen-custom-voice-1.7B',
  },
  {
    slug: 'qwen-custom-voice-0.6B',
    engine: 'qwen_custom_voice',
    modelSize: '0.6B',
    modelName: 'qwen-custom-voice-0.6B',
  },
  { slug: 'luxtts', engine: 'luxtts', modelName: 'luxtts' },
  { slug: 'chatterbox', engine: 'chatterbox', modelName: 'chatterbox-tts' },
  { slug: 'chatterbox-turbo', engine: 'chatterbox_turbo', modelName: 'chatterbox-turbo' },
  { slug: 'tada-1B', engine: 'tada', modelSize: '1B', modelName: 'tada-1b' },
  { slug: 'tada-3B', engine: 'tada', modelSize: '3B', modelName: 'tada-3b-ml' },
  { slug: 'kokoro', engine: 'kokoro', modelName: 'kokoro' },
];

export interface VoiceboxModelStatus {
  model_name: string;
  display_name: string;
  downloaded: boolean;
  downloading?: boolean;
  loaded?: boolean;
  size_mb?: number | null;
}

const DEFAULT_API = 'http://127.0.0.1:17493';
const GENERATE_TIMEOUT_MS = 1_800_000;
/** Staging dir for Windows curl when WSL loopback cannot reach Voicebox. */
const WIN_TEMP_WSL = '/mnt/c/Windows/Temp/deepeval-voice';
const WIN_TEMP_WIN = 'C:\\Windows\\Temp\\deepeval-voice';
const WIN_CMD_CWD = '/mnt/c/Windows/Temp';

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

const API = (env('VOICEBOX_URL') ?? DEFAULT_API).replace(/\/$/, '');

interface VoiceProfile {
  id: string;
  name: string;
}

interface GenerationResponse {
  id: string;
  status?: string;
  audio_path?: string | null;
  error?: string | null;
}

let cachedProfileId: string | undefined;
let useWindowsCurl: boolean | undefined;
let resolvedExe: string | null | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function run(
  command: string,
  args: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

async function nodeGet(path: string): Promise<{ ok: boolean; status: number; body: Buffer }> {
  try {
    const response = await fetch(`${API}${path}`, {
      signal: AbortSignal.timeout(4_000),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: Buffer.from(await response.arrayBuffer()),
    };
  } catch {
    return { ok: false, status: 0, body: Buffer.alloc(0) };
  }
}

async function windowsCurl(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await run('cmd.exe', ['/c', 'curl.exe', ...args], WIN_CMD_CWD);
}

async function windowsLocalAppData(): Promise<string | undefined> {
  const fromEnv = env('LOCALAPPDATA');
  if (fromEnv) return fromEnv.replace(/[/\\]+$/, '');
  const result = await run('cmd.exe', ['/c', 'echo %LOCALAPPDATA%'], WIN_CMD_CWD);
  const value = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)?.trim();
  if (result.code === 0 && value && !/%LOCALAPPDATA%/i.test(value)) {
    return value.replace(/[/\\]+$/, '');
  }
  return undefined;
}

async function voiceboxExe(): Promise<string | null> {
  if (resolvedExe !== undefined) return resolvedExe;
  const local = await windowsLocalAppData();
  resolvedExe = local ? `${local}\\Voicebox\\voicebox.exe` : null;
  return resolvedExe;
}

async function startVoicebox(): Promise<boolean> {
  const exe = await voiceboxExe();
  if (!exe) return false;
  const escaped = exe.replaceAll("'", "''");
  await run('powershell.exe', ['-Command', `Start-Process -FilePath '${escaped}'`], WIN_CMD_CWD);
  return true;
}

async function detectTransport(): Promise<'node' | 'windows'> {
  if (useWindowsCurl === true) return 'windows';
  if (useWindowsCurl === false) return 'node';
  const probe = await nodeGet('/profiles');
  if (probe.ok) {
    useWindowsCurl = false;
    return 'node';
  }
  const win = await windowsCurl(['-sS', '-m', '5', `${API}/profiles`]);
  if (win.code === 0 && (win.stdout.trim().startsWith('[') || win.stdout.trim().startsWith('{'))) {
    useWindowsCurl = true;
    return 'windows';
  }
  const launched = await startVoicebox();
  const deadline = Date.now() + (launched ? 90_000 : 8_000);
  while (Date.now() < deadline) {
    const again = await nodeGet('/profiles');
    if (again.ok) {
      useWindowsCurl = false;
      return 'node';
    }
    const winAgain = await windowsCurl(['-sS', '-m', '5', `${API}/profiles`]);
    if (winAgain.code === 0 && winAgain.stdout.includes('harvard')) {
      useWindowsCurl = true;
      return 'windows';
    }
    await sleep(2_000);
  }
  throw new Error(
    `Voicebox API not reachable at ${API}. Start Voicebox and set VOICEBOX_URL if the port differs.`,
  );
}

async function getJson(path: string): Promise<unknown> {
  const transport = await detectTransport();
  if (transport === 'node') {
    const response = await fetch(`${API}${path}`);
    if (!response.ok) throw new Error(`Voicebox GET ${path} failed: ${response.status}`);
    return await response.json();
  }
  const result = await windowsCurl(['-sS', '-m', '30', `${API}${path}`]);
  if (result.code !== 0)
    throw new Error(`Windows curl GET ${path} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

async function postJson(path: string, payload: unknown): Promise<unknown> {
  const transport = await detectTransport();
  if (transport === 'node') {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Voicebox POST ${path} failed: ${response.status} ${await response.text()}`);
    }
    return await response.json();
  }
  await mkdir(WIN_TEMP_WSL, { recursive: true });
  const bodyPath = resolve(WIN_TEMP_WSL, 'request.json');
  await writeFile(bodyPath, JSON.stringify(payload));
  const result = await windowsCurl([
    '-sS',
    '-m',
    String(Math.round(GENERATE_TIMEOUT_MS / 1000)),
    '-X',
    'POST',
    `${API}${path}`,
    '-H',
    'Content-Type: application/json',
    '--data-binary',
    `@${WIN_TEMP_WIN}\\request.json`,
  ]);
  if (result.code !== 0) {
    throw new Error(`Windows curl POST ${path} failed: ${result.stderr || result.stdout}`);
  }
  const trimmed = result.stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Voicebox POST ${path} returned non-JSON: ${trimmed.slice(0, 300)}`);
  }
}

function isWav(buffer: Buffer): boolean {
  return buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF';
}

async function downloadAudio(generationId: string, dest: string): Promise<void> {
  const transport = await detectTransport();
  if (transport === 'node') {
    const response = await fetch(`${API}/audio/${generationId}`);
    if (!response.ok)
      throw new Error(`Voicebox GET /audio/${generationId} failed: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!isWav(data)) {
      throw new Error(
        `Voicebox audio ${generationId} is not a WAV (${data.subarray(0, 80).toString('utf8')})`,
      );
    }
    await writeFile(dest, data);
    return;
  }
  await mkdir(WIN_TEMP_WSL, { recursive: true });
  const winOut = `${WIN_TEMP_WIN}\\${generationId}.wav`;
  const wslOut = resolve(WIN_TEMP_WSL, `${generationId}.wav`);
  const result = await windowsCurl([
    '-sS',
    '-m',
    '120',
    `${API}/audio/${generationId}`,
    '-o',
    winOut,
  ]);
  if (result.code !== 0) {
    throw new Error(
      `Windows curl GET /audio/${generationId} failed: ${result.stderr || result.stdout}`,
    );
  }
  const data = await readFile(wslOut);
  if (!isWav(data)) {
    throw new Error(
      `Voicebox audio ${generationId} is not a WAV (${data.subarray(0, 80).toString('utf8')})`,
    );
  }
  await writeFile(dest, data);
}

export function isDefaultVariant(engine: VoiceEngine, modelSize?: ModelSize): boolean {
  return engine === DEFAULT_ENGINE && modelSize === undefined;
}

function cachePath(text: string, engine: VoiceEngine, modelSize?: ModelSize): string {
  const key = `${engine}:${modelSize ?? ''}:${text}`;
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
  const sizePart = modelSize ? `-${modelSize}` : '';
  return resolve(voiceDir, `${engine}${sizePart}-${hash}.wav`);
}

export async function listModels(): Promise<VoiceboxModelStatus[]> {
  const raw = await getJson('/models/status');
  if (Array.isArray(raw)) return raw as VoiceboxModelStatus[];
  return ((raw as { models?: VoiceboxModelStatus[] }).models ?? []) as VoiceboxModelStatus[];
}

export async function downloadModel(modelName: string): Promise<void> {
  await postJson('/models/download', { model_name: modelName });
}

function unwrapGeneration(body: unknown): GenerationResponse {
  if (body && typeof body === 'object' && 'data' in body && (body as { data?: unknown }).data) {
    return (body as { data: GenerationResponse }).data;
  }
  return body as GenerationResponse;
}

function isDisconnect(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Failed to connect') ||
    message.includes('Could not connect') ||
    message.includes('Connection refused') ||
    message.includes('Voicebox API not reachable')
  );
}

async function restartVoicebox(): Promise<void> {
  console.info('Restarting Voicebox…');
  useWindowsCurl = undefined;
  cachedProfileId = undefined;
  await startVoicebox();
  await sleep(8_000);
  await detectTransport();
}

async function downloadAudioWithRetry(generationId: string, dest: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      await downloadAudio(generationId, dest);
      await access(dest);
      return;
    } catch (error) {
      lastError = error;
      if (attempt % 6 === 0) {
        console.info(`Waiting for Voicebox audio ${generationId} (attempt ${attempt + 1})`);
      }
      if (isDisconnect(error)) {
        try {
          await restartVoicebox();
        } catch (restartError) {
          lastError = restartError;
        }
      }
      await sleep(10_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function listProfilesFrom(raw: unknown): VoiceProfile[] {
  return Array.isArray(raw)
    ? (raw as VoiceProfile[])
    : ((raw as { data?: VoiceProfile[] }).data ?? []);
}

export async function harvardProfileId(): Promise<string> {
  if (cachedProfileId) return cachedProfileId;
  const profiles = listProfilesFrom(await getJson('/profiles'));
  const match = profiles.find((profile) => profile.name.toLowerCase() === PROFILE_NAME);
  if (!match) {
    const names = profiles.map((profile) => profile.name).join(', ') || '(none)';
    throw new Error(`Voicebox profile "${PROFILE_NAME}" not found. Available: ${names}`);
  }
  cachedProfileId = match.id;
  return match.id;
}

/** Engines that reject cloned profiles. Male English presets for narrator comparison. */
const PRESET_FALLBACK: Partial<Record<VoiceEngine, { name: string; voiceId: string }>> = {
  kokoro: { name: 'deepeval-kokoro-michael', voiceId: 'am_michael' },
  qwen_custom_voice: { name: 'deepeval-qwen-cv-ryan', voiceId: 'Ryan' },
};

const presetProfileIds = new Map<string, string>();

export async function ensurePresetProfile(
  engine: VoiceEngine,
  voiceId: string,
  name: string,
): Promise<string> {
  const cached = presetProfileIds.get(name);
  if (cached) return cached;
  const profiles = listProfilesFrom(await getJson('/profiles'));
  const existing = profiles.find((profile) => profile.name === name);
  if (existing) {
    presetProfileIds.set(name, existing.id);
    return existing.id;
  }
  const created = await postJson('/profiles', {
    name,
    language: LANGUAGE,
    voice_type: 'preset',
    preset_engine: engine,
    preset_voice_id: voiceId,
  });
  const profile = (created as { data?: VoiceProfile }).data ?? (created as VoiceProfile);
  if (!profile.id) {
    throw new Error(`Voicebox create profile returned no id: ${JSON.stringify(created)}`);
  }
  presetProfileIds.set(name, profile.id);
  return profile.id;
}

async function profileIdForEngine(engine: VoiceEngine): Promise<string> {
  const preset = PRESET_FALLBACK[engine];
  if (preset) return await ensurePresetProfile(engine, preset.voiceId, preset.name);
  return await harvardProfileId();
}

function isClonedProfileError(error: unknown): boolean {
  return String(error).includes('does not support cloned voice profiles');
}

export async function synthesize(text: string, options: SynthesizeOptions = {}): Promise<string> {
  const engine = options.engine ?? DEFAULT_ENGINE;
  const modelSize = options.modelSize;
  await mkdir(voiceDir, { recursive: true });
  const dest = cachePath(text, engine, modelSize);
  try {
    await access(dest);
    if (isWav(await readFile(dest))) return dest;
  } catch {
    // generate
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const profileId = await profileIdForEngine(engine);
      const label = `${engine}${modelSize ? ` ${modelSize}` : ''}`;
      console.info(`Voicebox generate [${label}] (${text.slice(0, 48)}…)`);
      const payload: Record<string, unknown> = {
        text,
        profile_id: profileId,
        language: LANGUAGE,
        engine,
      };
      if (modelSize) payload.model_size = modelSize;
      const body = unwrapGeneration(await postJson('/generate', payload));
      if (!body.id) throw new Error(`Voicebox generate returned no id: ${JSON.stringify(body)}`);
      await downloadAudioWithRetry(body.id, dest);
      return dest;
    } catch (error) {
      lastError = error;
      console.info(`Voicebox generate failed (attempt ${attempt + 1}): ${String(error)}`);
      if (isClonedProfileError(error)) throw error;
      try {
        await restartVoicebox();
      } catch (restartError) {
        lastError = restartError;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
