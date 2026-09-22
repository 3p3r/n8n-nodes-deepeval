import type { FC } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const TitleCard: FC<{ subtitle?: string }> = ({
  subtitle = 'Add DeepEval to a workflow you already run.',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleIn = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });
  const subIn = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 16, stiffness: 90 },
  });
  const line = interpolate(titleIn, [0, 1], [0, 220]);

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(160deg, #0b0f14 0%, #151b24 55%, #1c1412 100%)',
        justifyContent: 'center',
        padding: '0 140px',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ color: '#ff6d5a', fontSize: 22, letterSpacing: '0.28em', fontWeight: 700 }}>
        N8N COMMUNITY NODES
      </div>
      <h1
        style={{
          color: '#f8fafc',
          fontSize: 92,
          lineHeight: 1.05,
          margin: '18px 0 0',
          fontWeight: 720,
          letterSpacing: '-0.04em',
          opacity: titleIn,
          transform: `translateY(${interpolate(titleIn, [0, 1], [24, 0])}px)`,
        }}
      >
        n8n-nodes-deepeval
      </h1>
      <div
        style={{
          width: line,
          height: 4,
          background: '#ff6d5a',
          marginTop: 28,
          borderRadius: 99,
        }}
      />
      <p
        style={{
          color: '#cbd5e1',
          fontSize: 36,
          marginTop: 32,
          maxWidth: 1100,
          lineHeight: 1.4,
          opacity: subIn,
        }}
      >
        {subtitle}
      </p>
    </AbsoluteFill>
  );
};
