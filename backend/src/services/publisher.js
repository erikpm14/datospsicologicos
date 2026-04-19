/**
 * publisher.js
 * Publica videos en TikTok, Instagram Reels y YouTube Shorts.
 * Gestiona horarios óptimos, captions y hashtags dinámicos.
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Hashtags base siempre incluidos
const BASE_HASHTAGS = ['#psychology', '#psicologia', '#mentalidad', '#cerebro', '#hechosdepsicologia'];

// Hashtags adicionales por topic
const TOPIC_HASHTAGS = {
  body_language: ['#lenguajecorporal', '#comunicacion', '#bodyLanguage'],
  cognitive_biases: ['#sesgosCognitivos', '#pensamiento', '#cognitiveScience'],
  relationships: ['#relaciones', '#pareja', '#toxicPeople'],
  workplace: ['#trabajo', '#liderazgo', '#inteligenciaEmocional'],
  first_impressions: ['#primeraImpresion', '#social', '#personalidad'],
  social_skills: ['#habilidadesSociales', '#carisma', '#networking'],
  habits: ['#habitos', '#productividad', '#mindset'],
  communication: ['#comunicacion', '#conversacion', '#influencia'],
};

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
          title: script.hook.slice(0, 100),
          description: caption,
          tags: BASE_HASHTAGS.map((h) => h.replace('#', '')),
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
  const results = [];
  const errors = [];

  // TikTok — solo si el token está configurado
  const tiktokToken = process.env.TIKTOK_ACCESS_TOKEN;
  if (tiktokToken && tiktokToken !== 'RELLENAR') {
    try {
      const tiktokResult = await publishToTikTok(videoPath, script);
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
      const igResult = await publishToInstagram(videoUrl, script);
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
      const ytResult = await publishToYouTube(videoPath, script);
      results.push(ytResult);
    } catch (err) {
      errors.push({ platform: 'youtube', error: err.message });
    }
  } else {
    logger.warn('YouTube: YOUTUBE_REFRESH_TOKEN no configurado — saltando');
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
