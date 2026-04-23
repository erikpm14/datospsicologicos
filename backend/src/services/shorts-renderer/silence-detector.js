/**
 * silence-detector.js
 * Detecta gaps de audio (silencios) usando FFmpeg silencedetect.
 * Los gaps ≥400ms son puntos naturales de corte entre clips.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const { SILENCE_DETECTION_CONFIG } = require('./style-config');
const logger = require('../utils/logger');

/**
 * Ejecuta FFmpeg silencedetect y extrae los timestamps de gaps
 *
 * @param {string} audioPath - ruta al archivo de audio
 * @param {number} minGapMs - umbral mínimo de gap en milisegundos (default 400)
 * @returns {Promise<Array<number>>} - array de timestamps en segundos
 */
async function detectSilenceGaps(audioPath, minGapMs = SILENCE_DETECTION_CONFIG.minGapMs) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(audioPath)) {
      return reject(new Error(`Audio file not found: ${audioPath}`));
    }

    logger.info(`[silence-detector] Analyzing audio for gaps ≥${minGapMs}ms`);

    const minDuration = (minGapMs / 1000).toFixed(2);

    // FFmpeg silencedetect: encuentra períodos de silencio
    // noise=-30dB: threshold de silencio
    // duration=X: duración mínima del silencio para reportar
    const cmd = spawn('ffmpeg', [
      '-i', audioPath,
      '-af', `silencedetect=noise=${SILENCE_DETECTION_CONFIG.noiseThreshold}:duration=${minDuration}`,
      '-f', 'null',
      '-',
    ]);

    let stderr = '';

    cmd.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    cmd.on('close', (code) => {
      if (code !== 0) {
        logger.warn(`[silence-detector] FFmpeg exited with code ${code}`);
        return resolve([]); // fallback: sin cortes detectados
      }

      // Parsear stderr buscando "silence_end: X.XXX"
      const silenceEndPattern = /silence_end:\s*([\d.]+)/g;
      const gaps = [];
      let match;

      while ((match = silenceEndPattern.exec(stderr)) !== null) {
        const timestamp = parseFloat(match[1]);
        if (!isNaN(timestamp) && timestamp > 0) {
          gaps.push(timestamp);
        }
      }

      logger.info(`[silence-detector] Found ${gaps.length} gaps ≥${minGapMs}ms`);

      resolve(gaps);
    });

    cmd.on('error', (err) => {
      logger.warn(`[silence-detector] FFmpeg error: ${err.message}`);
      resolve([]); // fallback: sin cortes detectados
    });
  });
}

/**
 * Filtra los gaps para quedarse solo con los que caen dentro de un rango
 * @param {Array<number>} allGaps - todos los gaps detectados
 * @param {number} segmentStart - tiempo de inicio del segmento (segundos)
 * @param {number} segmentEnd - tiempo de final del segmento (segundos)
 * @returns {Array<number>} - gaps dentro del rango
 */
function filterGapsForSegment(allGaps, segmentStart, segmentEnd) {
  return allGaps.filter(gap => gap >= segmentStart && gap <= segmentEnd);
}

/**
 * Calcula puntos de corte preferentes dentro de un segmento
 * Retorna gaps reales si existen, o un corte por defecto a mitad de segmento
 *
 * @param {Array<number>} gapsInSegment - gaps dentro del segmento
 * @param {number} segmentStart - tiempo de inicio
 * @param {number} segmentEnd - tiempo de final
 * @returns {number} - timestamp preferente de corte
 */
function getPreferredCutPoint(gapsInSegment, segmentStart, segmentEnd) {
  if (gapsInSegment.length > 0) {
    // Usar el primer gap (más natural)
    return gapsInSegment[0];
  }

  // Fallback: corte a mitad del segmento si no hay gaps
  return (segmentStart + segmentEnd) / 2;
}

module.exports = {
  detectSilenceGaps,
  filterGapsForSegment,
  getPreferredCutPoint,
};
