'use strict';
/**
 * ab-winner-selector.js
 *
 * Elige winner/loser por subslot A/B dentro del mismo slot lógico.
 *
 * REGLA CLAVE (orientación a monetización):
 *   No elegir winner solo por views brutas.
 *   Si la variante con más views tiene businessValue peor, esa diferencia
 *   se documenta explícitamente y el winner por negocio tiene peso superior
 *   salvo que el gap de views sea > VIEW_DOMINANCE_THRESHOLD (50%).
 *
 * Dimensiones de evaluación:
 *   1. winnerByViews       → mayor views brutas
 *   2. winnerByUsefulViews → mayor usefulViews (retention-weighted)
 *   3. winnerByBusiness    → mayor businessValue (mono+ypp+usefulViews)
 *   4. winner (final)      → lógica de prioridad: business > reach salvo explosión
 *
 * Outputs:
 *   - data/tracking/ab-winners.json
 */

const fs   = require('fs');
const path = require('path');

const TRACKING_DIR       = path.resolve(__dirname, '../../data/tracking');
const AB_WINNERS_PATH    = path.join(TRACKING_DIR, 'ab-winners.json');
const { getAllSubslotPairs, SUBSLOT_RESULTS_PATH } = require('./subslot-ab-outcome-analyzer');

// Si la variante con más views supera en X% a la de negocio → views gana
const VIEW_DOMINANCE_THRESHOLD = 0.50;  // 50%
// Mínimo de vistas para declarar winner
const MIN_VIEWS_FOR_DECISION   = 100;
// Mínimo margen de businessValue para preferir negocio sobre views
const MIN_BUSINESS_MARGIN      = 0.05;  // 5%

/**
 * Selecciona winner/loser para todos los experimentos con al menos 2 subslots medidos.
 *
 * @param {string|null} experimentId  Filtrar por experimento concreto (opcional)
 * @returns {Object} payload guardado
 */
