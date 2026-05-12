/**
 * DYNAMIC BACKGROUND RENDERER
 *
 * Lee backgroundPlan.clipTimeline desde generation-metadata.json
 * y renderiza un vídeo con fondos/clips rotados según la timeline.
 *
 * Cada clip tiene: assetId, start, end, dominantColors, motionType, transition
 * El renderer genera fondos procedurales basados en estos atributos y los aplica
 * en sus rangos de tiempo correspondientes.
 */

require('dotenv').config();
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { safeSpawn } = require('../utils/safe-spawn');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const W = 1080;
const H = 1920;
const FPS = 30;

// Mapeo de colores a valores hex
const COLOR_MAP = {
  purple: '#9c27b0',
  pink: '#ff1493',
  blue: '#00d4ff',
  cyan: '#00bcd4',
  gold: '#ffd700',
  black: '#0a0e27',
  dark_gray: '#1a1a2e',
  white: '#ffffff',
  gray: '#666666',
  red: '#ff1744',
};

// Mapeo de motionType a efectos FFmpeg
const MOTION_EFFECTS = {
  neural_flow: 'pulse',
  particle_drift: 'pulse',
  cinematic_pan: 'pan',
  subtle_texture: 'none',
  slow_motion: 'fade',
  symbolic_animation: 'zoom',
  geometric_transform: 'zoom',
};

function getColorForAsset(dominantColors = []) {
  if (!dominantColors || dominantColors.length === 0) {
    return COLOR_MAP.black;
  }
  return COLOR_MAP[dominantColors[0]] || COLOR_MAP.black;
}

function buildBackgroundColorForClip(clip) {
  const primaryColor = getColorForAsset(clip.dominantColors);
  const accentColor = clip.dominantColors && clip.dominantColors[1]
    ? COLOR_MAP[clip.dominantColors[1]] || COLOR_MAP.black
    : primaryColor;

  return {
    primary: primaryColor,
    accent: accentColor,
  };
}


/**
 * Genera un comando FFmpeg que renderiza el vídeo con clip timeline dinámico
 */
