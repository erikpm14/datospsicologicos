const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, '../../../data/integrations/normalized-real-metrics.json');

// Normaliza métricas reales a la escala interna del motor.
function normalizeRealMetrics(realRecords = []) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  const normalized = realRecords.map((record) => {
    const retention = _estimateRetention(record);
    const rewatch = _estimateRewatch(record);
    const followConversion = _estimateFollowConversion(record);
    const engagement = _estimateEngagement(record);
    const realPerformanceScore = Number((
      (retention * 0.35) +
      (rewatch * 0.15) +
      (engagement * 0.2) +
      (followConversion * 0.15) +
      (_normalize(record.viralityScore || 0) * 0.15)
    ).toFixed(2));
    const yppContributionScore = Number((
      (_normalize(record.views || 0, 1000) * 0.45) +
      (followConversion * 0.25) +
      (_normalize(record.priorityScore || 0) * 0.15) +
      (_normalize(record.formatMatchScore || 0) * 0.15)
    ).toFixed(2));
    const realDataConfidence = _getConfidence(record);

    return {
      ...record,
      views: record.views ?? 0,
      avgWatchTime: record.avgWatchTime ?? null,
      retention,
      rewatch,
      likes: record.likes ?? 0,
      comments: record.comments ?? 0,
      shares: record.shares ?? 0,
      follows: record.follows ?? null,
      impressions: record.impressions ?? null,
      ctr: record.ctr ?? null,
      category: record.category || '',
      hookType: record.hookType || 'unknown',
      portfolioRole: record.portfolioRole || '',
      engagement,
      followConversion,
      realPerformanceScore,
      yppContributionScore,
      dataSourceType: 'real',
      realDataConfidence,
      fallbackNotes: _buildFallbackNotes(record)
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    totalRecords: normalized.length,
    normalized
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _estimateRetention(record) {
  if (typeof record.retention === 'number') return record.retention;
  if (typeof record.formatMatchScore === 'number') return _normalize(record.formatMatchScore);
  if (typeof record.priorityScore === 'number') return _normalize(record.priorityScore);
  return 55;
}

function _estimateRewatch(record) {
  if (typeof record.rewatch === 'number') return record.rewatch;
  if (typeof record.viralityScore === 'number' && typeof record.emotionalImpactScore === 'number') {
    return _normalize(((record.viralityScore * 0.6) + (record.emotionalImpactScore * 0.4)));
  }
  return _normalize((record.viralityScore || 45));
}

function _estimateFollowConversion(record) {
  if (typeof record.follows === 'number' && record.views > 0) {
    return _normalize((record.follows / record.views) * 1000);
  }

  const categoryBoost = /(relationships|habits|attention|emotions)/i.test(String(record.category || '')) ? 14 : 8;
  const hookBoost = record.hookType === 'challenge' ? 6 : 3;
  return Math.min(100, categoryBoost + hookBoost + Math.round((record.engagementRate || 0) / 2));
}

function _estimateEngagement(record) {
  if (typeof record.engagementRate === 'number') return _normalize(record.engagementRate * 3);
  if (record.views > 0) {
    const raw = ((record.likes + record.comments + record.shares) / record.views) * 1000;
    return _normalize(raw);
  }
  return 0;
}

function _getConfidence(record) {
  let score = 0.3;
  if (record.views !== null && record.views !== undefined) score += 0.2;
  if (record.dataPoints > 1) score += 0.2;
  if (record.source === 'backend/data/metrics.json') score += 0.2;
  if (record.priorityScore !== null && record.priorityScore !== undefined) score += 0.1;
  return Number(Math.min(score, 1).toFixed(2));
}

function _buildFallbackNotes(record) {
  const notes = [];
  if (record.avgWatchTime == null) notes.push('avgWatchTime_missing');
  if (record.retention == null) notes.push('retention_estimated');
  if (record.rewatch == null) notes.push('rewatch_estimated');
  if (record.follows == null) notes.push('follows_estimated');
  if (record.impressions == null) notes.push('impressions_missing');
  if (record.ctr == null) notes.push('ctr_missing');
  return notes;
}

function _normalize(value, max = 100) {
  return Math.max(0, Math.min(100, Math.round((Number(value || 0) / max) * 100)));
}

module.exports = {
  normalizeRealMetrics,
  OUTPUT_PATH
};
