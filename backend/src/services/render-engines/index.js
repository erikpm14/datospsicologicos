/**
 * render-engines/index.js
 * Router que elige qué motor de renderizado usar.
 *
 * VIDEO_RENDER_ENGINE=current   → motor actual (FFmpeg + Pexels)
 * VIDEO_RENDER_ENGINE=video_use → motor alternativo (video-use Python)
 *
 * Si video_use falla, fallback automático a motor actual.
 */

require('dotenv').config();
const logger = require('../utils/logger');
const { renderVideo: renderVideoCurrent } = require('../video-renderer');
const { renderVideo: renderVideoShorts } = require('../shorts-renderer');
const { renderWithVideoUse, checkVideoUseAvailability } = require('./video-use-renderer');

const RENDER_ENGINE = process.env.VIDEO_RENDER_ENGINE || 'current';
const VIDEO_USE_ENABLED = process.env.VIDEO_USE_ENABLED === 'true';
const VIDEO_USE_DRY_RUN = process.env.VIDEO_USE_DRY_RUN === 'true';
const VIDEO_RENDER_VALIDATE = process.env.VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH === 'true';

let videoUseHealthy = null; // cached health status

/**
 * Renderiza vídeo con el motor configurado
 * VIDEO_RENDER_ENGINE=current    → motor actual (FFmpeg + Pexels)
 * VIDEO_RENDER_ENGINE=shorts     → shorts-renderer mejorado
 * VIDEO_RENDER_ENGINE=video_use  → video-use Python (alternativo)
 */
async function renderVideoWithRouter(options = {}) {
  // Shorts renderer (nuevo motor mejorado)
  if (RENDER_ENGINE === 'shorts') {
    logger.info(`[render-router] Using motor: shorts (improved render)`);
    try {
      return await renderVideoShorts(options);
    } catch (err) {
      logger.warn(`[render-router] shorts-renderer failed: ${err.message}, falling back to current`);
      return await renderVideoCurrent(options);
    }
  }

  // Video-use (alternativo Python)
  const isVideoUseRequested = RENDER_ENGINE === 'video_use' && VIDEO_USE_ENABLED;
  if (isVideoUseRequested) {
    logger.info(`[render-router] Using motor: video_use (dry_run=${VIDEO_USE_DRY_RUN})`);

    try {
      // Health check (cached)
      if (videoUseHealthy === null) {
        videoUseHealthy = await checkVideoUseAvailability();
        logger.info(`[render-router] video-use health check: ${videoUseHealthy ? '✓' : '✗'}`);
      }

      if (!videoUseHealthy) {
        logger.warn(`[render-router] video-use not available, falling back to current motor`);
        return await renderVideoCurrent(options);
      }

      // Ejecutar video-use
      const result = await renderWithVideoUse(options);

      // Si dry_run está activo, marcar en metadata
      if (VIDEO_USE_DRY_RUN) {
        const outputDir = require('path').dirname(options.outputPath);
        const metadataPath = require('path').join(outputDir, 'render-metadata.json');
        require('fs').writeFileSync(metadataPath, JSON.stringify({
          engine: 'video_use',
          dryRun: true,
          timestamp: new Date().toISOString(),
          shouldPublish: false,
        }, null, 2));
        logger.info(`[render-router] DRY_RUN: vídeo generado pero NO será publicado`);
      }

      return result;
    } catch (error) {
      logger.warn(`[render-router] video-use failed: ${error.message}`);
      logger.warn(`[render-router] Fallback: usando motor current`);
      videoUseHealthy = false;
      return await renderVideoCurrent(options);
    }
  }

  // Motor actual (FFmpeg + Pexels) — default
  logger.info(`[render-router] Using motor: current`);
  return await renderVideoCurrent(options);
}

/**
 * Verifica si se debe bloquear publicación
 * Bloquea si: (1) validación manual activa, o (2) video-use dry-run activo
 */
function shouldBlockPublish(outputDir) {
  // Bloqueo por validación manual explícita (nuevo)
  if (VIDEO_RENDER_VALIDATE) {
    return true;
  }

  // Bloqueo por dry-run de video-use (existente)
  if (RENDER_ENGINE !== 'video_use' || !VIDEO_USE_DRY_RUN) {
    return false;
  }

  try {
    const metadataPath = require('path').join(outputDir, 'render-metadata.json');
    if (!require('fs').existsSync(metadataPath)) {
      return false;
    }

    const metadata = JSON.parse(require('fs').readFileSync(metadataPath, 'utf8'));
    return metadata.engine === 'video_use' && metadata.dryRun === true;
  } catch {
    return false;
  }
}

module.exports = {
  renderVideoWithRouter,
  shouldBlockPublish,
  getActiveEngine: () => RENDER_ENGINE,
  isVideoUseEnabled: () => VIDEO_USE_ENABLED && RENDER_ENGINE === 'video_use',
};
