import React from 'react';
import {
  AbsoluteFill,
  Img,
  useCurrentFrame,
  interpolate,
  Easing,
  spring,
  useVideoConfig,
} from 'remotion';
import { AvatarConfig } from '../types/video-plan';

interface AvatarLayerProps {
  config: AvatarConfig;
  currentExpression?: string;
  emphasis?: boolean;
  frame: number;
  durationFrames: number;
}

const AVATAR_ASSET_PATHS = {
  neutral: '/assets/avatar/avatar_idle.png',
  speaking: '/assets/avatar/avatar_talk_1.png',
  emphasis: '/assets/avatar/avatar_talk_2.png',
  surprised: '/assets/avatar/avatar_surprised.png',
  serious: '/assets/avatar/avatar_pointing.png',
  thinking: '/assets/avatar/avatar_idle.png',
  excited: '/assets/avatar/avatar_talk_2.png',
};

/**
 * AvatarLayer: Renderiza el personaje
 * - Cambio de expresiones según beat/frame
 * - Micro-movimientos (breathing, head tilt)
 * - Escala y posicionamiento configurable
 * - Fallback placeholder visual si no hay assets
 */
export const AvatarLayer: React.FC<AvatarLayerProps> = ({
  config,
  currentExpression = 'speaking',
  emphasis = false,
  frame,
  durationFrames,
}) => {
  const videoConfig = useVideoConfig();

  if (!config.enabled) {
    return null;
  }

  // Asset path (si existe, sino placeholder)
  const assetPath =
    config.assetPaths?.[currentExpression as keyof typeof config.assetPaths] ||
    AVATAR_ASSET_PATHS[currentExpression as keyof typeof AVATAR_ASSET_PATHS] ||
    AVATAR_ASSET_PATHS['speaking'];

  // Micro-movimientos (si está habilitado)
  const breathingIntensity = config.enableMicroMovement ? 1.0 : 0;
  const breathingScale = interpolate(
    frame % 30,
    [0, 15, 30],
    [1.0, 1.02, 1.0],
    { easing: Easing.inOut(Easing.ease) }
  );

  const headTiltRotate = config.enableMicroMovement
    ? interpolate(
        frame % 60,
        [0, 30, 60],
        [-0.5, 0, -0.5],
        { easing: Easing.inOut(Easing.ease) }
      )
    : 0;

  // Bounce si está en emphasis
  const emphasisBounce = emphasis
    ? spring({
        frame: frame % 20,
        fps: videoConfig.fps,
        config: { damping: 8, mass: 1, stiffness: 200 },
      })
    : 1.0;

  const emphasisScale = interpolate(
    emphasisBounce,
    [0, 1],
    [1.15, 1.0],
    { easing: Easing.out(Easing.ease) }
  );

  // Posicionamiento según config
  const getPosition = () => {
    const baseScale = config.scale;
    const width = 400 * baseScale; // Avatar ancho estimado
    const height = 600 * baseScale; // Avatar alto estimado
    const margin = 20;

    switch (config.position) {
      case 'bottom-right':
        return {
          right: margin,
          bottom: margin,
        };
      case 'bottom-center':
        return {
          left: '50%',
          bottom: margin,
          transform: 'translateX(-50%)',
        };
      case 'bottom-left':
        return {
          left: margin,
          bottom: margin,
        };
      case 'center-right':
        return {
          right: margin,
          top: '50%',
          transform: 'translateY(-50%)',
        };
      case 'full':
        return {
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
        };
      default:
        return {
          right: margin,
          bottom: margin,
        };
    }
  };

  const position = getPosition();
  const scale = config.scale * (breathingScale * (1 - breathingIntensity * 0.02) + breathingIntensity * 0.02) * emphasisScale;

  // Placeholder visual si no hay asset o si es una URL que no se puede cargar en render context
  // En contexto de render (CLI), las URLs /assets/... no son accesibles
  const showPlaceholder = !assetPath || assetPath.includes('undefined') || assetPath.startsWith('/');

  return (
    <div
      style={{
        position: 'absolute',
        ...position,
        zIndex: 10,
        transform: `scale(${scale}) rotate(${headTiltRotate}deg)`,
        transition: 'none', // frame-perfect, sin transitions
        transformOrigin: 'bottom center',
      }}
    >
      {!showPlaceholder && (
        <Img
          src={assetPath}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            filter: emphasis ? 'drop-shadow(0 0 10px rgba(255,255,255,0.3))' : 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))',
          }}
        />
      )}

      {showPlaceholder && (
        <div
          style={{
            width: 120,
            height: 180,
            background: 'linear-gradient(135deg, #4a5568, #2d3748)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #5a6c7d',
            fontSize: '12px',
            color: '#cbd5e0',
            textAlign: 'center',
            padding: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
          }}
        >
          Avatar
          <br />
          {currentExpression}
        </div>
      )}

      {/* Glow effect si emphasis */}
      {emphasis && (
        <div
          style={{
            position: 'absolute',
            inset: -20,
            border: '3px solid rgba(255,255,255,0.2)',
            borderRadius: '8px',
            pointerEvents: 'none',
            animation: 'pulse 0.5s ease-out',
          }}
        />
      )}
    </div>
  );
};
