const fs = require('fs');
const path = require('path');

const SLOT_ASSIGNMENTS_PATH    = path.resolve(__dirname, '../../data/tracking/slot-assignments.json');
const ATTRIBUTION_PATH         = path.resolve(__dirname, '../../data/tracking/publication-attribution.json');
const SLOT_RESULTS_PATH        = path.resolve(__dirname, '../../data/tracking/slot-results.json');
const PLANNED_SLOTS_PATH       = path.resolve(__dirname, '../../data/tracking/planned-slots.json');
const SLOT_VS_RESULT_REPORT_PATH = path.resolve(__dirname, '../../data/tracking/slot-vs-result-report.json');
const SUBSLOT_RESULTS_PATH     = path.resolve(__dirname, '../../data/tracking/subslot-results.json');
const AB_WINNERS_PATH          = path.resolve(__dirname, '../../data/tracking/ab-winners.json');

function buildSlotVsResultReport() {
  const planned      = _readJson(PLANNED_SLOTS_PATH,    { slots: [] }).slots || [];
  const assignments  = _readJson(SLOT_ASSIGNMENTS_PATH, { assignments: [] }).assignments || [];
  const publications = _readJson(ATTRIBUTION_PATH,      { publications: [] }).publications || [];
  const slotResults  = _readJson(SLOT_RESULTS_PATH,     { slotResults: [] }).slotResults || [];
  const subslots     = _readJson(SUBSLOT_RESULTS_PATH,  { subslotResults: [] }).subslotResults || [];
  const abWinners    = _readJson(AB_WINNERS_PATH,       { abWinners: [] }).abWinners || [];

  const report = planned.map((slot) => {
    const assignment = assignments
      .filter((item) => item.slotId === slot.slotId)
      .sort((a, b) => new Date(b.assignedAt || 0) - new Date(a.assignedAt || 0))[0] || {};
    const publication = publications.find((item) => item.slotId === slot.slotId) || {};
    const result = slotResults.find((item) => item.slotId === slot.slotId) || {};
    const replacementDetected = Boolean(publication.candidateReplacementDetected || (slot.recommendedCandidateId && assignment.assignedCandidateId && slot.recommendedCandidateId !== assignment.assignedCandidateId));
    const monetizationDelta = Number(((result.estimatedMonetizationOutcomeScore || result.monetizationOutcomeScore || 0) - (slot.plannedRole === 'monetization' ? 60 : slot.plannedRole === 'hybrid' ? 50 : 40)).toFixed(2));

    // Datos A/B enriquecidos para este slot
    const slotSubslots = subslots.filter(s => s.slotId === slot.slotId);
    const abWinner     = abWinners.find(w => w.slotId === slot.slotId) || null;
    const hasAbData    = slotSubslots.length >= 2;

    return {
      batchId:                slot.batchId,
      slotId:                 slot.slotId,
      plannedRole:            slot.plannedRole,
      plannedCluster:         slot.plannedCluster,
      recommendedCandidateId: slot.recommendedCandidateId || null,
      executedCandidateId:    publication.executedCandidateId || assignment.assignedCandidateId || null,
      publishedVideoId:       publication.publishedVideoId || null,
      variantId:              publication.variantId || assignment.variantId || null,
      executionFidelityScore: publication.executionFidelityScore || 0,

      // Métricas enriquecidas (preferir valores proxy si los brutos son 0)
      views:                  result.views || 0,
      usefulViews:            result.usefulViews || 0,
      engagementQualityScore: result.engagementQualityScore || 0,
      estimatedRetentionScore: result.estimatedRetentionScore || 0,
      estimatedFollowUsefulness: result.estimatedFollowUsefulness || 0,
      monetizationOutcomeScore:  result.estimatedMonetizationOutcomeScore || result.monetizationOutcomeScore || 0,
      yppContributionScore:      result.estimatedYppContributionScore || result.yppContributionScore || 0,
      businessValue:             result.businessValue || 0,
      slotPerformanceScore:      result.slotPerformanceScore || 0,
      proxyConfidence:           result.proxyConfidence || 0,

      replacementDetected,
      orderDelta:             publication.realOrderVsPlannedDelta || 0,
      exactTraceAvailable:    Boolean(publication.slotId && result.slotId),
      monetizationDelta,
      monetizationDeltaReason: _monetizationDeltaReason(slot, assignment, publication, result, replacementDetected, monetizationDelta),
      roleSequenceReal:        publication.actualOrder || null,
      slotExecutionQuality:    Number((((publication.executionFidelityScore || 0) * 0.55) + ((result.slotPerformanceScore || 0) * 0.45)).toFixed(2)),

      // Datos A/B por subslot
      hasAbVariants:           hasAbData,
      abSubslots:              hasAbData ? slotSubslots.map(s => ({
        subslotId:             s.subslotId,
        variantId:             s.variantId,
        variantRole:           s.variantRole,
        views:                 s.views,
        usefulViews:           s.usefulViews,
        businessValue:         s.businessValue,
        estimatedMonetizationOutcomeScore: s.estimatedMonetizationOutcomeScore,
        estimatedYppContributionScore:     s.estimatedYppContributionScore,
        subslotPerformanceScore:           s.subslotPerformanceScore,
        hookType:              s.hookType,
      })) : [],
      abWinnerSummary: abWinner ? {
        winnerSubslotId:      abWinner.winnerSubslotId,
        winnerByViews:        abWinner.winnerByViews,
        winnerByBusinessValue:abWinner.winnerByBusinessValue,
        winnerType:           abWinner.winnerType,
        winReason:            abWinner.winReason,
        confidence:           abWinner.confidence,
        shouldTransferLearning: abWinner.shouldTransferLearning,
      } : null,
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    totalSlots: report.length,
    exactSlots: report.filter((item) => item.exactTraceAvailable).length,
    report
  };

  fs.writeFileSync(SLOT_VS_RESULT_REPORT_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _monetizationDeltaReason(slot, assignment, publication, result, replacementDetected, monetizationDelta) {
  if (!publication.slotId) return 'slot_sin_publicacion_real';
  if (!result.slotId) return 'slot_sin_metricas_reales';
  if (replacementDetected && monetizationDelta < 0) return 'replacement_empeoro_valor_comercial';
  if (replacementDetected && monetizationDelta >= 0) return 'replacement_mejoro_o_mantuvo_valor';
  if ((result.usefulViews || 0) > 0 && (result.monetizationOutcomeScore || 0) >= 60) return 'slot_alineado_con_audiencia_util';
  if (slot.plannedRole === 'reach' && (result.monetizationOutcomeScore || 0) < 45) return 'reach_con_views_poco_monetizables';
  if ((assignment.assignmentStatus || publication.executionStatus) === 'assigned') return 'slot_asignado_sin_ejecucion_total';
  return 'resultado_neutro';
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  buildSlotVsResultReport,
  SLOT_VS_RESULT_REPORT_PATH
};
