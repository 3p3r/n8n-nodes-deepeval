import { type FC, Fragment } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { conceptSteps } from '../script';

export const ConceptDiagram: FC<{
  heading?: string;
  title?: string;
  steps?: Array<{ label: string; detail: string }>;
  footer?: string;
}> = ({
  heading = 'ADD EVAL TO WHAT YOU ALREADY RUN',
  title = 'Cases in, scores out, same workflow',
  steps = conceptSteps,
  footer = '',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(180deg, #0b0f14 0%, #121821 100%)',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        padding: '80px 96px',
      }}
    >
      <div style={{ color: '#94a3b8', fontSize: 22, letterSpacing: '0.18em', fontWeight: 700 }}>
        {heading}
      </div>
      <h2
        style={{ color: '#f8fafc', fontSize: 52, margin: '12px 0 56px', letterSpacing: '-0.03em' }}
      >
        {title}
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        {steps.map((step: { label: string; detail: string }, index: number) => {
          const appear = spring({
            frame: Math.max(0, frame - index * 10),
            fps,
            config: { damping: 13, stiffness: 95 },
          });
          return (
            <Fragment key={step.label}>
              <div
                style={{
                  flex: 1,
                  minHeight: 210,
                  borderRadius: 24,
                  padding: '28px 24px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  opacity: appear,
                  transform: `translateY(${interpolate(appear, [0, 1], [28, 0])}px)`,
                }}
              >
                <div style={{ color: '#ff6d5a', fontSize: 18, fontWeight: 700 }}>
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div style={{ color: '#f8fafc', fontSize: 32, fontWeight: 700, marginTop: 14 }}>
                  {step.label}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 22, marginTop: 10 }}>{step.detail}</div>
              </div>
              {index < steps.length - 1 ? (
                <div
                  style={{
                    width: 36,
                    height: 4,
                    background: '#ff6d5a',
                    opacity: interpolate(appear, [0.4, 1], [0, 1], { extrapolateLeft: 'clamp' }),
                    borderRadius: 99,
                    flexShrink: 0,
                  }}
                />
              ) : null}
            </Fragment>
          );
        })}
      </div>
      {footer ? (
        <p
          style={{
            color: '#64748b',
            fontSize: 24,
            marginTop: 64,
            maxWidth: 1400,
            lineHeight: 1.45,
          }}
        >
          {footer}
        </p>
      ) : null}
    </AbsoluteFill>
  );
};
