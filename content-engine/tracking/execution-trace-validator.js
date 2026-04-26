const fs = require('fs');
const path = require('path');

const TRACKING_DIR = path.resolve(__dirname, '../../data/tracking');
const PLANNED_SLOTS_PATH = path.join(TRACKING_DIR, 'planned-slots.json');
const SLOT_ASSIGNMENTS_PATH = path.join(TRACKING_DIR, 'slot-assignments.json');
const ATTRIBUTION_PATH = path.join(TRACKING_DIR, 'publication-attribution.json');
const SLOT_RESULTS_PATH = path.join(TRACKING_DIR, 'slot-results.json');
const SLOT_CONFLICTS_PATH = path.join(TRACKING_DIR, 'slot-conflicts.json');
const TRACE_VALIDATION_REPORT_PATH = path.join(TRACKING_DIR, 'trace-validation-report.json');

function validateExecutionTrace() {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const planned = _readJson(PLANNED_SLOTS_PATH, { slots: [] }).slots || [];
  const assignments = _readJson(SLOT_ASSIGNMENTS_PATH, { assignments: [] }).assignments || [];
  const publications = _readJson(ATTRIBUTION_PATH, { publications: [] }).publications || [];
  const slotResults = _readJson(SLOT_RESULTS_PATH, { slotResults: [] }).slotResults || [];
  const conflicts = _readJson(SLOT_CONFLICTS_PATH, {
    duplicateAssignments: 0,
    publishedSlotReuses: 0,
    abAmbiguities: 0,
    invalidTrackingCases: 0
  });
  const publicationBySlot = new Map(publications.map((item) => [item.slotId, item]));
  const resultBySlot = new Map(slotResults.map((item) => [item.slotId, item]));

  const plannedSlots = planned.length;
  const assignedSlots = new Set(assignments.map((item) => item.slotId).filter(Boolean)).size;
  const consumedSlots = planned.filter((slot) => ['assigned', 'queued', 'rendered', 'published', 'completed'].includes(slot.status)).length;
  const publishedSlotsMatched = planned.filter((slot) => publicationBySlot.has(slot.slotId)).length;
  const orphanPublications = publications.filter((item) => !item.slotId || !planned.some((slot) => slot.slotId === item.slotId)).length;
  const slotsWithoutMetrics = planned.filter((slot) => publicationBySlot.has(slot.slotId) && !resultBySlot.has(slot.slotId)).length;
  const candidateReplacements = publications.filter((item) => item.candidateReplacementDetected).length;
  const orderDeviations = publications.filter((item) => Math.abs(item.realOrderVsPlannedDelta || 0) > 0).length;
  const missing = [];

  if (consumedSlots > 0 && publishedSlotsMatched < consumedSlots) missing.push('slots_consumidos_sin_publicacion');
  if (orphanPublications > 0) missing.push('publicaciones_sin_slot');
  if (slotsWithoutMetrics > 0) missing.push('slots_sin_metricas');
  if (publications.some((item) => item.candidateReplacementDetected && !item.replacementReason)) missing.push('replacements_sin_explicacion');
  if (publications.some((item) => item.variantId === null && item.executionStatus === 'published')) missing.push('variantes_no_persistidas');
  if (publications.some((item) => item.plannedRole && item.actualRole && item.plannedRole !== item.actualRole)) missing.push('cambios_role');
  if ((conflicts.duplicateAssignments || 0) > 0) missing.push('doble_asignacion_detectada');

  const expectedPublishedSlots = Math.max(consumedSlots, 1);
  const traceRaw = (
    ((assignedSlots / Math.max(plannedSlots, 1)) * 0.15) +
    ((publishedSlotsMatched / expectedPublishedSlots) * 0.35) +
    ((1 - (orphanPublications / Math.max(publications.length, 1))) * 0.2) +
    ((1 - (slotsWithoutMetrics / Math.max(publishedSlotsMatched, 1))) * 0.2) +
    ((1 - ((candidateReplacements + (conflicts.publishedSlotReuses || 0)) / Math.max(publications.length + 1, 1))) * 0.05) +
    ((1 - ((orderDeviations + (conflicts.abAmbiguities || 0)) / Math.max(publications.length + 1, 1))) * 0.05)
  );
  const traceConfidence = Number((Math.max(0, Math.min(1, traceRaw))).toFixed(2));

  const payload = {
    plannedSlots,
    assignedSlots,
    consumedSlots,
    publishedSlotsMatched,
    orphanPublications,
    slotsWithoutMetrics,
    candidateReplacements,
    orderDeviations,
    duplicateAssignments: conflicts.duplicateAssignments || 0,
    publishedSlotReuses: conflicts.publishedSlotReuses || 0,
    abAmbiguities: conflicts.abAmbiguities || 0,
    invalidTrackingCases: conflicts.invalidTrackingCases || 0,
    traceConfidence,
    whatIsMissing: missing
  };

  fs.writeFileSync(TRACE_VALIDATION_REPORT_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

module.exports = {
  validateExecutionTrace,
  TRACE_VALIDATION_REPORT_PATH
};

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
