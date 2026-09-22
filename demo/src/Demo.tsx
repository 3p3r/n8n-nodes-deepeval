import type { FC, ReactNode } from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { Caption } from './components/Caption';
import { ConceptDiagram } from './components/ConceptDiagram';
import { TitleCard } from './components/TitleCard';
import demoVtt from './n8n-nodes-deepeval-demo.vtt';
import { FPS, HEIGHT, WIDTH } from './script';
import { activeSubtitle, bookendSpans, parseVtt } from './vtt';

const cues = parseVtt(demoVtt);
const spans = bookendSpans(cues);

export function calcDurationInFrames(): number {
  return Math.round(spans.takeOffsetSec * FPS);
}

export const Demo: FC = () => {
  const frame = useCurrentFrame();
  const timeSec = frame / FPS;
  const caption = activeSubtitle(cues, timeSec);
  const titleFrames = Math.round(spans.titleSec * FPS);
  const conceptFrames = Math.round(spans.conceptSec * FPS);
  const sequences: ReactNode[] = [
    <Sequence key="title" from={0} durationInFrames={titleFrames}>
      <TitleCard />
    </Sequence>,
    <Sequence key="concept" from={titleFrames} durationInFrames={conceptFrames}>
      <ConceptDiagram />
    </Sequence>,
  ];

  return (
    <AbsoluteFill style={{ background: '#0b0f14', width: WIDTH, height: HEIGHT }}>
      {sequences}
      {caption ? <Caption text={caption} /> : null}
    </AbsoluteFill>
  );
};
