require('dotenv').config();
const logger = require('../../utils/logger');
const { renderWithVideoUse } = require('./video-use-renderer');

const MIN_VIDEO_DURATION = 25; // segundos

async function renderVideoWithRouter(options = {}) {
  const { audioDuration } = options;

  // Validar duración mínima
  if (audioDuration && audioDuration < MIN_VIDEO_DURATION) {
    throw new Error(
      `[render-router] Video duración ${audioDuration.toFixed(2)}s < mínimo requerido ${MIN_VIDEO_DURATION}s. ` +
      `Genera un script más largo (objetivo: 26-32s).`
    );
  }

  logger.info('[render-router] Using motor: video_use');
  return renderWithVideoUse(options);
}

function shouldBlockPublish() {
  return process.env.VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH === 'true';
}

module.exports = {
  renderVideoWithRouter,
  shouldBlockPublish,
  getActiveEngine: () => 'video_use',
  isVideoUseEnabled: () => true,
};
