import React from 'react';
import {
  Composition,
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { VideoPlan } from '../types/video-plan';
import { BackgroundLayer } from '../components/BackgroundLayer';
import { AvatarLayer } from '../components/AvatarLayer';
import { CaptionsLayer } from '../components/CaptionsLayer';
import { OverlayLayer } from '../components/OverlayLayer';
import { AudioLayer } from '../components/AudioLayer';
import { FallbackContent } from '../components/FallbackContent';
import { getCurrentExpression, generateExpressionTimeline } from '../utils/avatar';

interface VideosiaShortCompositionProps {
  videoPlan?: VideoPlan;
}

/**
 * VideosiaShortComposition: Composición principal de Remotion
 *
 * Estructura de capas (bottom to top):
 * 1. BackgroundLayer (fondos, video, fallback)
 * 2. AvatarLayer (personaje)
 * 3. CaptionsLayer (subtítulos cinéticos)
 * 4. OverlayLayer (progress bar, indicadores)
 * 5. AudioLayer (voiceover + música)
 */
export const VideosiaShortComposition: React.FC<VideosiaShortCompositionProps> = ({
  videoPlan = {
    videoId: 'default',
    durationSeconds: 30,
    fps: 30,
    format: 'shorts_9_16',
    template: 'avatar_explainer',
    styleProfile: {
      mood: 'cinematic',
      energy: 'high',
      visualDensity: 'medium-high',
      colorMode: 'dark-premium',
    },
    audio: { voiceoverPath: '' },
    avatar: {
      enabled: false,
      characterId: 'default',
      position: 'bottom-right',
      scale: 1,
      expressionMode: 'beat_based',
      lipSyncMode: 'none',
      enableMicroMovement: false,
      enableEyeMovement: false,
    },
    scenes: [],
    captions: [],
  },
}) => {
  const frame = useCurrentFrame();
  const videoConfig = useVideoConfig();
  const durationFrames = videoPlan.durationSeconds * videoConfig.fps;

  // Detectar si hay contenido visual (captions o scenes)
  const hasVisibleContent = (videoPlan.captions?.length ?? 0) > 0 || (videoPlan.scenes?.length ?? 0) > 0;

  // Generar timeline de expresiones del avatar
  const expressionTimeline = generateExpressionTimeline(videoPlan.scenes);
  const currentExpression = getCurrentExpression(frame, videoConfig.fps, expressionTimeline);

  // Determinar si hay énfasis en este frame
  const currentTime = frame / videoConfig.fps;
  const currentCaption = videoPlan.captions.find(
    (cap) => currentTime >= cap.start && currentTime < cap.end
  );
  const hasEmphasis = (currentCaption?.emphasis || []).length > 0;

  // Gradiente visible cuando no hay contenido
  const bgGradient = hasVisibleContent
    ? 'linear-gradient(135deg, #000000 0%, #0a0a0a 100%)'
    : 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)';

  return (
    <>
      {/* Composición Remotion */}
      <AbsoluteFill style={{ backgroundImage: bgGradient }}>
        {/* Layer 1: Background */}
        <BackgroundLayer
          frame={frame}
          fps={videoConfig.fps}
          config={videoPlan.scenes[0]?.background}
          durationFrames={durationFrames}
          fallbackColor={hasVisibleContent ? '#0a0a0a' : '#16213e'}
        />

        {/* Layer 2: Fallback Content (si no hay captions/scenes) */}
        {!hasVisibleContent && (
          <FallbackContent
            hook={videoPlan.metadata?.hook || 'VIDEOSIA'}
            cta={videoPlan.metadata?.cta || 'Learn More'}
            subtitle="Visual Engine 2.0"
            durationSeconds={videoPlan.durationSeconds}
          />
        )}

        {/* Layer 3: Avatar */}
        {videoPlan.avatar.enabled && (
          <AvatarLayer
            config={videoPlan.avatar}
            currentExpression={currentExpression}
            emphasis={hasEmphasis}
            frame={frame}
            durationFrames={durationFrames}
          />
        )}

        {/* Layer 4: Captions (solo si hay contenido) */}
        {hasVisibleContent && (
          <CaptionsLayer
            captions={videoPlan.captions}
            frame={frame}
            fps={videoConfig.fps}
            durationFrames={durationFrames}
          />
        )}

        {/* Layer 5: Overlays (solo si hay contenido) */}
        {hasVisibleContent && (
          <OverlayLayer
            scene={videoPlan.scenes.find(
              (s) => currentTime >= s.start && currentTime < s.end
            )}
            frame={frame}
            fps={videoConfig.fps}
            durationFrames={durationFrames}
          />
        )}
      </AbsoluteFill>

      {/* Audio (no es visible pero sincroniza) */}
      <AudioLayer config={videoPlan.audio} />
    </>
  );
};

/**
 * Registrar composición en Remotion
 * Se exporta en Root.tsx
 */
export function registerVideosiaComposition() {
  return (
    <Composition
      id="VideosiaShort"
      component={VideosiaShortComposition}
      durationInFrames={900} // default 30s @ 30fps
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        videoPlan: {
          videoId: 'sample_composition',
          durationSeconds: 30,
          fps: 30,
          format: 'shorts_9_16',
          template: 'avatar_explainer',
          styleProfile: {
            mood: 'cinematic',
            energy: 'high',
            visualDensity: 'medium-high',
            colorMode: 'dark-premium',
          },
          audio: {
            voiceoverPath: '/sample-audio.mp3',
          },
          avatar: {
            enabled: true,
            characterId: 'default_videosia',
            position: 'bottom-right',
            scale: 1.15,
            expressionMode: 'beat_based',
            lipSyncMode: 'word_boundaries_basic',
            enableMicroMovement: true,
            enableEyeMovement: false,
          },
          scenes: [],
          captions: [],
        } as VideoPlan,
      }}
    />
  );
}
