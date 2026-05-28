import React from 'react';
import {
  AbsoluteFill,
  Img,
  Video,
  useCurrentFrame,
  interpolate,
  Easing,
} from 'remotion';
import { BackgroundConfig } from '../types/video-plan';

interface BackgroundLayerProps {
  frame: number;
  fps: number;
  config?: BackgroundConfig;
  durationFrames: number;
  fallbackColor?: string;
}

/**
 * BackgroundLayer: Renderiza fondos dinámicos, videos, imágenes o fallback premium
 * - Video/imagen si existen
 * - Fallback cinematic si no hay assets
 * - Filtros: blur, vignette, brightness, contrast
 */
export const BackgroundLayer: React.FC<BackgroundLayerProps> = ({
  frame,
  fps,
  config,
  durationFrames,
  fallbackColor = '#0a0a0a',
}) => {
  const isVideo = config?.type === 'video' && config?.path;
  const isImage = config?.type === 'image' && config?.path;
  const isFallback = !isVideo && !isImage;

  // Animación sutil de vignette y brightness
  const vignetteIntensity = interpolate(
    frame,
    [0, durationFrames / 2, durationFrames],
    [0.3, 0.25, 0.35],
    { easing: Easing.inOut(Easing.ease) }
  );

  const brightness = interpolate(
    frame,
    [0, durationFrames],
    [0, -0.05],
    { easing: Easing.inOut(Easing.ease) }
  );

  const blur = config?.blur ?? 0;
  const contrastVal = (config?.contrast ?? 0) + 0;
  const blurStr = blur > 0 ? `blur(${blur}px)` : 'none';
  const contrastedFilter =
    contrastVal !== 0
      ? `contrast(${1 + contrastVal})`
      : 'contrast(1)';
  const brightnessFilter =
    brightness !== 0
      ? `brightness(${1 + brightness})`
      : 'brightness(1)';

  return (
    <AbsoluteFill style={{ backgroundColor: config?.color || fallbackColor }}>
      {/* Asset si existe */}
      {isVideo && config?.path && (
        <Video
          src={config.path}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: config?.opacity ?? 1,
            filter: `${blurStr} ${contrastedFilter} ${brightnessFilter}`,
          }}
        />
      )}

      {isImage && config?.path && (
        <Img
          src={config.path}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: config?.opacity ?? 1,
            filter: `${blurStr} ${contrastedFilter} ${brightnessFilter}`,
          }}
        />
      )}

      {/* Fallback premium (dark cinematic) */}
      {isFallback && (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0f0f1e 50%, #000000 100%)',
            position: 'relative',
          }}
        >
          {/* Subtle noise texture */}
          <div
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' seed=\'2\' /%3E%3C/filter%3E%3Crect width=\'100\' height=\'100\' filter=\'url(%23noise)\' opacity=\'0.02\' fill=\'%23fff\'/%3E%3C/svg%3E")',
              opacity: 0.3,
              pointerEvents: 'none',
            }}
          />

          {/* Subtle light sweep animation */}
          <div
            style={{
              position: 'absolute',
              width: '150%',
              height: '150%',
              background:
                'linear-gradient(135deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0) 100%)',
              transform: `translateX(${interpolate(frame, [0, durationFrames], [-100, 100])}%)`,
              pointerEvents: 'none',
            }}
          />
        </div>
      )}

      {/* Vignette overlay */}
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 30%, rgba(0,0,0,${vignetteIntensity}))`,
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
