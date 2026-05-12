/**
 * anti-failure-publish-wrapper.js
 *
 * Sistema anti-fallos para CERO slots perdidos.
 * Garantiza publicación si existe MP4 válido (hardPassed=true).
 *
 * Regla de oro:
 * IF hardPassed=true THEN publication WILL happen (or retry exhausted)
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const MAX_PUBLISH_RETRIES = 2;

/**
 * Wrapper para publicación con reintentos automáticos y fallback en cascada
 *
 * @param {object} options { video, strategy, publishAll, saveVideo, state }
 * @returns {Promise<boolean>} true si se publicó, false si todos los intentos fallaron
 */
async function publishWithRetries(options) {
  const { video, strategy = 'normal', publishAll, saveVideo, state, source = 'PublishScheduler', slotDate, slotTime } = options;
  const videoId = video.videoId;
  const maxRetries = MAX_PUBLISH_RETRIES;

  logger.info(
    `[CANDIDATE_SELECTED] videoId=${videoId} | ` +
    `strategy=${strategy} | ` +
    `hardPassed=${video.validation?.coreValidation?.hardPassed || 'unknown'}`
  );

  // Intentar publicar hasta MAX_PUBLISH_RETRIES veces
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(
        `[PUBLISH_ATTEMPT] videoId=${videoId} | attempt=${attempt}/${maxRetries} | strategy=${strategy}`
      );

      const outputPath = path.join(OUTPUT_DIR, videoId, 'output.mp4');

      // Verificar que el MP4 existe y es válido ANTES de intentar publicar
      if (!fs.existsSync(outputPath)) {
        logger.error(`[PUBLISH_FAILED_NO_MP4] videoId=${videoId} | attempt=${attempt} | file_missing`);
        if (attempt < maxRetries) continue;
        return false;
      }

      const stats = fs.statSync(outputPath);
      if (stats.size < 1024 * 1024) {
        logger.error(
          `[PUBLISH_FAILED_INVALID_MP4] videoId=${videoId} | attempt=${attempt} | ` +
          `size=${(stats.size / 1024 / 1024).toFixed(2)}MB < 1MB`
        );
        if (attempt < maxRetries) continue;
        return false;
      }

      // Intentar publicar
      const script = video.script || video.prefabScript || {};
      const publishResult = await publishAll(outputPath, script, null, {
        source,
        slotDate,
        slotTime,
        skipPrepublishVisualQC: strategy === 'fallback',
        isManual: false,
      });

      // Handle both success and failure responses
      let results = [];
      if (publishResult && publishResult.results) {
        results = publishResult.results;
      } else if (publishResult && publishResult.success === false) {
        logger.warn(
          `[PUBLISH_API_ERROR] videoId=${videoId} | attempt=${attempt} | ` +
          `error=${publishResult.error} | reason=${publishResult.reason}`
        );
        if (attempt < maxRetries) continue;
        return false;
      }

      const published = results.length > 0 ? { youtubeId: results[0].videoId || results[0].id } : null;

      if (published && published.youtubeId) {
        logger.warn(
          `✅ [SLOT_PUBLISHED] videoId=${videoId} | youtubeId=${published.youtubeId} | ` +
          `attempt=${attempt} | strategy=${strategy}`
        );

        // Registrar publicación
        try {
          const publishLog = loadPublishLog();
          publishLog.published.push({
            videoId,
            youtubeId: published.youtubeId,
            publishedAt: new Date().toISOString(),
            strategy,
            attempt,
            hardPassed: video.validation?.coreValidation?.hardPassed || null,
          });
          const logDir = path.dirname(path.resolve('./data/publish-log.json'));
          if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
          fs.writeFileSync(path.resolve('./data/publish-log.json'), JSON.stringify(publishLog, null, 2));
        } catch (err) {
          logger.warn(`[PUBLISH_LOG_ERROR] could not update log: ${err.message}`);
        }

        return true;
      } else {
        logger.warn(
          `[PUBLISH_NO_YOUTUBE_ID] videoId=${videoId} | attempt=${attempt} | ` +
          `publishResult returned no youtubeId`
        );
        if (attempt < maxRetries) continue;
        return false;
      }
    } catch (err) {
      logger.error(
        `[PUBLISH_EXCEPTION] videoId=${videoId} | attempt=${attempt} | ` +
        `error=${err.message}`
      );
      if (attempt < maxRetries) {
        logger.info(`[PUBLISH_RETRY] videoId=${videoId} | next attempt in ${attempt * 1000}ms`);
        // Esperar antes de reintentar (backoff exponencial)
        await new Promise(r => setTimeout(r, attempt * 1000));
        continue;
      }
      return false;
    }
  }

  logger.error(
    `[PUBLISH_ALL_RETRIES_EXHAUSTED] videoId=${videoId} | ` +
    `attempted=${maxRetries} times | strategy=${strategy}`
  );
  return false;
}

