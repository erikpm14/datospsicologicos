const fs = require('fs');
const path = require('path');

const STRATEGY_DIR = path.resolve(__dirname, '../../data/strategy');
const STRATEGY_MEMORY_PATH = path.join(STRATEGY_DIR, 'strategy-memory.json');

function buildStrategyMemory(inputs = {}) {
  fs.mkdirSync(STRATEGY_DIR, { recursive: true });

  const clusters = inputs.clusters?.clusters || [];
  const patterns = inputs.patterns || {};
  const inheritedSignals = inputs.inheritedSignals?.inherited || [];
  const scoredContent = inputs.scoredContent?.scripts || [];
  const yppStatus = inputs.yppStatus || {};
  const analysis = inputs.analysis?.analysis || [];
  const normalizedRealMetrics = inputs.normalizedRealMetrics?.normalized || [];
  const executionFeedback = inputs.executionFeedback || _readJson(path.resolve(__dirname, '../../data/execution/strategy-feedback.json'), {});
  const feedbackAdjustments = new Map((executionFeedback.clusterAdjustments || []).map((item) => [item.clusterId, item]));

  const clusterEntries = clusters.map((cluster) => {
    const members = cluster.memberVideos || [];
    const relatedInherited = inheritedSignals.filter((item) => members.includes(item.scriptId) || item.inheritedFromCluster === cluster.clusterId);
    const relatedScored = scoredContent.filter((item) => members.includes(item.id) || item.inheritedFromCluster === cluster.clusterId || (item.topic && cluster.clusterLabel.includes(String(item.topic).toLowerCase())));
    const relatedReal = normalizedRealMetrics.filter((item) => item.category && cluster.clusterLabel.includes(String(item.category).toLowerCase()));
    const feedback = feedbackAdjustments.get(cluster.clusterId) || {};

    const averageReachValue = _clamp(_avg(relatedScored.map((item) => ((item.retentionScore || 0) + (item.rewatchScore || 0)) / 2)) + (feedback.averageReachValueDelta || 0));
    const averageFollowValue = _clamp(_avg(relatedScored.map((item) => item.followScore || item.inheritedFollowPotential || 0)) + (feedback.averageFollowValueDelta || 0));
    const averageMonetizationValue = _clamp(_avg(relatedScored.map((item) => item.monetizationPriorityScore || item.monetizationOutcomeScore || 0)) + (feedback.averageMonetizationValueDelta || 0));
    const averageYppContribution = _clamp(_avg([
      ...relatedScored.map((item) => item.yppContributionScore || 0),
      ...relatedInherited.map((item) => item.inheritedYppContributionScore || 0),
      ...relatedReal.map((item) => item.yppContributionScore || 0)
    ]) + (feedback.averageYppContributionDelta || 0));
    const averageHybridValue = Number((((averageFollowValue + averageMonetizationValue) / 2) * 0.6 + averageReachValue * 0.4).toFixed(2));
    const repeatabilityScore = _clamp(_calcRepeatability(cluster, relatedScored) + (feedback.repeatabilityScoreDelta || 0));
    const saturationRisk = _clamp(_calcSaturationRisk(cluster, relatedScored) + (feedback.saturationRiskDelta || 0));
    const businessUsefulnessScore = Number(((averageMonetizationValue * 0.4) + (averageYppContribution * 0.25) + (averageFollowValue * 0.2) + (repeatabilityScore * 0.15) - (saturationRisk * 0.15)).toFixed(2));
    const strategicRole = feedback.clusterBusinessRole || _getStrategicRole({
      averageReachValue,
      averageFollowValue,
      averageMonetizationValue,
      averageYppContribution,
      saturationRisk
    });

    return {
      clusterId: cluster.clusterId,
      clusterLabel: cluster.clusterLabel,
      averageReachValue,
      averageFollowValue,
      averageMonetizationValue,
      averageYppContribution,
      averageHybridValue,
      repeatabilityScore,
      saturationRisk,
      businessUsefulnessScore,
      bestHookTypesByCluster: _topValues(relatedScored.map((item) => item.hookType).filter(Boolean), 2),
      bestMicroActionsByCluster: _topValues(relatedScored.map((item) => item.microActionType).filter(Boolean), 2),
      bestPortfolioRoleByCluster: _topValues(relatedScored.map((item) => item.portfolioRole).filter(Boolean), 1)[0] || 'hybrid',
      worstPatternsByCluster: _getWorstPatterns(cluster, patterns),
      strategicRole,
      clusterBusinessRole: strategicRole,
      explorationRecommendation: saturationRisk >= 55,
      exploitationRecommendation: businessUsefulnessScore >= 60,
      batchLearningConfidence: executionFeedback.batchLearningConfidence || 0
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    currentYppFocus: yppStatus.recommendation?.missingMore || 'views',
    clusters: clusterEntries
  };

  fs.writeFileSync(STRATEGY_MEMORY_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _calcRepeatability(cluster, relatedScored) {
  const roleSpread = new Set(relatedScored.map((item) => item.portfolioRole).filter(Boolean)).size;
  const base = cluster.topPerformingPatterns?.length ? 55 : 35;
  return Math.min(100, Math.round(base + roleSpread * 8));
}

function _calcSaturationRisk(cluster, relatedScored) {
  const usage = (cluster.memberVideos || []).length * 9;
  const repeatedRole = _topValues(relatedScored.map((item) => item.portfolioRole).filter(Boolean), 1);
  const penalty = repeatedRole.length ? 10 : 0;
  return Math.min(100, usage + penalty);
}

function _getStrategicRole(values) {
  if (values.averageYppContribution >= values.averageMonetizationValue && values.averageYppContribution >= values.averageReachValue) return 'ypp_push';
  if (values.averageMonetizationValue >= values.averageReachValue && values.averageMonetizationValue >= values.averageFollowValue) return 'monetization';
  if (values.averageFollowValue >= values.averageReachValue) return 'follow';
  return 'reach';
}

function _getWorstPatterns(cluster, patterns) {
  return (patterns.emptyViewsPatterns || []).filter((pattern) => cluster.clusterLabel.includes(String(pattern).toLowerCase()) || cluster.clusterId.includes(String(pattern).toLowerCase()));
}

function _topValues(values, limit) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => value);
}

function _avg(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return 0;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(2));
}

function _clamp(value) {
  return Number(Math.max(0, Math.min(100, value || 0)).toFixed(2));
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  buildStrategyMemory,
  STRATEGY_MEMORY_PATH
};
