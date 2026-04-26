'use strict';
/**
 * slot-metrics-enricher.js
 *
 * Enriquece slot-results.json con proxies comerciales y de retención
 * usando SOLO datos reales disponibles o heurísticas claras y explicables.
 *
 * Cada campo añadido incluye:
 *   - sourceType: 'real' | 'proxy' | 'mixed'
 *   - confidence: 0-1
 *
 * Se ejecuta después de linkSlotResults() para agregar capas
 * sin alterar la trazabilidad exacta ya conseguida.
 */

const fs   = require('fs');
const path = require('path');

const {
  _estimateRetention,
  _estimateFollowUsefulness,
  _estimateMonetization,
  _estimateYppContribution,
  _calcUsefulViews,
  _calcEngagementQuality,
  TOPIC_COMMERCIAL_MULT,
} = require('./slot-commercial-proxy-scorer');

const TRACKING_DIR      = path.resolve(__dirname, '../../data/tracking');
const SLOT_RESULTS_PATH = path.join(TRACKING_DIR, 'slot-results.json');
const ATTRIBUTION_PATH  = path.join(TRACKING_DIR, 'publication-attribution.json');
const VIDEOS_PATH       = path.resolve(__dirname, '../../backend/data/videos.json');

/**
 * Enriquece todos los slot-results con proxies comerciales.
 * Actualiza slot-results.json in-place, preservando todos los campos originales.
 *
 * @param {string|null} publishedVideoId  Si se pasa, solo enriquece ese vídeo
 * @returns {Object} slot-results actualizado
 */
function enrichSlotMetrics(publishedVideoId = null) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const existing     = _readJson(SLOT_RESULTS_PATH, { slotResults: [] });
  const attributions = _readJson(ATTRIBUTION_PATH, { publications: [] }).publications || [];
  const videos       = _readJson(VIDEOS_PATH, []);

  const targets = publishedVideoId
    ? (existing.slotResults || []).filter(s => s.publishedVideoId === publishedVideoId)
    : (existing.slotResults || []);

  const enriched = targets.map(slot => _enrichSlot(slot, attributions, videos));

  // Merge: reemplazar los slots enriquecidos, mantener el resto
  const merged = (existing.slotResults || []).map(slot => {
    const updated = enriched.find(e =>
      e.slotId === slot.slotId && e.publishedVideoId === slot.publishedVideoId
    );
    return updated || slot;
  });

  const payload = {
    ...existing,
    generatedAt:      new Date().toISOString(),
    totalSlotResults: merged.length,
    slotResults:      merged,
  };

  fs.writeFileSync(SLOT_RESULTS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Enriquece un slot individual con proxies.
 * Respeta los valores reales si ya existen (sourceType: 'real').
 */
function _enrichSlot(slot, attributions, videos) {
  const pub    = attributions.find(p =>
    p.slotId === slot.slotId || p.publishedVideoId === slot.publishedVideoId
  ) || {};
  const video  = videos.find(v => v.id === slot.publishedVideoId) || {};
  const script = video.script_json || {};

  const views    = slot.views    || 0;
  const likes    = slot.likes    || 0;
  const comments = slot.comments || 0;
  const shares   = slot.shares   || 0;
  const topic    = script.topic  || pub.actualCluster || slot.actualCluster || 'unknown';
  const role     = pub.actualRole || slot.actualRole || script.strategicRole || 'reach';

  // ── Calculo proxies ──────────────────────────────────────────────────────
  const retProxy     = _estimateRetention(views, likes, comments, shares);
  const rewatchProxy = { value: 0, confidence: 0, sourceType: 'proxy' }; // placeholder
  const followProxy  = _estimateFollowUsefulness(views, likes, comments, topic, role);
  const monoProxy    = _estimateMonetization(views, likes, comments, shares, topic, role);
  const yppProxy     = _estimateYppContribution(views, likes, comments, shares, followProxy.value);
  const engQuality   = _calcEngagementQuality(views, likes, comments, shares);

  // ── Respetar valores reales si existen ───────────────────────────────────
  // Si normalized-real-metrics ya tiene retention real → no sobreescribir
  const retentionValue    = _bestValue(slot.retention, retProxy.value);
  const retentionSource   = slot.retention != null ? 'real' : 'proxy';
  const retentionConf     = slot.retention != null ? 0.95 : retProxy.confidence;

  const rewatchValue      = _bestValue(slot.rewatch, rewatchProxy.value);
  const rewatchSource     = slot.rewatch != null ? 'real' : 'proxy';
  const rewatchConf       = slot.rewatch != null ? 0.90 : 0.35;

  const followValue       = _bestValue(null, followProxy.value);
  const monoValue         = _bestValue(slot.monetizationOutcomeScore > 0 ? slot.monetizationOutcomeScore : null, monoProxy.value);
  const monoSource        = slot.monetizationOutcomeScore > 0 ? 'real' : 'proxy';
  const yppValue          = _bestValue(slot.yppContributionScore > 0 ? slot.yppContributionScore : null, yppProxy.value);
  const yppSource         = slot.yppContributionScore > 0 ? 'real' : 'proxy';

  const usefulViews       = _calcUsefulViews(views, retentionValue, followValue, monoValue, yppValue);

  // slotPerformanceScore: recalcular con valores enriquecidos
  const slotPerfScore = parseFloat((
    (retentionValue * 0.22) +
    (rewatchValue   * 0.14) +
    (monoValue      * 0.22) +
    (yppValue       * 0.18) +
    ((followValue / Math.max(views, 1)) * 0.24)
  ).toFixed(2));

  const avgConfidence = parseFloat((
    (retentionConf + rewatchConf + followProxy.confidence + monoProxy.confidence + yppProxy.confidence) / 5
  ).toFixed(2));

  // businessValue compuesto para comparación A/B
  const businessValue = parseFloat((
    (usefulViews * 0.40) +
    (monoValue   * 0.35) +
    (yppValue    * 0.25)
  ).toFixed(2));

  return {
    ...slot,
    // Campos enriquecidos — se sobrescriben solo si no eran reales
    usefulViews,
    slotPerformanceScore:            slotPerfScore,
    engagementQualityScore:          engQuality,
    businessValue,

    // Proxies con metadata
    estimatedRetentionScore:         retentionValue,
    estimatedRetentionSource:        retentionSource,
    estimatedRetentionConfidence:    retentionConf,

    estimatedRewatchScore:           rewatchValue,
    estimatedRewatchSource:          rewatchSource,
    estimatedRewatchConfidence:      rewatchConf,

    estimatedFollowUsefulness:       followValue,
    estimatedFollowSource:           'proxy',
    estimatedFollowConfidence:       followProxy.confidence,

    estimatedMonetizationOutcomeScore: monoValue,
    estimatedMonetizationSource:     monoSource,
    estimatedMonetizationConfidence: monoProxy.confidence,

    estimatedYppContributionScore:   yppValue,
    estimatedYppSource:              yppSource,
    estimatedYppConfidence:          yppProxy.confidence,

    proxyConfidence:    avgConfidence,
    enrichedAt:         new Date().toISOString(),
  };
}

/**
 * Devuelve el valor real si existe, o el proxy si no.
 */
function _bestValue(realValue, proxyValue) {
  if (realValue != null && realValue > 0) return realValue;
  return proxyValue;
}

function _readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

module.exports = {
  enrichSlotMetrics,
  SLOT_RESULTS_PATH,
};
