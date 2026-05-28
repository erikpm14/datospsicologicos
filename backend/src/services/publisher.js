/**
 * publisher.js
 * Publica videos en TikTok, Instagram Reels y YouTube Shorts.
 * Gestiona horarios óptimos, captions y hashtags dinámicos.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
if (process.env.OUTPUT_DIR && !path.isAbsolute(process.env.OUTPUT_DIR)) {
  process.env.OUTPUT_DIR = path.resolve(__dirname, '../../', process.env.OUTPUT_DIR);
}
if (process.env.QUEUE_DIR && !path.isAbsolute(process.env.QUEUE_DIR)) {
  process.env.QUEUE_DIR = path.resolve(__dirname, '../../', process.env.QUEUE_DIR);
}
const axios = require('axios');
const fs = require('fs');
const logger = require('../utils/logger');
const { validateForPublish, discardInvalidVideo } = require('./publish-validator.service');
const { validateCaptionsForPublish } = require('./caption-pre-publish-validator');
const { validatePrepublish } = require('./prepublish-visual-qc.service');
const performanceTracker = require('./performance-tracker.service');
const duplicateDetector = require('./duplicate-detector.service');
const duplicateTracker = require('./duplicate-tracker');
const { assertPublishAllowed, recordAuthorizedPublish } = require('./publish-guard.service');
const { acquirePublishLock, releasePublishLock } = require('./publish-idempotency-lock.service');
const PUBLISH_RETRY_DELAY_MS = Math.max(1000, parseInt(process.env.PUBLISH_RETRY_DELAY_MS || '4000', 10) || 4000);
const PUBLISH_MAX_RETRIES = Math.max(1, parseInt(process.env.PUBLISH_MAX_RETRIES || '3', 10) || 3);

// Hashtags base siempre incluidos — #Shorts es obligatorio para clasificación de YouTube
const BASE_HASHTAGS = ['#Shorts', '#IA', '#Automatizacion', '#HerramientasIA', '#ProductividadDigital'];

// Hashtags adicionales por topic — cubre todos los topics del decision engine
const TOPIC_HASHTAGS = {
  ai_tools:              ['#AITools', '#IA', '#HerramientasIA'],
  automation:            ['#Automatizacion', '#Workflows', '#NoCode'],
  ai_agents:             ['#AgentesIA', '#AI', '#Automation'],
  auto_channels:         ['#CanalAutomatico', '#IA', '#ShortsFactory'],
  productivity:          ['#Productividad', '#Notion', '#Sistemas'],
  ai_video_editing:      ['#EdicionDeVideo', '#Captions', '#IA'],
  content_creation:      ['#CreacionDeContenido', '#Guiones', '#IA'],
  nocode_lowcode:        ['#NoCode', '#LowCode', '#Automatizacion'],
  tech_experiments:      ['#Tech', '#Experimentos', '#IA'],
  digital_opportunities: ['#NegociosDigitales', '#Plantillas', '#IA'],
};

/**
 * Construye el título de YouTube: hook + #Shorts + 1-2 hashtags de topic.
 * Máximo 100 caracteres. #Shorts es obligatorio para clasificación como Short.
 */
function buildYouTubeTitle(script) {
  const topicTags = (TOPIC_HASHTAGS[script.topic] || []).slice(0, 2).join(' ');
  const suffix = `#Shorts ${topicTags}`.trim();
  const maxHookLen = 100 - suffix.length - 1;
  const hook = script.hook.slice(0, maxHookLen);
  return `${hook} ${suffix}`.trim();
}

/**
 * Construye el caption completo para el video.
 */
function buildCaption(script) {
  const hookUpper = script.hook.toUpperCase();
  const topicHashtags = (TOPIC_HASHTAGS[script.topic] || []).slice(0, 2);
  const allHashtags = [...BASE_HASHTAGS, ...topicHashtags, ...(script.hashtags || [])];
  const cta = script.cta || script.soft_cta || script.open_ending || '';

  // Elimina duplicados
  const uniqueHashtags = [...new Set(allHashtags)].slice(0, 10);

  return `${hookUpper} 🧠\n\n${cta}\n\n${uniqueHashtags.join(' ')}`;
}

