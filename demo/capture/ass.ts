import { writeFile } from 'node:fs/promises';
import { bookendSpans, type VttCue } from '../src/vtt.js';

const BOOKEND_IDS = new Set(['title', 'concept', 'outro']);

function formatAssTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const hours = Math.floor(cs / 360_000);
  const minutes = Math.floor((cs % 360_000) / 6_000);
  const seconds = Math.floor((cs % 6_000) / 100);
  const centi = cs % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centi).padStart(2, '0')}`;
}

function escapeAss(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('{', '\\{').replaceAll('}', '\\}');
}

export function wrapCaption(text: string, maxChars = 110): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.map(escapeAss).join('\\N');
}

export function takeSubtitleCues(
  cues: VttCue[],
  takeDurationSec: number,
): Array<{ startSec: number; endSec: number; text: string }> {
  const offset = bookendSpans(cues).takeOffsetSec;
  const rows: Array<{ startSec: number; endSec: number; text: string }> = [];
  for (const cue of cues) {
    if (!cue.subtitle || BOOKEND_IDS.has(cue.id)) continue;
    const start = cue.startSec - offset;
    const end = cue.endSec - offset;
    if (end <= 0.05 || start >= takeDurationSec) continue;
    rows.push({
      startSec: Math.max(0, start),
      endSec: Math.min(takeDurationSec, end),
      text: cue.subtitle,
    });
  }
  return rows;
}

export async function writeTakeAss(
  cues: VttCue[],
  takeDurationSec: number,
  output: string,
): Promise<number> {
  const rows = takeSubtitleCues(cues, takeDurationSec);
  const body = rows
    .filter((row) => row.endSec - row.startSec >= 0.05 && row.text)
    .map((row) => {
      return `Dialogue: 0,${formatAssTime(row.startSec)},${formatAssTime(row.endSec)},Caption,,0,0,0,,${wrapCaption(row.text)}`;
    });
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,34,&H00FCFAF8,&H000000FF,&H00000000,&HE10E0A08,-1,0,0,0,100,100,0,0,3,10,0,2,72,72,48,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${body.join('\n')}
`;
  await writeFile(output, ass);
  return rows.length;
}
