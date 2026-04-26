const fs = require('fs');
const path = require('path');

const { loadRealMetrics } = require('./real-metrics-adapter');
const { matchVideos } = require('./video-id-matcher');
const { normalizeRealMetrics } = require('./analytics-normalizer');
const { buildContentClusters } = require('../similarity/content-clusterer');
const { findSemanticMatches } = require('../similarity/semantic-matcher');
const { inheritSignals } = require('../similarity/metric-inheritance-engine');

const SYNC_REPORT_PATH = path.resolve(__dirname, '../../../data/integrations/sync-report.json');

// Sincroniza histórico real y lo deja listo para learning/monetization.
function runRealLearningCycle(contentItems = []) {
  fs.mkdirSync(path.dirname(SYNC_REPORT_PATH), { recursive: true });

  const realPayload = loadRealMetrics();
  const matchingReport = matchVideos(contentItems, realPayload.records);
  const normalized = normalizeRealMetrics(realPayload.records);
  const clusters = buildContentClusters(normalized.normalized, contentItems);
  const semantic = findSemanticMatches(contentItems, normalized.normalized, clusters.clusters);
  const inherited = inheritSignals(contentItems, semantic.matches, normalized.normalized, clusters.clusters);

  const payload = {
    generatedAt: new Date().toISOString(),
    hasRealData: realPayload.hasRealData,
    dataSourceType: realPayload.dataSourceType,
    matchedVideos: matchingReport.totals.matched,
    unmatchedVideos: matchingReport.totals.unmatched,
    ambiguousMatches: matchingReport.totals.ambiguousMatches,
    totalRealRecords: normalized.totalRecords,
    semanticMatches: semantic.report.semanticMatches,
    highConfidenceSemanticMatches: semantic.report.highConfidenceSemanticMatches,
    scriptsWithInheritedSignals: semantic.report.scriptsWithInheritedSignals,
    sources: realPayload.sources,
    fieldsCoverage: _getFieldsCoverage(normalized.normalized),
    fallbackStillUsed: _countFallbackRecords(normalized.normalized)
  };

  fs.writeFileSync(SYNC_REPORT_PATH, JSON.stringify(payload, null, 2));
  return {
    realPayload,
    matchingReport,
    normalized,
    clusters,
    semantic,
    inherited,
    syncReport: payload
  };
}

function _getFieldsCoverage(records) {
  const fields = ['views', 'likes', 'comments', 'shares', 'publishedAt', 'category', 'hookType', 'retention', 'rewatch', 'followConversion'];
  return fields.map((field) => ({
    field,
    filled: records.filter((record) => record[field] !== null && record[field] !== undefined).length,
    total: records.length
  }));
}

function _countFallbackRecords(records) {
  return {
    withEstimatedRetention: records.filter((record) => record.fallbackNotes.includes('retention_estimated')).length,
    withEstimatedRewatch: records.filter((record) => record.fallbackNotes.includes('rewatch_estimated')).length,
    withEstimatedFollows: records.filter((record) => record.fallbackNotes.includes('follows_estimated')).length
  };
}

module.exports = {
  runRealLearningCycle,
  SYNC_REPORT_PATH
};
