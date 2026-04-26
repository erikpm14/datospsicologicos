const fs = require('fs');
const path = require('path');

const STRATEGY_DIR = path.resolve(__dirname, '../../data/strategy');
const PORTFOLIO_BALANCE_PATH = path.join(STRATEGY_DIR, 'portfolio-balance.json');

function optimizePortfolio(strategyMemory = {}, businessMode = {}, context = {}) {
  fs.mkdirSync(STRATEGY_DIR, { recursive: true });

  const clusters = strategyMemory.clusters || [];
  const clusterWeights = clusters.map((cluster) => ({
    clusterId: cluster.clusterId,
    clusterLabel: cluster.clusterLabel,
    clusterWeight: Number((cluster.businessUsefulnessScore / 100).toFixed(2)),
    businessPriorityWeight: _businessPriorityWeight(cluster, businessMode.currentBusinessMode),
    saturationPenalty: Number((cluster.saturationRisk / 100).toFixed(2)),
    explorationWeight: Number(((cluster.explorationRecommendation ? 0.35 : 0.15) + (context.strategyFeedback?.portfolioAdjustment?.explorationWeightDelta || 0)).toFixed(2)),
    exploitationWeight: Number(((cluster.exploitationRecommendation ? 0.7 : 0.3) + (context.strategyFeedback?.portfolioAdjustment?.exploitationWeightDelta || 0)).toFixed(2))
  }));

  const recommendedMix = _applyFeedbackToMix(_getRecommendedMix(businessMode.currentBusinessMode), context.strategyFeedback?.portfolioAdjustment, context.batchOutcome);
  const payload = {
    generatedAt: new Date().toISOString(),
    currentBusinessMode: businessMode.currentBusinessMode || 'balanced_growth',
    recommendedMix,
    clusters: clusterWeights
  };

  fs.writeFileSync(PORTFOLIO_BALANCE_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _businessPriorityWeight(cluster, mode) {
  if (mode === 'ypp_views_priority') return Number((cluster.averageReachValue / 100).toFixed(2));
  if (mode === 'ypp_subs_priority') return Number((cluster.averageFollowValue / 100).toFixed(2));
  if (mode === 'monetization_priority') return Number((cluster.averageMonetizationValue / 100).toFixed(2));
  return Number((cluster.averageHybridValue / 100).toFixed(2));
}

function _getRecommendedMix(mode) {
  if (mode === 'ypp_views_priority') return { reach: 35, follow: 15, monetization: 20, hybrid: 10, ypp_push: 20 };
  if (mode === 'ypp_subs_priority') return { reach: 15, follow: 30, monetization: 20, hybrid: 20, ypp_push: 15 };
  if (mode === 'monetization_priority') return { reach: 15, follow: 20, monetization: 35, hybrid: 20, ypp_push: 10 };
  return { reach: 25, follow: 20, monetization: 25, hybrid: 20, ypp_push: 10 };
}

function _applyFeedbackToMix(mix, portfolioAdjustment = {}, batchOutcome = {}) {
  const adjusted = {
    ...mix,
    reach: (mix.reach || 0) + (portfolioAdjustment.reachMixDelta || 0),
    follow: (mix.follow || 0) + (portfolioAdjustment.followMixDelta || 0),
    monetization: (mix.monetization || 0) + (portfolioAdjustment.monetizationMixDelta || 0),
    hybrid: mix.hybrid || 0,
    ypp_push: (mix.ypp_push || 0) + (portfolioAdjustment.yppPushMixDelta || 0)
  };

  if ((batchOutcome.batchBalanceScore || 0) < 45) adjusted.hybrid += 4;
  if ((batchOutcome.batchReachEfficiency || 0) > (batchOutcome.batchMonetizationEfficiency || 0) + 25) adjusted.reach -= 3;

  return _normalizeMix(adjusted);
}

function _normalizeMix(mix) {
  const safe = Object.fromEntries(Object.entries(mix).map(([key, value]) => [key, Math.max(0, value)]));
  const total = Object.values(safe).reduce((sum, value) => sum + value, 0) || 1;
  const normalized = {};
  Object.entries(safe).forEach(([key, value]) => {
    normalized[key] = Math.round((value / total) * 100);
  });
  const diff = 100 - Object.values(normalized).reduce((sum, value) => sum + value, 0);
  normalized.hybrid = (normalized.hybrid || 0) + diff;
  return normalized;
}

module.exports = {
  optimizePortfolio,
  PORTFOLIO_BALANCE_PATH
};