/**
 * Ejecutar publicación con garantía anti-fallos
 * Intenta en cascada hasta encontrar una estrategia exitosa
 */
async function publishWithAntiFailure(options) {
  const { video, publishAll, saveVideo, state, fallbackReason } = options;
  const videoId = video.videoId;

  const strategies = [
    { name: 'normal', skipQC: false },
    { name: 'force', skipQC: true },
    { name: 'fallback', skipQC: true },
  ];

  for (const strategy of strategies) {
    const success = await publishWithRetries({
      video,
      strategy: strategy.name,
      publishAll,
      saveVideo,
      state,
    });

    if (success) {
      logger.info(`[ANTI_FAILURE_SUCCESS] videoId=${videoId} | strategy=${strategy.name}`);
      return true;
    }

    logger.warn(
      `[ANTI_FAILURE_RETRY_NEXT] videoId=${videoId} | current_strategy=${strategy.name} | ` +
      `trying next strategy...`
    );
  }

  logger.error(
    `[ANTI_FAILURE_EXHAUSTED] videoId=${videoId} | ` +
    `all strategies failed | cannot publish`
  );
  return false;
}

/**
 * Leer publish-log.json
 */
function loadPublishLog() {
  const logPath = path.resolve('./data/publish-log.json');
  try {
    if (fs.existsSync(logPath)) {
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
  } catch (err) {
    logger.warn(`[PUBLISH_LOG_READ_ERROR] ${err.message}`);
  }
  return { published: [] };
}

/**
 * Verificar si un video es publicable (hardPassed=true)
 */
async function isPublishable(videoId) {
  try {
    const { validatePublishCandidate } = require('./publish-candidate-validator.service');
    const result = validatePublishCandidate({ videoId }, true);
    return result.hardPassed === true;
  } catch (err) {
    logger.error(`[PUBLISHABLE_CHECK_ERROR] videoId=${videoId} | ${err.message}`);
    return false;
  }
}

/**
 * Import automático desde output/ si existe MP4 válido sin entry en queue
 */
async function attemptAutoImport() {
  try {
    const { runSync } = require('./auto-import-from-output.service');
    const result = await runSync();
    if (result && result.imported > 0) {
      logger.info(
        `[AUTO_IMPORT_SUCCESS] scanned=${result.scanned} | ` +
        `imported=${result.imported} | skipped=${result.skipped}`
      );
      return result.imported;
    }
  } catch (err) {
    logger.warn(`[AUTO_IMPORT_ERROR] ${err.message}`);
  }
  return 0;
}

/**
 * Verificar si hay al menos 1 video publicable en el sistema
 */
async function ensureAtLeastOnePublishable() {
  try {
    const { getReadyToPublishVideos } = require('./operational-state.service');
    const readyVideos = getReadyToPublishVideos();

    let hasPublishable = false;
    for (const video of readyVideos) {
      if (await isPublishable(video.videoId)) {
        hasPublishable = true;
        break;
      }
    }

    if (!hasPublishable) {
      logger.warn(`[NO_PUBLISHABLE_VIDEOS] attempting auto-import...`);
      const imported = await attemptAutoImport();
      if (imported > 0) {
        logger.info(`[AUTO_IMPORT_RECOVERED] imported ${imported} videos`);
        return true;
      }
      logger.error(`[SYSTEM_BLOCKED_NO_PUBLISHABLE] no videos available to publish`);
      return false;
    }

    return true;
  } catch (err) {
    logger.error(`[PUBLISHABLE_CHECK_FAILED] ${err.message}`);
    return false;
  }
}

module.exports = {
  publishWithRetries,
  publishWithAntiFailure,
  isPublishable,
  attemptAutoImport,
  ensureAtLeastOnePublishable,
};
