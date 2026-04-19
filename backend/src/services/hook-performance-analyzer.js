/**
 * hook-performance-analyzer.js
 *
 * Analiza el rendimiento real de hooks por tipo, patrón y topic.
 * Combina earlyScore (señal rápida, 1-24h) con performance histórico final.
 *
 * earlyScore = likeRate×0.20 + commentRate×0.25 + shareRate×0.35 + velocity×0.20
 * Windows: 1-3h/200v/1.5x  |  6-12h/500v/1.3x  |  12-24h/1000v/1.2x
 *
 * Genera:
 *   backend/data/hook-performance-advanced.json  — análisis completo
 *   backend/data/top-hooks.json                  — top 20% para decision engine
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR      = path.resolve('./data');
const VIDEOS_FILE   = path.join(DATA_DIR, 'videos.json');
const METRICS_FILE  = path.join(DATA_DIR, 'metrics.json');
const ADVANCED_FILE = path.join(DATA_DIR, 'hook-performance-advanced.json');
const TOP_HOOKS_FILE = path.join(DATA_DIR, 'top-hooks.json');

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function readJSON(file, def = []) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return def; }
}

function writeJSON(file, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────
//  EARLY SCORE (Part 6)
// ─────────────────────────────────────────────

/**
 * Calcula earlyScore para un video dado su primera métrica disponible.
 * Normaliza velocity a 0-1 usando 500 views/h como referencia.
 *
 * @returns {{ earlyScore: number, window: string, multiplier: number } | null}
 */
function calcEarlyScore(video, metricsForVideo) {
  if (!video.published_at || metricsForVideo.length === 0) return null;

  const publishedAt = new Date(video.published_at).getTime();
  const now         = Date.now();

  // Buscar la métrica más cercana a las primeras 24h
  const earlyMetrics = metricsForVideo
    .map(m => {
      const hoursLive = (new Date(m.recorded_at).getTime() - publishedAt) / 3600000;
      return { ...m, hoursLive };
    })
    .filter(m => m.hoursLive >= 0.5 && m.hoursLive <= 24)
    .sort((a, b) => a.hoursLive - b.hoursLive);

  if (earlyMetrics.length === 0) return null;

  const m = earlyMetrics[0];
  const { views = 0, likes = 0, comments = 0, shares = 0, hoursLive } = m;

  if (views === 0) return null;

  // Tasas de engagement
  const likeRate    = likes    / views;
  const commentRate = comments / views;
  const shareRate   = shares   / views;

  // Velocity normalizada (500 views/h = score 1.0)
  const velocityRaw        = views / Math.max(hoursLive, 0.5);
  const velocityNormalized = Math.min(velocityRaw / 500, 1);

  const rawScore = likeRate * 0.20 + commentRate * 0.25 + shareRate * 0.35 + velocityNormalized * 0.20;

  // Ventana temporal y multiplicador
  let window = 'beyond_24h', multiplier = 1.0;
  if (hoursLive <= 3 && views >= 200) {
    window = '1-3h'; multiplier = 1.5;
  } else if (hoursLive <= 12 && views >= 500) {
    window = '6-12h'; multiplier = 1.3;
  } else if (hoursLive <= 24 && views >= 1000) {
    window = '12-24h'; multiplier = 1.2;
  } else if (hoursLive <= 3) {
    window = '1-3h_low_views'; multiplier = 1.0;
  } else if (hoursLive <= 12) {
    window = '6-12h_low_views'; multiplier = 1.0;
  } else {
    window = '12-24h_low_views'; multiplier = 1.0;
  }

  const earlyScore = parseFloat((rawScore * multiplier * 100).toFixed(2));

  return { earlyScore, window, multiplier, hoursLive: Math.round(hoursLive * 10) / 10, views };
}

// ─────────────────────────────────────────────
//  ANÁLISIS PRINCIPAL (Part 7 + 8)
// ─────────────────────────────────────────────

