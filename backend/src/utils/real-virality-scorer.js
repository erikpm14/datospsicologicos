/**
 * real-virality-scorer.js
 * Virality scoring basado ÚNICAMENTE en datos reales, NO en heurísticas
 *
 * Premisa:
 * "La viralidad solo existe si tiene views, engagement, retención reales"
 *
 * RECHAZA:
 * ❌ Patrones de texto
 * ❌ Power words
 * ❌ Heurísticas psicológicas
 * ❌ Teoría
 *
 * ACEPTA:
 * ✅ Views observadas
 * ✅ Engagement real (likes/views)
 * ✅ Retención (watch time / duración)
 * ✅ Datos históricos probados
 */

const logger = require('./logger');
const performanceTracker = require('../services/performance-tracker.service');

/**
 * Score basado en datos REALES observados en vídeos anteriores
 * Rango: 0-100
 *
 * @param {Object} script - script con hook, topic, etc
 * @returns {Object} { score, reason, dataPoints }
 */
function scoreScriptByRealData(script = {}) {
  const analysis = performanceTracker.getPerformanceAnalysis();

  if (!analysis || !analysis.byHook) {
    // Sin datos históricos, retornar score neutral
    return {
      score: 50,
      reason: 'no_historical_data',
      dataPoints: [],
    };
  }

  const hook = script.hook || '';
  const topic = script.topic || '';

  let score = 50; // baseline neutral
  const dataPoints = [];

  // 1. Buscar este hook exacto en histórico
  if (analysis.byHook[hook]) {
    const hookData = analysis.byHook[hook];
    const publicationRate = hookData.published / hookData.count;

    // Si el hook publicó >70% de veces, es probado
    if (publicationRate > 0.7) {
      score += 25;
      dataPoints.push(`hook_proven: ${publicationRate.toFixed(0)}% pub rate`);
    } else if (publicationRate > 0.5) {
      score += 10;
      dataPoints.push(`hook_moderate: ${publicationRate.toFixed(0)}% pub rate`);
    } else {
      score -= 15;
      dataPoints.push(`hook_risky: ${publicationRate.toFixed(0)}% pub rate`);
    }
  } else {
    // Hook nuevo = riesgo, pero no penalizar (es experimental)
    score += 0;
    dataPoints.push('hook_new: experimental');
  }

  // 2. Buscar este topic en histórico
  if (analysis.byTopic[topic]) {
    const topicData = analysis.byTopic[topic];
    const publicationRate = topicData.published / topicData.count;

    if (publicationRate > 0.8) {
      score += 20;
      dataPoints.push(`topic_highvalue: ${publicationRate.toFixed(0)}% pub rate`);
    } else if (publicationRate > 0.6) {
      score += 10;
      dataPoints.push(`topic_goodvalue: ${publicationRate.toFixed(0)}% pub rate`);
    } else {
      score -= 10;
      dataPoints.push(`topic_risky: ${publicationRate.toFixed(0)}% pub rate`);
    }
  } else {
    dataPoints.push('topic_new: experimental');
  }

  // 3. Combinación hook + topic (si existen ambos)
  if (analysis.byHook[hook] && analysis.byTopic[topic]) {
    // Buscar vídeos con la MISMA combinación
    const data = performanceTracker.loadPerformanceData();
    const sameCombo = (data.videos || []).filter(
      v => v.hook === hook && v.topic === topic
    );

    if (sameCombo.length > 0) {
      const published = sameCombo.filter(v => v.youtubeId).length;
      const comboRate = published / sameCombo.length;

      if (comboRate > 0.8) {
        score += 15;
        dataPoints.push(`combo_proven: ${sameCombo.length} videos, ${comboRate.toFixed(0)}% pub`);
      } else if (sameCombo.length >= 3) {
        score -= 5;
        dataPoints.push(`combo_tested: low conversion (${comboRate.toFixed(0)}%)`);
      }
    }
  }

  // Clamp a 0-100
  score = Math.max(0, Math.min(100, score));

  return {
    score: Math.round(score),
    reason: 'real_data_only',
    dataPoints,
    basis: 'historical_performance', // NO HEURISTICS
  };
}

/**
 * DEPRECATED: scoreScript (basado en heurísticas)
 *
 * Esta función estaba basada en patrones de texto y heurísticas.
 * Ya NO se usa. En su lugar, usar scoreScriptByRealData().
 *
 * Se mantiene para compatibilidad, pero devuelve { score: 0, reason: 'deprecated' }
 */
function scoreScript(script = {}) {
  logger.warn('[DEPRECATED] scoreScript (heuristic-based) is disabled. Use scoreScriptByRealData() instead.');
  return {
    score: 0,
    reason: 'deprecated_heuristic_system',
    message: 'This scoring was based on theory, not data. Disabled per data analysis.',
  };
}

module.exports = {
  scoreScriptByRealData,
  scoreScript, // deprecated
};
