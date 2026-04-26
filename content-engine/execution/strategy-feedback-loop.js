const fs = require('fs');
const path = require('path');

const EXECUTION_DIR              = path.resolve(__dirname, '../../data/execution');
const STRATEGY_FEEDBACK_PATH     = path.join(EXECUTION_DIR, 'strategy-feedback.json');
const SLOT_VS_RESULT_REPORT_PATH = path.resolve(__dirname, '../../data/tracking/slot-vs-result-report.json');
const AB_WINNERS_PATH            = path.resolve(__dirname, '../../data/tracking/ab-winners.json');

function applyStrategyFeedback(inputs = {}) {
  fs.mkdirSync(EXECUTION_DIR, { recursive: true });

  const strategyMemory = inputs.strategyMemory || { clusters: [] };
  const batchPlan      = inputs.batchPlan      || {};
  const batchExecution = inputs.batchExecution || {};
  const batchOutcome   = inputs.batchOutcome   || {};
  const slotVsResult   = _readJson(SLOT_VS_RESULT_REPORT_PATH, { report: [] }).report || [];
  const abWinners      = _readJson(AB_WINNERS_PATH, { abWinners: [] }).abWinners || [];

  const batchId = batchExecution.batchId || batchOutcome.batchId;
  const exactBatchSlots = slotVsResult.filter((item) => item.batchId === batchId);
  const batchAbWinners  = abWinners.filter(w => w.batchId === batchId && w.status === 'decided');

  const recommendationQuality = _recommendationQuality(batchPlan, batchOutcome);
  const executionQuality = _executionQuality(batchExecution);
  const learningMode = _learningMode(recommendationQuality, executionQuality, batchOutcome);
  const clusterAdjustments = (strategyMemory.clusters || []).map((cluster) => _buildClusterAdjustment(cluster, batchExecution, batchOutcome));
  const roleAdjustments = _buildRoleAdjustments(batchOutcome.batchRolePerformance || []);
  const portfolioAdjustment  = _buildPortfolioAdjustment(batchOutcome, learningMode);
  const abVariantLearning    = _buildAbVariantLearning(batchAbWinners);
  const roleSequenceLearning = _buildRoleSequenceLearning(exactBatchSlots);

  const payload = {
    generatedAt: new Date().toISOString(),
    batchId: batchId || `batch_${Date.now()}`,
    recommendationQuality,
    executionQuality,
    learningMode,
    batchLearningConfidence: Number((((batchExecution.reconstructionConfidence || 0) * 0.35) + ((batchExecution.executionCoverage || 0) / 100 * 0.25) + ((batchOutcome.batchBalanceScore || 0) / 100 * 0.2) + ((_avg(exactBatchSlots.map((item) => item.exactTraceAvailable ? 1 : 0)) || 0) * 0.2)).toFixed(2)),
    clusterAdjustments,
    roleAdjustments,
    portfolioAdjustment,
    abVariantLearning,
    roleSequenceLearning,
    summary: _buildSummary(learningMode, batchOutcome, abVariantLearning)
  };

  fs.writeFileSync(STRATEGY_FEEDBACK_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function _avg(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function _buildClusterAdjustment(cluster, batchExecution, batchOutcome) {
  const matchedSlots = (batchExecution.executedSlots || []).filter((slot) => slot.actualCluster === cluster.clusterLabel);
  const clusterWeight = matchedSlots.length;
  const isBest = batchOutcome.bestCluster === cluster.clusterLabel;
  const isWorst = batchOutcome.worstCluster === cluster.clusterLabel;
  const averageReachValueDelta = isBest ? 6 : isWorst ? -4 : clusterWeight > 0 ? 1.5 : 0;
  const averageFollowValueDelta = matchedSlots.some((slot) => slot.actualRole === 'follow' || slot.actualRole === 'hybrid') ? 4 : 0;
  const averageMonetizationValueDelta = isBest ? 5 : isWorst ? -5 : clusterWeight > 0 ? 2 : 0;
  const averageYppContributionDelta = matchedSlots.some((slot) => slot.actualRole === 'ypp_push' || (slot.yppContributionScore || 0) >= 45) ? 4 : 0;
  const repeatabilityScoreDelta = batchOutcome.clusterMixQuality >= 60 && clusterWeight === 1 ? 3 : clusterWeight >= 2 ? -2 : 0;
  const saturationRiskDelta = clusterWeight >= 2 ? 8 : clusterWeight === 1 ? 2 : -1;
  const clusterBusinessRole = isBest
    ? _bestClusterRole(batchOutcome, matchedSlots)
    : cluster.clusterBusinessRole || cluster.strategicRole;

  return {
    clusterId: cluster.clusterId,
    clusterLabel: cluster.clusterLabel,
    averageReachValueDelta,
    averageFollowValueDelta,
    averageMonetizationValueDelta,
    averageYppContributionDelta,
    repeatabilityScoreDelta,
    saturationRiskDelta,
    clusterBusinessRole
  };
}

function _buildRoleAdjustments(batchRolePerformance) {
  return batchRolePerformance.map((role, index) => ({
    role: role.key,
    delta: index === 0 ? 6 : index === batchRolePerformance.length - 1 ? -5 : 1,
    score: role.score
  }));
}

function _buildPortfolioAdjustment(batchOutcome, learningMode) {
  const liftGap = (batchOutcome.batchReachEfficiency || 0) - (batchOutcome.batchMonetizationEfficiency || 0);
  return {
    explorationWeightDelta: learningMode === 'good_recommendation_good_execution' ? -0.03 : 0.05,
    exploitationWeightDelta: learningMode === 'good_recommendation_good_execution' ? 0.07 : -0.02,
    reachMixDelta: liftGap > 30 ? -4 : 2,
    monetizationMixDelta: liftGap > 30 ? 6 : 1,
    followMixDelta: (batchOutcome.batchFollowEfficiency || 0) < 20 ? 4 : 0,
    yppPushMixDelta: (batchOutcome.yppLift || 0) < 35 ? 5 : 0
  };
}

function _recommendationQuality(batchPlan, batchOutcome) {
  const monetizationSlots = (batchPlan.slotBySlotPlan || []).filter((slot) => slot.targetRole === 'monetization' || slot.targetRole === 'hybrid').length;
  const score = ((batchOutcome.batchMonetizationEfficiency || 0) * 0.5) + ((batchOutcome.batchBalanceScore || 0) * 0.3) + (monetizationSlots * 4);
  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
}

function _executionQuality(batchExecution) {
  const score = ((batchExecution.executionCoverage || 0) * 0.65) - ((batchExecution.executionDeviation || 0) * 0.25) + ((batchExecution.reconstructionConfidence || 0) * 20);
  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
}

function _learningMode(recommendationQuality, executionQuality, batchOutcome) {
  if (recommendationQuality >= 60 && executionQuality >= 60) return 'good_recommendation_good_execution';
  if (recommendationQuality >= 60 && executionQuality < 60) return 'good_recommendation_bad_execution';
  if (recommendationQuality < 60 && executionQuality >= 60) return 'bad_recommendation_good_execution';
  if ((batchOutcome.totalViews || 0) > 800 && (batchOutcome.batchBalanceScore || 0) < 45) return 'successful_by_anomaly';
  return 'bad_recommendation_bad_execution';
}

function _bestClusterRole(batchOutcome, matchedSlots) {
  if ((batchOutcome.bestPerformingRole || '') && matchedSlots.some((slot) => slot.actualRole === batchOutcome.bestPerformingRole)) {
    return batchOutcome.bestPerformingRole;
  }
  return matchedSlots[0]?.actualRole || 'hybrid';
}

/**
 * Aprendizaje por variante A/B orientado a negocio.
 * Distingue qué hookType gana en views vs. qué gana en monetización.
 */
function _buildAbVariantLearning(batchAbWinners) {
  if (!batchAbWinners.length) {
    return { available: false, note: 'Sin experimentos A/B decididos en este batch.' };
  }

  const hookTypeInsights = {};
  for (const w of batchAbWinners) {
    if (!w.shouldTransferLearning) continue;

    // Winner por negocio puede ser diferente al winner por views
    const bizWinner   = w.winnerByBusinessValue?.split('_').pop();
    const viewWinner  = w.winnerByViews?.split('_').pop();
    const hookTypeWin = w.winnerHookType;
    const hookTypeLos = w.loserHookType;

    if (hookTypeWin) {
      if (!hookTypeInsights[hookTypeWin]) hookTypeInsights[hookTypeWin] = { businessWins: 0, viewWins: 0, total: 0 };
      hookTypeInsights[hookTypeWin].total++;
      if (bizWinner === w.winnerSubslotId?.split('_').pop()) hookTypeInsights[hookTypeWin].businessWins++;
      if (viewWinner === w.winnerSubslotId?.split('_').pop()) hookTypeInsights[hookTypeWin].viewWins++;
    }
  }

  // Detectar conflictos views vs negocio
  const viewsVsBusinessConflicts = batchAbWinners.filter(w =>
    w.winnerByViews !== w.winnerByBusinessValue && w.status === 'decided'
  ).length;

  return {
    available:               true,
    decidedExperiments:      batchAbWinners.length,
    viewsVsBusinessConflicts,
    hookTypeInsights,
    recommendation: viewsVsBusinessConflicts > 0
      ? `${viewsVsBusinessConflicts} experimento(s) con ganador de views ≠ ganador de negocio. ` +
        `Priorizar hookType de negocio para slots de monetización.`
      : 'Views y negocio alineados — hookType ganador válido para todos los slots.',
    transferableInsights: batchAbWinners
      .filter(w => w.shouldTransferLearning)
      .map(w => ({
        hookType:        w.winnerHookType,
        winnerType:      w.winnerType,
        learningNote:    w.learningNote,
        businessImpact:  w.businessImpact,
      })),
  };
}

/**
 * Aprendizaje por roleSequence: qué posición del batch deja más valor comercial.
 */
function _buildRoleSequenceLearning(exactBatchSlots) {
  if (!exactBatchSlots.length) {
    return { available: false };
  }

  const byOrder = {};
  for (const slot of exactBatchSlots) {
    const order = slot.roleSequenceReal || slot.orderDelta + 1;
    if (!order) continue;
    if (!byOrder[order]) byOrder[order] = { businessValues: [], monetizations: [], usefulViews: [] };
    byOrder[order].businessValues.push(slot.businessValue || 0);
    byOrder[order].monetizations.push(slot.monetizationOutcomeScore || 0);
    byOrder[order].usefulViews.push(slot.usefulViews || 0);
  }

  const sequencePerformance = Object.entries(byOrder).map(([order, data]) => ({
    order:            parseInt(order),
    avgBusinessValue: parseFloat((_avg(data.businessValues)).toFixed(2)),
    avgMonetization:  parseFloat((_avg(data.monetizations)).toFixed(2)),
    avgUsefulViews:   parseFloat((_avg(data.usefulViews)).toFixed(2)),
  })).sort((a, b) => a.order - b.order);

  const bestOrder = sequencePerformance.sort((a, b) => b.avgBusinessValue - a.avgBusinessValue)[0];

  return {
    available:            true,
    sequencePerformance,
    bestOrderForBusiness: bestOrder?.order || null,
    recommendation: bestOrder
      ? `La posición ${bestOrder.order} del batch generó mayor businessValue (${bestOrder.avgBusinessValue}). ` +
        `Colocar slots de monetización en esa posición en el próximo batch.`
      : 'Sin datos suficientes de roleSequence.',
  };
}

function _buildSummary(learningMode, batchOutcome, abLearning) {
  const abNote = abLearning?.available && abLearning.viewsVsBusinessConflicts > 0
    ? ` | ${abLearning.viewsVsBusinessConflicts} conflicto(s) views vs negocio detectados.`
    : '';
  return `Modo ${learningMode}; balance ${batchOutcome.batchBalanceScore || 0}, monetización ${batchOutcome.monetizationLift || 0}, YPP ${batchOutcome.yppLift || 0}, businessValue ${batchOutcome.avgBusinessValue || 0}.${abNote}`;
}

module.exports = {
  applyStrategyFeedback,
  STRATEGY_FEEDBACK_PATH
};
