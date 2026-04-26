const fs = require('fs');
const path = require('path');

const { runRealLearningCycle } = require('../integrations/historical-sync.service');

const METRICS_DIR = path.resolve(__dirname, '../../data/metrics');
const METRICS_PATH = path.join(METRICS_DIR, 'videos.json');

// Usa datos reales si existen; si no, genera métricas fallback.
function collectMetrics(videos = []) {
  _ensureDir(METRICS_DIR);

  const realCycle = runRealLearningCycle(videos);
  if (realCycle.realPayload.hasRealData && realCycle.normalized.normalized.length > 0) {
    const realVideos = realCycle.normalized.normalized.map((record) => ({
      videoId: record.videoId,
      source: record.source,
      title: record.title,
      publishedAt: record.publishedAt,
      status: record.status,
      views: record.views ?? 0,
      avgWatchTime: record.avgWatchTime,
      retention: record.retention,
      rewatch: record.rewatch,
      likes: record.likes ?? 0,
      comments: record.comments ?? 0,
      shares: record.shares ?? 0,
      follows: record.follows ?? Math.round(record.followConversion || 0),
      impressions: record.impressions,
      ctr: record.ctr,
      category: record.category,
      hookType: record.hookType,
      portfolioRole: record.portfolioRole,
      realDataConfidence: record.realDataConfidence,
      dataSourceType: record.dataSourceType,
      realPerformanceScore: record.realPerformanceScore,
      yppContributionScore: record.yppContributionScore,
      monetizationOutcomeScore: record.monetizationOutcomeScore || null,
      fallbackNotes: record.fallbackNotes
    }));

    const payload = {
      generatedAt: new Date().toISOString(),
      source: 'real',
      totalVideos: realVideos.length,
      videos: realVideos
    };

    fs.writeFileSync(METRICS_PATH, JSON.stringify(payload, null, 2));
    return payload;
  }

  const fallbackVideos = videos.map((video, index) => {
    const seed = _hash(`${video.id || video.title}-${index}`);
    const themeBoost = _getThemeBoost(video.topic);
    const hookBoost = _getHookBoost(video.hookType);
    const microBoost = _getMicroBoost(video.microActionType);

    const views = 20000 + (seed % 35000) + themeBoost * 220 + hookBoost * 160;
    const avgWatchTime = 14 + (seed % 10) + Math.round((themeBoost + hookBoost) / 2);
    const retention = Math.min(98, 52 + (seed % 26) + themeBoost + Math.round(hookBoost / 2));
    const rewatch = Math.min(85, 18 + (seed % 20) + hookBoost + microBoost);
    const likes = 600 + (seed % 2000) + themeBoost * 20;
    const comments = 60 + (seed % 220) + hookBoost * 3;
    const shares = 40 + (seed % 160) + microBoost * 4;
    const follows = 25 + (seed % 130) + themeBoost * 4 + hookBoost * 2;

    return {
      videoId: video.id || `video-${index + 1}`,
      source: 'fallback',
      title: video.title || '',
      publishedAt: video.publishedAt || null,
      status: 'simulated',
      views,
      avgWatchTime,
      retention,
      rewatch,
      likes,
      comments,
      shares,
      follows,
      impressions: null,
      ctr: null,
      category: video.topic || '',
      hookType: video.hookType || 'UNKNOWN',
      portfolioRole: video.portfolioRole || '',
      realDataConfidence: 0,
      dataSourceType: 'fallback',
      realPerformanceScore: null,
      yppContributionScore: null,
      monetizationOutcomeScore: null,
      fallbackNotes: ['simulated_metrics']
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    totalVideos: fallbackVideos.length,
    videos: fallbackVideos
  };

  fs.writeFileSync(METRICS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _getThemeBoost(topic) {
  const boostMap = {
    relationships: 18,
    habits: 12,
    money: 10,
    mobile: 8,
    decisions: 7
  };

  return boostMap[topic] || 4;
}

function _getHookBoost(hookType) {
  const boostMap = {
    RELATABLE_ACTION: 14,
    OPEN_LOOP: 10,
    DIRECT_COMMAND: 8
  };

  return boostMap[hookType] || 5;
}

function _getMicroBoost(microActionType) {
  const boostMap = {
    REPEAT_CHECK: 12,
    DO_IT_NOW: 10,
    PHYSICAL_GESTURE: 8,
    SCREEN_ACTION: 9
  };

  return boostMap[microActionType] || 5;
}

function _hash(value) {
  return String(value).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function _ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

module.exports = {
  collectMetrics,
  METRICS_PATH
};
