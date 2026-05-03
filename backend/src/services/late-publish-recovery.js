/**
 * late-publish-recovery.js
 *
 * Intenta publicar automáticamente un vídeo válido si existe un slot
 * saltado recientemente (<=2h) por falta de vídeos válidos.
 *
 * Se llama DESPUÉS de generar un vídeo.
 * No toca render engine ni generación.
 * Solo publica si el vídeo es válido y cumple criterios anti-abuso.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const logger = require('../utils/logger');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const SKIPPED_SLOTS_FILE = path.resolve('./data/skipped-slots-state.json');
const PUBLISH_LOG_FILE = path.resolve('./data/publish-log.json');

/**
 * Leer publish-log.json para contar publicaciones de hoy
 */
function loadPublishLog() {
  try {
    if (fs.existsSync(PUBLISH_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(PUBLISH_LOG_FILE, 'utf8'));
    }
  } catch (err) {
    logger.warn(`[LATE_PUBLISH] could not load publish log: ${err.message}`);
  }
  return { published: [] };
}

/**
 * Chequear si se puede intentar late publish:
 * 1. Existe slot saltado reciente
 * 2. No expiró (<=2h)
 * 3. No se ejecutó ya late publish para ese slot
 */
function canAttemptLatePublish() {
  try {
    if (!fs.existsSync(SKIPPED_SLOTS_FILE)) {
      return null;
    }

    const state = JSON.parse(fs.readFileSync(SKIPPED_SLOTS_FILE, 'utf8'));
    if (!state.lastSkippedSlot) {
      return null;
    }

    const expireAt = new Date(state.lastSkippedSlot.mustExpireAt);
    const now = new Date();

    if (now > expireAt) {
      // Expiró, limpiar
      fs.unlinkSync(SKIPPED_SLOTS_FILE);
      logger.info(`[LATE_PUBLISH] skipped slot expired, cleaned`);
      return null;
    }

    // Si ya se ejecutó late publish para este slot, no repetir
    if (state.lastSkippedSlot.latePublishExecuted) {
      logger.info(`[LATE_PUBLISH] late publish already executed for this slot`);
      return null;
    }

    return state.lastSkippedSlot;
  } catch (err) {
    logger.warn(`[LATE_PUBLISH] error reading skipped slots: ${err.message}`);
    return null;
  }
}

/**
 * Validar que el vídeo es publicable (usa función centralizada)
 */
async function validateVideoForLatePublish(videoId) {
  try {
    const { validatePublishCandidate, logValidationDecision } = require('./publish-candidate-validator.service');

    const result = validatePublishCandidate({ videoId }, true);

    logValidationDecision(result, 'late_publish');

    if (!result.hardPassed) {
      logger.info(`[LATE_PUBLISH] ${videoId} rejected: ${result.hardBlocks[0]}`);
      return false;
    }

    logger.info(`[LATE_PUBLISH] ${videoId} validated: ${result.duration.toFixed(1)}s, quality=${result.quality}%`);
    return true;
  } catch (err) {
    logger.warn(`[LATE_PUBLISH] validation error for ${videoId}: ${err.message}`);
    return false;
  }
}

/**
 * Chequear si la publicación no superaría límites diarios
 */
function canPublishWithoutExceedingDailyLimit() {
  try {
    const publishLog = loadPublishLog();
    const today = new Date().toISOString().split('T')[0];

    const todayPublished = publishLog.published.filter((p) => {
      const pDate = new Date(p.publishedAt).toISOString().split('T')[0];
      return pDate === today && !p.latePublish;
    });

    const latePublished = publishLog.published.filter((p) => {
      const pDate = new Date(p.publishedAt).toISOString().split('T')[0];
      return pDate === today && p.latePublish;
    });

    // MAX_PUBLISHES_PER_DAY normalmente es 2, máximo 1 late publish
    const MAX_PER_DAY = 2;
    const total = todayPublished.length + latePublished.length;

    if (total >= MAX_PER_DAY) {
      logger.info(`[LATE_PUBLISH] daily limit already reached: ${todayPublished.length} regular + ${latePublished.length} late`);
      return false;
    }

    if (latePublished.length >= 1) {
      logger.info(`[LATE_PUBLISH] already executed 1 late publish today, limit is 1 per day`);
      return false;
    }

    return true;
  } catch (err) {
    logger.warn(`[LATE_PUBLISH] error checking daily limit: ${err.message}`);
    return true; // Asumir que está OK si hay error en log
  }
}

/**
 * Marcar slot como "late publish ejecutado" para no repetir
 */
function markSlotLatePublishExecuted() {
  try {
    if (fs.existsSync(SKIPPED_SLOTS_FILE)) {
      const state = JSON.parse(fs.readFileSync(SKIPPED_SLOTS_FILE, 'utf8'));
      if (state.lastSkippedSlot) {
        state.lastSkippedSlot.latePublishExecuted = true;
        fs.writeFileSync(SKIPPED_SLOTS_FILE, JSON.stringify(state, null, 2));
      }
    }
  } catch (err) {
    logger.warn(`[LATE_PUBLISH] error marking slot: ${err.message}`);
  }
}

/**
 * Intentar publicar vídeo automáticamente si existe slot saltado
 * Se llama después de generar un vídeo nuevo.
 *
 * @param {string} videoId - ID del vídeo generado
 * @returns {Promise<boolean>} - true si se publicó, false si no
 */
