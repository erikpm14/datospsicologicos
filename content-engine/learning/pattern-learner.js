const fs = require('fs');
const path = require('path');

const { ANALYSIS_PATH } = require('./performance-analyzer');
const CLUSTERS_PATH = path.resolve(__dirname, '../../data/similarity/content-clusters.json');

const PATTERNS_PATH = path.resolve(__dirname, '../../data/learning/patterns.json');

// Detecta patrones por performance real, monetización y familias.
function learnPatterns() {
  const analysisPayload = _readJson(ANALYSIS_PATH, { analysis: [] });
  const videos = analysisPayload.analysis || [];
  const overallAverage = _getOverallAverage(videos, 'successScore');
  const overallMonetizationAverage = _getOverallAverage(videos, 'monetizationOutcomeScore');
  const clusters = _readJson(CLUSTERS_PATH, { clusters: [] }).clusters || [];

  const bestHookType = _pickTopKey(videos, 'hookType', 'realPerformanceScore');
  const topThemes = _pickTopKeys(videos, 'topic', 'successScore', 3);
  const bestMicroActions = _pickTopKeys(videos, 'microActionType', 'successScore', 3);
  const bestStructures = _pickTopKeys(videos, 'structureType', 'successScore', 2);
  const monetizationWinningCategories = _pickTopKeys(videos, 'topic', 'monetizationOutcomeScore', 3);
  const yppWinningCategories = _pickTopKeys(videos, 'topic', 'yppContributionScore', 3);
  const valuableAudiencePatterns = _pickTopKeys(videos, 'hookType', 'monetizationOutcomeScore', 2);
  const emptyViewsPatterns = _pickBottomPatterns(videos, overallAverage, overallMonetizationAverage);
  const winningClusters = clusters
    .sort((a, b) => (b.monetizationStrength + b.yppStrength) - (a.monetizationStrength + a.yppStrength))
    .slice(0, 3)
    .map((item) => item.clusterLabel);
  const bestReachClusters = clusters
    .sort((a, b) => (b.topPerformingPatterns?.[0]?.score || 0) - (a.topPerformingPatterns?.[0]?.score || 0))
    .slice(0, 3)
    .map((item) => item.clusterLabel);
  const bestFollowClusters = clusters
    .sort((a, b) => (b.repeatabilityScore || 0) - (a.repeatabilityScore || 0))
    .slice(0, 3)
    .map((item) => item.clusterLabel);
  const bestMonetizationClusters = clusters
    .sort((a, b) => (b.monetizationStrength || 0) - (a.monetizationStrength || 0))
    .slice(0, 3)
    .map((item) => item.clusterLabel);

  const payload = {
    generatedAt: new Date().toISOString(),
    bestHookType,
    topThemes,
    bestMicroActions,
    bestStructures,
    monetizationWinningCategories,
    yppWinningCategories,
    winningClusters,
    bestReachClusters,
    bestFollowClusters,
    bestMonetizationClusters,
    valuableAudiencePatterns,
    emptyViewsPatterns,
    worstPatterns: emptyViewsPatterns
  };

  fs.mkdirSync(path.dirname(PATTERNS_PATH), { recursive: true });
  fs.writeFileSync(PATTERNS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _pickTopKey(videos, field, scoreField) {
  return _rankGroups(videos, field, scoreField, false, 1)[0] || 'UNKNOWN';
}

function _pickTopKeys(videos, field, scoreField, limit) {
  return _rankGroups(videos, field, scoreField, false, limit);
}

function _pickBottomPatterns(videos, overallAverage, overallMonetizationAverage) {
  const topics = _rankUnderAverage(videos, 'topic', overallAverage, overallMonetizationAverage, 2);
  const hooks = _rankUnderAverage(videos, 'hookType', overallAverage, overallMonetizationAverage, 2);
  const structures = _rankUnderAverage(videos, 'structureType', overallAverage, overallMonetizationAverage, 1);
  return [...topics, ...hooks, ...structures];
}

function _rankGroups(videos, field, scoreField, asc, limit) {
  return _buildGroups(videos, field, scoreField)
    .sort((a, b) => asc ? a.averageScore - b.averageScore : b.averageScore - a.averageScore)
    .slice(0, limit)
    .map((item) => item.key);
}

function _rankUnderAverage(videos, field, overallAverage, overallMonetizationAverage, limit) {
  return _buildDualGroups(videos, field)
    .filter((item) => item.averageSuccessScore < (overallAverage - 3) || item.averageMonetizationScore < (overallMonetizationAverage - 4))
    .sort((a, b) => (a.averageSuccessScore + a.averageMonetizationScore) - (b.averageSuccessScore + b.averageMonetizationScore))
    .slice(0, limit)
    .map((item) => item.key);
}

function _buildGroups(videos, field, scoreField) {
  const groups = new Map();

  videos.forEach((video) => {
    const key = video[field] || 'UNKNOWN';
    const current = groups.get(key) || { total: 0, count: 0 };
    current.total += video[scoreField] || 0;
    current.count += 1;
    groups.set(key, current);
  });

  return [...groups.entries()].map(([key, value]) => ({
    key,
    averageScore: Number((value.total / Math.max(value.count, 1)).toFixed(2)),
    count: value.count
  }));
}

function _buildDualGroups(videos, field) {
  const groups = new Map();

  videos.forEach((video) => {
    const key = video[field] || 'UNKNOWN';
    const current = groups.get(key) || { successTotal: 0, monetizationTotal: 0, count: 0 };
    current.successTotal += video.successScore || 0;
    current.monetizationTotal += video.monetizationOutcomeScore || 0;
    current.count += 1;
    groups.set(key, current);
  });

  return [...groups.entries()].map(([key, value]) => ({
    key,
    averageSuccessScore: Number((value.successTotal / Math.max(value.count, 1)).toFixed(2)),
    averageMonetizationScore: Number((value.monetizationTotal / Math.max(value.count, 1)).toFixed(2)),
    count: value.count
  }));
}

function _getOverallAverage(videos, field) {
  if (videos.length === 0) return 0;
  const total = videos.reduce((sum, video) => sum + (video[field] || 0), 0);
  return total / videos.length;
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  learnPatterns,
  PATTERNS_PATH
};