function analyzeHookPerformance() {
  const videos  = readJSON(VIDEOS_FILE);
  const metrics = readJSON(METRICS_FILE);

  if (videos.length === 0) {
    logger.info('HookAnalyzer: no videos to analyze');
    return null;
  }

  // Indexar métricas por video_id
  const metricsByVideo = {};
  for (const m of metrics) {
    if (!metricsByVideo[m.video_id]) metricsByVideo[m.video_id] = [];
    metricsByVideo[m.video_id].push(m);
  }

  // Máximas métricas por video (performance final histórico)
  const videoMaxMetrics = {};
  for (const [vid, mList] of Object.entries(metricsByVideo)) {
    videoMaxMetrics[vid] = mList.reduce((best, m) => {
      return (!best || m.views > best.views) ? m : best;
    }, null);
  }

  // Enriquecer cada video con earlyScore + max metrics
  const enriched = videos
    .filter(v => v.status === 'published')
    .map(v => {
      const script   = v.script_json || {};
      const hookType = script.hookType || script.growthContext?.hookType || 'unknown';
      const topic    = v.topic || script.topic || 'unknown';
      const hook     = v.hook || script.hook || '';
      const maxM     = videoMaxMetrics[v.id] || null;
      const early    = calcEarlyScore(v, metricsByVideo[v.id] || []);

      return {
        id:               v.id,
        hook,
        topic,
        hookType,
        viralityScore:    v.virality_score || script.viralityScore || 0,
        formatMatchScore: script.formatMatchScore || 0,
        emotionalImpact:  script.emotionalImpactScore || 0,
        contentVersion:   script.contentVersion || 'v1',
        publishedAt:      v.published_at,
        maxViews:         maxM?.views         || 0,
        maxLikes:         maxM?.likes         || 0,
        maxComments:      maxM?.comments      || 0,
        maxShares:        maxM?.shares        || 0,
        maxEngagement:    maxM?.engagement_rate || 0,
        earlyScore:       early?.earlyScore   || null,
        earlyWindow:      early?.window       || null,
        earlyViews:       early?.views        || null,
      };
    });

  if (enriched.length === 0) {
    logger.info('HookAnalyzer: no published videos with data');
    return null;
  }

  // ──────────────────────────────────────────
  //  POR HOOK TYPE
  // ──────────────────────────────────────────
  const hookTypeMap = {};
  for (const v of enriched) {
    const ht = v.hookType;
    if (!hookTypeMap[ht]) hookTypeMap[ht] = { hookType: ht, videos: [] };
    hookTypeMap[ht].videos.push(v);
  }

  const hookTypeStats = Object.values(hookTypeMap).map(({ hookType, videos: vs }) => {
    const withViews    = vs.filter(v => v.maxViews > 0);
    const withEarly    = vs.filter(v => v.earlyScore !== null);
    const avgViews     = withViews.length ? Math.round(withViews.reduce((s, v) => s + v.maxViews, 0) / withViews.length) : 0;
    const avgEng       = withViews.length ? parseFloat((withViews.reduce((s, v) => s + v.maxEngagement, 0) / withViews.length).toFixed(2)) : 0;
    const avgVirality  = vs.length ? Math.round(vs.reduce((s, v) => s + v.viralityScore, 0) / vs.length) : 0;
    const avgEarlyScore = withEarly.length ? parseFloat((withEarly.reduce((s, v) => s + v.earlyScore, 0) / withEarly.length).toFixed(2)) : null;

    // Win rate: top 20% de todos los videos con views > 0
    const allViewsSorted = enriched.filter(v => v.maxViews > 0).map(v => v.maxViews).sort((a, b) => a - b);
    const p80Views = allViewsSorted.length >= 5 ? allViewsSorted[Math.floor(allViewsSorted.length * 0.8)] : 0;
    const winners  = vs.filter(v => p80Views > 0 && v.maxViews >= p80Views);
    const winRate  = vs.length > 0 ? parseFloat((winners.length / vs.length * 100).toFixed(1)) : 0;

    return {
      hookType,
      count:       vs.length,
      avgViews,
      avgEngagement: avgEng,
      avgVirality,
      avgEarlyScore,
      winRate,
      topHooks:    [...vs].sort((a, b) => b.maxViews - a.maxViews).slice(0, 3).map(v => ({
        hook: v.hook, topic: v.topic, views: v.maxViews, earlyScore: v.earlyScore,
      })),
    };
  }).sort((a, b) => b.avgViews - a.avgViews);

  // ──────────────────────────────────────────
  //  POR TOPIC
  // ──────────────────────────────────────────
  const topicMap = {};
  for (const v of enriched) {
    const t = v.topic;
    if (!topicMap[t]) topicMap[t] = { topic: t, videos: [] };
    topicMap[t].videos.push(v);
  }

  const topicStats = Object.values(topicMap).map(({ topic, videos: vs }) => {
    const withViews = vs.filter(v => v.maxViews > 0);
    const avgViews  = withViews.length ? Math.round(withViews.reduce((s, v) => s + v.maxViews, 0) / withViews.length) : 0;
    const avgEng    = withViews.length ? parseFloat((withViews.reduce((s, v) => s + v.maxEngagement, 0) / withViews.length).toFixed(2)) : 0;

    // Best hook type for this topic
    const htMap = {};
    for (const v of vs) {
      if (!htMap[v.hookType]) htMap[v.hookType] = [];
      htMap[v.hookType].push(v.maxViews);
    }
    const bestHookType = Object.entries(htMap)
      .map(([ht, views]) => ({ ht, avgV: views.reduce((s, v) => s + v, 0) / views.length }))
      .sort((a, b) => b.avgV - a.avgV)[0]?.ht || null;

    return {
      topic,
      count:       vs.length,
      avgViews,
      avgEngagement: avgEng,
      bestHookType,
      recentTrend: calcTrend(vs),
    };
  }).sort((a, b) => b.avgViews - a.avgViews);

  // ──────────────────────────────────────────
  //  INSIGHTS AUTOMÁTICOS (Part 8)
  // ──────────────────────────────────────────
  const insights = generateInsights(hookTypeStats, topicStats, enriched);

  const analysis = {
    generatedAt:   new Date().toISOString(),
    totalVideos:   enriched.length,
    hookTypeStats,
    topicStats,
    insights,
  };

  writeJSON(ADVANCED_FILE, analysis);
  logger.info(`HookAnalyzer: analysis saved (${enriched.length} videos, ${hookTypeStats.length} hookTypes, ${topicStats.length} topics)`);

  // ──────────────────────────────────────────
  //  TOP HOOKS (Part 9)
  // ──────────────────────────────────────────
  const topHooks = buildTopHooks(enriched);
  writeJSON(TOP_HOOKS_FILE, topHooks);
  logger.info(`HookAnalyzer: top-hooks saved (${topHooks.hooks.length} hooks in top 20%)`);

  return analysis;
}

