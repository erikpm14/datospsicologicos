/**
 * video-classifier.js
 * Clasifica vídeos publicados como WINNER / MEDIO / FLOP.
 *
 * Criterios:
 *   WINNER  → views ≥ 10k  OR (views ≥ 1k AND engagement ≥ 5%)
 *   MEDIO   → views ≥ 500  OR (views ≥ 100 AND engagement ≥ 2%)
 *   FLOP    → el resto
 *
 * Regla de borrado:
 *   NUNCA eliminar vídeos automáticamente (mantener como base histórica).
 *   Solo marcar — la decisión de borrar siempre es manual.
 *
 * Persiste clasificaciones en: backend/data/video-classifications.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const CLASSIFICATIONS_PATH = path.resolve('./data/video-classifications.json');
const VIDEOS_PATH          = path.resolve('./data/videos.json');

// ─────────────────────────────────────────────
//  UMBRALES (configurables por env)
// ─────────────────────────────────────────────

const WINNER_VIEWS      = parseInt(process.env.WINNER_VIEWS       || '10000');
const WINNER_ALT_VIEWS  = parseInt(process.env.WINNER_ALT_VIEWS   || '1000');
const WINNER_ALT_ENG    = parseFloat(process.env.WINNER_ALT_ENG   || '0.05');
const MEDIO_VIEWS       = parseInt(process.env.MEDIO_VIEWS        || '500');
const MEDIO_ALT_VIEWS   = parseInt(process.env.MEDIO_ALT_VIEWS    || '100');
const MEDIO_ALT_ENG     = parseFloat(process.env.MEDIO_ALT_ENG    || '0.02');

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function readJSON(file, def) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return def; }
}

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────
//  CLASIFICACIÓN
// ─────────────────────────────────────────────

/**
 * Clasifica un único vídeo.
 * @param {Object} video - registro de analytics-tracker
 * @returns {'WINNER'|'MEDIO'|'FLOP'}
 */
function classifyVideo(video) {
  const views      = video.tiktok_views || video.youtube_views || video.max_views || 0;
  const likes      = video.tiktok_likes || video.youtube_likes || 0;
  const comments   = video.tiktok_comments || video.youtube_comments || 0;
  const engagement = views > 0 ? (likes + comments) / views : 0;

  if (
    views >= WINNER_VIEWS ||
    (views >= WINNER_ALT_VIEWS && engagement >= WINNER_ALT_ENG)
  ) return 'WINNER';

  if (
    views >= MEDIO_VIEWS ||
    (views >= MEDIO_ALT_VIEWS && engagement >= MEDIO_ALT_ENG)
  ) return 'MEDIO';

  return 'FLOP';
}

// ─────────────────────────────────────────────
//  CLASIFICACIÓN EN LOTE
// ─────────────────────────────────────────────

/**
 * Clasifica todos los vídeos publicados y guarda el resultado.
 * Solo actualiza las clasificaciones que han cambiado.
 *
 * @returns {{ winners, medios, flops, total, changed }}
 */
function classifyAllVideos() {
  const videos          = readJSON(VIDEOS_PATH, []) || [];
  const existing        = readJSON(CLASSIFICATIONS_PATH, {}) || {};
  const published       = videos.filter(v => v.status === 'published' || v.published_at);

  if (published.length === 0) return { winners: 0, medios: 0, flops: 0, total: 0, changed: 0 };

  const updated = { ...existing };
  let changed   = 0;

  for (const video of published) {
    const classification = classifyVideo(video);
    const views          = video.tiktok_views || video.youtube_views || video.max_views || 0;
    const likes          = video.tiktok_likes || video.youtube_likes || 0;
    const engagement     = views > 0 ? parseFloat(((likes) / views).toFixed(4)) : 0;

    const prev = existing[video.id];
    const now  = {
      classification,
      views,
      likes,
      engagement,
      topic:       video.topic,
      hook:        video.hook,
      publishedAt: video.published_at,
      classifiedAt:new Date().toISOString(),
    };

    if (!prev || prev.classification !== classification || prev.views !== views) {
      updated[video.id] = now;
      changed++;
    }
  }

  if (changed > 0) {
    writeJSON(CLASSIFICATIONS_PATH, updated);
  }

  const values    = Object.values(updated);
  const winners   = values.filter(v => v.classification === 'WINNER').length;
  const medios    = values.filter(v => v.classification === 'MEDIO').length;
  const flops     = values.filter(v => v.classification === 'FLOP').length;

  if (changed > 0) {
    logger.info(`Video Classifier: ${changed} updated | WINNER=${winners} MEDIO=${medios} FLOP=${flops}`);
  }

  return { winners, medios, flops, total: values.length, changed };
}

// ─────────────────────────────────────────────
//  CONSULTAS
// ─────────────────────────────────────────────

/**
 * Devuelve los vídeos WINNER con sus datos.
 */
function getWinners(limit = 20) {
  const data = readJSON(CLASSIFICATIONS_PATH, {}) || {};
  return Object.entries(data)
    .filter(([, v]) => v.classification === 'WINNER')
    .sort(([, a], [, b]) => b.views - a.views)
    .slice(0, limit)
    .map(([id, v]) => ({ id, ...v }));
}

/**
 * Devuelve los FLOPs (para análisis, no para borrar).
 */
function getFlops(limit = 20) {
  const data = readJSON(CLASSIFICATIONS_PATH, {}) || {};
  return Object.entries(data)
    .filter(([, v]) => v.classification === 'FLOP')
    .sort(([, a], [, b]) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, limit)
    .map(([id, v]) => ({ id, ...v }));
}

/**
 * Informe completo para el dashboard.
 */
function getClassificationReport() {
  const data    = readJSON(CLASSIFICATIONS_PATH, {}) || {};
  const values  = Object.values(data);

  if (values.length === 0) {
    return { status: 'no_data', winners: 0, medios: 0, flops: 0, total: 0 };
  }

  const byTopic = {};
  for (const v of values) {
    if (!v.topic) continue;
    if (!byTopic[v.topic]) byTopic[v.topic] = { WINNER: 0, MEDIO: 0, FLOP: 0 };
    byTopic[v.topic][v.classification] = (byTopic[v.topic][v.classification] || 0) + 1;
  }

  const topWinnerTopics = Object.entries(byTopic)
    .sort(([, a], [, b]) => b.WINNER - a.WINNER)
    .slice(0, 5)
    .map(([topic, counts]) => ({ topic, ...counts }));

  return {
    status:          'ok',
    winners:         values.filter(v => v.classification === 'WINNER').length,
    medios:          values.filter(v => v.classification === 'MEDIO').length,
    flops:           values.filter(v => v.classification === 'FLOP').length,
    total:           values.length,
    topWinnerTopics,
    thresholds: {
      winner:  `views ≥ ${WINNER_VIEWS} OR (views ≥ ${WINNER_ALT_VIEWS} AND eng ≥ ${WINNER_ALT_ENG * 100}%)`,
      medio:   `views ≥ ${MEDIO_VIEWS} OR (views ≥ ${MEDIO_ALT_VIEWS} AND eng ≥ ${MEDIO_ALT_ENG * 100}%)`,
    },
    note: 'Los vídeos NUNCA se eliminan automáticamente — solo clasificación.',
  };
}

module.exports = {
  classifyVideo,
  classifyAllVideos,
  getWinners,
  getFlops,
  getClassificationReport,
};
