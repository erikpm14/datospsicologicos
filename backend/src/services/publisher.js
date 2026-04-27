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
const PUBLISH_RETRY_DELAY_MS = Math.max(1000, parseInt(process.env.PUBLISH_RETRY_DELAY_MS || '4000', 10) || 4000);
const PUBLISH_MAX_RETRIES = Math.max(1, parseInt(process.env.PUBLISH_MAX_RETRIES || '3', 10) || 3);

// Hashtags base siempre incluidos — #Shorts es obligatorio para clasificación de YouTube
const BASE_HASHTAGS = ['#Shorts', '#psicologia', '#cerebro', '#hechosdepsicologia', '#mentalidad', '#psychology'];

// Hashtags adicionales por topic — cubre todos los topics del decision engine
const TOPIC_HASHTAGS = {
  habits:            ['#habitos', '#productividad', '#mindset'],
  dopamine:          ['#dopamina', '#motivacion', '#neurociencia'],
  procrastination:   ['#procrastinacion', '#productividad', '#habitos'],
  cognitive_biases:  ['#sesgosCognitivos', '#pensamiento', '#cognitiveScience'],
  body_language:     ['#lenguajecorporal', '#comunicacion', '#bodyLanguage'],
  emotional_patterns:['#emocionalmente', '#inteligenciaEmocional', '#emociones'],
  relationships:     ['#relaciones', '#pareja', '#toxicPeople'],
  decision_making:   ['#decisiones', '#pensamiento', '#racional'],
  attention:         ['#concentracion', '#foco', '#atencion'],
  memory:            ['#memoria', '#aprendizaje', '#neurociencia'],
  social_patterns:   ['#comportamiento', '#social', '#psicologiaSocial'],
  perception:        ['#percepcion', '#realidad', '#mente'],
  motivation:        ['#motivacion', '#exito', '#mindset'],
  self_talk:         ['#autoestima', '#mentePositiva', '#desarrolloPersonal'],
  emotions:          ['#emociones', '#inteligenciaEmocional', '#bienestar'],
  // legacy
  workplace:         ['#trabajo', '#liderazgo', '#inteligenciaEmocional'],
  first_impressions: ['#primeraImpresion', '#social', '#personalidad'],
  social_skills:     ['#habilidadesSociales', '#carisma', '#networking'],
  communication:     ['#comunicacion', '#conversacion', '#influencia'],
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

  // Elimina duplicados
  const uniqueHashtags = [...new Set(allHashtags)].slice(0, 10);

  return `${hookUpper} 🧠\n\n${script.cta}\n\n${uniqueHashtags.join(' ')}`;
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
 */
async function publishToYouTube(videoPath, script) {
  logger.info(`Publishing to YouTube Shorts`);

  const accessToken = await getYouTubeAccessToken();
  const caption = buildCaption(script);
  const videoSize = fs.statSync(videoPath).size;

  try {
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

    const videoId = uploadResponse.data.id;
    logger.info(`YouTube Shorts published | video_id: ${videoId}`);
    return {
      platform: 'youtube',
      videoId,
      url: `https://www.youtube.com/shorts/${videoId}`,
      status: 'published',
    };
  } catch (err) {
    logger.error(`YouTube publish failed: ${err.response?.data?.error?.message || err.message}`);
    throw new Error(`YouTube publish error: ${err.message}`);
  }
}

/**
 * Obtiene access token de YouTube usando refresh token.
 */
async function getYouTubeAccessToken() {
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });
    return response.data.access_token;
  } catch (err) {
    const detail = err.response?.data?.error || err.response?.data || err.message;
    throw new Error(`YouTube OAuth failed (${err.response?.status}): ${JSON.stringify(detail)}`);
  }
}

// ─────────────────────────────────────────────
//  PUBLICACIÓN COORDINADA
// ─────────────────────────────────────────────

/**
 * Publica en todas las plataformas disponibles (según tokens configurados).
 * Solo intenta plataformas con credenciales reales (no "RELLENAR").
 */
async function publishAll(videoPath, script, videoUrl = null) {
  const videoId = script?.videoId || script?.id || path.basename(path.dirname(videoPath || 'unknown'));
  const hasLegacyValidationShape = Boolean(
    script?.data?.prefabScript ||
    script?.prefabScript
  );

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
      const ytResult = await runWithRetry('YouTube', () => publishToYouTube(videoPath, script));
      results.push(ytResult);
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
