/**
 * insights-optimizer.service.js
 *
 * Usa los insights de performance para optimizar la generación:
 * - Prioriza hooks/topics efectivos
 * - Ajusta proporción challenge/observable
 * - Influye en content-generator sin cambiar el pipeline
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getInsights } = require('./performance-analyzer.service');

/**
 * Obtener pesos de optimización basados en insights
 */
function getOptimizationWeights() {
  const insights = getInsights();

  if (!insights || !insights.recommendedHookTypeRatio) {
    // Default sin insights
    return {
      hasInsights: false,
      challengeWeight: 0.4,
      observableWeight: 0.6,
      topicWeights: {},
      topHooks: [],
    };
  }

  // Extraer pesos de insights
  const hookTypeRatio = insights.recommendedHookTypeRatio;
  const challengeWeight = (hookTypeRatio.challenge || 40) / 100;
  const observableWeight = (hookTypeRatio.observable || 60) / 100;

  // Crear weights para topics basados en performance
  const topicWeights = {};
  for (const topic in insights.byTopic) {
    const stats = insights.byTopic[topic];
    topicWeights[topic] = {
      avgVirality: stats.avgVirality,
      count: stats.count,
      weight: Math.min(100, stats.avgVirality + 10), // bonus para top performers
    };
  }

  // Top hooks para validación
  const topHooks = insights.topHooks.map(h => h.hook);

  return {
    hasInsights: true,
    insightsGeneratedAt: insights.generatedAt,
    totalVideosAnalyzed: insights.totalVideosAnalyzed,
    challengeWeight,
    observableWeight,
    topicWeights,
    topHooks,
    recommendations: insights.recommendations || [],
  };
}

/**
 * Ajustar proporción de hookType en generación
 */
function getHookTypeDistribution() {
  const weights = getOptimizationWeights();

  if (!weights.hasInsights) {
    // Default: 40% challenge, 60% observable
    return {
      challenge: 0.4,
      observable: 0.6,
      source: 'default',
    };
  }

  return {
    challenge: weights.challengeWeight,
    observable: weights.observableWeight,
    source: 'insights',
    lastAnalyzed: weights.insightsGeneratedAt,
  };
}

/**
 * Ordenar topics por performance
 */
function getTopicPriority() {
  const weights = getOptimizationWeights();
  const insights = getInsights();

  if (!insights || !insights.byTopic) {
    return null;
  }

  // Crear lista ordenada por virality promedio
  return Object.entries(insights.byTopic)
    .map(([topic, stats]) => ({
      topic,
      avgVirality: stats.avgVirality,
      count: stats.count,
      priority: stats.avgVirality > 70 ? 'high' : stats.avgVirality > 60 ? 'medium' : 'low',
    }))
    .sort((a, b) => b.avgVirality - a.avgVirality);
}

/**
 * Validar si un hook debe ser usado basado en performance
 */
function isHookHighPerforming(hookText) {
  const weights = getOptimizationWeights();
  if (!weights.hasInsights || weights.topHooks.length === 0) {
    return true; // Sin insights, permitir todo
  }

  return weights.topHooks.includes(hookText);
}

/**
 * Obtener sugerencia de topic basado en performance
 */
function suggestTopicByPerformance() {
  const priorityList = getTopicPriority();
  if (!priorityList || priorityList.length === 0) {
    return null;
  }

  // Retornar top topic
  return {
    topic: priorityList[0].topic,
    avgVirality: priorityList[0].avgVirality,
    reason: `Top performing topic with ${priorityList[0].count} videos`,
  };
}

/**
 * Log de optimización
 */
function logOptimization(action, details) {
  const logFile = path.join(path.resolve('./analytics'), 'optimization-log.json');

  try {
    let log = [];
    if (fs.existsSync(logFile)) {
      log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }

    log.push({
      timestamp: new Date().toISOString(),
      action,
      details,
    });

    // Mantener últimas 1000 entries
    if (log.length > 1000) {
      log = log.slice(-1000);
    }

    fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
  } catch (err) {
    logger.warn('Failed to log optimization:', err.message);
  }
}

/**
 * Reporte de estado actual de optimización
 */
function getOptimizationStatus() {
  const weights = getOptimizationWeights();
  const topicPriority = getTopicPriority();

  return {
    status: weights.hasInsights ? 'active' : 'inactive',
    hookTypeDistribution: {
      challenge: Math.round(weights.challengeWeight * 100),
      observable: Math.round(weights.observableWeight * 100),
    },
    videosAnalyzed: weights.totalVideosAnalyzed || 0,
    topicsTracked: topicPriority ? topicPriority.length : 0,
    topPerformers: {
      hookType: Object.entries(weights.topicWeights || {})
        .sort((a, b) => b[1].avgVirality - a[1].avgVirality)
        .slice(0, 3)
        .map(([topic, stats]) => ({
          topic,
          avgVirality: stats.avgVirality,
        })),
    },
    lastAnalyzed: weights.insightsGeneratedAt || null,
    recommendations: weights.recommendations || [],
  };
}

module.exports = {
  getOptimizationWeights,
  getHookTypeDistribution,
  getTopicPriority,
  isHookHighPerforming,
  suggestTopicByPerformance,
  logOptimization,
  getOptimizationStatus,
};