/**
 * BLOQUEO DURO: Detecta duplicados contra ÚLTIMOS 5 VÍDEOS PUBLICADOS
 * Reglas de bloqueo (CRÍTICAS):
 * - hookSimilarity > 80%
 * - scriptSimilarity > 70%
 * - mismo tema + keywordOverlap > 50%
 *
 * SI se bloquea: shouldRegenerate=true (fuerza nuevo script)
 */
function shouldBlockDuplicate(newScript, videoId) {
  try {
    const publishLogPath = path.resolve('./data/publish-log.json');
    if (!fs.existsSync(publishLogPath)) {
      return { blocked: false, reason: 'no_publish_log' };
    }

    const publishLog = JSON.parse(fs.readFileSync(publishLogPath, 'utf8'));
    const publishedVideos = (publishLog.published || [])
      .filter(v => v.youtubeId) // Solo vídeos con YouTube ID válido
      .slice(-5) // Últimos 5 publicados
      .reverse(); // Más recientes primero

    if (publishedVideos.length === 0) {
      return { blocked: false, reason: 'insufficient_history' };
    }

    const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
    const blockedMatches = [];

    for (const publishedVideo of publishedVideos) {
      const prevScriptPath = path.join(OUTPUT_DIR, publishedVideo.videoId, 'script.json');
      if (!fs.existsSync(prevScriptPath)) {
        continue;
      }

      let prevScript;
      try {
        prevScript = JSON.parse(fs.readFileSync(prevScriptPath, 'utf8'));
      } catch {
        continue;
      }

      // Comparar scripts usando duplicate-detector
      const comparison = duplicateDetector.compareScripts(newScript, prevScript);

      // REGLAS DE BLOQUEO
      // Nota: Si type='EXACT_HOOK_MATCH', score=100 y no hay hookSimilarity/scriptSimilarity
      const hookMatch = comparison.type === 'EXACT_HOOK_MATCH' || (comparison.hookSimilarity && comparison.hookSimilarity > 80);
      const scriptMatch = comparison.scriptSimilarity && comparison.scriptSimilarity > 70;
      const themeAndKeywordsMatch = comparison.sameTopic && comparison.keywordOverlap && comparison.keywordOverlap > 50;

      if (hookMatch || scriptMatch || themeAndKeywordsMatch) {
        blockedMatches.push({
          matchedVideoId: publishedVideo.videoId,
          youtubeId: publishedVideo.youtubeId,
          type: comparison.type || 'SIMILARITY_MATCH',
          score: comparison.score,
          hookSimilarity: comparison.hookSimilarity || (comparison.type === 'EXACT_HOOK_MATCH' ? 100 : 0),
          scriptSimilarity: comparison.scriptSimilarity || 0,
          keywordOverlap: comparison.keywordOverlap || 0,
          sameTopic: comparison.sameTopic || false,
          blockedBy: [
            hookMatch ? 'hookSimilarity' : null,
            scriptMatch ? 'scriptSimilarity' : null,
            themeAndKeywordsMatch ? 'theme_keywords' : null,
          ].filter(Boolean),
        });
      }
    }

    if (blockedMatches.length > 0) {
      logger.error(`[DUPLICATE_BLOCKED] videoId=${videoId} matches=${blockedMatches.length} rule=${blockedMatches[0].blockedBy.join('+')}`);
      logger.error(`[DUPLICATE_SOURCE] matchedVideoId=${blockedMatches[0].matchedVideoId} youtubeId=${blockedMatches[0].youtubeId}`);
      logger.error(`[DUPLICATE_METRICS] hookSim=${blockedMatches[0].hookSimilarity}% scriptSim=${blockedMatches[0].scriptSimilarity}% keywordOvlp=${blockedMatches[0].keywordOverlap}%`);

      return {
        blocked: true,
        reason: 'DUPLICATE_CONTENT_BLOCKED',
        shouldRegenerate: true,
        matchedVideos: blockedMatches,
        details: {
          hookSimilarity: blockedMatches[0].hookSimilarity,
          scriptSimilarity: blockedMatches[0].scriptSimilarity,
          keywordOverlap: blockedMatches[0].keywordOverlap,
        },
      };
    }

    return { blocked: false, reason: 'duplicate_check_pass' };
  } catch (err) {
    logger.warn(`shouldBlockDuplicate check failed: ${err.message}`);
    return { blocked: false, reason: 'check_error' };
  }
}

