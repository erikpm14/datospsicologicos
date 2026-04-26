const fs = require('fs');
const path = require('path');

const CLUSTERS_PATH = path.resolve(__dirname, '../../data/similarity/content-clusters.json');
const BATCH_HISTORY_PATH = path.resolve(__dirname, '../../data/execution/batch-history.json');

// Agrupa contenido en familias reutilizables.
function buildContentClusters(historical = [], newScripts = []) {
  fs.mkdirSync(path.dirname(CLUSTERS_PATH), { recursive: true });
  const batchHistory = _readJson(BATCH_HISTORY_PATH, { batches: [] });
  const batchUsage = _getBatchUsage(batchHistory.batches || []);

  const buckets = new Map();
  [...historical, ...newScripts].forEach((item) => {
    const clusterId = _getClusterId(item);
    const current = buckets.get(clusterId) || {
      clusterId,
      clusterLabel: _getClusterLabel(clusterId),
      memberVideos: [],
      topPerformingPatterns: [],
      monetizationStrength: 0,
      yppStrength: 0
    };

    current.memberVideos.push(item.videoId || item.id || item.title);
    current.monetizationStrength += item.monetizationOutcomeScore || item.monetizationPriorityScore || 0;
    current.yppStrength += item.yppContributionScore || 0;
    current.topPerformingPatterns.push({
      hookType: item.hookType || 'unknown',
      topic: item.topic || item.category || 'unknown',
      score: item.realPerformanceScore || item.successScore || 0
    });
    buckets.set(clusterId, current);
  });

  const clusters = [...buckets.values()].map((cluster) => {
    const monetizationStrength = Number((cluster.monetizationStrength / Math.max(cluster.memberVideos.length, 1)).toFixed(2));
    const yppStrength = Number((cluster.yppStrength / Math.max(cluster.memberVideos.length, 1)).toFixed(2));
    const repeatabilityScore = _repeatability(cluster, batchUsage.get(cluster.clusterLabel) || 0);
    const saturationRisk = _saturation(cluster, batchUsage.get(cluster.clusterLabel) || 0);

    return {
      ...cluster,
      topPerformingPatterns: cluster.topPerformingPatterns
        .sort((a, b) => b.score - a.score)
        .slice(0, 3),
      monetizationStrength,
      yppStrength,
      repeatabilityScore,
      saturationRisk,
      clusterBusinessRole: _clusterRole({ monetizationStrength, yppStrength, topPatternScore: cluster.topPerformingPatterns?.[0]?.score || 0 })
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    clusters
  };

  fs.writeFileSync(CLUSTERS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _getClusterId(item) {
  const text = `${item.topic || item.category || ''} ${item.title || ''} ${item.hook || ''} ${item.microAction || ''}`.toLowerCase();
  if (/mensaje|chat|hora|audio|notificacion/.test(text)) return 'cluster_relationship_messages';
  if (/dormir|movil|video|scroll|pantalla/.test(text)) return 'cluster_mobile_distraction';
  if (/habito|alarma|cafe|rutina|productividad/.test(text)) return 'cluster_habits_selfcontrol';
  if (/compra|menu|decision|carrito/.test(text)) return 'cluster_daily_decisions';
  if (/emocion|amigdala|control/.test(text)) return 'cluster_emotion_control';
  return `cluster_${String(item.topic || item.category || 'general').toLowerCase()}`;
}

function _getClusterLabel(clusterId) {
  const labels = {
    cluster_relationship_messages: 'relaciones ambiguas en mensajes',
    cluster_mobile_distraction: 'habitos de distraccion movil',
    cluster_habits_selfcontrol: 'autocontrol y rutinas',
    cluster_daily_decisions: 'decisiones cotidianas con sesgo',
    cluster_emotion_control: 'emociones y autocontrol'
  };
  return labels[clusterId] || clusterId.replace(/^cluster_/, '').replace(/_/g, ' ');
}

function _repeatability(cluster) {
  return Math.min(100, 45 + (cluster.memberVideos.length * 6));
}

function _saturation(cluster, batchUsage) {
  return Math.min(100, (cluster.memberVideos.length * 10) + (batchUsage * 8));
}

function _clusterRole(cluster) {
  if ((cluster.yppStrength || 0) >= 45) return 'ypp_push';
  if ((cluster.monetizationStrength || 0) >= 60) return 'monetization';
  if ((cluster.topPatternScore || 0) >= 55) return 'reach';
  return 'hybrid';
}

function _getBatchUsage(batches) {
  const usage = new Map();
  batches.forEach((batch) => {
    (batch.executedSlots || []).forEach((slot) => {
      if (!slot.actualCluster) return;
      usage.set(slot.actualCluster, (usage.get(slot.actualCluster) || 0) + 1);
    });
  });
  return usage;
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  buildContentClusters,
  CLUSTERS_PATH
};
