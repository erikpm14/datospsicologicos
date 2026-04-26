const fs = require('fs');
const path = require('path');

const { getLatestPlannedSlots, updatePlannedSlot } = require('./slot-lineage-manager');
const { canConsumeSlot, transitionSlotState } = require('./slot-consumption-guard');
const { linkAbVariantToSlot } = require('./ab-slot-linker');

const TRACKING_DIR = path.resolve(__dirname, '../../data/tracking');
const SLOT_ASSIGNMENTS_PATH = path.join(TRACKING_DIR, 'slot-assignments.json');

function assignSlotToCandidate(script = {}, context = {}) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const existingTracking = script.slotTracking || {};
  const planned = getLatestPlannedSlots();
  const slot = existingTracking.slotId
    ? (planned.slots || []).find((item) => item.slotId === existingTracking.slotId)
    : _findBestSlot(script, context, planned.slots || []);

  if (!slot) {
    return {
      ...script,
      slotTracking: {
        ...existingTracking,
        batchId: existingTracking.batchId || null,
        slotId: existingTracking.slotId || null,
        plannedOrder: existingTracking.plannedOrder || null,
        plannedRole: existingTracking.plannedRole || null,
        plannedCluster: existingTracking.plannedCluster || null,
        plannedHookType: existingTracking.plannedHookType || null,
        plannedMicroAction: existingTracking.plannedMicroAction || null,
        recommendedCandidateId: existingTracking.recommendedCandidateId || null,
        recommendedCandidateTitle: existingTracking.recommendedCandidateTitle || null,
        attributionType: existingTracking.attributionType || 'unplanned',
        slotState: 'unplanned',
        assignmentConfidence: 0,
        traceConfidence: 0,
        exactTraceAvailable: false,
        abLinked: Boolean(script.abExperimentId || script.abVariantId)
      }
    };
  }

  const assignmentConfidence = Number(Math.min(1, (_slotMatchScore(slot, script, context) || 0) / 100).toFixed(2));
  const guard = canConsumeSlot(
    { ...existingTracking, slotId: slot.slotId },
    script,
    {
      abExperimentId: script.abExperimentId || slot.abExperimentId || null,
      variantId: script.abVariantId || null
    }
  );

  if (!guard.allowed) {
    return {
      ...script,
      slotTracking: {
        ...existingTracking,
        batchId: slot.batchId,
        slotId: slot.slotId,
        plannedOrder: slot.plannedOrder,
        plannedRole: slot.plannedRole,
        plannedCluster: slot.plannedCluster,
        plannedHookType: slot.plannedHookType,
        plannedMicroAction: slot.plannedMicroAction,
        recommendedCandidateId: slot.recommendedCandidateId,
        recommendedCandidateTitle: slot.recommendedCandidateTitle,
        attributionType: 'blocked',
        slotState: slot.status,
        assignmentConfidence: guard.assignmentConfidence || assignmentConfidence,
        traceConfidence: slot.traceConfidence || assignmentConfidence,
        exactTraceAvailable: false,
        abLinked: Boolean(script.abExperimentId || script.abVariantId),
        assignmentBlockedReason: guard.reason
      }
    };
  }

  const assignment = {
    batchId: slot.batchId,
    slotId: slot.slotId,
    plannedRole: slot.plannedRole,
    plannedCluster: slot.plannedCluster,
    recommendedCandidateId: slot.recommendedCandidateId || null,
    assignedCandidateId: script.id || context.executedCandidateId || null,
    assignedCandidateTitle: script.title || null,
    assignmentStatus: context.assignmentStatus || 'assigned',
    assignmentConfidence,
    assignedAt: new Date().toISOString(),
    queueJobId: context.jobId || null,
    variantId: script.abVariantId || null,
    abExperimentId: script.abExperimentId || null
  };

  _upsertAssignment(assignment);
  updatePlannedSlot(slot.slotId, {
    queueJobId: context.jobId || slot.queueJobId || null,
    assignedCandidateId: assignment.assignedCandidateId,
    assignedCandidateTitle: assignment.assignedCandidateTitle,
    assignmentType: _assignmentType(slot, script),
    assignmentConfidence,
    traceConfidence: Math.max(slot.traceConfidence || 0, assignmentConfidence),
    abExperimentId: script.abExperimentId || slot.abExperimentId || null,
    variantId: script.abVariantId || slot.variantId || null
  });
  transitionSlotState(slot.slotId, context.assignmentStatus || 'assigned', {
    queueJobId: context.jobId || slot.queueJobId || null,
    assignedCandidateId: assignment.assignedCandidateId,
    assignedCandidateTitle: assignment.assignedCandidateTitle,
    assignmentConfidence,
    traceConfidence: Math.max(slot.traceConfidence || 0, assignmentConfidence),
    abExperimentId: script.abExperimentId || slot.abExperimentId || null,
    variantId: script.abVariantId || slot.variantId || null
  });

  const slotTracking = {
    batchId: slot.batchId,
    slotId: slot.slotId,
    plannedOrder: slot.plannedOrder,
    plannedRole: slot.plannedRole,
    plannedCluster: slot.plannedCluster,
    plannedHookType: slot.plannedHookType,
    plannedMicroAction: slot.plannedMicroAction,
    recommendedCandidateId: slot.recommendedCandidateId,
    recommendedCandidateTitle: slot.recommendedCandidateTitle,
    businessMode: slot.businessMode,
    targetGoal: slot.targetGoal,
    scheduleWindow: slot.scheduleWindow,
    recommendedPublishTime: slot.recommendedPublishTime,
    attributionType: _assignmentType(slot, script),
    slotState: context.assignmentStatus || 'assigned',
    assignmentConfidence,
    traceConfidence: Math.max(slot.traceConfidence || 0, assignmentConfidence),
    exactTraceAvailable: true,
    abLinked: Boolean(script.abExperimentId || script.abVariantId)
  };

  if (script.abExperimentId || script.abVariantId) {
    linkAbVariantToSlot({
      script: { ...script, slotTracking },
      variantRole: script.abVariantId === 'v_a' ? 'control' : script.abVariantId === 'v_b' ? 'test' : 'variant'
    });
  }

  return {
    ...script,
    slotTracking
  };
}

