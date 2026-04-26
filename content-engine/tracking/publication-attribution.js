const fs = require('fs');
const path = require('path');

const TRACKING_DIR = path.resolve(__dirname, '../../data/tracking');
const ATTRIBUTION_PATH = path.join(TRACKING_DIR, 'publication-attribution.json');
const { updatePlannedSlot, getLatestPlannedSlots } = require('./slot-lineage-manager');
const { transitionSlotState } = require('./slot-consumption-guard');
const { linkAbVariantToSlot } = require('./ab-slot-linker');

function recordPublication(input = {}) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const script = input.script || {};
  const slotTracking = script.slotTracking || input.slotTracking || {};
  const batchId = slotTracking.batchId || input.batchId || null;
  const slotId = slotTracking.slotId || input.slotId || null;
  const planned = (getLatestPlannedSlots().slots || []).find((slot) => slot.slotId === slotId) || {};
  const publishedAt = input.publishedAt || new Date().toISOString();
  const existing = _readJson(ATTRIBUTION_PATH, { generatedAt: null, totalPublications: 0, publications: [] });
  const currentBatch = (existing.publications || []).filter((item) => item.batchId === batchId);
  const actualOrder = input.actualOrder || (currentBatch.length + 1);
  const plannedOrder = slotTracking.plannedOrder || planned.plannedOrder || null;
  const executedCandidateId = script.id || input.executedCandidateId || input.publishedVideoId;
  const actualRole = script.strategicRole || script.portfolioRole || input.actualRole || null;
  const actualCluster = _resolveCluster(script, input.actualCluster);
  const record = {
    batchId,
    slotId,
    executedCandidateId,
    executedCandidateTitle: script.title || input.executedCandidateTitle || null,
    publishedVideoId: input.publishedVideoId,
    platformVideoId: input.platformVideoId || null,
    publishedAt,
    actualOrder,
    actualRole,
    actualCluster,
    actualHookType: script.hookType || input.actualHookType || null,
    variantId: script.abVariantId || input.variantId || null,
    executionStatus: input.executionStatus || 'published',
    slotState: input.executionStatus || 'published',
    replacementReason: _replacementReason(planned, script, input),
    plannedRole: slotTracking.plannedRole || planned.plannedRole || null,
    plannedCluster: slotTracking.plannedCluster || planned.plannedCluster || null,
    recommendedCandidateId: slotTracking.recommendedCandidateId || planned.recommendedCandidateId || null,
    recommendedCandidateTitle: slotTracking.recommendedCandidateTitle || planned.recommendedCandidateTitle || null,
    traceConfidence: Number((((slotTracking.traceConfidence || 0) * 0.7) + 0.3).toFixed(2)),
    attributionType: slotId ? 'exact_slot' : 'script_only',
    exactTraceAvailable: Boolean(slotId),
    abLinked: Boolean(script.abExperimentId || script.abVariantId || input.variantId),
    replacementType: _replacementType(planned, actualRole, actualCluster, executedCandidateId),
    executionFidelityScore: _executionFidelityScore(planned, actualRole, actualCluster, executedCandidateId, plannedOrder, actualOrder),
    slotDeviationScore: _slotDeviationScore(planned, actualRole, actualCluster, executedCandidateId),
    candidateReplacementDetected: Boolean(planned.recommendedCandidateId && planned.recommendedCandidateId !== executedCandidateId),
    realOrderVsPlannedDelta: plannedOrder ? actualOrder - plannedOrder : null
  };

  const publications = [
    ...(existing.publications || []).filter((item) => item.publishedVideoId !== record.publishedVideoId),
    record
  ];

  fs.writeFileSync(ATTRIBUTION_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalPublications: publications.length,
    publications
  }, null, 2));

  if (slotId) {
    updatePlannedSlot(slotId, {
      status: 'published',
      slotState: 'published',
      publishedVideoId: record.publishedVideoId,
      publishedAt: record.publishedAt,
      actualOrder: record.actualOrder,
      executionStatus: record.executionStatus
    });
    transitionSlotState(slotId, 'published', {
      publishedVideoId: record.publishedVideoId,
      publishedAt: record.publishedAt,
      actualOrder: record.actualOrder,
      assignedCandidateId: executedCandidateId,
      assignedCandidateTitle: record.executedCandidateTitle,
      variantId: record.variantId,
      abExperimentId: script.abExperimentId || input.abExperimentId || null,
      traceConfidence: record.traceConfidence
    });
  }

  if (record.abLinked) {
    linkAbVariantToSlot({
      script: { ...script, slotTracking },
      abExperimentId: script.abExperimentId || input.abExperimentId || null,
      variantId: record.variantId,
      executedCandidateId,
      executedCandidateTitle: record.executedCandidateTitle
    });
  }

  return record;
}

function _replacementType(planned, actualRole, actualCluster, executedCandidateId) {
  if (planned.recommendedCandidateId && planned.recommendedCandidateId !== executedCandidateId) return 'candidate_replaced';
  if (planned.plannedRole && planned.plannedRole !== actualRole) return 'role_changed';
  if (planned.plannedCluster && _slug(planned.plannedCluster) !== _slug(actualCluster)) return 'cluster_changed';
  return 'recommended_candidate_kept';
}

function getPublicationAttribution() {
  return _readJson(ATTRIBUTION_PATH, { publications: [] });
}

function _resolveCluster(script, fallback) {
  if (fallback) return fallback;
  if (script.slotTracking?.plannedCluster) return script.slotTracking.plannedCluster;
  if (script.inheritedFromCluster) return script.inheritedFromCluster;
  return script.topic || null;
}

function _replacementReason(planned, script, input) {
  const executedCandidateId = script.id || input.executedCandidateId || null;
  if (!planned.recommendedCandidateId || planned.recommendedCandidateId === executedCandidateId) return null;
  return input.replacementReason || 'recommended_candidate_not_executed';
}

function _executionFidelityScore(planned, actualRole, actualCluster, executedCandidateId, plannedOrder, actualOrder) {
  let score = 40;
  if (planned.recommendedCandidateId && planned.recommendedCandidateId === executedCandidateId) score += 30;
  if (planned.plannedRole && planned.plannedRole === actualRole) score += 15;
  if (planned.plannedCluster && _slug(planned.plannedCluster) === _slug(actualCluster)) score += 10;
  if (plannedOrder && actualOrder) score -= Math.min(10, Math.abs(actualOrder - plannedOrder) * 5);
  return Math.max(0, Math.min(100, score));
}

function _slotDeviationScore(planned, actualRole, actualCluster, executedCandidateId) {
  let score = 0;
  if (planned.recommendedCandidateId && planned.recommendedCandidateId !== executedCandidateId) score += 45;
  if (planned.plannedRole && planned.plannedRole !== actualRole) score += 30;
  if (planned.plannedCluster && _slug(planned.plannedCluster) !== _slug(actualCluster)) score += 25;
  return Math.min(100, score);
}

function _slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  recordPublication,
  getPublicationAttribution,
  ATTRIBUTION_PATH
};
