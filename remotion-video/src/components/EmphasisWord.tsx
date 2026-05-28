import React from 'react';
import { spring, useVideoConfig } from 'remotion';

interface EmphasisWordProps {
  word: string;
  color: string;
  fontSize: number;
  frame: number;
  fps: number;
}

/**
 * EmphasisWord: Palabra destacada con efecto visual
 * - Pulse sutil
 * - Color más intenso
 * - Tamaño +8px
 */
export const EmphasisWord: React.FC<EmphasisWordProps> = ({
  word,
  color,
  fontSize,
  frame,
  fps,
}) => {
  const videoConfig = useVideoConfig();

  const pulse = spring({
    frame: frame % 20,
    fps,
    config: { damping: 10, mass: 1, stiffness: 100 },
  });

  const pulseScale = 1 + (pulse - 1) * 0.15; // oscilación de +15%

  return (
    <span
      style={{
        color: color,
        fontSize: `${fontSize + 8}px`,
        fontWeight: 700,
        textShadow: `0 0 10px ${color}80, 0 2px 8px rgba(0,0,0,0.7)`,
        transform: `scale(${pulseScale})`,
        display: 'inline-block',
        transformOrigin: 'center',
        fontFamily: 'Arial, sans-serif',
        lineHeight: 1.3,
      }}
    >
      {word}
    </span>
  );
};
