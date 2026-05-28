import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { VideosiaShortComposition } from './compositions/VideosiaShortComposition';
import { VideoPlan, createMinimalVideoPlan } from './types/video-plan';

export const Root: React.FC = () => {
  const samplePlan = createMinimalVideoPlan({
    videoId: 'sample_remotion_test',
    durationSeconds: 30,
    audio: {
      voiceoverPath: '',
      musicPath: undefined,
    },
    avatar: {
      enabled: false,
      characterId: 'default_videosia',
      position: 'bottom-right',
      scale: 1.15,
      expressionMode: 'beat_based',
      lipSyncMode: 'word_boundaries_basic',
      enableMicroMovement: true,
      enableEyeMovement: false,
    },
    captions: [
      {
        start: 0.5,
        end: 2.5,
        text: 'Esto está cambiando',
        section: 'hook',
        emphasis: ['cambiando'],
        effect: 'bounce_in',
      },
      {
        start: 2.5,
        end: 5,
        text: 'internet completamente',
        section: 'claim',
        effect: 'fade_in',
      },
    ],
    scenes: [
      {
        id: 'scene_hook',
        start: 0,
        end: 3,
        type: 'hook',
        avatarExpression: 'surprised',
        visualIntent: 'stop_scroll',
      },
    ],
  });

  return (
    <Composition
      id="VideosiaShort"
      component={VideosiaShortComposition}
      durationInFrames={samplePlan.durationSeconds * 30}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        videoPlan: samplePlan,
      }}
    />
  );
};

registerRoot(Root);
