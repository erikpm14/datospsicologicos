/**
 * shorts-renderer/index.js
 * Punto de entrada del módulo shorts-renderer.
 * Misma firma que renderVideo() — compatible con video-processor.js
 */

require('dotenv').config();
const { renderVideo, getRealAudioDuration } = require('../video-renderer');

module.exports = {
  renderVideo,
  getRealAudioDuration,
};
