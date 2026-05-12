require('dotenv').config();
const logger = require('../../utils/logger');
const { renderWithVideoUse } = require('./video-use-renderer');
const { renderHyperframe } = require('../../renderers/hyperframe-renderer');
const { renderDynamicBackgroundTimeline } = require('../dynamic-background-renderer');
const fs = require('fs');
const path = require('path');

const MIN_VIDEO_DURATION = 25; // segundos
const RENDER_MODE = process.env.RENDER_MODE || 'video_use';

// FIX #3: NEVER REUSE SUBTITLE FILES
function cleanOldSubtitles(outputDir) {
  if (!outputDir) return;
  const subtitleExtensions = ['.srt', '.ass', '.vtt'];
  for (const ext of subtitleExtensions) {
    const subtitlePath = path.join(outputDir, `subtitles${ext}`);
    if (fs.existsSync(subtitlePath)) {
      try {
        fs.unlinkSync(subtitlePath);
        logger.info(`[render-router] Cleaned old subtitle: ${subtitlePath}`);
      } catch (err) {
        logger.warn(`[render-router] Failed to clean old subtitle ${subtitlePath}: ${err.message}`);
      }
    }
  }
}

async function renderVideoWithRouter(options = {}) {
  const { audioDuration, outputPath } = options;
  const outputDir = path.dirname(outputPath);

  // FIX #3: Clean old subtitle files before rendering
  cleanOldSubtitles(outputDir);
  logger.info(`[render-router] Output directory: ${outputDir} (subtitles cleaned)`);

  // Validar duración mínima
  if (audioDuration && audioDuration < MIN_VIDEO_DURATION) {
    throw new Error(
      `[render-router] Video duración ${audioDuration.toFixed(2)}s < mínimo requerido ${MIN_VIDEO_DURATION}s. ` +
      `Genera un script más largo (objetivo: 26-32s).`
    );
  }

  // NUEVO: Verificar si existe backgroundPlan.clipTimeline en generation-metadata.json
  const metadataPath = path.join(outputDir, 'generation-metadata.json');
  let hasDynamicBackground = false;
  let clipTimeline = null;

  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (metadata.backgroundPlan && Array.isArray(metadata.backgroundPlan.clipTimeline)) {
        hasDynamicBackground = true;
        clipTimeline = metadata.backgroundPlan.clipTimeline;
        logger.info(`[render-router] Dynamic background detected: ${clipTimeline.length} clips`);
      }
    } catch (err) {
      logger.warn(`[render-router] Failed to read generation-metadata.json: ${err.message}`);
    }
  }

  // Si existe clipTimeline, usar renderDynamicBackgroundTimeline
  if (hasDynamicBackground && clipTimeline && clipTimeline.length > 0) {
    logger.info('[render-router] Using dynamic background timeline renderer');
    try {
      const result = await renderDynamicBackgroundTimeline({
        audioPath: options.audioPath,
        outputPath,
        clipTimeline,
        audioDuration: audioDuration || 30,
        outputDir,
      });

      // Marcar que fue aplicado
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      metadata.backgroundPlan.appliedToRender = true;
      metadata.backgroundPlan.renderedAt = new Date().toISOString();
      metadata.backgroundPlan.renderMode = 'dynamic_background_timeline';
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      return {
        success: true,
        renderMode: 'dynamic_background_timeline',
        fallbackUsed: false,
        outputPath,
      };
    } catch (error) {
      logger.error(`[render-router] Dynamic background render failed: ${error.message}`);
      throw error;
    }
  }

  // Estrategia de rendering: Hyperframe (si habilitado) + fallback a video_use
  if (RENDER_MODE === 'hyperframe_html') {
    try {
      logger.info('[render-router] Attempting hyperframe_html render');
      const outputDir = path.dirname(outputPath);
      const { captions = [] } = options;

      const result = await renderHyperframe({
        script: options.script || {},
        audioPath: options.audioPath,
        captions: buildCaptionsFromOptions(options),
        outputDir,
        videoId: options.script?.id || 'unknown',
      });

      logger.info('[render-router] Hyperframe render successful');

      // Copiar output.mp4 a la ruta esperada
      const hyperframeOutput = path.join(outputDir, 'output.mp4');
      if (fs.existsSync(hyperframeOutput) && outputPath !== hyperframeOutput) {
        fs.copyFileSync(hyperframeOutput, outputPath);
        logger.info(`[render-router] Output copied: ${hyperframeOutput} → ${outputPath}`);
      }

      return {
        success: true,
        renderMode: 'hyperframe_html',
        fallbackUsed: false,
        outputPath,
      };
    } catch (error) {
      logger.warn(`[render-router] Hyperframe render failed, falling back to video_use: ${error.message}`);

      // Fallback a video_use
      try {
        const result = await renderWithVideoUse(options);
        logger.info('[render-router] Fallback to video_use successful');

        // Marcar que se usó fallback
        const outputDir = path.dirname(outputPath);
        const metadataPath = path.join(outputDir, 'render-metadata.json');
        if (fs.existsSync(metadataPath)) {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          metadata.fallbackUsed = true;
          metadata.fallbackReason = error.message;
          fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        }

        return {
          success: true,
          renderMode: 'video_use',
          fallbackUsed: true,
          fallbackReason: error.message,
          outputPath,
        };
      } catch (fallbackError) {
        logger.error(`[render-router] Both hyperframe and fallback failed`, fallbackError);
        throw new Error(
          `HYPERFRAME_RENDER_FAILED and fallback also failed: ${error.message} | ${fallbackError.message}`
        );
      }
    }
  } else {
    logger.info(`[render-router] Using configured render mode: ${RENDER_MODE}`);
    return renderWithVideoUse(options);
  }
}

function buildCaptionsFromOptions(options) {
  // Convertir subtitleBlocks del script a formato de captions
  const { script = {}, wordBoundaries = [] } = options;

  if (script.subtitleBlocks && Array.isArray(script.subtitleBlocks)) {
    return script.subtitleBlocks.map((block) => ({
      text: block.text,
      start: block.start,
      end: block.end,
    }));
  }

  if (wordBoundaries && Array.isArray(wordBoundaries)) {
    return wordBoundaries.map((wb) => ({
      text: wb.word,
      start: wb.startTime,
      end: wb.endTime,
    }));
  }

  return [];
}

function shouldBlockPublish() {
  return process.env.VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH === 'true';
}

module.exports = {
  renderVideoWithRouter,
  shouldBlockPublish,
  getActiveEngine: () => RENDER_MODE,
  isVideoUseEnabled: () => true,
};
