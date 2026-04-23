/**
 * render-executor.js
 * Ejecuta el comando FFmpeg con el filtergraph completo.
 * Maneja fallback a gradient si algo falla.
 */

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { FFMPEG_CONFIG } = require('./style-config');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Ejecuta el render principal con FFmpeg
 * Construye el comando FFmpeg completo y espera a que termine
 *
 * @param {Object} renderPlan - plan visual completo del render
 * @param {string} audioPath - ruta al audio procesado
 * @param {string} outputPath - ruta del video de salida
 * @param {Object} inputMap - { videoInputs: [paths], audioIdx, musicIdx, logoIdx }
 * @param {string} filterGraph - complexFilter de FFmpeg
 * @returns {Promise<{ success, outputPath, duration, size }>}
 */
async function executeRender(renderPlan, audioPath, outputPath, inputMap, filterGraph) {
  return new Promise((resolve, reject) => {
    const outputDir = path.dirname(outputPath);

    logger.info(`[render-executor] Starting FFmpeg render to ${outputPath}`);

    try {
      let cmd = ffmpeg();

      // Inputs de video (clips Pexels)
      if (inputMap.videoInputs && inputMap.videoInputs.length > 0) {
        for (const vidPath of inputMap.videoInputs) {
          if (fs.existsSync(vidPath)) {
            cmd = cmd.input(vidPath);
          }
        }
      }

      // Input de audio principal
      if (fs.existsSync(audioPath)) {
        cmd = cmd.input(audioPath);
      }

      // Input de música (opcional)
      if (inputMap.musicIdx !== null && inputMap.musicPath && fs.existsSync(inputMap.musicPath)) {
        cmd = cmd.input(inputMap.musicPath);
      }

      // Input de logo (opcional)
      if (inputMap.logoIdx !== null && inputMap.logoPath && fs.existsSync(inputMap.logoPath)) {
        cmd = cmd.input(inputMap.logoPath);
      }

      // Aplicar filtergraph
      if (filterGraph) {
        cmd = cmd.complexFilter(filterGraph);
      }

      // Opciones de salida
      cmd
        .videoCodec(FFMPEG_CONFIG.videoCodec)
        .outputOptions(`-preset ${FFMPEG_CONFIG.preset}`)
        .outputOptions(`-crf ${FFMPEG_CONFIG.crf}`)
        .outputOptions(`-pix_fmt yuv420p`)
        .outputOptions(`-r ${FFMPEG_CONFIG.fps}`)
        .audioCodec(FFMPEG_CONFIG.audioCodec)
        .audioBitrate(FFMPEG_CONFIG.audioBitrate)
        .audioFrequency(FFMPEG_CONFIG.audioSampleRate)
        .outputOptions(`-movflags +faststart`)
        .on('start', (cmdline) => {
          logger.debug(`[render-executor] FFmpeg command: ${cmdline.substring(0, 100)}...`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            logger.debug(`[render-executor] Progress: ${progress.percent.toFixed(0)}%`);
          }
        })
        .on('end', () => {
          logger.info(`[render-executor] FFmpeg completed`);

          // Validar output
          if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            const sizeGB = (stats.size / 1024 / 1024 / 1024).toFixed(2);
            logger.info(`[render-executor] Output: ${sizeGB}GB`);

            resolve({
              success: true,
              outputPath,
              size: stats.size,
              duration: renderPlan.totalDuration || 0,
            });
          } else {
            reject(new Error('Output file not created'));
          }
        })
        .on('error', (err) => {
          logger.error(`[render-executor] FFmpeg error: ${err.message}`);
          reject(err);
        })
        .save(outputPath);
    } catch (err) {
      logger.error(`[render-executor] Setup error: ${err.message}`);
      reject(err);
    }
  });
}

/**
 * Valida que el output es un archivo válido
 * @param {string} outputPath - ruta del video
 * @param {number} expectedDuration - duración esperada en segundos
 * @returns {Promise<{ valid: boolean, reason: string | null }>}
 */
async function validateOutput(outputPath, expectedDuration) {
  return new Promise((resolve) => {
    if (!fs.existsSync(outputPath)) {
      return resolve({ valid: false, reason: 'File not found' });
    }

    const stats = fs.statSync(outputPath);
    if (stats.size < 100 * 1024) {
      // Menos de 100KB es sospechoso
      return resolve({ valid: false, reason: 'File too small' });
    }

    // Usar ffprobe para validar duración
    ffmpeg.ffprobe(outputPath, (err, metadata) => {
      if (err) {
        return resolve({ valid: false, reason: `ffprobe error: ${err.message}` });
      }

      const duration = metadata.format.duration || 0;
      const diff = Math.abs(duration - expectedDuration);

      if (diff > 2) {
        // Duración muy diferente
        return resolve({ valid: false, reason: `Duration mismatch: expected ${expectedDuration}s, got ${duration.toFixed(1)}s` });
      }

      resolve({ valid: true, reason: null });
    });
  });
}

/**
 * Escribe metadatos del render en un archivo JSON
 * @param {string} outputDir - directorio de salida
 * @param {Object} renderPlan - plan del render
 * @param {Object} result - resultado del render
 */
function writeRenderMetadata(outputDir, renderPlan, result) {
  try {
    const metadata = {
      engine: 'shorts-renderer',
      timestamp: new Date().toISOString(),
      totalDuration: renderPlan.totalDuration || 0,
      segmentCount: renderPlan.segments ? renderPlan.segments.length : 0,
      success: result.success || false,
      outputSize: result.size || 0,
      colorGrade: renderPlan.colorGrade || 'dark_psychology',
      videoStyle: 'viral_psychology_short',
    };

    const metadataPath = path.join(outputDir, 'render-metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    logger.debug(`[render-executor] Metadata written: ${metadataPath}`);
  } catch (err) {
    logger.warn(`[render-executor] Could not write metadata: ${err.message}`);
  }
}

module.exports = {
  executeRender,
  validateOutput,
  writeRenderMetadata,
};
