/**
 * hook-quality-filter.js
 *
 * Filtro de calidad para hooks.
 * - Valida contra criterios confesionales
 * - Penaliza genéricos
 * - Prioriza confesionales
 * - Se integra con content-generator sin romper pipeline
 */

const logger = require('../utils/logger');
const {
  validateHookConfessional,
  applyHookPenalty,
} = require('./hook-validator.service');
const {
  generateConfessionalHook,
} = require('./confessional-hook-generator');

/**
 * Evaluar y mejorar un hook
 * Retorna: { hook, score, improved, reason }
 */
function evaluateHook(hookText, baseScore = 50) {
  if (!hookText || typeof hookText !== 'string') {
    return {
      hook: hookText,
      score: baseScore,
      improved: false,
      reason: 'Invalid hook text',
    };
  }

  const validation = validateHookConfessional(hookText);
  const adjustedScore = applyHookPenalty(baseScore, validation);
  const penaltyApplied = baseScore - adjustedScore;

  return {
    hook: hookText,
    originalScore: baseScore,
    score: adjustedScore,
    improved: false,
    validation,
    penaltyApplied,
    reason: validation.valid ? 'Valid confessional' : `Generic pattern detected (penalty: -${penaltyApplied})`,
    isConfessional: validation.valid,
  };
}

/**
 * Mejorar un hook reemplazándolo si no es confesional
 */
function improveHook(hookText, topic = null, fallbackScore = 50) {
  const evaluation = evaluateHook(hookText, fallbackScore);

  // Si ya es válido confesional, retornar como está
  if (evaluation.isConfessional) {
    return evaluation;
  }

  // Si no es válido, intentar reemplazarlo con un hook confesional
  logger.debug(`Hook not confessional, attempting to replace`, { hook: hookText });

  const generated = generateConfessionalHook(topic || 'emotions');

  if (generated.validation.valid) {
    return {
      hook: generated.hook,
      originalScore: fallbackScore,
      score: 75, // Score optimista para hooks confesionales generados
      improved: true,
      originalHook: hookText,
      reason: `Replaced generic with confessional hook`,
      validation: generated.validation,
    };
  }

  // Si no se puede generar válido, retornar el original con penalización
  return evaluation;
}

/**
 * Filtrar array de hooks, aplicando penalizaciones
 */
function filterHooks(hookList, applyPenalties = true) {
  if (!Array.isArray(hookList)) {
    return [];
  }

  return hookList.map(item => {
    const hook = typeof item === 'string' ? item : item.hook || item.text;
    const baseScore = item.estimatedScore || item.score || 50;

    if (applyPenalties) {
      return evaluateHook(hook, baseScore);
    }

    return {
      hook,
      originalScore: baseScore,
      score: baseScore,
      improved: false,
    };
  });
}

/**
 * Rankear hooks por calidad confesional
 */
function rankHooks(hookList) {
  const evaluated = filterHooks(hookList, true);

  return evaluated
    .sort((a, b) => b.score - a.score)
    .map((h, idx) => ({
      ...h,
      rank: idx + 1,
    }));
}

/**
 * Seleccionar N mejores hooks
 */
function selectTopHooks(hookList, count = 5) {
  const ranked = rankHooks(hookList);
  return ranked.slice(0, count);
}

/**
 * Reporte de calidad de hooks
 */
function getQualityReport(hookList) {
  const evaluated = filterHooks(hookList, true);

  const confessional = evaluated.filter(h => h.isConfessional);
  const generic = evaluated.filter(h => !h.isConfessional);
  const avgScore = evaluated.reduce((sum, h) => sum + h.score, 0) / evaluated.length;

  return {
    total: evaluated.length,
    confessional: confessional.length,
    generic: generic.length,
    confessionalRatio: (confessional.length / evaluated.length * 100).toFixed(1),
    averageScore: Math.round(avgScore),
    topHook: rankHooks(hookList)[0],
    suggestions: {
      replaceGenerics: generic.length > 0,
      genericCount: generic.length,
      prioritizeConfessional: confessional.length < evaluated.length * 0.5,
    },
    hooks: rankHooks(hookList),
  };
}

module.exports = {
  evaluateHook,
  improveHook,
  filterHooks,
  rankHooks,
  selectTopHooks,
  getQualityReport,
};