// ─────────────────────────────────────────────
//  TREND POR TOPIC
// ─────────────────────────────────────────────

function calcTrend(videos) {
  if (videos.length < 3) return 'insufficient_data';
  const sorted  = [...videos].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  const half    = Math.ceil(sorted.length / 2);
  const recent  = sorted.slice(-half);
  const older   = sorted.slice(0, Math.floor(sorted.length / 2));
  const recentAvg = recent.reduce((s, v) => s + v.maxViews, 0) / recent.length;
  const olderAvg  = older.reduce((s, v) => s + v.maxViews, 0)  / older.length;
  if (olderAvg === 0) return 'no_baseline';
  const ratio = recentAvg / olderAvg;
  if (ratio > 1.3) return 'rising';
  if (ratio < 0.7) return 'falling';
  return 'stable';
}

// ─────────────────────────────────────────────
//  INSIGHTS GENERATOR (Part 8)
// ─────────────────────────────────────────────

function generateInsights(hookTypeStats, topicStats, allVideos) {
  const insights = [];

  // Best hook type
  if (hookTypeStats.length > 0) {
    const best = hookTypeStats[0];
    insights.push({
      type:     'best_hook_type',
      priority: 'high',
      message:  `Mejor hookType: "${best.hookType}" — promedio ${best.avgViews} views, ${best.winRate}% win rate (${best.count} videos)`,
      data:     { hookType: best.hookType, avgViews: best.avgViews, winRate: best.winRate },
    });
  }

  // Hook types with earlyScore signal
  const earlySignalTypes = hookTypeStats
    .filter(ht => ht.avgEarlyScore !== null && ht.count >= 2)
    .sort((a, b) => (b.avgEarlyScore || 0) - (a.avgEarlyScore || 0));
  if (earlySignalTypes.length > 0) {
    const top = earlySignalTypes[0];
    insights.push({
      type:     'early_signal',
      priority: 'high',
      message:  `Mejor señal temprana (earlyScore): "${top.hookType}" — score ${top.avgEarlyScore}`,
      data:     { hookType: top.hookType, avgEarlyScore: top.avgEarlyScore },
    });
  }

  // Rising topics
  const risingTopics = topicStats.filter(t => t.recentTrend === 'rising');
  if (risingTopics.length > 0) {
    insights.push({
      type:     'rising_topic',
      priority: 'medium',
      message:  `Topics en alza: ${risingTopics.map(t => t.topic).join(', ')}`,
      data:     { topics: risingTopics.map(t => t.topic) },
    });
  }

  // Falling topics
  const fallingTopics = topicStats.filter(t => t.recentTrend === 'falling');
  if (fallingTopics.length > 0) {
    insights.push({
      type:     'falling_topic',
      priority: 'low',
      message:  `Topics a la baja (reducir frecuencia): ${fallingTopics.map(t => t.topic).join(', ')}`,
      data:     { topics: fallingTopics.map(t => t.topic) },
    });
  }

  // Underperforming hook types
  const underperforming = hookTypeStats.filter(ht => ht.count >= 2 && ht.winRate < 10 && hookTypeStats[0]?.winRate > 20);
  if (underperforming.length > 0) {
    insights.push({
      type:     'underperforming_hook',
      priority: 'medium',
      message:  `HookTypes con bajo rendimiento: ${underperforming.map(h => h.hookType).join(', ')}. Considerar reducir uso.`,
      data:     { hookTypes: underperforming.map(h => h.hookType) },
    });
  }

  // Content version comparison
  const v2Videos = allVideos.filter(v => v.contentVersion === 'v2' && v.maxViews > 0);
  const v1Videos = allVideos.filter(v => v.contentVersion !== 'v2' && v.maxViews > 0);
  if (v2Videos.length >= 2 && v1Videos.length >= 2) {
    const v2Avg = v2Videos.reduce((s, v) => s + v.maxViews, 0) / v2Videos.length;
    const v1Avg = v1Videos.reduce((s, v) => s + v.maxViews, 0) / v1Videos.length;
    const improvement = v1Avg > 0 ? Math.round((v2Avg / v1Avg - 1) * 100) : 0;
    insights.push({
      type:     'content_version_comparison',
      priority: improvement > 20 ? 'high' : 'low',
      message:  `V2 vs V1: v2 promedia ${Math.round(v2Avg)} views vs ${Math.round(v1Avg)} (${improvement > 0 ? '+' : ''}${improvement}%)`,
      data:     { v2Avg: Math.round(v2Avg), v1Avg: Math.round(v1Avg), improvement, v2Count: v2Videos.length, v1Count: v1Videos.length },
    });
  }

  return insights;
}