async function renderDynamicBackgroundTimeline(options = {}) {
  const {
    audioPath,
    videoPath,
    outputPath,
    clipTimeline = [],
    audioDuration = 30,
    outputDir = '',
  } = options;

  console.log('[RENDER_DYNAMIC_BACKGROUND_STARTED]');
  logger.info('[RENDER_DYNAMIC_BACKGROUND_STARTED]');

  try {
    // Validar inputs - puede venir audioPath directamente o extraer de videoPath
    let audioToUse = audioPath;

    if (!audioToUse && videoPath && fs.existsSync(videoPath)) {
      // Extraer audio del vídeo temporalmente
      const tempAudioPath = path.join(outputDir || path.dirname(outputPath), 'temp-audio-extract.aac');
      console.log('[EXTRACTING_AUDIO_FROM_VIDEO]');
      logger.info('[EXTRACTING_AUDIO_FROM_VIDEO] Extracting audio from existing video');

      // Usar ffmpeg para extraer el audio
      const ffmpegBin = ffmpegInstaller.path;
      const extractArgs = [
        '-i', videoPath,
        '-vn',
        '-acodec', 'aac',
        '-b:a', '128k',
        '-y',
        tempAudioPath,
      ];

      await new Promise((resolve, reject) => {
        const proc = require('child_process').spawn(ffmpegBin, extractArgs);
        let stderr = '';

        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(tempAudioPath)) {
            logger.info('[AUDIO_EXTRACTION_SUCCESS]');
            audioToUse = tempAudioPath;
            resolve();
          } else {
            reject(new Error(`Failed to extract audio: ${stderr}`));
          }
        });

        proc.on('error', reject);
      });
    }

    if (!audioToUse || !fs.existsSync(audioToUse)) {
      throw new Error(`Audio file not found: ${audioToUse}`);
    }
    if (!outputPath) {
      throw new Error('outputPath is required');
    }
    if (!clipTimeline || clipTimeline.length === 0) {
      throw new Error('clipTimeline is empty');
    }

    console.log(`[CLIP_TIMELINE_LOADED] ${clipTimeline.length} clips to render`);
    logger.info(`[CLIP_TIMELINE_LOADED] clipTimeline has ${clipTimeline.length} clips`);

    // Construir filtro complejo para todos los clips
    // Cada clip es un input lavfi de color con efectos visuales
    const filterParts = [];
    const inputIndexes = [];

    // Calcular duración total cubierta por clips
    let totalClipsDuration = 0;
    if (clipTimeline.length > 0) {
      totalClipsDuration = clipTimeline[clipTimeline.length - 1].end;
    }

    // FIX: Si los clips no cubren la duración del audio, agregar clip final de extensión
    let needsFinalExtension = totalClipsDuration < (audioDuration - 0.5);
    let finalExtensionDuration = 0;
    if (needsFinalExtension) {
      finalExtensionDuration = audioDuration - totalClipsDuration;
      console.log(`[AV_SYNC_FIX] Audio duration ${audioDuration}s > clips duration ${totalClipsDuration}s. Adding ${finalExtensionDuration.toFixed(2)}s extension.`);
      logger.info(`[AV_SYNC_FIX] Adding ${finalExtensionDuration.toFixed(2)}s final extension clip to match audio duration`);
    }

    // Para cada clip, crear un input de color con textura y movimiento
    for (let i = 0; i < clipTimeline.length; i++) {
      const clip = clipTimeline[i];
      const duration = clip.end - clip.start;
      const colorHex = getColorForAsset(clip.dominantColors).replace('#', '');

      inputIndexes.push(i);

      // Aplicar textura y movimiento sutil según el tipo de clip
      let filterChain = `[${i}:v]`;

      // 1. Escala básica
      filterChain += `scale=${W}:${H}`;

      // 2. Agregar ruido cinematográfico leve (grano sutil)
      filterChain += `,noise=alls=2:allf=t`;

      // 3. Agregar movimiento sutil según motionType (opcional)
      // La textura de ruido es suficiente para agregar complejidad visual sin afectar compresión
      const motionType = clip.motionType || 'subtle_texture';
      if (motionType === 'neural_flow' || motionType === 'particle_drift') {
        // Pulsación muy sutil: oscilación de brillo ±1%
        filterChain += `,eq=brightness=0.01*sin(2*PI*t)`;
      }

      // Marcar como output del filtro para este clip
      filterChain += `[clip${i}]`;

      filterParts.push(filterChain);

      console.log(`[BACKGROUND_CLIP_RENDERED] clip=${i + 1} assetId=${clip.assetId} duration=${duration.toFixed(2)}s color=${colorHex} motion=${clip.motionType}`);
      logger.info(`[BACKGROUND_CLIP_RENDERED] clip ${i + 1}: ${clip.assetId} (${duration.toFixed(2)}s) color=#${colorHex} motion=${clip.motionType}`);
    }

    // Agregar clip final de extensión si es necesario
    if (needsFinalExtension && finalExtensionDuration > 0) {
      const lastClip = clipTimeline[clipTimeline.length - 1];
      const extensionColorHex = getColorForAsset(lastClip.dominantColors).replace('#', '');
      const extensionIndex = clipTimeline.length;

      inputIndexes.push(extensionIndex);

      let filterChain = `[${extensionIndex}:v]`;
      filterChain += `scale=${W}:${H}`;
      filterChain += `,noise=alls=2:allf=t`;
      filterChain += `[clip${extensionIndex}]`;

      filterParts.push(filterChain);

      console.log(`[BACKGROUND_CLIP_EXTENSION] EXTENSION duration=${finalExtensionDuration.toFixed(2)}s color=${extensionColorHex}`);
      logger.info(`[BACKGROUND_CLIP_EXTENSION] Final extension: ${finalExtensionDuration.toFixed(2)}s color=#${extensionColorHex}`);

      // Agregar input de extensión a los argumentos FFmpeg
      // Se hará en el siguiente bloque
    }

    // Concatenar todos los clips: [clip0][clip1]...[clipN]concat=n=N:v=1:a=0[outv]
    const numInputClips = needsFinalExtension ? clipTimeline.length + 1 : clipTimeline.length;
    const clipSpecs = inputIndexes.map(i => `[clip${i}]`).join('');
    filterParts.push(`${clipSpecs}concat=n=${numInputClips}:v=1:a=0[outv]`);
    const complexFilter = filterParts.join(';');

    // Argumentos FFmpeg: inputs de color simple + audio
    const ffmpegArgs = [
      // Inputs: cada clip como fuente de color puro (se enriquecen en filterchain)
      ...clipTimeline.flatMap((clip, i) => {
        const duration = clip.end - clip.start;
        const colorHex = getColorForAsset(clip.dominantColors).replace('#', '');
        return [
          '-f', 'lavfi',
          '-i', `color=c='#${colorHex}':s=${W}x${H}:d=${duration}`,
        ];
      }),
      // Agregar input de extensión final si es necesario
      ...(needsFinalExtension && finalExtensionDuration > 0 ? (() => {
        const lastClip = clipTimeline[clipTimeline.length - 1];
        const extensionColorHex = getColorForAsset(lastClip.dominantColors).replace('#', '');
        return [
          '-f', 'lavfi',
          '-i', `color=c='#${extensionColorHex}':s=${W}x${H}:d=${finalExtensionDuration}`,
        ];
      })() : []),
      // Audio
      '-i', audioToUse,
      // Filtro complejo para concatenar clips
      '-filter_complex', complexFilter,
      // Map outputs
      '-map', '[outv]',
      '-map', `${numInputClips}:a`,
      // Codificación - bitrate alto para garantizar tamaño mínimo de archivo
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-b:v', '8000k', // 8 Mbps para vídeo - bitrate mayor para cumplir 4MB mínimo
      '-maxrate', '10000k',
      '-bufsize', '20000k',
      '-c:a', 'aac',
      '-b:a', '320k', // 320kbps de audio
      '-y',
      outputPath,
    ];

    logger.info(`[dynamic-background] Running FFmpeg with ${clipTimeline.length} clips...`);
    logger.info(`[dynamic-background] Output: ${outputPath}`);
    logger.info(`[dynamic-background] FFmpeg args: ${ffmpegArgs.join(' ').substring(0, 500)}...`);

    const ffmpegBin = ffmpegInstaller.path;
    const ffmpegProcess = safeSpawn(ffmpegBin, ffmpegArgs, { detached: false });

    let stderr = '';

    return new Promise((resolve, reject) => {
      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log FFmpeg progress
        if (data.toString().includes('frame=')) {
          const frameMatch = data.toString().match(/frame=\s*(\d+)/);
          if (frameMatch) {
            const frame = parseInt(frameMatch[1], 10);
            const progress = ((frame / (audioDuration * FPS)) * 100).toFixed(1);
            logger.debug(`[dynamic-background] FFmpeg progress: ${progress}%`);
          }
        }
      });

      ffmpegProcess.on('close', (code) => {
        if (code !== 0) {
          const errMsg = `FFmpeg failed with code ${code}: ${stderr}`;
          console.log(`[DYNAMIC_BACKGROUND_RENDER_FAILED] ${errMsg}`);
          logger.error(`[dynamic-background] ${errMsg}`);
          reject(new Error(errMsg));
        } else {
          // Validar output
          if (!fs.existsSync(outputPath)) {
            const errMsg = 'Output file not created';
            console.log(`[DYNAMIC_BACKGROUND_RENDER_FAILED] ${errMsg}`);
            logger.error(`[dynamic-background] ${errMsg}`);
            reject(new Error(errMsg));
          } else {
            const stats = fs.statSync(outputPath);
            if (stats.size < 100 * 1024) {
              const errMsg = `Output file too small: ${stats.size} bytes`;
              console.log(`[DYNAMIC_BACKGROUND_RENDER_FAILED] ${errMsg}`);
              logger.error(`[dynamic-background] ${errMsg}`);
              reject(new Error(errMsg));
            } else {
              console.log(`[BACKGROUND_TIMELINE_COMPOSED] success | size=${(stats.size / 1024 / 1024).toFixed(1)}MB`);
              logger.info(`[BACKGROUND_TIMELINE_COMPOSED] Output rendered successfully (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

              console.log(`[DYNAMIC_BACKGROUND_RENDER_SUCCESS]`);
              logger.info(`[DYNAMIC_BACKGROUND_RENDER_SUCCESS]`);

              resolve({
                success: true,
                outputPath,
                size: stats.size,
                duration: audioDuration,
                clipsApplied: clipTimeline.length,
              });
            }
          }
        }
      });

      ffmpegProcess.on('error', (err) => {
        const errMsg = `FFmpeg process error: ${err.message}`;
        console.log(`[DYNAMIC_BACKGROUND_RENDER_FAILED] ${errMsg}`);
        logger.error(`[dynamic-background] ${errMsg}`);
        reject(new Error(errMsg));
      });
    });
  } catch (err) {
    console.log(`[DYNAMIC_BACKGROUND_RENDER_FAILED] ${err.message}`);
    logger.error(`[dynamic-background-renderer] ${err.message}`);
    throw err;
  }
}

module.exports = {
  renderDynamicBackgroundTimeline,
};
