/**
 * subtitle-builder.js
 * Wrapper de subtitle-styler.js que reutiliza su lógica existente.
 * No duplica código, solo usa las funciones ya probadas.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Importar funciones existentes de subtitle-styler
let buildStyledSubtitleBlocks;
let buildStyledASSFile;
let buildSRTContent;

try {
  const subtitleStyler = require('../subtitle-styler');
  buildStyledSubtitleBlocks = subtitleStyler.buildStyledSubtitleBlocks;
  buildStyledASSFile = subtitleStyler.buildStyledASSFile;
  buildSRTContent = subtitleStyler.buildSRTContent;
} catch (err) {
  logger.error(`[subtitle-builder] Failed to load subtitle-styler: ${err.message}`);
  throw err;
}

/**
 * Construye subtítulos usando la lógica existente de subtitle-styler.js
 * Retorna los bloques y la ruta del archivo ASS generado.
 *
 * @param {Object} script - guión completo con segmentos
 * @param {number} realDuration - duración real del audio en segundos
 * @param {Array} wordBoundaries - timestamps de palabras (Edge TTS) o []
 * @param {Object} sectionDurations - información de secciones (Kokoro) o null
 * @returns {Promise<{ blocks, assFilePath, srtFilePath, mode }>}
 */
async function buildSubtitles(script, realDuration, wordBoundaries = [], sectionDurations = null) {
  try {
    // Usar la función existente de subtitle-styler
    const blocks = buildStyledSubtitleBlocks(script, realDuration, wordBoundaries, sectionDurations);

    logger.info(`[subtitle-builder] Generated ${blocks.length} subtitle blocks`);

    return {
      blocks,
      assFilePath: null, // Se genera en los pasos posteriores si es necesario
      srtFilePath: null,
      mode: wordBoundaries?.length > 4 ? 'exact' : sectionDurations ? 'segmented' : 'proportional',
    };
  } catch (err) {
    logger.error(`[subtitle-builder] Error building subtitles: ${err.message}`);
    throw err;
  }
}

/**
 * Genera el archivo ASS con colores correctos
 * Delega a subtitle-styler.js pero reutiliza el resultado
 *
 * @param {Array} blocks - bloques de subtítulos
 * @param {string} outputDir - directorio de salida
 * @param {number} yPos - posición Y en pantalla (píxeles)
 * @returns {Promise<string>} - ruta del archivo .ass generado
 */
async function writeASSFile(blocks, outputDir, yPos = 1500) {
  try {
    const assPath = path.join(outputDir, 'subtitles.ass');

    // Usar la función existente de subtitle-styler
    buildStyledASSFile(blocks, assPath, yPos);

    logger.info(`[subtitle-builder] ASS file written: ${assPath}`);

    return assPath;
  } catch (err) {
    logger.error(`[subtitle-builder] Error writing ASS: ${err.message}`);
    throw err;
  }
}

/**
 * Genera el archivo SRT (backup simple)
 * @param {Array} blocks - bloques de subtítulos
 * @param {string} outputDir - directorio de salida
 * @returns {Promise<string>} - ruta del archivo .srt generado
 */
async function writeSRTFile(blocks, outputDir) {
  try {
    const srtPath = path.join(outputDir, 'subtitles.srt');
    const srtContent = buildSRTContent(blocks);

    fs.writeFileSync(srtPath, srtContent, 'utf8');

    logger.info(`[subtitle-builder] SRT file written: ${srtPath}`);

    return srtPath;
  } catch (err) {
    logger.error(`[subtitle-builder] Error writing SRT: ${err.message}`);
    throw err;
  }
}

module.exports = {
  buildSubtitles,
  writeASSFile,
  writeSRTFile,
};
