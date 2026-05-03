/**
 * opportunistic-publish.js
 * Publica vídeos perfectos inmediatamente sin esperar slots programados
 * NO consume slots diarios — el flujo normal continúa independientemente
 *
 * Protecciones:
 * - Máximo 1 por ciclo
 * - Validación estricta: visualQc, blackdetect, assets, captions
 * - Evita reutilizar vídeos antiguos ya publicados
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../utils/logger');
const { publishAll } = require('./publisher');

const OPPORTUNISTIC_PUBLISH_LOG = path.resolve('./data/opportunistic-publish-log.json');
const OPPORTUNISTIC_PUBLISHED_STATE = path.resolve('./data/opportunistic-published-videos.json');
const OPPORTUNISTIC_CONFIG = path.resolve('./data/opportunistic-config.json');
const OPPORTUNISTIC_DAILY_COUNT = path.resolve('./data/opportunistic-daily-count.json');

/**
 * Lee configuración de opportunistic publish
 */
function _getOpportunisticConfig() {
  try {
    if (fs.existsSync(OPPORTUNISTIC_CONFIG)) {
      return JSON.parse(fs.readFileSync(OPPORTUNISTIC_CONFIG, 'utf8'));
    }
  } catch (err) {
    logger.warn(`Cannot read opportunistic config: ${err.message}`);
  }

  // Config por defecto
  return {
    opportunisticEnabledAt: new Date('2026-04-28T00:00:00Z').toISOString(),
    maxPerCycle: 1,
    maxPerDay: 2,
    minMinutesToNextSlot: 20,
  };
}

/**
 * Verifica si un vídeo es "perfecto" y cumple criterios estrictos
 * Perfecto = cumple TODOS estos criterios:
 * 1. Files: output.mp4, subtitles.ass, script.json
 * 2. Metadata: visualQc=pass, blackdetectPass=true, assetStatus=pass, captionsOk=true
 * 3. No reutilización: no fue ya publicado opportunistically
 * 4. Reciente: generado después de activar este modo
 */
function isPerfectVideo(videoPath, outputDir, videoId) {
  if (!videoPath || !outputDir) {
    return { perfect: false, reason: 'invalid_params' };
  }

  // Criterio 1: Files exist
  if (!fs.existsSync(videoPath)) {
    return { perfect: false, reason: 'output_mp4_missing' };
  }

  const assPath = path.join(outputDir, 'subtitles.ass');
  if (!fs.existsSync(assPath)) {
    return { perfect: false, reason: 'subtitles_ass_missing' };
  }

  const scriptPath = path.join(outputDir, 'script.json');
  if (!fs.existsSync(scriptPath)) {
    return { perfect: false, reason: 'script_json_missing' };
  }

  // Criterio 2: Verificar que NO fue ya publicado opportunistically
  const publishedState = _getPublishedState();
  if (publishedState.includes(videoId)) {
    return { perfect: false, reason: 'already_opportunistically_published' };
  }

  // Criterio 3: Verificar que es reciente (después de activar modo)
  // Usa createdAt de metadata, no file.mtime
  const config = _getOpportunisticConfig();
  const opportunisticEnabledAt = new Date(config.opportunisticEnabledAt);

  // Criterio 4: Metadata validation
  let metadata = {};
  try {
    // Intentar leer render-metadata.json
    const metadataPath = path.join(outputDir, 'render-metadata.json');
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    }
  } catch (err) {
    logger.warn(`Cannot read metadata for ${videoId}: ${err.message}`);
  }

  // Criterio 4a: Verificar fecha usando createdAt de metadata
  if (metadata.createdAt) {
    const videoCreatedAt = new Date(metadata.createdAt);
    if (videoCreatedAt < opportunisticEnabledAt) {
      return { perfect: false, reason: 'video_predates_opportunistic_mode', createdAt: metadata.createdAt };
    }
  }

  // Validaciones estrictas de metadata
  if (metadata.visualQc !== 'pass') {
    return { perfect: false, reason: 'visual_qc_not_pass', got: metadata.visualQc };
  }

  if (metadata.blackdetectPass !== true) {
    return { perfect: false, reason: 'blackdetect_not_pass', got: metadata.blackdetectPass };
  }

  if (metadata.assetStatus !== 'pass') {
    return { perfect: false, reason: 'asset_status_not_pass', got: metadata.assetStatus };
  }

  if (metadata.captionsOk !== true) {
    return { perfect: false, reason: 'captions_not_ok', got: metadata.captionsOk };
  }

  // Criterio 5: ffprobe debe haber validado
  if (metadata.ffprobePass !== true) {
    return { perfect: false, reason: 'ffprobe_not_pass', got: metadata.ffprobePass };
  }

  // Criterio 6: SUBTÍTULOS OBLIGATORIOS — no publicar sin subtítulos
  if (metadata.subtitlesBurned !== true) {
    return { perfect: false, reason: 'subtitles_missing', got: metadata.subtitlesBurned };
  }

  // Criterio 7: SUBTÍTULOS REALMENTE RENDERIZADOS — validación crítica
  // Verifica que FFmpeg aplicó el filtro subtitles en el render
  if (metadata.subtitlesFilterApplied !== true) {
    return { perfect: false, reason: 'subtitles_not_rendered', got: metadata.subtitlesFilterApplied };
  }

  // Criterio 8: SUBTÍTULOS VISUALMENTE CONFIRMADOS — validación ultra-robusta
  // Opportunistic publish REQUIERE confidence="confirmed" (ambas señales OK)
  // No acepta "low" confidence (una sola señal)
  if (metadata.subtitlesVisualConfidence !== 'confirmed') {
    return {
      perfect: false,
      reason: 'subtitles_not_fully_confirmed',
      got: metadata.subtitlesVisualConfidence,
      note: 'opportunistic_requires_confirmed_only',
    };
  }

  return {
    perfect: true,
    videoId,
    metadata: {
      visualQc: metadata.visualQc,
      blackdetectPass: metadata.blackdetectPass,
      assetStatus: metadata.assetStatus,
      captionsOk: metadata.captionsOk,
      ffprobePass: metadata.ffprobePass,
    },
  };
}