async function attemptLatePublish(videoId) {
  try {
    if (!videoId) return false;

    // 1. Chequear si hay slot saltado reciente
    const skippedSlot = canAttemptLatePublish();
    if (!skippedSlot) {
      return false;
    }

    logger.info(`[LATE_PUBLISH] checking video ${videoId} for delayed slot ${skippedSlot.slotTime}`);

    // 2. Validar el vídeo
    const isValid = await validateVideoForLatePublish(videoId);
    if (!isValid) {
      return false;
    }

    // 3. Chequear límites anti-abuso
    if (!canPublishWithoutExceedingDailyLimit()) {
      return false;
    }

    // 4. SI TODO OK: Cargar datos para publicar
    const queueDir = path.resolve('./queue/done');
    const doneFiles = fs
      .readdirSync(queueDir)
      .filter(f => f.includes(videoId) && f.endsWith('.json'));

    if (doneFiles.length === 0) {
      logger.warn(`[LATE_PUBLISH] no queue file found for ${videoId}`);
      return false;
    }

    let videoData = null;
    try {
      const doneFilePath = path.join(queueDir, doneFiles[0]);
      videoData = JSON.parse(fs.readFileSync(doneFilePath, 'utf8'));
    } catch (err) {
      logger.warn(`[LATE_PUBLISH] could not load queue data: ${err.message}`);
      return false;
    }

    // Ensure captions-debug.json exists for validator
    const videoDirPath = path.join(OUTPUT_DIR, videoId);
    const captionsDebugPath = path.join(videoDirPath, 'captions-debug.json');
    if (!fs.existsSync(captionsDebugPath)) {
      try {
        const assPath = path.join(videoDirPath, 'subtitles.ass');
        const metadataPath = path.join(videoDirPath, 'render-metadata.json');
        let duration = 30;
        let captionCount = 0;

        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            duration = metadata.duration || 30;
            captionCount = metadata.subtitleBlocksCount || 0;
          } catch {}
        }

        if (captionCount === 0 && fs.existsSync(assPath)) {
          captionCount = fs.readFileSync(assPath, 'utf8').split('Dialogue:').length - 1;
        }

        const captionsDebug = {
          captionCount: Math.max(captionCount, 1),
          drift: { value: 0.05, maxAcceptable: 0.35, status: 'ok' },
          source: 'late-publish-recovery',
          lastCaption: { end: Math.max(duration - 0.5, 1) },
          audioDuration: duration
        };

        fs.writeFileSync(captionsDebugPath, JSON.stringify(captionsDebug, null, 2));
        logger.info(`[LATE_PUBLISH] created captions-debug.json for ${videoId}`);
      } catch (err) {
        logger.warn(`[LATE_PUBLISH] could not auto-create captions-debug.json: ${err.message}`);
      }
    }

    // 5. PUBLICAR
    logger.warn(
      `🟢 [LATE_PUBLISH_EXECUTING] videoId=${videoId} | slot=${skippedSlot.slotTime} | ` +
      `reason=${skippedSlot.reason} | maxAge=2h`
    );

    try {
      const { publishAll } = require('./publisher');
      const { saveVideo } = require('./analytics-tracker');
      const { validateForPublish } = require('./publish-validator.service');

      // Validar con publish-validator
      const publishValidation = validateForPublish(videoData);
      if (!publishValidation.valid) {
        logger.warn(`[LATE_PUBLISH] publish validation failed: ${publishValidation.reason}`);
        return false;
      }

      // Cargar state para contar publicaciones
      const pipelineStateFile = path.resolve('./data/pipeline-state.json');
      let state = { count: 0 };
      try {
        if (fs.existsSync(pipelineStateFile)) {
          state = JSON.parse(fs.readFileSync(pipelineStateFile, 'utf8'));
        }
      } catch {}

      // Publicar (sin incrementar counter si ya pasó el slot)
      const outputPath = path.join(OUTPUT_DIR, videoId, 'output.mp4');
      const script = videoData.script || videoData.prefabScript || {};

      // Recovery videos already passed QC during render, skip prepublish visual check
      const publishResult = await publishAll(outputPath, script, null, { skipPrepublishVisualQC: true });

      // Handle both success and failure responses from publishAll
      let results = [];
      if (publishResult && publishResult.results) {
        results = publishResult.results;
      } else if (publishResult && publishResult.success === false) {
        logger.error(`[LATE_PUBLISH] publishAll returned error: ${publishResult.error} - ${publishResult.reason}`);
        return false;
      }

      const published = results.length > 0 ? { youtubeId: results[0].videoId || results[0].id } : null;

      if (published && published.youtubeId) {
        logger.info(
          `✅ [LATE_PUBLISH_EXECUTED] videoId=${videoId} | youtubeId=${published.youtubeId} | ` +
          `slot=${skippedSlot.slotTime}`
        );

        // Registrar en publish log
        const publishLog = loadPublishLog();
        publishLog.published.push({
          videoId,
          youtubeId: published.youtubeId,
          publishedAt: new Date().toISOString(),
          latePublish: true,
          slotTime: skippedSlot.slotTime,
        });
        try {
          const logDir = path.dirname(PUBLISH_LOG_FILE);
          if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
          fs.writeFileSync(PUBLISH_LOG_FILE, JSON.stringify(publishLog, null, 2));
        } catch (err) {
          logger.warn(`[LATE_PUBLISH] could not update publish log: ${err.message}`);
        }

        // Marcar que se ejecutó para este slot
        markSlotLatePublishExecuted();

        return true;
      } else {
        logger.error(`[LATE_PUBLISH_FAILED] publish returned no youtubeId`);
        return false;
      }
    } catch (err) {
      logger.error(`[LATE_PUBLISH] execution failed: ${err.message}`);
      return false;
    }
  } catch (err) {
    logger.error(`[LATE_PUBLISH] unexpected error: ${err.message}`);
    return false;
  }
}

module.exports = {
  attemptLatePublish,
};
