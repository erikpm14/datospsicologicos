const fs = require('fs');
const path = require('path');

const EXECUTION_DIR                = path.resolve(__dirname, '../../data/execution');
const BATCH_OUTCOMES_PATH          = path.join(EXECUTION_DIR, 'batch-outcomes.json');
const LATEST_BATCH_OUTCOME_PATH    = path.join(EXECUTION_DIR, 'latest-batch-outcome.json');
const SLOT_RESULTS_PATH            = path.resolve(__dirname, '../../data/tracking/slot-results.json');
const SLOT_VS_RESULT_REPORT_PATH   = path.resolve(__dirname, '../../data/tracking/slot-vs-result-report.json');
const NORMALIZED_REAL_METRICS_PATH = path.resolve(__dirname, '../../data/integrations/normalized-real-metrics.json');
const SUBSLOT_RESULTS_PATH         = path.resolve(__dirname, '../../data/tracking/subslot-results.json');
const AB_WINNERS_PATH              = path.resolve(__dirname, '../../data/tracking/ab-winners.json');

function analyzeBatchOutcome(inputs = {}) {
  fs.mkdirSync(EXECUTION_DIR, { recursive: true });

  const execution    = inputs.batchExecution || _readJson(path.join(EXECUTION_DIR, 'latest-batch-execution.json'), {});
  const slotResults  = _readJson(SLOT_RESULTS_PATH,          { slotResults: [] }).slotResults || [];
  const slotVsResult = _readJson(SLOT_VS_RESULT_REPORT_PATH, { report: [] }).report || [];
  const normalized   = inputs.normalizedRealMetrics?.normalized || _readJson(NORMALIZED_REAL_METRICS_PATH, { normalized: [] }).normalized || [];
  const subslots     = _readJson(SUBSLOT_RESULTS_PATH, { subslotResults: [] }).subslotResults || [];
  const abWinners    = _readJson(AB_WINNERS_PATH, { abWinners: [] }).abWinners || [];
  const batchResults = slotResults.filter((item) => item.batchId === execution.batchId);
  const batchAbWinners = abWinners.filter(w => w.batchId === execution.batchId);
  const executed = (execution.executedSlots || []).map((slot) => ({
    ...slot,
    metrics: batchResults.find((result) => result.slotId === slot.slotId) || _fallbackMetrics(slot, normalized),
    report: slotVsResult.find((result) => result.slotId === slot.slotId) || {}
  })).filter((slot) => slot.matched);

  // Para slots con A/B: usar métricas del winner (por businessValue) en los promedios
  // así el análisis no se contamina con el loser
  const executedNormalized = executed.map(slot => {
    const winner = batchAbWinners.find(w => w.slotId === slot.slotId && w.status === 'decided');
    if (!winner || !winner.winnerSubslotId) return slot;

    const winnerSubslot = subslots.find(s => s.subslotId === winner.winnerSubslotId);
    if (!winnerSubslot) return slot;

    // Enriquecer métricas del slot con las del winner A/B
    return {
      ...slot,
      isAbSlot: true,
      abWinnerVariantId:    winner.winnerByBusinessValue?.split('_').pop() || null,
      abWinnerType:         winner.winnerType,
      abBusinessValueGain:  Number(((winner.testBusinessValue || 0) - (winner.controlBusinessValue || 0)).toFixed(2)),
      metrics: {
        ...slot.metrics,
        views:                   winnerSubslot.views         || slot.metrics.views,
        usefulViews:             winnerSubslot.usefulViews   || slot.metrics.usefulViews,
        monetizationOutcomeScore: winnerSubslot.estimatedMonetizationOutcomeScore || slot.metrics.monetizationOutcomeScore,
        yppContributionScore:    winnerSubslot.estimatedYppContributionScore || slot.metrics.yppContributionScore,
        businessValue:           winnerSubslot.businessValue || 0,
      },
    };
  });

  const totalViews = executedNormalized.reduce((sum, slot) => sum + (slot.metrics.views || 0), 0);
  const avgViewsPerSlot = Number((totalViews / Math.max(executedNormalized.length, 1)).toFixed(2));
  const totalUsefulViews = Number((executedNormalized.reduce((sum, slot) => sum + (slot.metrics.usefulViews || 0), 0)).toFixed(2));
  const followLift = Number((_avg(executedNormalized.map((slot) => slot.metrics.follows || 0))).toFixed(2));
  const monetizationLift = Number((_avg(executedNormalized.map((slot) => slot.metrics.monetizationOutcomeScore || 0))).toFixed(2));
  const yppLift = Number((_avg(executedNormalized.map((slot) => slot.metrics.yppContributionScore || 0))).toFixed(2));
  const totalBusinessValue = Number((executedNormalized.reduce((sum, slot) => sum + (slot.metrics.businessValue || 0), 0)).toFixed(2));
  const avgBusinessValue   = Number((totalBusinessValue / Math.max(executedNormalized.length, 1)).toFixed(2));
  const batchReachEfficiency = Number((_avg(executedNormalized.filter((slot) => slot.actualRole === 'reach' || slot.actualRole === 'ypp_push').map((slot) => slot.metrics.usefulViews || 0))).toFixed(2));
  const batchMonetizationEfficiency = Number((_avg(executedNormalized.filter((slot) => slot.actualRole === 'monetization' || slot.actualRole === 'hybrid').map((slot) => slot.metrics.monetizationOutcomeScore || 0))).toFixed(2));
  const batchFollowEfficiency = Number((_avg(executedNormalized.filter((slot) => slot.actualRole === 'follow' || slot.actualRole === 'hybrid').map((slot) => slot.metrics.rolePerformanceScore || 0))).toFixed(2));
  const clusterMixQuality = Number((100 - _dominantClusterPenalty(executedNormalized)).toFixed(2));
  const batchBalanceScore = Number(((
    (batchReachEfficiency * 0.22) +
    (batchMonetizationEfficiency * 0.28) +
    (batchFollowEfficiency * 0.18) +
    (yppLift * 0.18) +
    (clusterMixQuality * 0.14)
  ) / 1.2).toFixed(2));

  const batchRolePerformance = _groupPerformance(executedNormalized, 'actualRole', 'rolePerformanceScore');
  const clusterPerformance   = _groupPerformance(executedNormalized, 'actualCluster', 'clusterPerformanceScore');

  // Resumen A/B del batch
  const abSlotsCount     = executedNormalized.filter(s => s.isAbSlot).length;
  const abBusinessGains  = executedNormalized
    .filter(s => s.isAbSlot && s.abBusinessValueGain > 0)
    .map(s => s.abBusinessValueGain);
  const avgAbBusinessGain = abBusinessGains.length
    ? Number((_avg(abBusinessGains)).toFixed(2)) : 0;
  const bestRole = batchRolePerformance[0];
  const worstRole = batchRolePerformance[batchRolePerformance.length - 1];
  const bestCluster = clusterPerformance[0];
  const worstCluster = clusterPerformance[clusterPerformance.length - 1];

  const payload = {
    batchId: execution.batchId || `batch_${Date.now()}`,
    executed: executed.length > 0,
    totalViews,
    avgViewsPerSlot,
    totalUsefulViews,
    followLift,
    monetizationLift,
    yppLift,
    batchReachEfficiency,
    batchMonetizationEfficiency,
    batchFollowEfficiency,
    batchBalanceScore,
    batchRolePerformance,
    executionDeviationScore: execution.executionDeviationScore || 0,
    scheduleEffectiveness: Number(Math.max(0, 100 - (execution.executionDeviationScore || 0) * 0.5).toFixed(2)),
    roleSequenceEffectiveness: Number((_avg(executed.map((slot) => 100 - Math.min(100, Math.abs(slot.realOrderVsPlannedDelta || 0) * 20)))).toFixed(2)),
    clusterMixQuality,
    totalBusinessValue,
    avgBusinessValue,
    abSlotsCount,
    avgAbBusinessGain,
    batchLearningConfidence: Number((_avg(executedNormalized.map((slot) => Math.max(slot.traceConfidence || 0, slot.report?.exactTraceAvailable ? 0.9 : 0))) * 100).toFixed(2)),
    abLearning: batchAbWinners.map(w => ({
      experimentId:         w.abExperimentId,
      winnerType:           w.winnerType,
      winnerByViews:        w.winnerByViews?.split('_').pop() || null,
      winnerByBusiness:     w.winnerByBusinessValue?.split('_').pop() || null,
      businessValueGain:    Number(((w.testBusinessValue || 0) - (w.controlBusinessValue || 0)).toFixed(2)),
      hookTypeLearning:     w.hookTypeLearning,
      shouldTransfer:       w.shouldTransferLearning,
    })),
    bestPerformingRole: bestRole?.key || '',
    worstPerformingRole: worstRole?.key || '',
    bestCluster: bestCluster?.key || '',
    worstCluster: worstCluster?.key || '',
    whatWorked: `El rol ${bestRole?.key || 'unknown'} y el cluster ${bestCluster?.key || 'unknown'} sostuvieron el mejor rendimiento útil del batch.`,
    whatFailed: `El rol ${worstRole?.key || 'unknown'} y el cluster ${worstCluster?.key || 'unknown'} dejaron la parte más floja del mix.`
  };

  const outcomes = _readJson(BATCH_OUTCOMES_PATH, { batches: [] });
  outcomes.batches = [...(outcomes.batches || []).filter((batch) => batch.batchId !== payload.batchId), payload];
  fs.writeFileSync(BATCH_OUTCOMES_PATH, JSON.stringify(outcomes, null, 2));
  fs.writeFileSync(LATEST_BATCH_OUTCOME_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _groupPerformance(items, field, scoreField) {
  const groups = new Map();
  items.forEach((item) => {
    const key = item[field] || 'unknown';
    const current = groups.get(key) || { key, count: 0, total: 0 };
    current.count += 1;
    current.total += item.metrics?.[scoreField] || 0;
    groups.set(key, current);
  });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      score: Number((group.total / Math.max(group.count, 1)).toFixed(2))
    }))
    .sort((a, b) => b.score - a.score);
}

