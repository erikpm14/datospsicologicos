const fs = require('fs');
const path = require('path');

const { getLatestPlannedSlots, updatePlannedSlot } = require('./slot-lineage-manager');

const TRACKING_DIR = path.resolve(__dirname, '../../data/tracking');
const SLOT_CONFLICTS_PATH = path.join(TRACKING_DIR, 'slot-conflicts.json');

function canConsumeSlot(slotTracking = {}, candidate = {}, options = {}) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const slotId = slotTracking.slotId || null;
  if (!slotId) {
    return {
      allowed: true,
      reason: 'no_slot_tracking',
      slotState: null,
      assignmentConfidence: 0
    };
  }

  const slot = (getLatestPlannedSlots().slots || []).find((item) => item.slotId === slotId);
  if (!slot) {
    const latestSlots = getLatestPlannedSlots().slots || [];
    if (latestSlots.length === 0) {
      return {
        allowed: true,
        reason: 'slot_tracking_orphaned',
        slotState: null,
        assignmentConfidence: slotTracking.assignmentConfidence || slotTracking.traceConfidence || 0
      };
    }
    _registerConflict('invalidTrackingCases', {
      slotId,
      reason: 'slot_not_found',
      candidateId: candidate.id || null
    });
    return {
      allowed: false,
      reason: 'slot_not_found',
      slotState: null,
      assignmentConfidence: 0
    };
  }

  const candidateId = candidate.id || slotTracking.executedCandidateId || null;
  const sameCandidate = Boolean(slot.assignedCandidateId && slot.assignedCandidateId === candidateId);
  const sameExperiment = Boolean(
    options.abExperimentId &&
    slot.abExperimentId &&
    slot.abExperimentId === options.abExperimentId
  );
  const publishedStates = ['published', 'completed'];
  const occupiedStates = ['assigned', 'queued', 'rendered'];

  if (publishedStates.includes(slot.status)) {
    // Si el candidato actual ES el mismo que ya se publicó → bloquear (duplicado real)
    if (slot.publishedVideoId && slot.publishedVideoId === candidateId) {
      _registerConflict('publishedSlotReuses', {
        slotId,
        reason: 'slot_already_published',
        status: slot.status,
        candidateId
      });
      return {
        allowed: false,
        reason: 'slot_already_published',
        slotState: slot.status,
        assignmentConfidence: slot.assignmentConfidence || slot.traceConfidence || 0
      };
    }
    // Candidato diferente (el original fue borrado y reemplazado) → permitir
  }

  if (occupiedStates.includes(slot.status) && !sameCandidate && !sameExperiment && slot.assignedCandidateId) {
    _registerConflict('duplicateAssignments', {
      slotId,
      reason: 'slot_already_consumed',
      status: slot.status,
      existingCandidateId: slot.assignedCandidateId,
      incomingCandidateId: candidateId
    });
    return {
      allowed: false,
      reason: 'slot_already_consumed',
      slotState: slot.status,
      assignmentConfidence: slot.assignmentConfidence || slot.traceConfidence || 0
    };
  }

  if (options.variantId && slot.variantId && slot.variantId !== options.variantId && !sameExperiment) {
    _registerConflict('abAmbiguities', {
      slotId,
      reason: 'variant_mismatch',
      existingVariantId: slot.variantId,
      incomingVariantId: options.variantId
    });
  }

  return {
    allowed: true,
    reason: sameExperiment ? 'shared_experiment_slot' : sameCandidate ? 'same_candidate' : 'slot_available',
    slotState: slot.status,
    assignmentConfidence: slot.assignmentConfidence || slot.traceConfidence || 0
  };
}

function transitionSlotState(slotId, nextState, metadata = {}) {
  if (!slotId) return null;
  const planned = getLatestPlannedSlots();
  const slot = (planned.slots || []).find((item) => item.slotId === slotId);
  if (!slot) return null;

  const payload = {
    ...metadata,
    status: nextState,
    slotState: nextState
  };

  if (metadata.abExperimentId) payload.abExperimentId = metadata.abExperimentId;
  if (metadata.variantId) payload.variantId = metadata.variantId;
  if (metadata.assignedCandidateId) payload.assignedCandidateId = metadata.assignedCandidateId;
  if (metadata.assignedCandidateTitle) payload.assignedCandidateTitle = metadata.assignedCandidateTitle;
  if (metadata.assignmentConfidence !== undefined) payload.assignmentConfidence = metadata.assignmentConfidence;
  if (metadata.traceConfidence !== undefined) payload.traceConfidence = metadata.traceConfidence;
  if (metadata.actualOrder !== undefined) payload.actualOrder = metadata.actualOrder;
  if (metadata.publishedVideoId) payload.publishedVideoId = metadata.publishedVideoId;
  if (metadata.publishedAt) payload.publishedAt = metadata.publishedAt;
  if (metadata.queueJobId) payload.queueJobId = metadata.queueJobId;

  updatePlannedSlot(slotId, payload);
  return { ...slot, ...payload };
}

function invalidateSlot(slotId, reason, metadata = {}) {
  _registerConflict('invalidTrackingCases', { slotId, reason, ...metadata });
  return transitionSlotState(slotId, 'invalidated', {
    invalidatedReason: reason,
    invalidatedAt: new Date().toISOString(),
    ...metadata
  });
}

function getSlotConflicts() {
  const payload = _readJson(SLOT_CONFLICTS_PATH, {
    duplicateAssignments: 0,
    publishedSlotReuses: 0,
    abAmbiguities: 0,
    invalidTrackingCases: 0,
    conflicts: []
  });
  if (!fs.existsSync(SLOT_CONFLICTS_PATH)) {
    fs.mkdirSync(TRACKING_DIR, { recursive: true });
    fs.writeFileSync(SLOT_CONFLICTS_PATH, JSON.stringify(payload, null, 2));
  }
  return payload;
}

function _registerConflict(bucket, conflict) {
  const existing = getSlotConflicts();
  existing[bucket] = (existing[bucket] || 0) + 1;
  existing.conflicts = [
    {
      detectedAt: new Date().toISOString(),
      type: bucket,
      ...conflict
    },
    ...(existing.conflicts || [])
  ].slice(0, 200);
  fs.writeFileSync(SLOT_CONFLICTS_PATH, JSON.stringify(existing, null, 2));
  return existing;
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  canConsumeSlot,
  transitionSlotState,
  invalidateSlot,
  getSlotConflicts,
  SLOT_CONFLICTS_PATH
};
