/**
 * VIDEO-USE INTEGRATION MODULE
 * Provides video rendering via hyperframe engine.
 * This module was previously missing and caused module loading failures.
 * FASE 1 FIX: Implements minimal interface delegating to hyperframe-renderer.
 */

const path = require('path');
const logger = require('../../src/utils/logger');
const { renderHyperframe } = require('../../src/renderers/hyperframe-renderer');

async function renderWithVideoUse(options = {}) {
  try {
    logger.info('[video-use] Delegating to hyperframe renderer');

    const { audioPath, script, captions = [], outputPath } = options;
    const path_module = require('path');

    if (!audioPath || !outputPath) {
      throw new Error('[video-use] Missing required options: audioPath, outputPath');
    }

    const outputDir = path_module.dirname(outputPath);

    const result = await renderHyperframe({
      script: script || {},
      audioPath,
      captions: captions || [],
      outputDir,
      videoId: script?.id || 'unknown',
    });

    logger.info('[video-use] Render completed successfully');
    return result;
  } catch (err) {
    logger.error(`[video-use] Render failed: ${err.message}`);
    throw err;
  }
}

function checkVideoUseAvailability() {
  // Basic availability check - hyperframe is always available
  return {
    available: true,
    mode: 'hyperframe',
    message: 'Video-use integration operational (hyperframe mode)',
  };
}

function buildVideoUseInput(options = {}) {
  // Identity passthrough - options are already in correct format
  return {
    ...options,
    renderer: 'video-use',
  };
}

module.exports = {
  renderWithVideoUse,
  checkVideoUseAvailability,
  buildVideoUseInput,
};