function markSlotAssignmentStatus(slotId, assignmentStatus, metadata = {}) {
  if (!slotId) return null;
  const payload = transitionSlotState(slotId, assignmentStatus, metadata);
  const assignments = _readJson(SLOT_ASSIGNMENTS_PATH, { totalAssignments: 0, assignments: [] });
  assignments.assignments = (assignments.assignments || []).map((item) => item.slotId === slotId ? {
    ...item,
    assignmentStatus,
    ...metadata
  } : item);
  assignments.generatedAt = new Date().toISOString();
  assignments.totalAssignments = assignments.assignments.length;
  fs.writeFileSync(SLOT_ASSIGNMENTS_PATH, JSON.stringify(assignments, null, 2));
  return payload;
}

function getSlotAssignments() {
  return _readJson(SLOT_ASSIGNMENTS_PATH, { assignments: [] });
}

function _findBestSlot(script, context, slots) {
  return [...slots]
    .filter((slot) => slot.status === 'planned')
    .map((slot) => ({ slot, score: _slotMatchScore(slot, script, context) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.slot.plannedOrder - b.slot.plannedOrder)[0]?.slot || null;
}

function _slotMatchScore(slot, script, context) {
  let score = 0;
  if (slot.recommendedCandidateId && slot.recommendedCandidateId === script.id) score += 60;
  if (slot.recommendedCandidateTitle && _slug(slot.recommendedCandidateTitle) === _slug(script.title)) score += 18;
  if (slot.plannedRole && slot.plannedRole === (script.strategicRole || script.portfolioRole || context.growthContext?.strategyRole)) score += 15;
  if (slot.plannedCluster && (_slug(slot.plannedCluster).includes(_slug(script.topic)) || _slug(slot.plannedCluster).includes(_slug(script.inheritedFromCluster)))) score += 12;
  if (slot.plannedHookType && slot.plannedHookType === script.hookType) score += 6;
  if (slot.plannedMicroAction && slot.plannedMicroAction === script.microActionType) score += 5;
  if (script.abVariantId === 'v_b' && script.slotTracking?.slotId === slot.slotId) score += 30;
  return score;
}

function _assignmentType(slot, script) {
  if (slot.recommendedCandidateId && slot.recommendedCandidateId === script.id) return 'exact_candidate';
  if (script.abExperimentId || script.abVariantId) return 'ab_linked';
  if (slot.plannedRole === (script.strategicRole || script.portfolioRole)) return 'role_match';
  return 'cluster_match';
}

function _upsertAssignment(assignment) {
  const existing = _readJson(SLOT_ASSIGNMENTS_PATH, { generatedAt: null, totalAssignments: 0, assignments: [] });
  const assignments = [
    ...(existing.assignments || []).filter((item) => !(item.slotId === assignment.slotId && item.assignedCandidateId === assignment.assignedCandidateId && item.variantId === assignment.variantId)),
    assignment
  ];
  fs.writeFileSync(SLOT_ASSIGNMENTS_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalAssignments: assignments.length,
    assignments
  }, null, 2));
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
  assignSlotToCandidate,
  markSlotAssignmentStatus,
  getSlotAssignments,
  SLOT_ASSIGNMENTS_PATH
};