// ─────────────────────────────────────────────
//  TOP HOOKS (Part 9)
// ─────────────────────────────────────────────

/**
 * Selecciona los hooks del top 20% por una combinación de:
 *   views × 0.40 + earlyScore × 0.35 + engagement × 0.25
 * Normalizado dentro del conjunto para comparación.
 */
function buildTopHooks(enriched) {
  const withViews = enriched.filter(v => v.maxViews > 0 && v.hook);
  if (withViews.length === 0) return { generatedAt: new Date().toISOString(), hooks: [], threshold: null };

  const maxViews    = Math.max(...withViews.map(v => v.maxViews));
  const maxEarlyS   = Math.max(...withViews.map(v => v.earlyScore || 0));
  const maxEng      = Math.max(...withViews.map(v => v.maxEngagement));

  const scored = withViews.map(v => {
    const normViews = maxViews     > 0 ? v.maxViews    / maxViews   : 0;
    const normEarly = maxEarlyS    > 0 ? (v.earlyScore || 0) / maxEarlyS : 0;
    const normEng   = maxEng       > 0 ? v.maxEngagement / maxEng   : 0;
    const combined  = normViews * 0.40 + normEarly * 0.35 + normEng * 0.25;
    return { ...v, combinedScore: parseFloat(combined.toFixed(4)) };
  }).sort((a, b) => b.combinedScore - a.combinedScore);

  // Top 20%
  const cutoffIdx = Math.max(1, Math.ceil(scored.length * 0.2));
  const topVideos = scored.slice(0, cutoffIdx);
  const threshold = topVideos[topVideos.length - 1]?.combinedScore || 0;

  const hooks = topVideos.map(v => ({
    videoId:       v.id,
    hook:          v.hook,
    topic:         v.topic,
    hookType:      v.hookType,
    views:         v.maxViews,
    engagement:    v.maxEngagement,
    earlyScore:    v.earlyScore,
    viralityScore: v.viralityScore,
    combinedScore: v.combinedScore,
    contentVersion:v.contentVersion,
    publishedAt:   v.publishedAt,
  }));

  // Agrupación por hookType para el decision engine
  const byHookType = {};
  for (const h of hooks) {
    if (!byHookType[h.hookType]) byHookType[h.hookType] = [];
    byHookType[h.hookType].push(h);
  }
  const hookTypeSummary = Object.entries(byHookType)
    .map(([ht, hs]) => ({ hookType: ht, count: hs.length, avgCombined: parseFloat((hs.reduce((s, h) => s + h.combinedScore, 0) / hs.length).toFixed(4)) }))
    .sort((a, b) => b.avgCombined - a.avgCombined);

  return {
    generatedAt:    new Date().toISOString(),
    totalAnalyzed:  withViews.length,
    threshold,
    hooks,
    hookTypeSummary,
  };
}

