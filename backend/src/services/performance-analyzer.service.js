/**
 * performance-analyzer.service.js
 *
 * Analiza performance cada 10 vídeos:
 * - Promedio viralityScore por hookType y topic
 * - Distribución de duración
 * - Detecta top 3 hooks y topics
 * - Genera insights para optimización
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getPerformanceLog, PERFORMANCE_LOG, ANALYTICS_DIR } = require('./analytics-collector.service');

const INSIGHTS_FILE = path.join(ANALYTICS_DIR, 'insights.json');

/**
 * Analizar performance acumulado
 */
function analyzePerformance() {
  try {
    const videos = getPerformanceLog();

    if (videos.length === 0) {
      logger.warn('No videos to analyze');
      return null;
    }

    logger.info(`Analyzing ${videos.length} videos...`);

    // 1. Estadísticas por hookType
    const hookTypeStats = analyzeByHookType(videos);

    // 2. Estadísticas por topic
    const topicStats = analyzeByTopic(videos);

    // 3. Distribución de duración
    const durationDistribution = analyzeDurationDistribution(videos);

    // 4. Top hooks
    const topHooks = getTopHooks(videos, 3);

    // 5. Top topics
    const topTopics = getTopTopics(videos, 3);

    // 6. Detectar proporción óptima challenge/observable
    const hookTypeRatio = calculateOptimalHookTypeRatio(hookTypeStats);

    const insights = {
      generatedAt: new Date().toISOString(),
      totalVideosAnalyzed: videos.length,
      lastAnalysisRange: {
        from: videos[0]?.createdAt,
        to: videos[videos.length - 1]?.createdAt,
      },
      byHookType: hookTypeStats,
      byTopic: topicStats,
      durationDistribution,
      topHooks,
      topTopics,
      recommendedHookTypeRatio: hookTypeRatio,
      recommendations: generateRecommendations(hookTypeStats, topicStats, topHooks, topTopics),
    };

    // Guardar insights
    fs.writeFileSync(INSIGHTS_FILE, JSON.stringify(insights, null, 2));

    logger.info('Performance analysis complete:', {
      totalVideos: videos.length,
      topHook: topHooks[0]?.hook,
      topTopic: topTopics[0]?.topic,
    });

    return insights;
  } catch (err) {
    logger.error('Performance analysis failed:', { error: err.message });
    return null;
  }
}

/**
 * Analizar por hookType
 */
function analyzeByHookType(videos) {
  const stats = {};

  for (const video of videos) {
    const type = video.hookType || 'observable';
    if (!stats[type]) {
      stats[type] = {
        count: 0,
        totalVirality: 0,
        avgVirality: 0,
        avgDuration: 0,
        avgFormat: 0,
        avgEmotional: 0,
      };
    }
    stats[type].count++;
    stats[type].totalVirality += video.viralityScore || 0;
    stats[type].avgDuration += video.duration || 0;
    stats[type].avgFormat += video.formatScore || 0;
    stats[type].avgEmotional += video.emotionalImpactScore || 0;
  }

  // Calcular promedios
  for (const type in stats) {
    const count = stats[type].count;
    stats[type].avgVirality = Math.round(stats[type].totalVirality / count);
    stats[type].avgDuration = Math.round((stats[type].avgDuration / count) * 10) / 10;
    stats[type].avgFormat = Math.round(stats[type].avgFormat / count);
    stats[type].avgEmotional = Math.round(stats[type].avgEmotional / count);
  }

  return stats;
}

/**
 * Analizar por topic
 */
function analyzeByTopic(videos) {
  const stats = {};

  for (const video of videos) {
    const topic = video.topic || 'unknown';
    if (!stats[topic]) {
      stats[topic] = {
        count: 0,
        totalVirality: 0,
        avgVirality: 0,
      };
    }
    stats[topic].count++;
    stats[topic].totalVirality += video.viralityScore || 0;
  }

  // Calcular promedios
  for (const topic in stats) {
    stats[topic].avgVirality = Math.round(stats[topic].totalVirality / stats[topic].count);
  }

  return stats;
}

/**
 * Analizar distribución de duración
 */