/**
 * Lee el estado de vídeos ya publicados opportunistically
 */
function _getPublishedState() {
  try {
    if (!fs.existsSync(OPPORTUNISTIC_PUBLISHED_STATE)) {
      return [];
    }
    const state = JSON.parse(fs.readFileSync(OPPORTUNISTIC_PUBLISHED_STATE, 'utf8'));
    return state.published || [];
  } catch (err) {
    logger.warn(`Cannot read opportunistic published state: ${err.message}`);
    return [];
  }
}

/**
 * Lee contador diario de vídeos publicados opportunistically
 * Reset automático si es nuevo día
 */
function _getDailyCount() {
  try {
    if (!fs.existsSync(OPPORTUNISTIC_DAILY_COUNT)) {
      return { count: 0, date: new Date().toISOString().split('T')[0] };
    }

    const data = JSON.parse(fs.readFileSync(OPPORTUNISTIC_DAILY_COUNT, 'utf8'));
    const today = new Date().toISOString().split('T')[0];

    // Reset si es nuevo día
    if (data.date !== today) {
      return { count: 0, date: today };
    }

    return data;
  } catch (err) {
    logger.warn(`Cannot read daily count: ${err.message}`);
    return { count: 0, date: new Date().toISOString().split('T')[0] };
  }
}

/**
 * Incrementa contador diario
 */
