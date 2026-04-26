const fs = require('fs');
const path = require('path');

const { enrichSlotMetrics } = require('./slot-metrics-enricher');

const TRACKING_DIR = path.resolve(__dirname, '../../data/tracking');
const SLOT_RESULTS_PATH = path.join(TRACKING_DIR, 'slot-results.json');
const ATTRIBUTION_PATH = path.join(TRACKING_DIR, 'publication-attribution.json');
const PRIMARY_VIDEOS_PATH = path.resolve(__dirname, '../../data/videos.json');
const PRIMARY_METRICS_PATH = path.resolve(__dirname, '../../data/metrics.json');
const LEGACY_VIDEOS_PATH = path.resolve(__dirname, '../../backend/data/videos.json');
const LEGACY_METRICS_PATH = path.resolve(__dirname, '../../backend/data/metrics.json');
const NORMALIZED_REAL_METRICS_PATH = path.resolve(__dirname, '../../data/integrations/normalized-real-metrics.json');
const { transitionSlotState } = require('./slot-consumption-guard');

function linkSlotResults(options = {}) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const attribution = _readJson(ATTRIBUTION_PATH, { publications: [] }).publications || [];
  const videos = _loadMergedRecords(PRIMARY_VIDEOS_PATH, LEGACY_VIDEOS_PATH, 'id');
  const metrics = _loadMergedRecords(PRIMARY_METRICS_PATH, LEGACY_METRICS_PATH, 'id');
  const normalized = _readJson(NORMALIZED_REAL_METRICS_PATH, { normalized: [] }).normalized || [];
  const filtered = options.publishedVideoId
    ? attribution.filter((item) => item.publishedVideoId === options.publishedVideoId)
    : attribution;

  const results = filtered.map((item) => {
    const video = videos.find((record) => record.id === item.publishedVideoId) || {};
    const videoMetrics = metrics
      .filter((metric) => metric.video_id === item.publishedVideoId)
      .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))[0] || {};
    const normalizedMetrics = normalized.find((record) => record.videoId === item.publishedVideoId) || {};
    const metricsSource = normalizedMetrics.source || (_hasRecord(PRIMARY_METRICS_PATH, item.publishedVideoId) ? 'data/metrics.json' : 'backend/data/metrics.json');
    const views = normalizedMetrics.views ?? videoMetrics.views ?? 0;
    const likes = normalizedMetrics.likes ?? videoMetrics.likes ?? 0;
    const comments = normalizedMetrics.comments ?? videoMetrics.comments ?? 0;
    const shares = normalizedMetrics.shares ?? videoMetrics.shares ?? 0;
    const retention = normalizedMetrics.retention ?? null;
    const rewatch = normalizedMetrics.rewatch ?? null;
    const follows = normalizedMetrics.follows ?? null;
    const monetizationOutcomeScore = normalizedMetrics.monetizationOutcomeScore ?? 0;
    const yppContributionScore = normalizedMetrics.yppContributionScore ?? 0;
    const usefulViews = Number((views * ((((retention || 0) * 0.35) + ((rewatch || 0) * 0.2) + (((follows || 0) / Math.max(views, 1)) * 100 * 0.2) + (monetizationOutcomeScore * 0.15) + (yppContributionScore * 0.1)) / 100)).toFixed(2));
    const slotPerformanceScore = Number((((retention || 0) * 0.22) + ((rewatch || 0) * 0.14) + (monetizationOutcomeScore * 0.22) + (yppContributionScore * 0.18) + (((follows || 0) / Math.max(views, 1)) * 100 * 0.24)).toFixed(2));

    return {
      batchId: item.batchId,
      slotId: item.slotId,
      publishedVideoId: item.publishedVideoId,
      metricsSource,
      views,
      likes,
      comments,
      shares,
      retention,
      rewatch,
      follows,
      monetizationOutcomeScore,
      yppContributionScore,
      usefulViews,
      slotPerformanceScore,
      rolePerformanceScore: Number((slotPerformanceScore * (item.actualRole === 'monetization' ? 1.08 : item.actualRole === 'ypp_push' ? 1.05 : 1)).toFixed(2)),
      clusterPerformanceScore: Number((slotPerformanceScore * (item.actualCluster && item.actualCluster.includes('attention') ? 1.06 : 1)).toFixed(2)),
      traceConfidence: item.traceConfidence || 0,
      attributionType: item.attributionType || 'script_only',
      exactTraceAvailable: Boolean(item.slotId && item.attributionType === 'exact_slot'),
      monetizationDelta: Number(((monetizationOutcomeScore || 0) - (item.plannedRole === 'monetization' ? 60 : 40)).toFixed(2)),
      videoRecord: {
        title: video.title || item.executedCandidateTitle || null,
        youtubeId: video.youtube_id || null,
        abVariantId: video.script_json?.abVariantId || item.variantId || null
      }
    };
  });

  const existing = _readJson(SLOT_RESULTS_PATH, { generatedAt: null, totalSlotResults: 0, slotResults: [] });
  const merged = [
    ...(existing.slotResults || []).filter((item) => !results.some((result) => result.slotId === item.slotId && result.publishedVideoId === item.publishedVideoId)),
    ...results
  ];

  fs.writeFileSync(SLOT_RESULTS_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalSlotResults: merged.length,
    slotResults: merged
  }, null, 2));

  // Enriquecer con proxies comerciales inmediatamente después de persistir
  try {
    enrichSlotMetrics(options.publishedVideoId || null);
  } catch (enrichErr) {
    // No bloquear el flujo si el enriquecimiento falla
    const logger = (() => { try { return require('../utils/logger'); } catch { return console; } })();
    (logger.warn || logger.log)(`slot-result-linker: enrich failed — ${enrichErr.message}`);
  }

  merged.forEach((result) => {
    if (result.slotId && (result.views || result.retention || result.rewatch)) {
      transitionSlotState(result.slotId, 'completed', {
        publishedVideoId: result.publishedVideoId
      });
    }
  });

  return { generatedAt: new Date().toISOString(), totalSlotResults: merged.length, slotResults: merged };
}

module.exports = {
  linkSlotResults,
  SLOT_RESULTS_PATH
};

function _loadMergedRecords(primaryPath, legacyPath, idField) {
  const primary = _readJson(primaryPath, []);
  const legacy = _readJson(legacyPath, []);
  const merged = [...legacy];
  primary.forEach((item) => {
    const index = merged.findIndex((entry) => entry[idField] === item[idField]);
    if (index >= 0) {
      merged[index] = { ...merged[index], ...item };
    } else {
      merged.push(item);
    }
  });
  return merged;
}

function _hasRecord(filePath, videoId) {
  const records = _readJson(filePath, []);
  return records.some((item) => item.video_id === videoId || item.id === videoId);
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
