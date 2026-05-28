import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

interface FallbackContentProps {
  hook?: string;
  cta?: string;
  subtitle?: string;
  durationSeconds?: number;
}

export const FallbackContent: React.FC<FallbackContentProps> = ({
  hook = 'VIDEOSIA',
  cta = 'Learn More',
  subtitle = 'Vídeo generado con Visual Engine 2.0',
  durationSeconds = 30,
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const slideInY = interpolate(frame, [0, 30], [40, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* Brand text */}
      <div
        style={{
          position: 'absolute',
          top: 180,
          left: 70,
          right: 70,
          opacity,
          zIndex: 20,
        }}
      >
        <div
          style={{
            fontSize: 54,
            fontWeight: 800,
            color: '#F3F7FF',
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          VIDEOSIA
        </div>

        {/* Main hook text */}
        <div
          style={{
            marginTop: 28,
            fontSize: 82,
            lineHeight: 1.05,
            fontWeight: 900,
            color: '#FFFFFF',
            textShadow: '0 8px 40px rgba(0,0,0,0.75)',
            transform: `translateY(${slideInY}px)`,
          }}
        >
          {hook}
        </div>

        {/* Subtitle */}
        <div
          style={{
            marginTop: 32,
            fontSize: 34,
            color: '#B9C7FF',
            fontWeight: 600,
          }}
        >
          {subtitle}
        </div>
      </div>

      {/* CTA - Bottom right */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          right: 40,
          opacity,
          zIndex: 20,
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 600,
            color: '#FFFFFF',
            textAlign: 'right',
            textShadow: '0 4px 20px rgba(0,0,0,0.75)',
          }}
        >
          {cta}
        </div>
      </div>
    </AbsoluteFill>
  );
};
