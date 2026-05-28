import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  Easing,
} from 'remotion';
import { SceneBeat } from '../types/video-plan';

interface OverlayLayerProps {
  scene?: SceneBeat;
  frame: number;
  fps: number;
  durationFrames: number;
}

/**
 * OverlayLayer: Overlays contextuales
 * - Progress bar sutil
 * - Indicadores de escena
 * - Elementos gráficos dinámicos
 */
export const OverlayLayer: React.FC<OverlayLayerProps> = ({
  scene,
  frame,
  fps,
  durationFrames,
}) => {
  const progress = frame / durationFrames;

  // Progress bar en el borde inferior (muy sutil)
  const progressWidth = progress * 100;

  return (
    <AbsoluteFill>
      {/* Progress bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: `${progressWidth}%`,
          height: '2px',
          background: 'linear-gradient(to right, #00E5FF, #FFE500)',
          opacity: 0.4,
        }}
      />

      {/* Scene indicator (si existe) */}
      {scene && (
        <div
          style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            fontSize: '12px',
            color: '#888',
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            letterSpacing: '2px',
            opacity: 0.3,
          }}
        >
          {scene.type}
        </div>
      )}
    </AbsoluteFill>
  );
};
