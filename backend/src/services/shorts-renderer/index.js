/**
 * shorts-renderer/index.js
 * Punto de entrada del módulo shorts-renderer.
 * Misma firma que renderVideo() — compatible con video-processor.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { orchestrateRender } = require('./render-orchestrator');

/**
 * Renderiza un vídeo con el motor mejorado shorts-renderer.
 * Misma firma que video-renderer.renderVideo() para compatibilidad.
 *
 * @param {Object} options
 *   - script: Object — guión con segmentos (hook, open_loop, etc.)
 *   - audioPath: string — ruta al audio procesado
 *   - audioDuration: number — estimación (se sobreescribe con ffprobe)
 *   - outputPath: string — ruta del .mp4 de salida
 *   - themeId: string — ID del tema visual
 *   - wordBoundaries: Array — timestamps de palabras (Edge TTS) o []
 *   - sectionDurations: Object — info de secciones (Kokoro) o null
 *   - bgStyle: string — estilo de fondo ('satisfying', etc.) o null
 *
 * @returns {Promise<string>} — outputPath del video generado
 */
async function renderVideo(options = {}) {
  const { script, audioPath, outputPath, themeId } = options;

  if (!script) throw new Error('script is required');
  if (!audioPath || !fs.existsSync(audioPath)) throw new Error(`audioPath not found: ${audioPath}`);
  if (!outputPath) throw new Error('outputPath is required');

  const outputDir = path.dirname(outputPath);

  try {
    // Llamar al orquestador que coordina todos los pasos
    const result = await orchestrateRender({
      ...options,
      outputPath,
    });

    if (!result.success) {
      throw new Error('Render failed');
    }

    // Retornar la ruta del output (compatible con video-processor.js)
    return result.outputPath;
  } catch (err) {
    logger.error(`[shorts-renderer] Render failed: ${err.message}`);
    throw err;
  }
}

/**
 * Obtiene la duración real de un audio (reutiliza de orchestrator)
 * @param {string} audioPath - ruta al audio
 * @returns {Promise<number>} - duración en segundos
 */
async function getRealAudioDuration(audioPath) {
  const { getRealAudioDuration: getRealDuration } = require('./render-orchestrator');
  return getRealDuration(audioPath);
}

module.exports = {
  renderVideo,
  getRealAudioDuration,
};