// ─────────────────────────────────────────────
//  TIKTOK
// ─────────────────────────────────────────────

/**
 * Publica en TikTok usando la Creator API (upload directo).
 * Requiere TIKTOK_ACCESS_TOKEN válido.
 */
async function publishToTikTok(videoPath, script) {
  logger.info(`Publishing to TikTok: ${path.basename(videoPath)}`);

  const caption = buildCaption(script);
  const videoBuffer = fs.readFileSync(videoPath);
  const videoSize = fs.statSync(videoPath).size;

  try {
    // Paso 1: Inicializar upload
    const initResponse = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TIKTOK_ACCESS_TOKEN}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      }
    );

    const { publish_id, upload_url } = initResponse.data.data;

    // Paso 2: Subir el video
    await axios.put(upload_url, videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
      },
      maxBodyLength: Infinity,
      timeout: 120000,
    });

    logger.info(`TikTok upload complete | publish_id: ${publish_id}`);
    return { platform: 'tiktok', publishId: publish_id, status: 'published' };
  } catch (err) {
    const errData = err.response?.data;
    logger.error(`TikTok publish failed: ${JSON.stringify(errData) || err.message}`);
    throw new Error(`TikTok publish error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
//  INSTAGRAM REELS
// ─────────────────────────────────────────────

/**
 * Publica Reels en Instagram vía Graph API.
 * Requiere que el video esté en una URL pública (se sube a un CDN temporal).
 */
async function publishToInstagram(videoUrl, script) {
  logger.info(`Publishing to Instagram Reels`);

  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const caption = buildCaption(script);

  try {
    // Paso 1: Crear container de media
    const containerResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${accountId}/media`,
      {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption,
        share_to_feed: true,
        access_token: accessToken,
      }
    );

    const creationId = containerResponse.data.id;
    logger.debug(`Instagram container created: ${creationId}`);

    // Paso 2: Esperar que el video procese (polling)
    await waitForInstagramProcessing(creationId, accessToken);

    // Paso 3: Publicar
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${accountId}/media_publish`,
      {
        creation_id: creationId,
        access_token: accessToken,
      }
    );

    const mediaId = publishResponse.data.id;
    logger.info(`Instagram published | media_id: ${mediaId}`);
    return { platform: 'instagram', mediaId, status: 'published' };
  } catch (err) {
    logger.error(`Instagram publish failed: ${err.response?.data?.error?.message || err.message}`);
    throw new Error(`Instagram publish error: ${err.message}`);
  }
}

async function waitForInstagramProcessing(creationId, accessToken, maxWait = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const statusRes = await axios.get(`https://graph.facebook.com/v19.0/${creationId}`, {
      params: { fields: 'status_code', access_token: accessToken },
    });

    const status = statusRes.data.status_code;
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error('Instagram video processing failed');

    logger.debug(`Instagram processing status: ${status}, waiting...`);
    await sleep(10000);
  }
  throw new Error('Instagram processing timeout');
}

// ─────────────────────────────────────────────
//  YOUTUBE SHORTS
// ─────────────────────────────────────────────

/**
 * Publica en YouTube Shorts vía YouTube Data API v3.
 *
 * DEFENSA DEFENSIVA: Este function NO debe ser llamado directamente.
 * publishAll() es el único caller autorizado (pasa por guard).
 */
