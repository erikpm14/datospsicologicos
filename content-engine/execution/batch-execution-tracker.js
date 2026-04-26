const fs = require('fs');
const path = require('path');

const EXECUTION_DIR = path.resolve(__dirname, '../../data/execution');
const BATCH_HISTORY_PATH = path.join(EXECUTION_DIR, 'batch-history.json');
const LATEST_BATCH_EXECUTION_PATH = path.join(EXECUTION_DIR, 'latest-batch-execution.json');
const PLANNED_SLOTS_PATH = path.resolve(__dirname, '../../data/tracking/planned-slots.json');
const ATTRIBUTION_PATH = path.resolve(__dirname, '../../data/tracking/publication-attribution.json');
const VALIDATION_PATH = path.resolve(__dirname, '../../data/tracking/trace-validation-report.json');
const SLOT_VS_RESULT_REPORT_PATH = path.resolve(__dirname, '../../data/tracking/slot-vs-result-report.json');
const PUBLISH_LOG_PATH = path.resolve(__dirname, '../../backend/data/publish-log.json');

function trackBatchExecution(inputs = {}) {
  fs.mkdirSync(EXECUTION_DIR, { recursive: true });

  const batchPlan = inputs.batchPlan || _readJson(path.resolve(__dirname, '../../data/strategy/next-batch-plan.json'), {});
  const plannedSlots = _readJson(PLANNED_SLOTS_PATH, { slots: [] }).slots || [];
  const attribution = _readJson(ATTRIBUTION_PATH, { publications: [] }).publications || [];
  const slotVsResult = _readJson(SLOT_VS_RESULT_REPORT_PATH, { report: [] }).report || [];
  const validation = _readJson(VALIDATION_PATH, {});
  const batchId = batchPlan.batchId || [...plannedSlots].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0]?.batchId || `batch_${Date.now()}`;
  const exactPlanned = plannedSlots.filter((slot) => slot.batchId === batchId);
  const exactPublications = attribution.filter((item) => item.batchId === batchId);

  if (exactPlanned.length > 0 && exactPublications.length > 0) {
    const executedSlots = exactPlanned.map((slot) => {
      const pub = exactPublications.find((item) => item.slotId === slot.slotId);
      const slotReport = slotVsResult.find((item) => item.slotId === slot.slotId) || {};
      return {
        slot: slot.plannedOrder,
        slotId: slot.slotId,
        targetRole: slot.plannedRole,
        plannedCluster: slot.plannedCluster,
        plannedOrder: slot.plannedOrder,
        matched: Boolean(pub),
        traceConfidence: pub?.traceConfidence ?? slot.traceConfidence ?? 0,
        attributionType: pub?.attributionType || 'planned_only',
        recommendedCandidateId: slot.recommendedCandidateId,
        recommendedCandidateTitle: slot.recommendedCandidateTitle,
        actualRole: pub?.actualRole || null,
        actualCluster: pub?.actualCluster || null,
        videoId: pub?.publishedVideoId || null,
        title: pub?.executedCandidateTitle || slot.assignedCandidateTitle || null,
        publishedAt: pub?.publishedAt || null,
        actualOrder: pub?.actualOrder || null,
        executionStatus: pub?.executionStatus || (pub ? 'published' : 'planned'),
        matchScore: pub ? Math.round((pub.executionFidelityScore || 0)) : 0,
        executionFidelityScore: pub?.executionFidelityScore || 0,
        slotDeviationScore: pub?.slotDeviationScore || 0,
        candidateReplacementDetected: Boolean(pub?.candidateReplacementDetected),
        realOrderVsPlannedDelta: pub?.realOrderVsPlannedDelta ?? null,
        exactTraceAvailable: Boolean(slotReport.exactTraceAvailable),
        slotExecutionQuality: slotReport.slotExecutionQuality || 0
      };
    });

    const skippedSlots = executedSlots.filter((slot) => !slot.matched).map((slot) => slot.slot);
    const replacedSlots = executedSlots
      .filter((slot) => slot.candidateReplacementDetected || slot.slotDeviationScore > 0)
      .map((slot) => ({
        slot: slot.slot,
        targetRole: slot.targetRole,
        actualRole: slot.actualRole,
        plannedCluster: slot.plannedCluster,
        actualCluster: slot.actualCluster,
        recommendedCandidateId: slot.recommendedCandidateId,
        executedCandidateId: slot.videoId
      }));

    const executionCoverage = Number((((executedSlots.length - skippedSlots.length) / Math.max(executedSlots.length, 1)) * 100).toFixed(2));
    const executionDeviation = Number((_avg(executedSlots.map((slot) => slot.slotDeviationScore || 0))).toFixed(2));
    const executionFidelityScore = Number((_avg(executedSlots.filter((slot) => slot.matched).map((slot) => slot.executionFidelityScore || 0))).toFixed(2));
    const payload = {
      batchId,
      createdAt: new Date().toISOString(),
      businessMode: batchPlan.currentBusinessMode || exactPlanned[0]?.businessMode || 'balanced_growth',
      plannedComposition: batchPlan.batchComposition || _compose(exactPlanned),
      plannedSlots: batchPlan.slotBySlotPlan || exactPlanned,
      executedSlots,
      publishedVideoIds: executedSlots.filter((slot) => slot.videoId).map((slot) => slot.videoId),
      skippedSlots,
      replacedSlots,
      executionCoverage,
      executionDeviation,
      executionDeviationScore: executionDeviation,
      executionFidelityScore,
      reconstructionType: 'exact_trace',
      reconstructionConfidence: validation.traceConfidence || _avg(executedSlots.map((slot) => slot.traceConfidence || 0))
    };

    const history = _readJson(BATCH_HISTORY_PATH, { batches: [] });
    history.batches = [...(history.batches || []).filter((batch) => batch.batchId !== batchId), payload];
    fs.writeFileSync(BATCH_HISTORY_PATH, JSON.stringify(history, null, 2));
    fs.writeFileSync(LATEST_BATCH_EXECUTION_PATH, JSON.stringify(payload, null, 2));
    return payload;
  }

  const fallback = _buildHeuristicFallback(batchPlan, inputs);

  const history = _readJson(BATCH_HISTORY_PATH, { batches: [] });
  history.batches = [...(history.batches || []).filter((batch) => batch.batchId !== batchId), fallback];
  fs.writeFileSync(BATCH_HISTORY_PATH, JSON.stringify(history, null, 2));
  fs.writeFileSync(LATEST_BATCH_EXECUTION_PATH, JSON.stringify(fallback, null, 2));
  return fallback;
}

