const fs = require('fs');
const path = require('path');

const { METRICS_PATH } = require('./metrics-collector');

const ANALYSIS_PATH = path.resolve(__dirname, '../../data/metrics/analysis.json');

// Convierte métricas reales o fallback en scores comparables.
function analyzePerformance(videoScripts = []) {
  const metricsPayload = _readJson(METRICS_PATH, { videos: [], source: 'fallback' });
  const scriptMap = new Map(videoScripts.map((video) => [video.id, video]));

  const analysis = metricsPayload.videos.map((item) => {
    const script = scriptMap.get(item.videoId) || {};
    const retentionScore = _normalize(item.retention);
    const rewatchScore = _normalize(item.rewatch);
    const engagementScore = _normalize(item.realPerformanceScore ?? (((item.likes + item.comments + item.shares) / Math.max(item.views, 1)) * 1000));
    const followScore = _normalize(item.follows ? ((item.follows / Math.max(item.views, 1)) * 1000) : 0);
    const successScore = Number((
      (retentionScore * 0.3) +
      (rewatchScore * 0.25) +
      (followScore * 0.2) +
      (_normalize(item.shares || 0, 20) * 0.15) +
      (_normalize(item.comments || 0, 20) * 0.1)
    ).toFixed(2));

    return {
      videoId: item.videoId,
      topic: script.topic || item.category || 'unknown',
      hookType: script.hookType || item.hookType || 'UNKNOWN',
      microActionType: script.microActionType || 'UNKNOWN',
      structureType: script.structureType || 'UNKNOWN',
      dataSourceType: item.dataSourceType || metricsPayload.source || 'fallback',
      realDataConfidence: item.realDataConfidence ?? 0,
      retentionScore,
      rewatchScore,
      engagementScore,
      followScore,
      successScore,
      realPerformanceScore: item.realPerformanceScore ?? successScore,
      yppContributionScore: item.yppContributionScore ?? 0,
      monetizationOutcomeScore: item.monetizationOutcomeScore ?? 0,
      metrics: item
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: metricsPayload.source || 'fallback',
    totalVideos: analysis.length,
    analysis
  };

  fs.mkdirSync(path.dirname(ANALYSIS_PATH), { recursive: true });
  fs.writeFileSync(ANALYSIS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _normalize(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  analyzePerformance,
  ANALYSIS_PATH
};