async function publishToYouTube(videoPath, script, _publishGuardContext) {
  // DEFENSIVE GATE: Bloquear llamada directa sin contexto de guard
  if (!_publishGuardContext || _publishGuardContext.allowed !== true) {
    const msg = 'publishToYouTube() called without valid publish guard context — direct calls blocked';
    logger.error(`[PUBLISH_BLOCKED_DIRECT_UPLOAD_CALL] ${msg}`);
    throw new Error(msg);
  }

  const videoId = script?.videoId || script?.id;

  // ═══════════════════════════════════════════════════════════════
  // SLOT-LEVEL IDEMPOTENCY: One video per slot maximum
  // NEW FIX: Prevent principal + backup both publishing to same slot
  // ═══════════════════════════════════════════════════════════════
  let slotLockAcquired = false;
  let slotKey = null;

  if (_publishGuardContext.slotDate && _publishGuardContext.slotTime) {
    const {
      acquireSlotLock,
      markSlotAsFailed,
      markSlotAsPublished,
    } = require('./slot-idempotency-lock.service');

    slotKey = `${_publishGuardContext.slotDate}_${_publishGuardContext.slotTime}`;

    const slotLockResult = acquireSlotLock(
      _publishGuardContext.slotDate,
      _publishGuardContext.slotTime,
      videoId
    );

    if (!slotLockResult.acquired) {
      const msg = slotLockResult.detail || slotLockResult.reason;
      logger.error(`[PUBLISH_BLOCKED_BY_SLOT_LOCK] ${msg}`, {
        slotKey,
        videoId,
        existingLock: slotLockResult.existingLock,
      });
      throw new Error(`Cannot publish: Slot already has publication (${msg})`);
    }

    slotLockAcquired = true;
    logger.info('[SLOT_LOCK_ACQUIRED]', { slotKey, videoId });
  }

  // ═══════════════════════════════════════════════════════════════
  // CRITICAL: ATOMIC IDEMPOTENCY LOCK (VIDEO-LEVEL)
  // Prevents concurrent uploads of same videoId to YouTube
  // ═══════════════════════════════════════════════════════════════
  const lockResult = acquirePublishLock(videoId, {
    source: _publishGuardContext.source,
    reason: 'youtube_upload',
  });

  if (!lockResult.acquired) {
    // Si adquirimos slot lock, necesitamos marcarlo como fallido
    if (slotLockAcquired && slotKey) {
      const { markSlotAsFailed } = require('./slot-idempotency-lock.service');
      markSlotAsFailed(slotKey, videoId, 'Failed to acquire video-level lock');
    }

    const msg = lockResult.error || 'Failed to acquire publish lock';
    logger.error(`[PUBLISH_BLOCKED_BY_IDEMPOTENCY_LOCK] videoId=${videoId} reason=${msg}`);
    throw new Error(`Cannot publish: ${msg}`);
  }

  logger.info(`Publishing to YouTube Shorts`);

  try {
    const accessToken = await getYouTubeAccessToken();
    const caption = buildCaption(script);
    const videoSize = fs.statSync(videoPath).size;

    // Paso 1: Inicializar upload resumible
    const initResponse = await axios.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        snippet: {
          title: buildYouTubeTitle(script),
          description: caption,
          tags: [...BASE_HASHTAGS, ...(TOPIC_HASHTAGS[script.topic] || [])].map((h) => h.replace('#', '')),
          categoryId: '26', // How-to & Style
          defaultLanguage: 'es',
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Length': videoSize,
          'X-Upload-Content-Type': 'video/mp4',
        },
      }
    );

    const uploadUrl = initResponse.headers.location;

    // Paso 2: Upload del archivo
    const videoBuffer = fs.readFileSync(videoPath);
    const uploadResponse = await axios.put(uploadUrl, videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoSize,
        Authorization: `Bearer ${accessToken}`,
      },
      maxBodyLength: Infinity,
      timeout: 300000,
    });

    const publishedYouTubeId = uploadResponse.data.id;
    logger.info(`YouTube Shorts published | video_id: ${publishedYouTubeId}`);

    // Release lock with success
    releasePublishLock(videoId, true, publishedYouTubeId);

    // ═══════════════════════════════════════════════════════════════
    // MARK SLOT AS PUBLISHED (prevents backup from publishing)
    // ═══════════════════════════════════════════════════════════════
    if (slotLockAcquired && slotKey) {
      const { markSlotAsPublished } = require('./slot-idempotency-lock.service');
      markSlotAsPublished(slotKey, videoId, publishedYouTubeId);
      logger.info('[SLOT_LOCK_PUBLISHED]', {
        slotKey,
        videoId,
        youtubeId: publishedYouTubeId,
      });
    }

    return {
      platform: 'youtube',
      videoId: publishedYouTubeId,
      url: `https://www.youtube.com/shorts/${publishedYouTubeId}`,
      status: 'published',
    };
  } catch (err) {
    logger.error(`YouTube publish failed: ${err.response?.data?.error?.message || err.message}`);
    // Release lock with failure - allows retry
    releasePublishLock(videoId, false);

    // ═══════════════════════════════════════════════════════════════
    // MARK SLOT AS FAILED (allows backup attempt)
    // ═══════════════════════════════════════════════════════════════
    if (slotLockAcquired && slotKey) {
      const { markSlotAsFailed } = require('./slot-idempotency-lock.service');
      markSlotAsFailed(slotKey, videoId, err.message);
    }

    throw new Error(`YouTube publish error: ${err.message}`);
  }
}