function selectAbWinners(experimentId = null) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const pairs = getAllSubslotPairs();
  const targets = experimentId
    ? pairs.filter(p => p.experimentId === experimentId)
    : pairs;

  const decisions = targets.map(pair => _decidePair(pair));

  const existing = _readJson(AB_WINNERS_PATH, { abWinners: [] });
  const merged   = [...(existing.abWinners || [])];
  for (const d of decisions) {
    const idx = merged.findIndex(r => r.abExperimentId === d.abExperimentId);
    if (idx >= 0) merged[idx] = d;
    else merged.push(d);
  }

  const payload = {
    generatedAt:    new Date().toISOString(),
    totalDecisions: merged.length,
    pendingDecisions: merged.filter(d => d.status === 'pending').length,
    abWinners:      merged,
  };

  fs.writeFileSync(AB_WINNERS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Toma decisión para un par de subslots.
 */
function _decidePair(pair) {
  const { experimentId, subslots } = pair;

  // Necesitamos exactamente control (v_a) y test (v_b)
  const control = subslots.find(s => s.variantId === 'v_a' || s.variantRole === 'control') || subslots[0];
  const test    = subslots.find(s => s.variantId === 'v_b' || s.variantRole === 'test')    || subslots[1];

  if (!control || !test) {
    return _pendingDecision(experimentId, subslots, 'less_than_2_variants');
  }

  // Verificar datos mínimos
  const controlViews = control.views || 0;
  const testViews    = test.views    || 0;
  const totalViews   = controlViews + testViews;

  if (totalViews < MIN_VIEWS_FOR_DECISION) {
    return _pendingDecision(experimentId, subslots, 'insufficient_views');
  }

  // ── Dimensiones de comparación ──────────────────────────────────────────

  // 1. Winner por views brutas
  const winnerByViews = controlViews >= testViews ? control.subslotId : test.subslotId;
  const loserByViews  = controlViews >= testViews ? test.subslotId    : control.subslotId;
  const viewsLeader   = controlViews >= testViews ? control : test;
  const viewsFollower = controlViews >= testViews ? test    : control;

  // 2. Winner por usefulViews
  const controlUseful = control.usefulViews || 0;
  const testUseful    = test.usefulViews    || 0;
  const winnerByUsefulViews = controlUseful >= testUseful ? control.subslotId : test.subslotId;

  // 3. Winner por businessValue (mono + ypp + usefulViews)
  const controlBiz = control.businessValue || 0;
  const testBiz    = test.businessValue    || 0;
  const bizLeader   = controlBiz >= testBiz ? control : test;
  const bizFollower = controlBiz >= testBiz ? test    : control;
  const winnerByBusiness = bizLeader.subslotId;
  const loserByBusiness  = bizFollower.subslotId;

  // ── Decisión final ───────────────────────────────────────────────────────
  // Si views y business apuntan al mismo → fácil
  const viewsAndBizAgree = winnerByViews === winnerByBusiness;

  let winner, loser, winnerType, winReason, businessImpact;

  if (viewsAndBizAgree) {
    winner      = viewsLeader;
    loser       = viewsFollower;
    winnerType  = 'views_and_business';
    winReason   = `Acuerdo total: ${winner.variantId} lidera en views (${winner.views}) y businessValue (${winner.businessValue?.toFixed(1)})`;
    businessImpact = 'high';
  } else {
    // Discordancia → aplicar regla de monetización
    const viewsGap = viewsLeader.views > 0
      ? (viewsLeader.views - bizLeader.views) / viewsLeader.views
      : 0;

    const bizGap = bizLeader.businessValue > 0
      ? (bizLeader.businessValue - bizFollower.businessValue) / bizLeader.businessValue
      : 0;

    if (viewsGap > VIEW_DOMINANCE_THRESHOLD) {
      // La variante con más views es tan dominante que ignorar sería un error
      winner     = viewsLeader;
      loser      = viewsFollower;
      winnerType = 'views_dominant';
      winReason  = `Views dominan (+${(viewsGap * 100).toFixed(0)}% sobre biz winner). ` +
                   `Nota: businessValue de ${bizLeader.variantId} (${bizLeader.businessValue?.toFixed(1)}) era mayor.`;
      businessImpact = 'medium';
    } else if (bizGap >= MIN_BUSINESS_MARGIN) {
      // Business lidera con margen suficiente → priorizar monetización
      winner     = bizLeader;
      loser      = bizFollower;
      winnerType = 'business_priority';
      winReason  = `Business winner priorizado: ${winner.variantId} tiene businessValue ${winner.businessValue?.toFixed(1)} ` +
                   `vs ${loser.businessValue?.toFixed(1)} (+${(bizGap * 100).toFixed(0)}%). ` +
                   `Views: ${winner.views} vs ${loser.views}.`;
      businessImpact = 'high';
    } else {
      // Margen demasiado pequeño → empate
      winner     = null;
      loser      = null;
      winnerType = 'tie';
      winReason  = `Margen insuficiente: views gap ${(viewsGap * 100).toFixed(0)}%, biz gap ${(bizGap * 100).toFixed(0)}%`;
      businessImpact = 'low';
    }
  }

  const winMargin = winner && loser
    ? parseFloat(((winner.businessValue || 0) - (loser.businessValue || 0)).toFixed(2))
    : 0;

  const confidence = winner
    ? parseFloat(Math.min(winner.confidence, loser?.confidence || 1).toFixed(2))
    : 0.10;

  // shouldTransferLearning: solo si tenemos datos suficientes y trazabilidad
  const shouldTransferLearning = Boolean(
    winner &&
    confidence >= 0.30 &&
    (winner.views || 0) >= MIN_VIEWS_FOR_DECISION &&
    winnerType !== 'tie'
  );

  return {
    abExperimentId:       experimentId,
    batchId:              control.batchId || test.batchId || null,
    slotId:               control.slotId  || test.slotId  || null,
    status:               winnerType === 'tie' ? 'tie' : 'decided',
    decidedAt:            new Date().toISOString(),

    // Subslots evaluados
    controlSubslotId:     control.subslotId,
    testSubslotId:        test.subslotId,
    controlVariantId:     control.variantId,
    testVariantId:        test.variantId,
    controlHookType:      control.hookType || null,
    testHookType:         test.hookType    || null,

    // Dimensiones de winner (separadas explícitamente)
    winnerSubslotId:      winner?.subslotId    || null,
    loserSubslotId:       loser?.subslotId     || null,
    winnerByViews:        winnerByViews,
    winnerByUsefulViews:  winnerByUsefulViews,
    winnerByBusinessValue:winnerByBusiness,

    // Métricas comparadas
    controlViews:         controlViews,
    testViews:            testViews,
    controlBusinessValue: controlBiz,
    testBusinessValue:    testBiz,
    controlUsefulViews:   controlUseful,
    testUsefulViews:      testUseful,

    // Decisión
    winnerType,
    winReason,
    winMargin,
    confidence,
    businessImpact,

    // Learning
    shouldTransferLearning,
    abLearningTransferAllowed: shouldTransferLearning,
    learningNote: _buildLearningNote(winner, loser, winnerType),

    // Hook insights para el generador
    winnerHookType:       winner?.hookType || null,
    loserHookType:        loser?.hookType  || null,
    hookTypeLearning:     winner ? `${winner.hookType} > ${loser?.hookType} por ${winnerType}` : 'no_learning',
  };
}

function _pendingDecision(experimentId, subslots, reason) {
  return {
    abExperimentId: experimentId,
    status:         'pending',
    pendingReason:  reason,
    subslotIds:     subslots.map(s => s.subslotId),
    decidedAt:      null,
    shouldTransferLearning: false,
  };
}

function _buildLearningNote(winner, loser, winnerType) {
  if (!winner) return 'Sin datos suficientes para aprendizaje.';
  if (winnerType === 'views_and_business') {
    return `Aprendizaje limpio: ${winner.hookType} gana en todas las dimensiones. ` +
           `Subir peso de ${winner.hookType} en decision-engine.`;
  }
  if (winnerType === 'business_priority') {
    return `${winner.hookType} tiene mejor monetización aunque no lidera en views. ` +
           `Priorizar para slots de monetización. ${loser?.hookType} puede seguir en slots de reach.`;
  }
  if (winnerType === 'views_dominant') {
    return `${winner.hookType} domina en views pero con menor valor comercial. ` +
           `Usar para slots de reach, no de monetización.`;
  }
  return 'Empate: no transferir aprendizaje hasta más datos.';
}

/**
 * Devuelve winners para un batch concreto.
 */
function getWinnersForBatch(batchId) {
  const data = _readJson(AB_WINNERS_PATH, { abWinners: [] });
  return (data.abWinners || []).filter(w => w.batchId === batchId);
}

/**
 * Devuelve la decisión para un experimento concreto.
 */
function getWinnerForExperiment(experimentId) {
  const data = _readJson(AB_WINNERS_PATH, { abWinners: [] });
  return (data.abWinners || []).find(w => w.abExperimentId === experimentId) || null;
}

function _readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

module.exports = {
  selectAbWinners,
  getWinnersForBatch,
  getWinnerForExperiment,
  AB_WINNERS_PATH,
  VIEW_DOMINANCE_THRESHOLD,
  MIN_BUSINESS_MARGIN,
};
