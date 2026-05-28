/**
 * remotion-renderer-router.js
 *
 * Router que elige entre Remotion y fallbacks
 * Integra la nueva capa Remotion al pipeline existente
 */

require('dotenv').config();
const logger = require('../../utils/logger');
const { renderVideoWithRemotion } = require('../../renderers/remotion-renderer');

const RENDER_MODE = process.env.RENDER_MODE || 'video_use';
const REMOTION_ENABLED = process.env.REMOTION_RENDERER_ENABLED === 'true';
const REMOTION_FALLBACK_VIDEO_USE = process.env.REMOTION_FALLBACK_VIDEO_USE === 'true';

/**
 * Router que selecciona renderer
 */
async function renderVideoWithRemotionRouter(options = {}) {
  const renderModeConfig = process.env.RENDER_MODE_V2 || RENDER_MODE;

  // Decision tree:
  // 1. Si RENDER_MODE=remotion o REMOTION_ENABLED: intentar Remotion
  // 2. Si falla y REMOTION_FALLBACK_VIDEO_USE: fallback a video_use
  // 3. Si falla y sin fallback: error

  if (renderModeConfig === 'remotion' || REMOTION_ENABLED) {
    logger.info('[remotion-router] Attempting Remotion render');

    try {
      const result = await renderVideoWithRemotion(options);
      logger.info('[remotion-router] Remotion render successful');
      return result;
    } catch (error) {
      logger.warn(`[remotion-router] Remotion render failed: ${error.message}`);

      if (REMOTION_FALLBACK_VIDEO_USE) {
        logger.info('[remotion-router] Falling back to video_use');
        try {
          const { renderWithVideoUse } = require('./video-use-renderer');
          const fallbackResult = await renderWithVideoUse(options);
          return {
            ...fallbackResult,
            fallbackUsed: true,
            fallbackReason: error.message,
          };
        } catch (fallbackError) {
          logger.error(`[remotion-router] Fallback to video_use also failed: ${fallbackError.message}`);
          throw fallbackError;
        }
      } else {
        throw error;
      }
    }
  }

  // Modo por defecto: video_use
  logger.info('[remotion-router] Using default video_use renderer');
  const { renderWithVideoUse } = require('./video-use-renderer');
  return await renderWithVideoUse(options);
}

module.exports = {
  renderVideoWithRemotionRouter,
  REMOTION_ENABLED,
};
