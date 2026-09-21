import type { FC } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const Caption: FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = spring({
    frame,
    fps,
    config: { damping: 18, mass: 0.7, stiffness: 120 },
  });
  const translateY = interpolate(opacity, [0, 1], [28, 0]);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', pointerEvents: 'none' }}>
      <div
        style={{
          margin: '0 72px 48px',
          padding: '22px 32px',
          borderRadius: 16,
          background: 'rgba(8, 10, 14, 0.88)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 18px 40px rgba(0, 0, 0, 0.35)',
          transform: `translateY(${translateY}px)`,
          opacity,
        }}
      >
        <div
          style={{
            color: '#f8fafc',
            fontSize: 34,
            lineHeight: 1.35,
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            fontWeight: 560,
            letterSpacing: '-0.02em',
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