function analyzeDurationDistribution(videos) {
  const durations = videos.map(v => v.duration || 0).sort((a, b) => a - b);
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const avg = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;

  return {
    min,
    max,
    average: avg,
    count: durations.length,
  };
}

/**
 * Top 3 hooks más efectivos
 */
function getTopHooks(videos, topN = 3) {
  const hookStats = {};

  for (const video of videos) {
    const hook = video.hook || 'unknown';
    if (!hookStats[hook]) {
      hookStats[hook] = {
        hook,
        count: 0,
        totalVirality: 0,
        avgVirality: 0,
        hookType: video.hookType,
      };
    }
    hookStats[hook].count++;
    hookStats[hook].totalVirality += video.viralityScore || 0;
  }

  // Calcular promedios y ordenar
  const sorted = Object.values(hookStats)
    .map(h => ({
      ...h,
      avgVirality: Math.round(h.totalVirality / h.count),
    }))
    .sort((a, b) => b.avgVirality - a.avgVirality)
    .slice(0, topN);

  return sorted;
}

/**
 * Top 3 topics más efectivos
 */
function getTopTopics(videos, topN = 3) {
  const topicStats = {};

  for (const video of videos) {
    const topic = video.topic || 'unknown';
    if (!topicStats[topic]) {
      topicStats[topic] = {
        topic,
        count: 0,
        totalVirality: 0,
        avgVirality: 0,
      };
    }
    topicStats[topic].count++;
    topicStats[topic].totalVirality += video.viralityScore || 0;
  }

  // Calcular y ordenar
  const sorted = Object.values(topicStats)
    .map(t => ({
      ...t,
      avgVirality: Math.round(t.totalVirality / t.count),
    }))
    .sort((a, b) => b.avgVirality - a.avgVirality)
    .slice(0, topN);

  return sorted;
}

/**
 * Calcular proporción óptima challenge/observable
 */
function calculateOptimalHookTypeRatio(hookTypeStats) {
  const ratios = {};
  let total = 0;

  for (const type in hookTypeStats) {
    const avgVirality = hookTypeStats[type].avgVirality || 0;
    ratios[type] = avgVirality;
    total += avgVirality;
  }

  // Normalizar a porcentajes
  for (const type in ratios) {
    ratios[type] = Math.round((ratios[type] / total) * 100);
  }

  return ratios;
}

/**
 * Generar recomendaciones
 */
function generateRecommendations(hookTypeStats, topicStats, topHooks, topTopics) {
  const recommendations = [];

  // Recomendación 1: hookType más efectivo
  let bestHookType = null;
  let bestHookScore = -Infinity;
  for (const type in hookTypeStats) {
    if (hookTypeStats[type].avgVirality > bestHookScore) {
      bestHookScore = hookTypeStats[type].avgVirality;
      bestHookType = type;
    }
  }

  if (bestHookType) {
    recommendations.push({
      category: 'hookType',
      recommendation: `Increase ${bestHookType} hooks to ${Math.round(bestHookScore)}% virality`,
      priority: 'high',
      reason: `${bestHookType} hooks have highest average virality score`,
    });
  }

  // Recomendación 2: top topic
  if (topTopics.length > 0) {
    recommendations.push({
      category: 'topic',
      recommendation: `Prioritize "${topTopics[0].topic}" topic (avg: ${topTopics[0].avgVirality}/100)`,
      priority: 'high',
      reason: 'Highest performing topic across all videos',
    });
  }

  // Recomendación 3: duración objetivo
  recommendations.push({
    category: 'duration',
    recommendation: 'Target 26-28 seconds for optimal retention',
    priority: 'medium',
    reason: 'Optimal format range for platform algorithm',
  });

  return recommendations;
}

/**
 * Obtener insights actuales
 */
function getInsights() {
  try {
    if (fs.existsSync(INSIGHTS_FILE)) {
      return JSON.parse(fs.readFileSync(INSIGHTS_FILE, 'utf8'));
    }
    return null;
  } catch (err) {
    logger.warn('Failed to read insights:', err.message);
    return null;
  }
}

module.exports = {
  analyzePerformance,
  getInsights,
  INSIGHTS_FILE,
};
