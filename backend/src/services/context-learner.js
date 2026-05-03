/**
 * context-learner.js
 * Construye una matriz de rendimiento (topic × hookType) a partir de vídeos publicados.
 * Incluye motor de aprendizaje: ajusta pesos por topic basándose en tasas de aceptación
 * y analiza fracasos con Claude para mejorar la generación futura.
 *
 * Persiste en: backend/data/context-matrix.json
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');
const { callAnthropicWithTimeout } = require('../utils/llm-call');

const MATRIX_PATH        = path.resolve('./data/context-matrix.json');
const VIDEOS_PATH        = path.resolve('./data/videos.json');
const GROWTH_LOG_PATH    = path.resolve('./data/growth-log.json');
const REJECTED_LOG_PATH  = path.resolve('./data/rejected-scripts.json');

// Umbrales del motor de aprendizaje
const MIN_SAMPLES_FOR_WEIGHT   = 5;   // mínimo de intentos por topic para ajustar peso
const HIGH_ACCEPTANCE_RATE     = 0.6; // >60% aprobados → boost ×1.3
const LOW_ACCEPTANCE_RATE      = 0.2; // <20% aprobados → penalty ×0.7
const MIN_REJECTED_FOR_ANALYSIS = 8;  // mínimo rechazos por topic para análisis Claude
const LEARNING_CYCLE_INTERVAL  = 20;  // ejecutar ciclo cada 20 generaciones

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

// ─────────────────────────────────────────────
//  MOTOR DE APRENDIZAJE
// ─────────────────────────────────────────────

/**
 * Calcula tasas de aceptación por topic a partir del growth-log y rejected-scripts.
 * Devuelve { topic: { accepted, rejected, rate } }
 */
function _computeAcceptanceRates() {
  const growthLog = readJSON(GROWTH_LOG_PATH, []);
  const rejected  = readJSON(REJECTED_LOG_PATH, []);

  const stats = {};

  for (const entry of growthLog) {
    const t = entry.topic;
    if (!t) continue;
    if (!stats[t]) stats[t] = { accepted: 0, rejected: 0 };
    stats[t].accepted++;
  }

  for (const entry of rejected) {
    const t = entry.topic;
    if (!t) continue;
    if (!stats[t]) stats[t] = { accepted: 0, rejected: 0 };
    stats[t].rejected++;
  }

  for (const t of Object.keys(stats)) {
    const s = stats[t];
    const total = s.accepted + s.rejected;
    s.rate  = total > 0 ? s.accepted / total : 0.5;
    s.total = total;
  }

  return stats;
}

/**
 * Ajusta multiplicadores por topic basándose en tasas de aceptación.
 * Topics que pasan el filtro >60% suben; <20% bajan.
 * Guarda resultado en context-matrix.json bajo `topicWeights`.
 */
function adjustTopicWeights() {
  const matrix  = readJSON(MATRIX_PATH, {});
  const rates   = _computeAcceptanceRates();
  const weights = matrix.topicWeights || {};
  const changes = [];

  for (const [topic, stats] of Object.entries(rates)) {
    if (stats.total < MIN_SAMPLES_FOR_WEIGHT) continue;

    const current = weights[topic]?.multiplier ?? 1.0;
    let   next    = current;

    if (stats.rate >= HIGH_ACCEPTANCE_RATE) {
      next = Math.min(parseFloat((current * 1.3).toFixed(3)), 1.8);
    } else if (stats.rate <= LOW_ACCEPTANCE_RATE) {
      next = Math.max(parseFloat((current * 0.7).toFixed(3)), 0.4);
    } else {
      // Deriva suave hacia 1.0
      next = parseFloat((current * 0.95 + 0.05).toFixed(3));
    }

    if (next !== current) {
      changes.push({ topic, from: current, to: next, rate: stats.rate, samples: stats.total });
    }

    weights[topic] = {
      multiplier:   next,
      acceptanceRate: parseFloat(stats.rate.toFixed(3)),
      samples:      stats.total,
      updatedAt:    new Date().toISOString(),
    };
  }

  matrix.topicWeights = weights;
  writeJSON(MATRIX_PATH, matrix);

  if (changes.length > 0) {
    for (const c of changes) {
      logger.info(`Learning: topic weight "${c.topic}" ${c.from.toFixed(2)} → ${c.to.toFixed(2)} (rate=${(c.rate*100).toFixed(0)}% accept, n=${c.samples})`);
    }
  } else {
    logger.info('Learning: topic weights stable — no changes');
  }

  return weights;
}

/**
 * Para los topics con muchos rechazos, llama a Claude para obtener un análisis
 * de por qué los scripts no pasan el filtro y qué cambiar.
 * Guarda análisis en context-matrix.json bajo `failureAnalyses`.
 */
