import React from 'react';
import {
  useCurrentFrame,
  interpolate,
  Easing,
  AbsoluteFill,
} from 'remotion';
import { CaptionBlock } from '../types/video-plan';
import { KineticCaption } from './KineticCaption';

interface CaptionsLayerProps {
  captions: CaptionBlock[];
  frame: number;
  fps: number;
  durationFrames: number;
}

/**
 * CaptionsLayer: Renderiza captions cinéticos
 * - Múltiples captions simultáneos si overlap
 * - Efectos de entrada dinámicos
 * - Colores y tamaños por sección
 * - Zona segura para Shorts
 */
export const CaptionsLayer: React.FC<CaptionsLayerProps> = ({
  captions,
  frame,
  fps,
  durationFrames,
}) => {
  // Convertir tiempos a frames
  const currentTime = frame / fps;

  // Captions activos en este frame
  const activeCaption = captions.find(
    (cap) => currentTime >= cap.start && currentTime < cap.end
  );

  // Para debug: mostrar siguiente caption
  const nextCaption = captions.find(
    (cap) => cap.start >= currentTime && cap.start < currentTime + 1
  );

  if (!activeCaption) {
    return null;
  }

  return (
    <AbsoluteFill>
      <KineticCaption
        caption={activeCaption}
        frame={frame}
        fps={fps}
        durationFrames={durationFrames}
      />
    </AbsoluteFill>
  );
};
