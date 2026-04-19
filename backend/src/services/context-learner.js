/**
 * context-learner.js
 * Construye una matriz de rendimiento (topic × hookType) a partir de vídeos publicados.
 *
 * Responde a:
 *   "¿Qué tipo de hook funciona mejor para ESTE topic?"
 *   "¿Qué combinación topic+hookType tiene mayor engagement?"
 *
 * Persiste en: backend/data/context-matrix.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const MATRIX_PATH   = path.resolve('./data/context-matrix.json');
const VIDEOS_PATH   = path.resolve('./data/videos.json');
const GROWTH_LOG_PATH = path.resolve('./data/growth-log.json');

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
//  CONSTRUCCIÓN DE MATRIZ
// ─────────────────────────────────────────────

/**
 * Reconstruye la matriz topic × hookType desde los datos de vídeos y growth-log.
 * Se llama periódicamente (cada vez que analytics-tracker actualiza métricas).
 */
function rebuildMatrix() {
  const videos    = readJSON(VIDEOS_PATH, []) || [];
  const growthLog = readJSON(GROWTH_LOG_PATH, []) || [];

  // Construir mapa jobId → hookType desde el growth log
  const jobHookMap = {};
  for (const entry of growthLog) {
    if (entry.jobId && entry.hookType) {
      jobHookMap[entry.jobId] = entry.abHookType || entry.hookType;
    }
  }

  const matrix = {}; // { topic: { hookType: { count, views, likes, engagement, viralityScores } } }

  for (const video of videos) {
    const topic    = video.topic;
    const hookType = jobHookMap[video.id] || video.hookType || 'unknown';

    if (!topic) continue;

    const views    = video.tiktok_views || video.youtube_views || video.max_views || 0;
    const likes    = video.tiktok_likes || video.youtube_likes || 0;
    const score    = video.virality_score || video.viralityScore || 0;

    if (!matrix[topic]) matrix[topic] = {};
    if (!matrix[topic][hookType]) {
      matrix[topic][hookType] = { count: 0, totalViews: 0, totalLikes: 0, totalScore: 0 };
    }

    const cell = matrix[topic][hookType];
    cell.count++;
    cell.totalViews += views;
    cell.totalLikes += likes;
    cell.totalScore += score;
  }

  // Calcular promedios
  const computed = {};
  for (const [topic, hooks] of Object.entries(matrix)) {
    computed[topic] = {};
    for (const [hookType, cell] of Object.entries(hooks)) {
      const avgViews      = cell.count > 0 ? Math.round(cell.totalViews / cell.count) : 0;
      const avgLikes      = cell.count > 0 ? Math.round(cell.totalLikes / cell.count) : 0;
      const avgScore      = cell.count > 0 ? parseFloat((cell.totalScore / cell.count).toFixed(1)) : 0;
      const avgEngagement = avgViews > 0 ? parseFloat((avgLikes / avgViews).toFixed(4)) : 0;

      computed[topic][hookType] = {
        count:         cell.count,
        avgViews,
        avgLikes,
        avgScore,
        avgEngagement,
      };
    }
  }

  // Top performers: las 10 combinaciones topic+hookType con mayor engagement
  const topPerformers = [];
  for (const [topic, hooks] of Object.entries(computed)) {
    for (const [hookType, stats] of Object.entries(hooks)) {
      if (stats.count >= 2 && stats.avgViews >= 100) {
        topPerformers.push({ topic, hookType, ...stats });
      }
    }
  }
  topPerformers.sort((a, b) => b.avgEngagement - a.avgEngagement);

  const result = {
    matrix: computed,
    topPerformers: topPerformers.slice(0, 20),
    totalVideos: videos.length,
    lastUpdated: new Date().toISOString(),
  };

  writeJSON(MATRIX_PATH, result);
  logger.info(`Context Learner: matrix rebuilt | ${Object.keys(computed).length} topics | top: ${topPerformers[0] ? `${topPerformers[0].topic}+${topPerformers[0].hookType}` : 'none'}`);

  return result;
}

// ─────────────────────────────────────────────
//  CONSULTAS
// ─────────────────────────────────────────────

/**
 * Devuelve el hookType con mejor engagement para un topic dado.
 * Si no hay datos suficientes, devuelve null (el decision-engine usa sus pesos por defecto).
 *
 * @param {string} topic
 * @param {number} minSamples - mínimo de vídeos para considerar válido el dato
 * @returns {{ hookType: string, avgEngagement: number, confidence: 'high'|'low' } | null}
 */
