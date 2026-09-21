import type { FC } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const OutroCard: FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inFrame = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(160deg, #0b0f14 0%, #151b24 100%)',
        justifyContent: 'center',
        padding: '0 140px',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        opacity: interpolate(inFrame, [0, 1], [0.4, 1]),
      }}
    >
      <div style={{ color: '#ff6d5a', fontSize: 22, letterSpacing: '0.28em', fontWeight: 700 }}>
        GET STARTED
      </div>
      <h1
        style={{
          color: '#f8fafc',
          fontSize: 72,
          margin: '16px 0 28px',
          letterSpacing: '-0.04em',
        }}
      >
        Install the community package
      </h1>
      <div
        style={{
          display: 'inline-block',
          background: '#111827',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: '22px 32px',
          color: '#e2e8f0',
          fontSize: 36,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        npm install n8n-nodes-deepeval
      </div>
      <p style={{ color: '#94a3b8', fontSize: 28, marginTop: 36, maxWidth: 1100, lineHeight: 1.4 }}>
        33 metric nodes, DeepEval Trigger, Aggregate, Consistency, and an optional ABC Benchmarks
        tab.
      </p>
    </AbsoluteFill>
  );
};