function _compose(planned) {
  return planned.reduce((acc, slot) => {
    acc[slot.plannedRole] = (acc[slot.plannedRole] || 0) + 1;
    return acc;
  }, {});
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
  trackBatchExecution,
  BATCH_HISTORY_PATH,
  LATEST_BATCH_EXECUTION_PATH
};

function _buildHeuristicFallback(batchPlan, inputs) {
  const normalizedMetrics = inputs.normalizedRealMetrics?.normalized || _readJson(path.resolve(__dirname, '../../data/integrations/normalized-real-metrics.json'), { normalized: [] }).normalized || [];
  const strategyMemory = inputs.strategyMemory || _readJson(path.resolve(__dirname, '../../data/strategy/strategy-memory.json'), { clusters: [] });
  const publishLog = _readJson(PUBLISH_LOG_PATH, []);
  const batchSize = batchPlan.recommendedBatchSize || (batchPlan.slotBySlotPlan || []).length || 0;
  const recentPublished = normalizedMetrics
    .filter((item) => item.status === 'published')
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, Math.max(batchSize, 1) * 2);
  const available = [...recentPublished];
  const executedSlots = (batchPlan.slotBySlotPlan || []).map((slot, index) => {
    const matchIndex = _findBestMatchIndex(slot, available, strategyMemory.clusters || [], index);
    if (matchIndex === -1) {
      return {
        slot: slot.slot,
        targetRole: slot.targetRole,
        plannedCluster: slot.recommendedCluster || '',
        plannedOrder: slot.slot,
        matched: false,
        traceConfidence: 0,
        attributionType: 'heuristic',
        actualRole: null,
        actualCluster: null,
        videoId: null,
        title: null,
        publishedAt: null,
        actualOrder: null,
        executionStatus: 'planned',
        matchScore: 0,
        executionFidelityScore: 0,
        slotDeviationScore: 100,
        candidateReplacementDetected: false,
        realOrderVsPlannedDelta: null
      };
    }
    const matched = available.splice(matchIndex, 1)[0];
    const actualCluster = _inferClusterLabel(matched, strategyMemory.clusters || []);
    const actualRole = _classifyRole(matched);
    const matchScore = _calculateMatchScore(slot, matched, actualCluster, actualRole);
    return {
      slot: slot.slot,
      targetRole: slot.targetRole,
      plannedCluster: slot.recommendedCluster || '',
      plannedOrder: slot.slot,
      matched: true,
      traceConfidence: Number((matchScore / 100).toFixed(2)),
      attributionType: 'heuristic',
      actualRole,
      actualCluster,
      videoId: matched.videoId,
      title: matched.title,
      publishedAt: matched.publishedAt,
      actualOrder: index + 1,
      executionStatus: 'published',
      matchScore,
      executionFidelityScore: matchScore,
      slotDeviationScore: 100 - matchScore,
      candidateReplacementDetected: false,
      realOrderVsPlannedDelta: (index + 1) - slot.slot
    };
  });

  const skippedSlots = executedSlots.filter((slot) => !slot.matched).map((slot) => slot.slot);
  const replacedSlots = executedSlots.filter((slot) => slot.slotDeviationScore > 0).map((slot) => ({
    slot: slot.slot,
    targetRole: slot.targetRole,
    actualRole: slot.actualRole,
    plannedCluster: slot.plannedCluster,
    actualCluster: slot.actualCluster
  }));
  return {
    batchId: batchPlan.batchId || `batch_${Date.now()}`,
    createdAt: new Date().toISOString(),
    businessMode: batchPlan.currentBusinessMode || 'balanced_growth',
    plannedComposition: batchPlan.batchComposition || {},
    plannedSlots: batchPlan.slotBySlotPlan || [],
    executedSlots,
    publishedVideoIds: executedSlots.filter((slot) => slot.videoId).map((slot) => slot.videoId),
    skippedSlots,
    replacedSlots,
    executionCoverage: Number((((executedSlots.length - skippedSlots.length) / Math.max(executedSlots.length, 1)) * 100).toFixed(2)),
    executionDeviation: Number((_avg(executedSlots.map((slot) => slot.slotDeviationScore || 0))).toFixed(2)),
    executionDeviationScore: Number((_avg(executedSlots.map((slot) => slot.slotDeviationScore || 0))).toFixed(2)),
    executionFidelityScore: Number((_avg(executedSlots.filter((slot) => slot.matched).map((slot) => slot.executionFidelityScore || 0))).toFixed(2)),
    reconstructionType: publishLog.length > 0 ? 'heuristic_fallback' : 'no_execution_data',
    reconstructionConfidence: Number((_avg(executedSlots.map((slot) => slot.traceConfidence || 0))).toFixed(2))
  };
}