function getBestHookTypeForTopic(topic, minSamples = 2) {
  const matrix = readJSON(MATRIX_PATH, null);
  if (!matrix?.matrix?.[topic]) return null;

  const hooks = Object.entries(matrix.matrix[topic])
    .filter(([, stats]) => stats.count >= minSamples)
    .sort(([, a], [, b]) => b.avgEngagement - a.avgEngagement);

  if (hooks.length === 0) return null;

  const [hookType, stats] = hooks[0];
  return {
    hookType,
    avgEngagement: stats.avgEngagement,
    avgViews:      stats.avgViews,
    confidence:    stats.count >= 5 ? 'high' : 'low',
  };
}

/**
 * Devuelve una recomendación contextual para el decision-engine.
 * Incluye el mejor hookType y los ángulos con mejor rendimiento histórico.
 *
 * @param {string} topic
 * @returns {{ hookType?: string, notes: string[] }}
 */
function getContextRecommendation(topic) {
  const matrix = readJSON(MATRIX_PATH, null);
  const notes  = [];

  if (!matrix?.matrix?.[topic]) {
    return { hookType: null, notes: ['Sin datos históricos para este topic'] };
  }

  const hooks = Object.entries(matrix.matrix[topic])
    .filter(([, s]) => s.count >= 1)
    .sort(([, a], [, b]) => b.avgEngagement - a.avgEngagement);

  let bestHookType = null;
  if (hooks.length > 0) {
    const [best, stats] = hooks[0];
    bestHookType = stats.count >= 2 ? best : null;
    notes.push(`Mejor hook type: "${best}" (${stats.count} muestras, engagement ${(stats.avgEngagement * 100).toFixed(1)}%)`);
  }

  if (hooks.length > 1) {
    const [worst, wStats] = hooks[hooks.length - 1];
    notes.push(`Peor hook type: "${worst}" (engagement ${(wStats.avgEngagement * 100).toFixed(1)}%)`);
  }

  // Top performers globales del mismo topic
  const topForTopic = (matrix.topPerformers || []).filter(p => p.topic === topic).slice(0, 3);
  if (topForTopic.length > 0) {
    notes.push(`Mejores combinaciones: ${topForTopic.map(p => `${p.hookType}(${p.avgViews} views)`).join(', ')}`);
  }

  return { hookType: bestHookType, notes };
}

/**
 * Informe completo de patrones aprendidos.
 * Usado por GET /api/learning/context
 */
function getLearningReport() {
  const matrix = readJSON(MATRIX_PATH, null);

  if (!matrix) {
    return {
      status: 'no_data',
      message: 'Sin datos de aprendizaje. Se generarán cuando haya vídeos publicados.',
      matrix: {},
      topPerformers: [],
      lastUpdated: null,
    };
  }

  // Insights rápidos
  const insights = [];

  if (matrix.topPerformers?.length > 0) {
    const top = matrix.topPerformers[0];
    insights.push(`Combinación top: ${top.topic} + ${top.hookType} → ${(top.avgEngagement * 100).toFixed(1)}% engagement, ${top.avgViews} views/vídeo`);
  }

  // Tipo de hook dominante
  const hookTypeCounts = {};
  for (const [, hooks] of Object.entries(matrix.matrix || {})) {
    for (const [hookType, stats] of Object.entries(hooks)) {
      if (!hookTypeCounts[hookType]) hookTypeCounts[hookType] = { total: 0, views: 0 };
      hookTypeCounts[hookType].total += stats.count;
      hookTypeCounts[hookType].views += stats.avgViews * stats.count;
    }
  }

  const hookRanking = Object.entries(hookTypeCounts)
    .sort(([, a], [, b]) => (b.views / (b.total || 1)) - (a.views / (a.total || 1)));

  if (hookRanking.length > 0) {
    const [bestHook] = hookRanking[0];
    insights.push(`Hook type con más views promedio: "${bestHook}"`);
  }

  return {
    status: 'ok',
    totalVideos:   matrix.totalVideos,
    topicsLearned: Object.keys(matrix.matrix || {}).length,
    topPerformers: matrix.topPerformers?.slice(0, 10) || [],
    hookRanking:   hookRanking.map(([type, stats]) => ({
      type,
      totalVideos: stats.total,
      avgViews:    Math.round(stats.views / (stats.total || 1)),
    })),
    insights,
    lastUpdated: matrix.lastUpdated,
  };
}

module.exports = {
  rebuildMatrix,
  getBestHookTypeForTopic,
  getContextRecommendation,
  getLearningReport,
};
