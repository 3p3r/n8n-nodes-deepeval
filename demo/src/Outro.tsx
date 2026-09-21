import type { FC } from 'react';
import { AbsoluteFill } from 'remotion';
import { OutroCard } from './components/OutroCard';
import { FPS, HEIGHT, OUTRO_SEC, WIDTH } from './script';

export function calcOutroFrames(): number {
  return Math.round(OUTRO_SEC * FPS);
}

export const Outro: FC = () => {
  return (
    <AbsoluteFill style={{ width: WIDTH, height: HEIGHT }}>
      <OutroCard />
    </AbsoluteFill>
  );
};
