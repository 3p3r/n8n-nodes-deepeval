import { CONCEPT_SEC, OUTRO_SEC, TITLE_SEC } from './script';

export interface VttCue {
  id: string;
  startSec: number;
  endSec: number;
  subtitle: string;
  narrator: string;
}

export interface BookendSpans {
  titleSec: number;
  conceptSec: number;
  outroSec: number;
  takeOffsetSec: number;
}

const SCENE_ID_RE = /^(dt-\d{2}-[a-z]+|\d{2}-[a-z]+)-\d+$/;
const TIMING_RE = /-->/;
const VOICE_RE = /^<v\s+([^>]+)>(.*)$/;

export function parseTimestamp(value: string): number {
  const parts = value.trim().split(':');
  if (parts.length === 3) {
    const [hours, minutes, rest] = parts;
    const [seconds, millis] = (rest ?? '0.000').split('.');
    return (
      Number(hours) * 3600 +
      Number(minutes) * 60 +
      Number(seconds) +
      Number((millis ?? '0').padEnd(3, '0').slice(0, 3)) / 1000
    );
  }
  if (parts.length === 2) {
    const [minutes, rest] = parts;
    const [seconds, millis] = (rest ?? '0.000').split('.');
    return (
      Number(minutes) * 60 +
      Number(seconds) +
      Number((millis ?? '0').padEnd(3, '0').slice(0, 3)) / 1000
    );
  }
  throw new Error(`Invalid WebVTT timestamp: ${value}`);
}

export function formatTimestamp(sec: number): string {
  const msTotal = Math.max(0, Math.round(sec * 1000));
  const hours = Math.floor(msTotal / 3_600_000);
  const minutes = Math.floor((msTotal % 3_600_000) / 60_000);
  const seconds = Math.floor((msTotal % 60_000) / 1000);
  const millis = msTotal % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function parseVoices(block: string): { subtitle: string; narrator: string } {
  let subtitle = '';
  let narrator = '';
  let current: 'subtitle' | 'narrator' | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (!current) return;
    const text = buffer.join('\n').trim();
    if (current === 'subtitle') subtitle = text;
    else narrator = text;
    buffer = [];
  };
  for (const line of block.split('\n')) {
    const match = line.match(VOICE_RE);
    if (match) {
      flush();
      const voice = (match[1] ?? '').trim().toLowerCase();
      current = voice === 'subtitle' || voice === 'narrator' ? voice : null;
      buffer = [match[2] ?? ''];
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return { subtitle, narrator };
}

export function parseVtt(source: string): VttCue[] {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const chunks = normalized.split(/\n\n+/);
  const cues: VttCue[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n').filter((line, index) => !(index === 0 && line === ''));
    if (lines.length === 0) continue;
    if (/^WEBVTT/i.test(lines[0] ?? '')) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(lines[0] ?? '')) continue;
    let id = '';
    let timingIndex = 0;
    if (lines[0] && !TIMING_RE.test(lines[0])) {
      id = lines[0].trim();
      timingIndex = 1;
    }
    const timingLine = lines[timingIndex];
    if (!timingLine || !TIMING_RE.test(timingLine)) continue;
    const [startRaw, endRaw] = timingLine.split('-->');
    if (startRaw === undefined || endRaw === undefined) continue;
    const startSec = parseTimestamp(startRaw);
    const endSec = parseTimestamp(endRaw);
    const payload = lines.slice(timingIndex + 1).join('\n');
    const voices = parseVoices(payload);
    cues.push({
      id: id || `cue-${cues.length + 1}`,
      startSec,
      endSec,
      subtitle: voices.subtitle,
      narrator: voices.narrator,
    });
  }
  return cues;
}

export function serializeVtt(cues: VttCue[], note?: string): string {
  const header = [
    'WEBVTT',
    '',
    `NOTE ${note ?? 'subtitle = on-screen caption. narrator = Voicebox. They may differ.'}`,
  ];
  const body = cues.map((cue) => {
    const lines = [
      `${cue.id}`,
      `${formatTimestamp(cue.startSec)} --> ${formatTimestamp(cue.endSec)}`,
    ];
    if (cue.subtitle) lines.push(`<v subtitle>${cue.subtitle}`);
    if (cue.narrator) lines.push(`<v narrator>${cue.narrator}`);
    return lines.join('\n');
  });
  return `${header.join('\n')}\n\n${body.join('\n\n')}\n`;
}

export function sceneIdOf(cueId: string): string | undefined {
  const match = cueId.match(SCENE_ID_RE);
  return match?.[1];
}

export function cueById(cues: VttCue[], id: string): VttCue | undefined {
  return cues.find((cue) => cue.id === id);
}

export function bookendSpans(cues: VttCue[]): BookendSpans {
  const title = cueById(cues, 'title');
  const concept = cueById(cues, 'concept');
  const outro = cueById(cues, 'outro');
  const titleSec = title ? Math.max(0.2, title.endSec - title.startSec) : TITLE_SEC;
  const conceptSec = concept ? Math.max(0.2, concept.endSec - concept.startSec) : CONCEPT_SEC;
  const outroSec = outro ? Math.max(0.2, outro.endSec - outro.startSec) : OUTRO_SEC;
  return {
    titleSec,
    conceptSec,
    outroSec,
    takeOffsetSec: titleSec + conceptSec,
  };
}

export function activeSubtitle(cues: VttCue[], timeSec: number): string | undefined {
  const match = cues.find(
    (cue) => cue.subtitle !== '' && timeSec >= cue.startSec && timeSec < cue.endSec,
  );
  return match?.subtitle;
}

export function retargetSceneCues(
  cues: VttCue[],
  sceneWindows: Array<{ id: string; takeStartSec: number; takeEndSec: number }>,
  takeOffsetSec: number,
): VttCue[] {
  const next = cues.map((cue) => ({ ...cue }));
  for (const scene of sceneWindows) {
    const members = next
      .filter((cue) => sceneIdOf(cue.id) === scene.id)
      .sort((a, b) => a.startSec - b.startSec);
    if (members.length === 0) continue;
    const oldMin = Math.min(...members.map((cue) => cue.startSec));
    const oldMax = Math.max(...members.map((cue) => cue.endSec));
    const oldSpan = Math.max(0.001, oldMax - oldMin);
    const newStart = takeOffsetSec + scene.takeStartSec;
    const newDur = Math.max(0.2, scene.takeEndSec - scene.takeStartSec);
    for (const cue of members) {
      cue.startSec = newStart + ((cue.startSec - oldMin) / oldSpan) * newDur;
      cue.endSec = newStart + ((cue.endSec - oldMin) / oldSpan) * newDur;
    }
  }
  return next;
}
