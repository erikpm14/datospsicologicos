const fs = require('fs');
const path = require('path');

const TRACKING_DIR = path.resolve(__dirname, '../../data/tracking');
const PLANNED_SLOTS_PATH = path.join(TRACKING_DIR, 'planned-slots.json');
const NEXT_BATCH_PLAN_PATH = path.resolve(__dirname, '../../data/strategy/next-batch-plan.json');
const SCHEDULE_PLAN_PATH = path.resolve(__dirname, '../../data/execution/schedule-plan.json');

function persistPlannedSlots(nextBatchPlan = null, options = {}) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const plan = nextBatchPlan || _readJson(NEXT_BATCH_PLAN_PATH, {});
  const schedulePlan = options.schedulePlan || _readJson(SCHEDULE_PLAN_PATH, {});
  const existing = _readJson(PLANNED_SLOTS_PATH, { generatedAt: null, totalSlots: 0, slots: [] });
  const batchId = plan.batchId || `batch_${Date.now()}`;
  const slots = (plan.slotBySlotPlan || []).map((slot) => ({
    batchId,
    slotId: `${batchId}_slot_${slot.slot}`,
    createdAt: new Date().toISOString(),
    plannedOrder: slot.slot,
    plannedRole: slot.targetRole || '',
    plannedCluster: slot.recommendedCluster || '',
    plannedHookType: slot.preferredHookType || '',
    plannedMicroAction: slot.preferredMicroAction || '',
    recommendedCandidateId: slot.recommendedCandidateId || null,
    recommendedCandidateTitle: slot.recommendedCandidateTitle || null,
    businessMode: plan.currentBusinessMode || '',
    targetGoal: slot.businessGoal || plan.currentBusinessMode || '',
    scheduleWindow: schedulePlan.recommendedScheduleWindow || null,
    recommendedPublishTime: _recommendedPublishTime(slot.slot, schedulePlan),
    strategicRole: slot.strategicRole || slot.targetRole || '',
    queueJobId: null,
    assignedCandidateId: null,
    assignedCandidateTitle: null,
    assignmentType: null,
    traceConfidence: 0,
    status: 'planned'
  }));

  const merged = [
    ...(existing.slots || []).filter((slot) => slot.batchId !== batchId),
    ...slots
  ];
  const payload = {
    generatedAt: new Date().toISOString(),
    totalSlots: merged.length,
    slots: merged
  };

  fs.writeFileSync(PLANNED_SLOTS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function attachSlotToScript(script = {}, context = {}) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const planned = _readJson(PLANNED_SLOTS_PATH, { slots: [] });
  const candidates = [...(planned.slots || [])].filter((slot) => slot.status === 'planned' || slot.status === 'queued');
  const best = candidates
    .map((slot) => ({ slot, score: _slotMatchScore(slot, script, context) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.slot.plannedOrder - b.slot.plannedOrder)[0];

  if (!best) {
    return {
      ...script,
      slotTracking: {
        batchId: null,
        slotId: null,
        plannedOrder: null,
        plannedRole: null,
        plannedCluster: null,
        recommendedCandidateId: null,
        recommendedCandidateTitle: null,
        attributionType: 'unplanned',
        traceConfidence: 0
      }
    };
  }

  const updatedSlots = (planned.slots || []).map((slot) => {
    if (slot.slotId !== best.slot.slotId) return slot;
    return {
      ...slot,
      queueJobId: context.jobId || slot.queueJobId || null,
      assignedCandidateId: script.id || context.executedCandidateId || slot.assignedCandidateId || null,
      assignedCandidateTitle: script.title || slot.assignedCandidateTitle || null,
      assignmentType: _assignmentType(best.slot, script),
      traceConfidence: Number(Math.min(1, best.score / 100).toFixed(2)),
      status: 'queued'
    };
  });

  fs.writeFileSync(PLANNED_SLOTS_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalSlots: updatedSlots.length,
    slots: updatedSlots
  }, null, 2));

  return {
    ...script,
    slotTracking: {
      batchId: best.slot.batchId,
      slotId: best.slot.slotId,
      plannedOrder: best.slot.plannedOrder,
      plannedRole: best.slot.plannedRole,
      plannedCluster: best.slot.plannedCluster,
      plannedHookType: best.slot.plannedHookType,
      plannedMicroAction: best.slot.plannedMicroAction,
      recommendedCandidateId: best.slot.recommendedCandidateId,
      recommendedCandidateTitle: best.slot.recommendedCandidateTitle,
      businessMode: best.slot.businessMode,
      targetGoal: best.slot.targetGoal,
      scheduleWindow: best.slot.scheduleWindow,
      recommendedPublishTime: best.slot.recommendedPublishTime,
      attributionType: _assignmentType(best.slot, script),
      traceConfidence: Number(Math.min(1, best.score / 100).toFixed(2))
    }
  };
}

function updatePlannedSlot(slotId, updates = {}) {
  const planned = _readJson(PLANNED_SLOTS_PATH, { slots: [] });
  const slots = (planned.slots || []).map((slot) => slot.slotId === slotId ? { ...slot, ...updates } : slot);
  const payload = {
    generatedAt: new Date().toISOString(),
    totalSlots: slots.length,
    slots
  };
  fs.writeFileSync(PLANNED_SLOTS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function getLatestPlannedSlots() {
  return _readJson(PLANNED_SLOTS_PATH, { slots: [] });
}

function _slotMatchScore(slot, script, context) {
  let score = 0;
  if (slot.recommendedCandidateId && slot.recommendedCandidateId === script.id) score += 60;
  if (slot.recommendedCandidateTitle && _slug(slot.recommendedCandidateTitle) === _slug(script.title)) score += 20;
  if (slot.plannedRole && slot.plannedRole === (script.strategicRole || script.portfolioRole || context.growthContext?.strategyRole)) score += 15;
  if (slot.plannedCluster && (_slug(slot.plannedCluster).includes(_slug(script.topic)) || _slug(slot.plannedCluster).includes(_slug(script.inheritedFromCluster)))) score += 12;
  if (slot.plannedHookType && slot.plannedHookType === script.hookType) score += 6;
  if (slot.plannedMicroAction && slot.plannedMicroAction === script.microActionType) score += 5;
  return score;
}

function _assignmentType(slot, script) {
  if (slot.recommendedCandidateId && slot.recommendedCandidateId === script.id) return 'exact_candidate';
  if (slot.plannedRole === (script.strategicRole || script.portfolioRole)) return 'role_match';
  return 'cluster_match';
}

function _recommendedPublishTime(order, schedulePlan) {
  if (!order || !schedulePlan.spacingBetweenPosts) return null;
  return `${schedulePlan.spacingBetweenPosts} x slot ${order}`;
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
  persistPlannedSlots,
  attachSlotToScript,
  updatePlannedSlot,
  getLatestPlannedSlots,
  PLANNED_SLOTS_PATH
};