function _incrementDailyCount() {
  try {
    let data = _getDailyCount();
    data.count = (data.count || 0) + 1;
    data.lastUpdated = new Date().toISOString();

    const dir = path.dirname(OPPORTUNISTIC_DAILY_COUNT);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(OPPORTUNISTIC_DAILY_COUNT, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error(`Failed to increment daily count: ${err.message}`);
  }
}

/**
 * Marca un vídeo como publicado opportunistically
 */
function _markAsOpportunisticallyPublished(videoId, youtubeUrl) {
  try {
    const dir = path.dirname(OPPORTUNISTIC_PUBLISHED_STATE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let state = { published: [], lastUpdated: null };
    if (fs.existsSync(OPPORTUNISTIC_PUBLISHED_STATE)) {
      try {
        state = JSON.parse(fs.readFileSync(OPPORTUNISTIC_PUBLISHED_STATE, 'utf8'));
      } catch {
        state = { published: [], lastUpdated: null };
      }
    }

    if (!state.published) state.published = [];
    if (!state.published.includes(videoId)) {
      state.published.push(videoId);
    }
    state.lastUpdated = new Date().toISOString();

    fs.writeFileSync(OPPORTUNISTIC_PUBLISHED_STATE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.error(`Failed to mark ${videoId} as opportunistically published: ${err.message}`);
  }
}

/**
 * Construye validationResult a partir del videoPath
 * (para compatibilidad futura con análisis más profundo)
 */
function buildValidationResult(videoPath, outputDir) {
  return {
    outputExists: fs.existsSync(videoPath),
    assExists: fs.existsSync(path.join(outputDir, 'subtitles.ass')),
    scriptExists: fs.existsSync(path.join(outputDir, 'script.json')),
  };
}

/**
 * Publica un vídeo perfecto inmediatamente sin consumir slot diario
 * Marca como opportunisticPublished=true para evitar duplicados
 */
async function publishOpportunistic(videoId, videoPath, script) {
  if (!videoId || !videoPath || !script) {
    logger.error('OPPORTUNISTIC_PUBLISH_INVALID_INPUT', {
      videoId,
      hasPath: !!videoPath,
      hasScript: !!script,
    });
    return {
      published: false,
      reason: 'missing_parameters',
    };
  }

  logger.info('OPPORTUNISTIC_PUBLISH_TRIGGERED', {
    videoId,
    videoPath,
    topic: script.topic,
    hook: script.hook,
  });

  try {
    // Publicar sin consumir slot
    const result = await publishAll(videoPath, script);

    if (result.success) {
      logger.info('OPPORTUNISTIC_PUBLISH_SUCCESS', {
        videoId,
        platform: 'youtube',
        youtubeUrl: result.youtubeUrl,
        timestamp: new Date().toISOString(),
      });

      // Marcar como publicado para evitar duplicados
      _markAsOpportunisticallyPublished(videoId, result.youtubeUrl);

      // Incrementar contador diario
      _incrementDailyCount();

      // Log en archivo de opportunistic publishes
      _logOpportunisticPublish({
        videoId,
        success: true,
        timestamp: new Date().toISOString(),
        youtubeUrl: result.youtubeUrl,
      });

      return {
        published: true,
        videoId,
        youtubeUrl: result.youtubeUrl,
      };
    } else {
      logger.error('OPPORTUNISTIC_PUBLISH_FAILED', {
        videoId,
        error: result.error,
        reason: result.reason,
      });

      _logOpportunisticPublish({
        videoId,
        success: false,
        timestamp: new Date().toISOString(),
        error: result.error,
      });

      return {
        published: false,
        videoId,
        error: result.error,
      };
    }
  } catch (err) {
    logger.error('OPPORTUNISTIC_PUBLISH_EXCEPTION', {
      videoId,
      error: err.message,
      stack: err.stack,
    });

    _logOpportunisticPublish({
      videoId,
      success: false,
      timestamp: new Date().toISOString(),
      error: 'exception',
      message: err.message,
    });

    return {
      published: false,
      videoId,
      error: 'exception',
      message: err.message,
    };
  }
}

function _logOpportunisticPublish(entry) {
  try {
    const dir = path.dirname(OPPORTUNISTIC_PUBLISH_LOG);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let log = [];
    if (fs.existsSync(OPPORTUNISTIC_PUBLISH_LOG)) {
      const content = fs.readFileSync(OPPORTUNISTIC_PUBLISH_LOG, 'utf8');
      try {
        log = JSON.parse(content);
      } catch {
        log = [];
      }
    }

    log.push(entry);
    fs.writeFileSync(OPPORTUNISTIC_PUBLISH_LOG, JSON.stringify(log, null, 2));
  } catch (err) {
    logger.warn('Failed to log opportunistic publish', { error: err.message });
  }
}

/**
 * Chequea si hemos alcanzado el límite diario
 */
function hasReachedDailyLimit() {
  const config = _getOpportunisticConfig();
  const count = _getDailyCount();
  return count.count >= (config.maxPerDay || 2);
}

/**
 * Chequea si estamos demasiado cerca del siguiente slot
 * @param {Date} nextSlotTime - Hora del siguiente slot programado
 * @returns {boolean} true si faltan menos de minMinutesToNextSlot minutos
 */
function isTooCloseToNextSlot(nextSlotTime) {
  if (!nextSlotTime) return false;

  const config = _getOpportunisticConfig();
  const minMinutes = config.minMinutesToNextSlot || 20;
  const now = new Date();
  const minutesToSlot = (nextSlotTime.getTime() - now.getTime()) / 60000;

  return minutesToSlot < minMinutes;
}

module.exports = {
  isPerfectVideo,
  publishOpportunistic,
  buildValidationResult,
  hasReachedDailyLimit,
  isTooCloseToNextSlot,
  _getDailyCount,
  _incrementDailyCount,
  _getOpportunisticConfig,
};