/**
 * Obtiene access token de YouTube usando refresh token.
 * Si falla, proporciona instrucciones claras para renovar.
 */
async function getYouTubeAccessToken() {
  const hasRefreshToken = Boolean(process.env.YOUTUBE_REFRESH_TOKEN && process.env.YOUTUBE_REFRESH_TOKEN !== 'RELLENAR');

  if (!hasRefreshToken) {
    logger.error('YOUTUBE_OAUTH_MISSING | refresh_token no configurado en .env');
    throw new Error('YOUTUBE_OAUTH_MISSING: YOUTUBE_REFRESH_TOKEN no está en .env o es RELLENAR');
  }

  try {
    logger.debug(`YouTube OAuth: intentando renovación de token...`);
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });
    logger.debug(`YouTube OAuth: token renovado exitosamente`);
    return response.data.access_token;
  } catch (err) {
    const errorCode = err.response?.data?.error || 'UNKNOWN';
    const errorDesc = err.response?.data?.error_description || err.response?.data?.message || err.message;
    const httpStatus = err.response?.status || 'N/A';

    // invalid_grant = token expirado o inválido
    if (errorCode === 'invalid_grant') {
      const msg = `YOUTUBE_OAUTH_INVALID_GRANT: refresh_token está expirado o inválido.\n` +
        `ACCIÓN REQUERIDA: Regenera el token en http://localhost:3001/auth/youtube\n` +
        `O ejecuta: node backend/scripts/check-youtube-oauth.js`;
      logger.error(msg);
      throw new Error(msg);
    }

    const detail = `${errorCode}: ${errorDesc}`;
    logger.error(`YouTube OAuth failed (${httpStatus}): ${detail}`);
    throw new Error(`YouTube OAuth failed (${httpStatus}): ${detail}`);
  }
}

// ─────────────────────────────────────────────
//  PUBLICACIÓN COORDINADA
// ─────────────────────────────────────────────

/**
 * Publica en todas las plataformas disponibles (según tokens configurados).
 * Solo intenta plataformas con credenciales reales (no "RELLENAR").
 *
 * REQUERIDO: source obligatorio para auditoría de seguridad
 *
 * @param {string} videoPath
 * @param {object} script
 * @param {string} videoUrl - optional
 * @param {object} options - { source?, skipPrepublishVisualQC?, slotDate?, slotTime? }
 */
