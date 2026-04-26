const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const BACKEND_DATA_DIR = path.join(ROOT_DIR, 'backend', 'data');
const BACKEND_OUTPUT_DIR = path.join(ROOT_DIR, 'backend', 'output');

const REAL_SOURCES = {
  videos: path.join(BACKEND_DATA_DIR, 'videos.json'),
  publishLog: path.join(BACKEND_DATA_DIR, 'publish-log.json'),
  metrics: path.join(BACKEND_DATA_DIR, 'metrics.json'),
  classifications: path.join(BACKEND_DATA_DIR, 'video-classifications.json'),
  hookPerformance: path.join(BACKEND_DATA_DIR, 'hook-performance-advanced.json')
};

// Lee fuentes reales y devuelve una colección unificada.
function loadRealMetrics() {
  const sourcePayload = {
    videos: _readJson(REAL_SOURCES.videos, []),
    publishLog: _readJson(REAL_SOURCES.publishLog, []),
    metrics: _readJson(REAL_SOURCES.metrics, []),
    classifications: _readJson(REAL_SOURCES.classifications, {}),
    hookPerformance: _readJson(REAL_SOURCES.hookPerformance, {})
  };

  const hasRealData = sourcePayload.videos.length > 0 || sourcePayload.publishLog.length > 0 || sourcePayload.metrics.length > 0;
  const records = hasRealData ? _mergeRealSources(sourcePayload) : [];

  return {
    hasRealData,
    dataSourceType: hasRealData ? 'real' : 'fallback',
    sources: _describeSources(sourcePayload),
    records
  };
}

function _mergeRealSources(sourcePayload) {
  const publishMap = new Map(sourcePayload.publishLog.map((item) => [item.videoId, item]));
  const classificationMap = new Map(Object.entries(sourcePayload.classifications || {}));
  const metricsGrouped = _groupMetrics(sourcePayload.metrics);
  const outputScriptMap = _loadOutputScripts();

  return sourcePayload.videos.map((video) => {
    const publish = publishMap.get(video.id) || {};
    const classification = classificationMap.get(video.id) || {};
    const metrics = metricsGrouped.get(video.id) || [];
    const latestMetric = metrics[metrics.length - 1] || {};
    const firstMetric = metrics[0] || {};
    const script = video.script_json || outputScriptMap.get(video.id) || {};
    const growthContext = script.growthContext || {};
    const source = _resolveSource(publish, metrics, classification);

    return {
      videoId: video.id,
      source,
      title: video.title || script.title || '',
      publishedAt: video.published_at || publish.publishedAt || null,
      status: video.status || (publish.platforms?.length ? 'published' : 'generated'),
      views: latestMetric.views ?? classification.views ?? 0,
      avgWatchTime: null,
      retention: null,
      rewatch: null,
      likes: latestMetric.likes ?? classification.likes ?? 0,
      comments: latestMetric.comments ?? 0,
      shares: latestMetric.shares ?? 0,
      follows: null,
      impressions: null,
      ctr: null,
      category: video.topic || script.topic || classification.topic || '',
      hookType: growthContext.hookType || _inferHookType(video.hook || script.hook),
      portfolioRole: '',
      viralityScore: video.virality_score || script.viralityScore || publish.viralityScore || null,
      formatMatchScore: script.formatMatchScore || publish.formatMatchScore || null,
      emotionalImpactScore: script.emotionalImpactScore || publish.emotionalImpactScore || null,
      priorityScore: publish.priorityScore || publish.priority || null,
      youtubeId: video.youtube_id || null,
      abExperimentId: script.abExperimentId || publish.abExperimentId || null,
      abVariantId: script.abVariantId || publish.abVariantId || null,
      classification: classification.classification || null,
      engagementRate: latestMetric.engagement_rate ?? classification.engagement ?? null,
      dataPoints: metrics.length,
      firstRecordedAt: firstMetric.recorded_at || null,
      lastRecordedAt: latestMetric.recorded_at || null
    };
  });
}

function _loadOutputScripts() {
  const map = new Map();
  if (!fs.existsSync(BACKEND_OUTPUT_DIR)) return map;

  fs.readdirSync(BACKEND_OUTPUT_DIR).forEach((dirName) => {
    const scriptPath = path.join(BACKEND_OUTPUT_DIR, dirName, 'script.json');
    if (!fs.existsSync(scriptPath)) return;
    const script = _readJson(scriptPath, null);
    if (script) map.set(dirName, script);
  });

  return map;
}

function _groupMetrics(metrics) {
  const grouped = new Map();

  metrics.forEach((item) => {
    const current = grouped.get(item.video_id) || [];
    current.push(item);
    grouped.set(item.video_id, current.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)));
  });

  return grouped;
}

function _resolveSource(publish, metrics, classification) {
  if (metrics.length > 0) return 'backend/data/metrics.json';
  if (publish.videoId) return 'backend/data/publish-log.json';
  if (classification.classification) return 'backend/data/video-classifications.json';
  return 'backend/data/videos.json';
}

function _describeSources(sourcePayload) {
  return [
    _buildSourceDescriptor('videos', REAL_SOURCES.videos, sourcePayload.videos),
    _buildSourceDescriptor('publishLog', REAL_SOURCES.publishLog, sourcePayload.publishLog),
    _buildSourceDescriptor('metrics', REAL_SOURCES.metrics, sourcePayload.metrics),
    _buildSourceDescriptor('classifications', REAL_SOURCES.classifications, sourcePayload.classifications),
    _buildSourceDescriptor('hookPerformance', REAL_SOURCES.hookPerformance, sourcePayload.hookPerformance)
  ];
}

function _buildSourceDescriptor(name, filePath, payload) {
  const exists = fs.existsSync(filePath);
  const size = Array.isArray(payload) ? payload.length : Object.keys(payload || {}).length;
  return {
    name,
    path: filePath,
    exists,
    size,
    confidence: exists && size > 0 ? 'high' : exists ? 'medium' : 'none'
  };
}

function _inferHookType(hook) {
  const value = String(hook || '').toLowerCase();
  if (value.includes('por qué') || value.includes('que ') || value.includes('qué ')) return 'challenge';
  if (value.includes('secreto')) return 'secret_truth';
  return 'unknown';
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  loadRealMetrics,
  REAL_SOURCES
};
