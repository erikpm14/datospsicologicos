const fs = require('fs');
const path = require('path');

const STRATEGY_DIR = path.resolve(__dirname, '../../data/strategy');
const NEXT_BATCH_PLAN_PATH = path.join(STRATEGY_DIR, 'next-batch-plan.json');

function planNextBatch(inputs = {}) {
  fs.mkdirSync(STRATEGY_DIR, { recursive: true });

  const strategyMemory = inputs.strategyMemory || { clusters: [] };
  const businessMode = inputs.businessMode || { currentBusinessMode: 'balanced_growth' };
  const portfolioBalance = inputs.portfolioBalance || { recommendedMix: { reach: 25, follow: 25, monetization: 25, hybrid: 15, ypp_push: 10 } };
  const batchOutcome = inputs.batchOutcome || _readJson(path.resolve(__dirname, '../../data/execution/latest-batch-outcome.json'), {});
  const strategyFeedback = inputs.strategyFeedback || _readJson(path.resolve(__dirname, '../../data/execution/strategy-feedback.json'), {});
  const candidates = inputs.candidates || [];
  const recommendedBatchSize = _getBatchSize(businessMode.currentBusinessMode);
  const batchComposition = _composeBatch(portfolioBalance.recommendedMix, recommendedBatchSize);
  const slotBySlotPlan = _buildSlots(strategyMemory.clusters || [], batchComposition, businessMode.currentBusinessMode, strategyFeedback, candidates);

  const payload = {
    batchId: `batch_${Date.now()}`,
    currentBusinessMode: businessMode.currentBusinessMode,
    recommendedBatchSize,
    batchComposition,
    slotBySlotPlan,
    whyThisBatch: _buildWhyThisBatch(businessMode, slotBySlotPlan, batchOutcome)
  };

  fs.writeFileSync(NEXT_BATCH_PLAN_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _getBatchSize(mode) {
  if (mode === 'ypp_views_priority') return 5;
  if (mode === 'monetization_priority') return 4;
  return 4;
}

function _composeBatch(mix, batchSize) {
  const entries = Object.entries(mix || {});
  const composition = {};
  let assigned = 0;
  entries.forEach(([role, percentage], index) => {
    const slots = index === entries.length - 1
      ? batchSize - assigned
      : Math.round((percentage / 100) * batchSize);
    composition[role] = slots;
    assigned += slots;
  });
  return composition;
}

function _buildSlots(clusters, composition, currentBusinessMode, strategyFeedback, candidates) {
  const feedbackMap = new Map((strategyFeedback.clusterAdjustments || []).map((item) => [item.clusterId, item]));
  const sorted = [...clusters].sort((a, b) => _clusterPriority(b, feedbackMap) - _clusterPriority(a, feedbackMap));
  const slots = [];
  let slot = 1;
  const usedClusters = new Set();

  Object.entries(composition).forEach(([role, count]) => {
    for (let index = 0; index < count; index += 1) {
      const cluster = _pickClusterForRole(sorted, role, index, usedClusters);
      const candidate = _pickCandidateForSlot(candidates, cluster, role);
      slots.push({
        slot,
        targetRole: role,
        recommendedCluster: cluster?.clusterLabel || '',
        reason: _slotReason(cluster, role),
        preferredHookType: cluster?.bestHookTypesByCluster?.[0] || 'challenge',
        preferredMicroAction: cluster?.bestMicroActionsByCluster?.[0] || 'REPEAT_CHECK',
        businessGoal: currentBusinessMode,
        strategicRole: cluster?.strategicRole || role,
        clusterBusinessRole: cluster?.clusterBusinessRole || cluster?.strategicRole || role,
        saturationRisk: cluster?.saturationRisk || 0,
        repeatabilityScore: cluster?.repeatabilityScore || 0,
        explorationRecommendation: Boolean(cluster?.explorationRecommendation),
        exploitationRecommendation: Boolean(cluster?.exploitationRecommendation),
        recommendedCandidateId: candidate?.id || null,
        recommendedCandidateTitle: candidate?.title || null,
        batchPriorityScore: candidate?.batchPriorityScore || cluster?.businessUsefulnessScore || 0
      });
      if (cluster?.clusterId) usedClusters.add(cluster.clusterId);
      slot += 1;
    }
  });

  return slots;
}

function _pickClusterForRole(clusters, role, offset, usedClusters) {
  const filtered = clusters.filter((cluster) => cluster.strategicRole === role || cluster.clusterBusinessRole === role || (role === 'hybrid' && cluster.averageHybridValue >= 55));
  const pool = filtered.length > 0 ? filtered : clusters;
  const freshPool = pool.filter((cluster) => !usedClusters.has(cluster.clusterId) || cluster.repeatabilityScore >= 65);
  const selectedPool = freshPool.length > 0 ? freshPool : pool;
  return selectedPool[offset % Math.max(selectedPool.length, 1)];
}

function _slotReason(cluster, role) {
  if (!cluster) return 'Sin cluster fuerte; usar exploración controlada.';
  return `Cluster con rol ${cluster.strategicRole}, utilidad ${cluster.businessUsefulnessScore} y saturación ${cluster.saturationRisk}.`;
}

function _buildWhyThisBatch(businessMode, slots, batchOutcome) {
  const roles = slots.map((slot) => slot.targetRole).join(', ');
  return `El batch sigue el modo ${businessMode.currentBusinessMode}, reparte slots en ${roles} y corrige el último balance ${batchOutcome.batchBalanceScore || 0} para mejorar negocio, YPP y saturación.`;
}

function _pickCandidateForSlot(candidates, cluster, role) {
  return [...(candidates || [])]
    .filter((candidate) => {
      const clusterMatch = cluster
        ? `${cluster.clusterId} ${cluster.clusterLabel}`.toLowerCase().includes(String(candidate.inheritedFromCluster || candidate.topic || '').toLowerCase())
          || String(candidate.topic || '').toLowerCase().includes(String(cluster.clusterLabel || '').toLowerCase())
        : true;
      const roleMatch = (candidate.strategicRole || candidate.portfolioRole || 'hybrid') === role || role === 'hybrid';
      return clusterMatch || roleMatch;
    })
    .sort((a, b) => (b.batchPriorityScore || 0) - (a.batchPriorityScore || 0))[0] || null;
}

function _clusterPriority(cluster, feedbackMap) {
  const feedback = feedbackMap.get(cluster.clusterId) || {};
  return (cluster.businessUsefulnessScore || 0) + ((feedback.averageMonetizationValueDelta || 0) * 2) + ((feedback.averageYppContributionDelta || 0) * 1.5) - (cluster.saturationRisk || 0);
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  planNextBatch,
  NEXT_BATCH_PLAN_PATH
};