// ─────────────────────────────────────────────
//  EXPLOIT WINNING HOOKS (Part 12)
// ─────────────────────────────────────────────

/**
 * Lee top-hooks.json y genera variantes de los mejores hooks que no hayan
 * sido explotados en las últimas 48h.
 * Se llama automáticamente desde pollAllMetrics.
 */
async function exploitWinningHooks() {
  const topHooksData = readJSON(TOP_HOOKS_FILE, null);
  if (!topHooksData || !topHooksData.hooks?.length) return { skipped: true, reason: 'no_top_hooks' };

  const EXPLOIT_LOG_PATH = path.join(DATA_DIR, 'hook-exploit-log.json');
  const exploitLog       = readJSON(EXPLOIT_LOG_PATH, []);

  // Hooks explotados en últimas 48h
  const exploited48h = new Set(
    exploitLog
      .filter(e => (Date.now() - new Date(e.exploitedAt).getTime()) < 48 * 3600000)
      .map(e => e.videoId),
  );

  // Candidatos: top hooks no explotados recientemente, con señal temprana fuerte
  const MIN_EARLY_SCORE = parseFloat(process.env.MIN_EARLY_SCORE_TO_EXPLOIT || '0.5');
  const candidates = topHooksData.hooks
    .filter(h =>
      !exploited48h.has(h.videoId) &&
      h.hook && h.topic && h.hookType &&
      (h.earlyScore === null || h.earlyScore >= MIN_EARLY_SCORE),
    )
    .slice(0, 2); // máximo 2 explotaciones por ciclo de métricas

  if (candidates.length === 0) {
    logger.info('exploitWinningHooks: no eligible candidates');
    return { skipped: true, reason: 'no_eligible_candidates' };
  }

  // Llamar a exploitWinner (lazy require para evitar circular)
  const { exploitWinner } = require('./growth-engine');
  const results = [];

  for (const candidate of candidates) {
    try {
      const result = await exploitWinner({
        videoId:        candidate.videoId,
        hook:           candidate.hook,
        topic:          candidate.topic,
        hookType:       candidate.hookType,
        viralityScore:  candidate.viralityScore,
        formatMatchScore: null,
      });

      // Registrar en log para evitar reexplotación
      exploitLog.unshift({
        videoId:     candidate.videoId,
        topic:       candidate.topic,
        hookType:    candidate.hookType,
        exploitedAt: new Date().toISOString(),
        result,
      });

      results.push({ videoId: candidate.videoId, result });
      logger.info(`exploitWinningHooks: triggered for ${candidate.videoId} (${candidate.topic}/${candidate.hookType})`);
    } catch (err) {
      logger.warn(`exploitWinningHooks: failed for ${candidate.videoId}: ${err.message}`);
    }
  }

  // Guardar log (máx 100 entradas)
  const fs2 = require('fs');
  const dir  = path.dirname(EXPLOIT_LOG_PATH);
  if (!fs2.existsSync(dir)) fs2.mkdirSync(dir, { recursive: true });
  fs2.writeFileSync(EXPLOIT_LOG_PATH, JSON.stringify(exploitLog.slice(0, 100), null, 2));

  return { exploited: results.length, results };
}

// ─────────────────────────────────────────────
//  LECTURA PÚBLICA
// ─────────────────────────────────────────────

function getHookPerformanceAnalysis() {
  return readJSON(ADVANCED_FILE, null);
}

function getTopHooks() {
  return readJSON(TOP_HOOKS_FILE, { generatedAt: null, hooks: [], hookTypeSummary: [] });
}

function getHookInsights() {
  const analysis = readJSON(ADVANCED_FILE, null);
  if (!analysis) return { status: 'no_data', insights: [], generatedAt: null };
  return {
    status:           'ok',
    generatedAt:      analysis.generatedAt,
    totalVideos:      analysis.totalVideos,
    insights:         analysis.insights,
    topHookType:      analysis.hookTypeStats?.[0] || null,
    risingTopics:     analysis.topicStats?.filter(t => t.recentTrend === 'rising').map(t => t.topic) || [],
    fallingTopics:    analysis.topicStats?.filter(t => t.recentTrend === 'falling').map(t => t.topic) || [],
  };
}

module.exports = {
  analyzeHookPerformance,
  exploitWinningHooks,
  getHookPerformanceAnalysis,
  getTopHooks,
  getHookInsights,
};