function _findBestMatchIndex(slot, candidates, clusters, index) {
  let bestIndex = -1;
  let bestScore = -1;
  candidates.forEach((candidate, candidateIndex) => {
    const actualCluster = _inferClusterLabel(candidate, clusters);
    const actualRole = _classifyRole(candidate);
    const score = _calculateMatchScore(slot, candidate, actualCluster, actualRole) - Math.abs(candidateIndex - index);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = candidateIndex;
    }
  });
  return bestIndex;
}

function _calculateMatchScore(slot, candidate, actualCluster, actualRole) {
  let score = 20;
  if (slot.targetRole === actualRole) score += 35;
  if (_slug(slot.recommendedCluster) === _slug(actualCluster)) score += 30;
  if ((slot.recommendedCluster || '').toLowerCase().includes(String(candidate.category || '').toLowerCase())) score += 12;
  score += Math.min(15, (candidate.realDataConfidence || 0) * 15);
  return Number(score.toFixed(2));
}

function _classifyRole(video) {
  if ((video.yppContributionScore || 0) >= 50) return 'ypp_push';
  if ((video.monetizationOutcomeScore || 0) >= 60) return 'monetization';
  if ((video.views || 0) >= 400) return 'reach';
  if ((video.follows || 0) >= 18 || (video.followConversion || 0) >= 5) return 'follow';
  return 'hybrid';
}

function _inferClusterLabel(item, clusters) {
  const text = `${item.category || item.topic || ''} ${item.title || ''} ${item.hook || ''}`.toLowerCase();
  const matchedCluster = (clusters || []).find((cluster) => {
    const clusterText = `${cluster.clusterId} ${cluster.clusterLabel}`.toLowerCase();
    return clusterText.includes(String(item.category || item.topic || '').toLowerCase())
      || text.includes(cluster.clusterLabel.toLowerCase())
      || (cluster.memberVideos || []).includes(item.videoId);
  });
  if (matchedCluster) return matchedCluster.clusterLabel;
  return item.category || item.topic || 'general';
}

function _slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