async function analyzeFailuresWithClaude() {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const rejected = readJSON(REJECTED_LOG_PATH, []);
  const matrix   = readJSON(MATRIX_PATH, {});
  const analyses = matrix.failureAnalyses || {};

  // Agrupar rechazos por topic
  const byTopic = {};
  for (const r of rejected) {
    if (!r.topic) continue;
    if (!byTopic[r.topic]) byTopic[r.topic] = [];
    byTopic[r.topic].push(r);
  }

  let analyzed = 0;

  for (const [topic, items] of Object.entries(byTopic)) {
    if (items.length < MIN_REJECTED_FOR_ANALYSIS) continue;

    // No reanalizar si el análisis es reciente (<48h) y hay suficientes muestras del mismo tamaño
    const existing = analyses[topic];
    if (existing) {
      const ageHours = (Date.now() - new Date(existing.analyzedAt).getTime()) / 3_600_000;
      if (ageHours < 48 && existing.sampleSize >= items.length - 3) continue;
    }

    const sample = items.slice(0, 6).map(r =>
      `- Hook: "${r.hook?.slice(0, 80)}" | virality=${r.viralityScore} | reason=${r.reason}`
    ).join('\n');

    const avgScore = items.reduce((s, r) => s + (r.viralityScore || 0), 0) / items.length;

    try {
      const msg = await callAnthropicWithTimeout(client, {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{
          role:    'user',
          content: `Soy un bot de YouTube Shorts de psicología en español. Estos scripts del topic "${topic}" son rechazados por score de viralidad bajo (media ${avgScore.toFixed(0)}/100, umbral 78):\n\n${sample}\n\nDa 3 razones concretas del fallo y 2 estrategias específicas para mejorar los scripts de "${topic}". Máximo 4 líneas.`,
        }],
      }, { label: `learning-${topic}` });

      analyses[topic] = {
        analysis:    msg.content[0].text.trim(),
        sampleSize:  items.length,
        avgScore:    parseFloat(avgScore.toFixed(1)),
        analyzedAt:  new Date().toISOString(),
      };

      logger.info(`Learning: failure analysis done for topic="${topic}" (${items.length} samples, avg=${avgScore.toFixed(0)})`);
      analyzed++;
    } catch (err) {
      logger.warn(`Learning: Claude failure analysis failed for "${topic}": ${err.message}`);
    }
  }

  matrix.failureAnalyses = analyses;
  writeJSON(MATRIX_PATH, matrix);

  return { analyzed, topics: Object.keys(analyses) };
}

/**
 * Ciclo completo de aprendizaje. Llamar cada LEARNING_CYCLE_INTERVAL generaciones.
 *
 * 1. Reconstruye matriz topic×hookType
 * 2. Ajusta pesos por topic según tasa de aceptación
 * 3. Analiza fracasos con Claude (solo topics con muchos rechazos)
 */
async function runLearningCycle() {
  const growthLog = readJSON(GROWTH_LOG_PATH, []);

  // Ejecutar solo cada N generaciones
  if (growthLog.length % LEARNING_CYCLE_INTERVAL !== 0) return null;

  logger.info(`Learning Engine: cycle triggered at generation #${growthLog.length}`);

  rebuildMatrix();
  const weights  = adjustTopicWeights();
  const failures = await analyzeFailuresWithClaude();

  logger.info(`Learning Engine: done | weights=${Object.keys(weights).length} topics | failures analyzed=${failures.analyzed}`);

  return { weights, failures };
}

/**
 * Devuelve el multiplicador de score para un topic dado.
 * Usado por growth-engine antes de evaluar el umbral de aceptación.
 *
 * @param {string} topic
 * @returns {number} multiplicador entre 0.4 y 1.8 (1.0 = sin ajuste)
 */
function getTopicWeight(topic) {
  const matrix = readJSON(MATRIX_PATH, {});
  return matrix.topicWeights?.[topic]?.multiplier ?? 1.0;
}

/**
 * Devuelve el análisis de fracasos de Claude para un topic, si existe.
 * Usado por content-generator para enriquecer el contexto del prompt.
 *
 * @param {string} topic
 * @returns {string|null}
 */
function getFailureAnalysis(topic) {
  const matrix = readJSON(MATRIX_PATH, {});
  return matrix.failureAnalyses?.[topic]?.analysis ?? null;
}

module.exports = {
  rebuildMatrix,
  getBestHookTypeForTopic,
  getContextRecommendation,
  getLearningReport,
  // Learning engine
  runLearningCycle,
  adjustTopicWeights,
  analyzeFailuresWithClaude,
  getTopicWeight,
  getFailureAnalysis,
};