async function publishAll(videoPath, script, videoUrl = null, options = {}) {
  const videoId = script?.videoId || script?.id || path.basename(path.dirname(videoPath || 'unknown'));
  const hasLegacyValidationShape = Boolean(
    script?.data?.prefabScript ||
    script?.prefabScript
  );

  // ═══════════════════════════════════════════════════════════════
  // PUBLISH GUARD: Verificar autorización ANTES de cualquier action
  // ═══════════════════════════════════════════════════════════════
  const source = options.source || options.caller;
  if (!source) {
    logger.error('PUBLISH_GUARD_BLOCKED | videoId', {
      videoId,
      error: 'source requerido',
      received: options,
    });
    return {
      success: false,
      error: 'PUBLISH_GUARD_FAILED',
      reason: 'source es obligatorio (opción options.source)',
      discarded: false,
    };
  }

  const guardResult = assertPublishAllowed({
    videoId,
    source,
    slotDate: options.slotDate,
    slotTime: options.slotTime,
    isManual: options.isManual === true,
  });

  if (!guardResult.allowed) {
    logger.error('PUBLISH_GUARD_BLOCKED | videoId', {
      videoId,
      source,
      reason: guardResult.reason,
      errors: guardResult.errors,
    });
    return {
      success: false,
      error: 'PUBLISH_GUARD_BLOCKED',
      reason: guardResult.reason,
      errors: guardResult.errors,
      discarded: false,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 0: VALIDAR ARCHIVOS LOCALES (PREVIO A TODO)
  // Impide publicar vídeos sin archivos físicos
  // ═══════════════════════════════════════════════════════════════
  if (!videoPath || !fs.existsSync(videoPath)) {
    logger.error('FILES_MISSING | publish', {
      videoId,
      error: 'output.mp4 no existe',
      videoPath,
      exists: videoPath ? fs.existsSync(videoPath) : false,
    });
    return {
      success: false,
      error: 'FILES_MISSING',
      reason: `output.mp4 no existe: ${videoPath}`,
      discarded: true,
    };
  }

  const assPath = path.join(path.dirname(videoPath), 'subtitles.ass');
  if (!fs.existsSync(assPath)) {
    logger.error('FILES_MISSING | publish', {
      videoId,
      error: 'subtitles.ass no existe',
      assPath,
    });
    return {
      success: false,
      error: 'FILES_MISSING',
      reason: `subtitles.ass no existe: ${assPath}`,
      discarded: true,
    };
  }

  logger.info(`NEXT_SLOT_CAPTION_CHECK_START videoId=${videoId}`);
  const captionValidation = validateCaptionsForPublish(videoId);
  if (!captionValidation.ok) {
    logger.error(`NEXT_SLOT_CAPTION_CHECK_BLOCKED reason=${captionValidation.reason} videoId=${videoId}`);
    return {
      success: false,
      error: 'CAPTION_PREPUBLISH_BLOCKED',
      reason: captionValidation.reason,
      discarded: true,
    };
  }
  logger.info(
    `NEXT_SLOT_CAPTION_CHECK_PASS videoId=${videoId} source=${captionValidation.debugData?.source || 'unknown'} driftStatus=${captionValidation.debugData?.drift?.status || 'unknown'}`
  );

  // ═══════════════════════════════════════════════════════════════
  // GATE 0.5: VALIDACIÓN VISUAL PRE-PUBLISH (DETECTA VÍDEOS NEGROS)
  // Impide publicar pantallas negras, sin stream de video, etc.
  // ═══════════════════════════════════════════════════════════════
  if (!options.skipPrepublishVisualQC) {
    const outputDir = path.dirname(videoPath);
    const visualQcResult = await validatePrepublish(videoPath, outputDir, videoId);
    if (!visualQcResult.ok) {
      logger.error(`PREPUBLISH_VISUAL_QC_BLOCKED videoId=${videoId} reasons=${visualQcResult.blockedReasons?.join(',') || 'unknown'}`, {
        videoId,
        blockedReasons: visualQcResult.blockedReasons,
        checks: visualQcResult.checks,
      });
      return {
        success: false,
        error: 'PREPUBLISH_VISUAL_QC_BLOCKED',
        reason: `Video failed visual QC: ${visualQcResult.blockedReasons?.join(', ') || 'unknown'}`,
        details: visualQcResult.checks,
        discarded: true,
      };
    }
    logger.info(`PREPUBLISH_VISUAL_QC_PASS videoId=${videoId}`);
  } else {
    logger.info(`PREPUBLISH_VISUAL_QC_SKIPPED videoId=${videoId} (recovery mode)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 0.7: DETECCIÓN DE DUPLICADOS (BLOQUEO DURO CONTRA ÚLTIMOS 5)
  // Reglas críticas: hookSim>80% OR scriptSim>70% OR (sameTopic + keywordOvlp>50%)
  // ═══════════════════════════════════════════════════════════════
  const scriptData = hasLegacyValidationShape ? (script.data?.prefabScript || script.prefabScript) : script;
  if (scriptData && (scriptData.hook || scriptData.topic)) {
    // HARD BLOCK: Verificar contra últimos 5 vídeos publicados
    const hardBlockCheck = shouldBlockDuplicate(scriptData, videoId);
    if (hardBlockCheck.blocked) {
      return {
        success: false,
        error: 'DUPLICATE_CONTENT_BLOCKED',
        reason: hardBlockCheck.reason,
        shouldRegenerate: hardBlockCheck.shouldRegenerate,
        matchedVideos: hardBlockCheck.matchedVideos,
        details: hardBlockCheck.details,
        discarded: false,
      };
    }

    // ADICIONAL: Verificar contra histórico más amplio (50 vídeos) para warnings
    const duplicateCheck = duplicateDetector.detectDuplicate(scriptData, {
      limit: 50,
      hookExactMatchLimit: 10,
      similarityThreshold: 70,
    });

    duplicateDetector.logDuplicateDetection(videoId, duplicateCheck);

    if (duplicateCheck.isDuplicate) {
      logger.error(`[DUPLICATE_BLOCKED_EXTENDED] videoId=${videoId} reason=${duplicateCheck.blockedReason}`);
      // FASE 3: Record in tracking
      duplicateTracker.recordDuplicateBlock(videoId, duplicateCheck);

      return {
        success: false,
        error: 'DUPLICATE_CONTENT_BLOCKED',
        reason: duplicateCheck.blockedReason,
        similarityScore: duplicateCheck.similarityScore,
        matchedVideos: duplicateCheck.exactHookMatches.length + duplicateCheck.duplicateRisks.length,
        discarded: false,
        shouldRegenerateHook: true,
      };
    } else if (duplicateCheck.warnings.length > 0) {
      logger.warn(`[DUPLICATE_WARNING] videoId=${videoId} similarity=${duplicateCheck.similarityScore}%`);
      duplicateTracker.recordDuplicateWarning(videoId, duplicateCheck.similarityScore);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // GATE 1: VALIDACIÓN SCRIPT + QC HARD
  // ═══════════════════════════════════════════════════════════════
  if (hasLegacyValidationShape) {
    const validation = validateForPublish({
      ...script,
      id: videoId,
      videoId,
    });
    if (!validation.valid) {
      logger.error('PublishAll: video failed validation — REJECTED', {
        videoId,
        failures: validation.failures,
      });

      const doneFilePath = path.resolve(`./queue/done/${videoId}.json`);
      if (fs.existsSync(doneFilePath)) {
        discardInvalidVideo({ ...script, id: videoId }, doneFilePath);
        logger.warn('PublishAll: moved to discarded-invalid-current/', { videoId });
      }

      return {
        success: false,
        error: 'REJECTED_VALIDATION',
        reason: validation.reason,
        failures: validation.failures,
        discarded: true,
      };
    }

    logger.info('PublishAll: video passed validation ✓', {
      videoId,
      duration: validation.duration,
      virality: validation.viralityScore,
      humanity: validation.humanityScore,
    });
  } else {
    logger.info(`PublishAll: legacy validator skipped for ready render | videoId=${videoId}`);
  }

  const results = [];
  const errors = [];
  const runWithRetry = async (platform, fn) => {
    let lastError = null;
    for (let attempt = 1; attempt <= PUBLISH_MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        logger.warn(`${platform}: publish attempt ${attempt}/${PUBLISH_MAX_RETRIES} failed | ${err.message}`);
        if (attempt < PUBLISH_MAX_RETRIES) {
          await sleep(PUBLISH_RETRY_DELAY_MS * attempt);
        }
      }
    }
    throw lastError;
  };

  // TikTok — solo si el token está configurado
  const tiktokToken = process.env.TIKTOK_ACCESS_TOKEN;
  if (tiktokToken && tiktokToken !== 'RELLENAR') {
    try {
      const tiktokResult = await runWithRetry('TikTok', () => publishToTikTok(videoPath, script));
      results.push(tiktokResult);
    } catch (err) {
      errors.push({ platform: 'tiktok', error: err.message });
    }
  } else {
    logger.warn('TikTok: TIKTOK_ACCESS_TOKEN no configurado — saltando');
  }

  // Instagram — solo si hay URL pública y token configurado
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (videoUrl && igToken && igToken !== 'RELLENAR') {
    try {
      const igResult = await runWithRetry('Instagram', () => publishToInstagram(videoUrl, script));
      results.push(igResult);
    } catch (err) {
      errors.push({ platform: 'instagram', error: err.message });
    }
  } else if (!videoUrl || !igToken || igToken === 'RELLENAR') {
    logger.warn('Instagram: token no configurado o sin videoUrl — saltando');
  }

  // YouTube — solo si hay refresh token configurado
  const ytRefresh = process.env.YOUTUBE_REFRESH_TOKEN;
  if (ytRefresh && ytRefresh !== 'RELLENAR') {
    try {
      // Pass guardResult context to publishToYouTube to prevent direct calls
      const ytResult = await runWithRetry('YouTube', () => publishToYouTube(videoPath, script, guardResult));
      results.push(ytResult);

      // AUDIT TRAIL: Registrar publicación autorizada
      if (ytResult && ytResult.videoId) {
        try {
          recordAuthorizedPublish(
            videoId,
            ytResult.videoId,
            source,
            options.slotDate || null,
            options.slotTime || null,
            process.env.OPERATOR || 'system'
          );
        } catch (err) {
          logger.warn(`[audit_trail] Failed to record publish: ${err.message}`);
        }
      }

      // PERFORMANCE TRACKING (non-blocking)
      if (ytResult && ytResult.videoId) {
        try {
          await performanceTracker.trackPublish(videoId, ytResult.videoId, new Date().toISOString());
        } catch (err) {
          logger.warn(`[tracking] Publish tracking failed: ${err.message}`);
        }
      }
    } catch (err) {
      // ⚠️  ESPECIAL: No descartar si OAuth falla con invalid_grant
      // El vídeo es válido, solo el token expiró. Permitir reintento.
      const isOAuthInvalidGrant = err.message?.includes('invalid_grant');
      if (isOAuthInvalidGrant) {
        logger.warn(`YouTube: OAuth token expired (invalid_grant) — video preserved for retry | videoId=${videoId}`);
        // No añadir a errors para no bloquear publish (fallback a otras plataformas)
        // pero tampoco marcar como discarded — el vídeo permanece en ready
      } else {
        errors.push({ platform: 'youtube', error: err.message });
      }
    }
  } else {
    logger.warn('YouTube: YOUTUBE_REFRESH_TOKEN no configurado — saltando');
  }

  if (results.length === 0) {
    const message = errors.length > 0
      ? errors.map((entry) => `${entry.platform}: ${entry.error}`).join(' | ')
      : 'no publish platforms configured';
    throw new Error(`Publish produced no successful platforms: ${message}`);
  }

  return { results, errors };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  publishToTikTok,
  publishToInstagram,
  publishToYouTube,
  publishAll,
  buildCaption,
};
