import type { FC } from 'react';
import { Composition } from 'remotion';
import { calcDurationInFrames, Demo } from './Demo';
import { calcOutroFrames, Outro } from './Outro';
import { FPS, HEIGHT, WIDTH } from './script';

export const RemotionRoot: FC = () => {
  return (
    <>
      <Composition
        id="Demo"
        component={Demo}
        durationInFrames={calcDurationInFrames()}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="Outro"
        component={Outro}
        durationInFrames={calcOutroFrames()}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
