import React from 'react';
import {
  useCurrentFrame,
  interpolate,
  Easing,
  spring,
  useVideoConfig,
} from 'remotion';
import { CaptionBlock } from '../types/video-plan';
import { EmphasisWord } from './EmphasisWord';

interface KineticCaptionProps {
  caption: CaptionBlock;
  frame: number;
  fps: number;
  durationFrames: number;
}

/**
 * KineticCaption: Un caption individual con efectos cinéticos
 * - Entrada animada (bounce, slide, scale)
 * - Palabras de énfasis destacadas
 * - Colores dinámicos por sección
 * - Tamaño responsive
 * - Safe area zone
 */
export const KineticCaption: React.FC<KineticCaptionProps> = ({
  caption,
  frame,
  fps,
  durationFrames,
}) => {
  const videoConfig = useVideoConfig();
  const currentTime = frame / fps;

  // Frames de este caption
  const captionStartFrame = caption.start * fps;
  const captionEndFrame = caption.end * fps;
  const captionDuration = captionEndFrame - captionStartFrame;

  // Progreso del caption (0 a 1)
  const captionProgress = interpolate(
    frame,
    [captionStartFrame, captionEndFrame],
    [0, 1],
    { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }
  );

  // Efecto de entrada
  const effectDurationMs = caption.effectDurationMs ?? 300;
  const effectDurationFrames = (effectDurationMs / 1000) * fps;
  const effectProgress = Math.min(frame - captionStartFrame, effectDurationFrames) / effectDurationFrames;

  // Spring para bounce
  const bounceScale = spring({
    frame: Math.min(frame - captionStartFrame, effectDurationFrames),
    fps,
    config: { damping: 10, mass: 1, stiffness: 100 },
  });

  // Calculadora de transformación según efecto
  let entryScale = 1;
  let entryOpacity = 1;
  let entryTranslateY = 0;

  switch (caption.effect || 'fade_in') {
    case 'bounce_in':
      entryScale = interpolate(effectProgress, [0, 1], [0.8, 1.0], { easing: Easing.out(Easing.cubic) }) * bounceScale;
      entryOpacity = interpolate(effectProgress, [0, 0.2, 1], [0, 1, 1]);
      break;
    case 'scale_in':
      entryScale = interpolate(effectProgress, [0, 1], [0.7, 1.0], { easing: Easing.out(Easing.cubic) });
      entryOpacity = interpolate(effectProgress, [0, 1], [0, 1]);
      break;
    case 'slide_in':
      entryTranslateY = interpolate(effectProgress, [0, 1], [40, 0], { easing: Easing.out(Easing.cubic) });
      entryOpacity = interpolate(effectProgress, [0, 0.3, 1], [0, 0.5, 1]);
      break;
    case 'typewriter':
      entryOpacity = 1;
      break;
    case 'fade_in':
    default:
      entryOpacity = interpolate(effectProgress, [0, 0.3], [0, 1], { easing: Easing.out(Easing.ease) });
      break;
  }

  // Salida al final
  const exitStartFrame = Math.max(0, captionEndFrame - (effectDurationFrames * 0.8));
  const exitProgress = Math.max(0, Math.min(1, (frame - exitStartFrame) / (effectDurationFrames * 0.8)));
  const exitOpacity = interpolate(exitProgress, [0, 1], [1, 0], { easing: Easing.in(Easing.ease) });

  const finalOpacity = Math.min(entryOpacity, exitOpacity);

  // Estilos por sección
  const sectionStyle: Record<string, { color: string; fontSize: number; fontWeight: number }> = {
    hook: { color: '#FFE500', fontSize: 48, fontWeight: 700 },
    claim: { color: '#F3F7FF', fontSize: 40, fontWeight: 600 },
    revelation: { color: '#FF3B30', fontSize: 42, fontWeight: 700 },
    cta: { color: '#00E5FF', fontSize: 36, fontWeight: 600 },
    transition: { color: '#B0B8C1', fontSize: 34, fontWeight: 400 },
    explanation: { color: '#F3F7FF', fontSize: 38, fontWeight: 500 },
  };

  const section = caption.section || 'claim';
  const style = sectionStyle[section] || sectionStyle.claim;
  const customColor = caption.color || style.color;
  const customSize = caption.fontSize || style.fontSize;

  // Parsear texto para énfasis
  const words = caption.text.split(/\s+/);
  const emphasis = caption.emphasis || [];

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '200px',
        left: '20px',
        right: '20px',
        textAlign: 'center',
        zIndex: 20,
        transform: `scale(${entryScale}) translateY(${entryTranslateY}px)`,
        opacity: finalOpacity,
        transformOrigin: 'bottom center',
        maxWidth: '1040px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '18px',
          alignItems: 'center',
        }}
      >
        {words.map((word, idx) => {
          const isEmphasis = emphasis.some(
            (e) => e.toLowerCase() === word.toLowerCase()
          );

          return (
            <span key={idx}>
              {isEmphasis ? (
                <EmphasisWord word={word} color={customColor} fontSize={customSize} frame={frame} fps={fps} />
              ) : (
                <span
                  style={{
                    color: customColor,
                    fontSize: `${customSize}px`,
                    fontFamily: 'Arial, sans-serif',
                    fontWeight: style.fontWeight,
                    textShadow: '0 2px 8px rgba(0,0,0,0.7)',
                    lineHeight: 1.4,
                    display: 'inline-block',
                  }}
                >
                  {word}
                </span>
              )}
            </span>
          );
        })}
      </div>

      {/* Background box sutil */}
      <div
        style={{
          position: 'absolute',
          inset: '-12px -16px',
          background: 'rgba(0,0,0,0.5)',
          borderRadius: '8px',
          zIndex: -1,
          backdropFilter: 'blur(4px)',
        }}
      />
    </div>
  );
};