function _dominantClusterPenalty(executed) {
  if (executed.length === 0) return 0;
  const counts = new Map();
  executed.forEach((slot) => counts.set(slot.actualCluster, (counts.get(slot.actualCluster) || 0) + 1));
  const dominant = [...counts.values()].sort((a, b) => b - a)[0] || 0;
  return Math.min(70, (dominant / executed.length) * 70);
}

function _avg(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  analyzeBatchOutcome,
  BATCH_OUTCOMES_PATH,
  LATEST_BATCH_OUTCOME_PATH
};

function _fallbackMetrics(slot, normalized) {
  const metric = normalized.find((item) => item.videoId === slot.videoId) || {};
  const views = metric.views || 0;
  const follows = metric.follows || 0;
  const retention = metric.retention || 0;
  const rewatch = metric.rewatch || 0;
  const monetizationOutcomeScore = metric.monetizationOutcomeScore || 0;
  const yppContributionScore = metric.yppContributionScore || 0;
  const usefulViews = Number((views * (((retention * 0.35) + (rewatch * 0.2) + (((follows / Math.max(views, 1)) * 100) * 0.2) + (monetizationOutcomeScore * 0.15) + (yppContributionScore * 0.1)) / 100)).toFixed(2));
  const slotPerformanceScore = Number((((retention * 0.22) + (rewatch * 0.14) + (monetizationOutcomeScore * 0.22) + (yppContributionScore * 0.18) + (((follows / Math.max(views, 1)) * 100) * 0.24))).toFixed(2));
  return {
    views,
    likes: metric.likes || 0,
    comments: metric.comments || 0,
    shares: metric.shares || 0,
    retention,
    rewatch,
    follows,
    monetizationOutcomeScore,
    yppContributionScore,
    usefulViews,
    slotPerformanceScore,
    rolePerformanceScore: slotPerformanceScore,
    clusterPerformanceScore: slotPerformanceScore
  };
}
