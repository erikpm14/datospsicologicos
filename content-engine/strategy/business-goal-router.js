const fs = require('fs');
const path = require('path');

const STRATEGY_DIR = path.resolve(__dirname, '../../data/strategy');
const BUSINESS_MODE_PATH = path.join(STRATEGY_DIR, 'business-mode.json');

function routeBusinessGoal(inputs = {}) {
  fs.mkdirSync(STRATEGY_DIR, { recursive: true });

  const yppStatus = inputs.yppStatus || {};
  const monetizationReport = inputs.monetizationReport || {};
  const strategyMemory = inputs.strategyMemory || { clusters: [] };
  const batchOutcome = inputs.batchOutcome || _readJson(path.resolve(__dirname, '../../data/execution/latest-batch-outcome.json'), {});
  const strategyFeedback = inputs.strategyFeedback || _readJson(path.resolve(__dirname, '../../data/execution/strategy-feedback.json'), {});

  const mode = _decideMode(yppStatus, monetizationReport, strategyMemory, batchOutcome, strategyFeedback);
  const payload = {
    generatedAt: new Date().toISOString(),
    currentBusinessMode: mode.mode,
    whyNow: mode.whyNow,
    whatToPrioritize: mode.whatToPrioritize,
    whatToDeprioritize: mode.whatToDeprioritize
  };

  fs.writeFileSync(BUSINESS_MODE_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _decideMode(yppStatus, monetizationReport, strategyMemory, batchOutcome, strategyFeedback) {
  const focus = yppStatus.recommendation?.missingMore || 'views';
  const bestCategory = monetizationReport.bestMonetizationCategory || '';
  const bestCluster = [...(strategyMemory.clusters || [])].sort((a, b) => b.businessUsefulnessScore - a.businessUsefulnessScore)[0];
  const learningMode = strategyFeedback.learningMode || '';

  if ((batchOutcome.batchReachEfficiency || 0) > 120 && (batchOutcome.batchMonetizationEfficiency || 0) < 28) {
    return {
      mode: 'monetization_priority',
      whyNow: 'El batch reciente trajo alcance pero poco valor comercial.',
      whatToPrioritize: 'Slots de monetización e hybrid después de captación.',
      whatToDeprioritize: 'Reach vacío repetido sin conversión útil.'
    };
  }

  if (focus === 'views' && (yppStatus.gapTo10MShortViews || 0) > 5000000) {
    return {
      mode: 'ypp_views_priority',
      whyNow: 'Faltan muchas views para YPP y hay clusters con empuje de alcance.',
      whatToPrioritize: `Clusters con reach alto y soporte YPP como ${bestCluster?.clusterLabel || 'attention'}.`,
      whatToDeprioritize: 'Clusters saturados con poco alcance incremental.'
    };
  }

  if (focus === 'subs' && (yppStatus.gapTo1000Subs || 0) > 250) {
    return {
      mode: 'ypp_subs_priority',
      whyNow: 'La brecha de suscriptores pesa más que la de views.',
      whatToPrioritize: 'Clusters de follow e hybrid con identidad fuerte.',
      whatToDeprioritize: 'Reach vacío sin follow útil.'
    };
  }

  if (bestCategory) {
    return {
      mode: 'monetization_priority',
      whyNow: learningMode === 'good_recommendation_good_execution'
        ? `El canal ya ve señal comercial repetible en ${bestCategory}.`
        : `El canal ya ve señal comercial en ${bestCategory}.`,
      whatToPrioritize: `Clusters que alimentan ${bestCategory} y audiencia reutilizable.`,
      whatToDeprioritize: 'Familias con valor comercial bajo o saturación alta.'
    };
  }

  return {
    mode: 'balanced_growth',
    whyNow: 'No hay una sola restricción dominante; conviene mezclar crecimiento y negocio.',
    whatToPrioritize: 'Mix equilibrado entre reach, follow y monetización.',
    whatToDeprioritize: 'Repetición excesiva del mismo cluster.'
  };
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  routeBusinessGoal,
  BUSINESS_MODE_PATH
};
