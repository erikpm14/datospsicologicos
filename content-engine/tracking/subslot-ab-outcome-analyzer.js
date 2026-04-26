'use strict';
/**
 * subslot-ab-outcome-analyzer.js
 *
 * Analiza resultados por SUBSLOT dentro del mismo slot lógico de un experimento A/B.
 * Garantiza que dos variantes del mismo slot se midan sin colisión y de forma
 * diferenciada: views brutas vs. valor comercial real.
 *
 * Flujo:
 *   1. Lee ab-slot-links.json para identificar pares (v_a, v_b) del mismo experimento
 *   2. Para cada par, obtiene métricas enriquecidas de slot-results.json
 *   3. Calcula scores por subslot con dimensión comercial
 *   4. Guarda en data/tracking/subslot-results.json
 *
 * Anticollisión: un subslotId único = slotId + "_" + variantId
 * garantiza que dos variantes del mismo slot nunca se mezclen.
 */

const fs   = require('fs');
const path = require('path');

const TRACKING_DIR         = path.resolve(__dirname, '../../data/tracking');
const SUBSLOT_RESULTS_PATH = path.join(TRACKING_DIR, 'subslot-results.json');
const AB_SLOT_LINKS_PATH   = path.join(TRACKING_DIR, 'ab-slot-links.json');
const SLOT_RESULTS_PATH    = path.join(TRACKING_DIR, 'slot-results.json');
const ATTRIBUTION_PATH     = path.join(TRACKING_DIR, 'publication-attribution.json');
const AB_EXPERIMENTS_PATH  = path.resolve(__dirname, '../../backend/data/ab-experiments-v2.json');
const VIDEOS_PATH          = path.resolve(__dirname, '../../backend/data/videos.json');

const {
  _estimateRetention,
  _estimateFollowUsefulness,
  _estimateMonetization,
  _estimateYppContribution,
  _calcUsefulViews,
  _calcEngagementQuality,
} = require('./slot-commercial-proxy-scorer');

// ─────────────────────────────────────────────
//  FUNCIÓN PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Analiza todos los experimentos A/B activos y genera subslot-results.json.
 *
 * @param {string|null} experimentId  Filtrar por experimento concreto (opcional)
 * @returns {Object} payload guardado
 */
