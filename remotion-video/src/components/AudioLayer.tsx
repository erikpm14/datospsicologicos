import React from 'react';
import { Audio } from 'remotion';
import { AudioConfig } from '../types/video-plan';

interface AudioLayerProps {
  config: AudioConfig;
}

/**
 * AudioLayer: Maneja sincronización de audio
 * - Voiceover principal
 * - Música de fondo (si existe)
 * - Volúmenes configurables
 */
export const AudioLayer: React.FC<AudioLayerProps> = ({ config }) => {
  return (
    <>
      {/* Voiceover principal */}
      {config.voiceoverPath && (
        <Audio
          src={config.voiceoverPath}
          volume={config.voiceoverVolume ?? 0.95}
        />
      )}

      {/* Música de fondo (si existe) */}
      {config.musicPath && (
        <Audio
          src={config.musicPath}
          volume={config.musicVolume ?? 0.15}
        />
      )}
    </>
  );
};