function analyzeSubslotOutcomes(experimentId = null) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const abLinks      = _readJson(AB_SLOT_LINKS_PATH,  { links: [] }).links || [];
  const slotResults  = _readJson(SLOT_RESULTS_PATH,   { slotResults: [] }).slotResults || [];
  const attributions = _readJson(ATTRIBUTION_PATH,    { publications: [] }).publications || [];
  const experiments  = _readJson(AB_EXPERIMENTS_PATH, []);
  const videos       = _readJson(VIDEOS_PATH, []);

  // Agrupar links por experimentId
  const expMap = {};
  for (const link of abLinks) {
    if (!link.abExperimentId) continue;
    if (experimentId && link.abExperimentId !== experimentId) continue;
    if (!expMap[link.abExperimentId]) expMap[link.abExperimentId] = [];
    expMap[link.abExperimentId].push(link);
  }

  const subslotResults = [];

  for (const [expId, links] of Object.entries(expMap)) {
    const exp = experiments.find(e => e.experimentId === expId) || {};

    for (const link of links) {
      const subslotId = link.subslotId ||
        (link.slotId && link.variantId ? `${link.slotId}_${link.variantId}` : null);

      // Buscar métricas del vídeo correspondiente a esta variante
      const pub = attributions.find(p =>
        p.abLinked &&
        p.variantId === link.variantId &&
        (p.slotId === link.slotId || !link.slotId) &&
        (p.abExperimentId || p.publishedVideoId)
      ) || attributions.find(p => p.variantId === link.variantId) || {};

      // Buscar en ab-experiments-v2 el variant con sus métricas
      const expVariant = (exp.variants || []).find(v => v.variantId === link.variantId) || {};

      // Métricas del slot enriquecido
      const slotResult = slotResults.find(s =>
        s.slotId === link.slotId || s.publishedVideoId === pub.publishedVideoId
      ) || {};

      const video  = videos.find(v => v.id === pub.publishedVideoId) || {};
      const script = video.script_json || {};

      // Métricas base — preferir slotResult (enriquecido) sobre raw
      const views    = slotResult.views    || expVariant.metrics?.views    || 0;
      const likes    = slotResult.likes    || expVariant.metrics?.likes    || 0;
      const comments = slotResult.comments || expVariant.metrics?.comments || 0;
      const shares   = slotResult.shares   || expVariant.metrics?.shares   || 0;
      const topic    = script.topic || exp.topic || 'unknown';
      const role     = pub.actualRole || script.strategicRole || 'reach';
      const traceConf  = slotResult.traceConfidence || pub.traceConfidence || 0;
      const exactTrace = slotResult.exactTraceAvailable || pub.exactTraceAvailable || false;

      // Calcular proxies comerciales por subslot
      const retProxy   = _estimateRetention(views, likes, comments, shares);
      const followProxy = _estimateFollowUsefulness(views, likes, comments, topic, role);
      const monoProxy   = _estimateMonetization(views, likes, comments, shares, topic, role);
      const yppProxy    = _estimateYppContribution(views, likes, comments, shares, followProxy.value);
      const engQuality  = _calcEngagementQuality(views, likes, comments, shares);
      const usefulViews = _calcUsefulViews(views, retProxy.value, followProxy.value, monoProxy.value, yppProxy.value);

      // Usar valores enriquecidos del slotResult si existen
      const retentionScore  = slotResult.estimatedRetentionScore  ?? retProxy.value;
      const followScore     = slotResult.estimatedFollowUsefulness ?? followProxy.value;
      const monoScore       = slotResult.estimatedMonetizationOutcomeScore ?? monoProxy.value;
      const yppScore        = slotResult.estimatedYppContributionScore ?? yppProxy.value;
      const usefulViewsFinal = slotResult.usefulViews ?? usefulViews;

      // subslotPerformanceScore: combinado orientado a negocio
      const subslotPerformanceScore = parseFloat((
        (retentionScore  * 0.22) +
        (followScore     * 0.20) +
        (monoScore       * 0.28) +
        (yppScore        * 0.20) +
        (engQuality      * 0.10)
      ).toFixed(2));

      // businessValue para comparación con winnerByViews
      const businessValue = parseFloat((
        (usefulViewsFinal * 0.40) +
        (monoScore        * 0.35) +
        (yppScore         * 0.25)
      ).toFixed(2));

      // Confianza del subslot: sube con views y trazabilidad exacta
      const winnerConfidence = _calcWinnerConfidence(views, traceConf, exactTrace);

      subslotResults.push({
        // Identificadores sin colisión
        batchId:                   link.batchId || exp.batchId || null,
        slotId:                    link.slotId || null,
        subslotId:                 subslotId || `orphan_${expId}_${link.variantId}`,
        variantId:                 link.variantId,
        variantRole:               link.variantRole || (link.variantId === 'v_a' ? 'control' : 'test'),
        abExperimentId:            expId,

        // Vídeo publicado
        publishedVideoId:          pub.publishedVideoId || null,
        hookType:                  expVariant.hookType || script.hookType || null,
        hook:                      expVariant.hook || script.hook || null,
        topic,
        strategicRole:             role,
        publishedAt:               pub.publishedAt || expVariant.publishedAt || null,

        // Métricas brutas
        views,
        likes,
        comments,
        shares,

        // Métricas enriquecidas
        usefulViews:                       usefulViewsFinal,
        engagementQualityScore:            engQuality,
        estimatedRetentionScore:           retentionScore,
        estimatedFollowUsefulness:         followScore,
        estimatedMonetizationOutcomeScore: monoScore,
        estimatedYppContributionScore:     yppScore,

        // Score compuesto del subslot
        subslotPerformanceScore,
        businessValue,

        // Metadatos de calidad
        sourceType:       views > 0 ? (exactTrace ? 'real' : 'mixed') : 'empty',
        confidence:       winnerConfidence,
        exactTraceAvailable: exactTrace,
        traceConfidence:  traceConf,

        // Early score del experimento (si existe)
        earlyScore:       expVariant.earlyScore || null,

        analyzedAt:       new Date().toISOString(),
      });
    }
  }

  const existing = _readJson(SUBSLOT_RESULTS_PATH, { subslotResults: [] });

  // Merge: actualizar o añadir cada subslot sin borrar histórico
  const merged = [...(existing.subslotResults || [])];
  for (const result of subslotResults) {
    const idx = merged.findIndex(r => r.subslotId === result.subslotId);
    if (idx >= 0) merged[idx] = result;
    else merged.push(result);
  }

  const payload = {
    generatedAt:      new Date().toISOString(),
    totalSubslots:    merged.length,
    totalExperiments: Object.keys(expMap).length,
    subslotResults:   merged,
  };

  fs.writeFileSync(SUBSLOT_RESULTS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Devuelve los subslots de un experimento concreto.
 */
function getSubslotsForExperiment(experimentId) {
  const data = _readJson(SUBSLOT_RESULTS_PATH, { subslotResults: [] });
  return (data.subslotResults || []).filter(r => r.abExperimentId === experimentId);
}

/**
 * Devuelve todos los pares de subslots (control vs test) agrupados por experimento.
 * Útil para ab-winner-selector.
 */
function getAllSubslotPairs() {
  const data = _readJson(SUBSLOT_RESULTS_PATH, { subslotResults: [] });
  const groups = {};
  for (const s of (data.subslotResults || [])) {
    const key = s.abExperimentId || s.slotId;
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }
  // Solo pares con al menos 2 variantes
  return Object.entries(groups)
    .filter(([, v]) => v.length >= 2)
    .map(([experimentId, subslots]) => ({ experimentId, subslots }));
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

/**
 * Confianza en el resultado del subslot.
 * 0 = no hay datos, 1 = datos abundantes y trazabilidad exacta.
 */
function _calcWinnerConfidence(views, traceConf, exactTrace) {
  let conf = 0;
  if (views >= 2000) conf += 0.45;
  else if (views >= 500) conf += 0.30;
  else if (views >= 100) conf += 0.15;
  else if (views > 0) conf += 0.05;

  if (exactTrace)          conf += 0.35;
  else if (traceConf > 0.7) conf += 0.20;
  else if (traceConf > 0.4) conf += 0.10;

  conf += 0.20; // confianza base de la metodología

  return parseFloat(Math.min(1, conf).toFixed(2));
}

function _readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

module.exports = {
  analyzeSubslotOutcomes,
  getSubslotsForExperiment,
  getAllSubslotPairs,
  SUBSLOT_RESULTS_PATH,
};
