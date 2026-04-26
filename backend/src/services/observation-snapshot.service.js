const fs = require('fs');
const path = require('path');
const { getFullAnalytics } = require('./analytics-tracker');
const { normalizeVideo } = require('./monetization-dashboard.service');
const { ensureLegacyFields } = require('../utils/script-segments');

const SNAPSHOT_DIR = path.resolve('./data/observation-snapshots');
const EXPERIMENTS_V2_PATH = path.resolve('./data/ab-experiments-v2.json');
const EXPERIMENTS_LEGACY_PATH = path.resolve('./data/ab-experiments.json');

function generateObservationSnapshot() {
  const analytics = getFullAnalytics();
  const experimentMap = loadExperimentMap();
  const videos = (analytics.allVideos || [])
    .map((video) => buildObservationVideo(video, experimentMap))
    .sort((a, b) => b.monetizationScore - a.monetizationScore);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalVideos: videos.length,
      avgViews: round(average(videos.map((video) => video.views))),
      avgRetention: round(average(videos.map((video) => video.retention))),
      avgCommentsPer1kViews: round(average(videos.map((video) => video.commentsPer1kViews))),
      avgMonetizationScore: round(average(videos.map((video) => video.monetizationScore))),
    },
    channelMonetization: buildChannelMonetization(videos, analytics),
    videos,
    cohorts: {
      byTopic: mapCohortArray(analytics.monetization?.cohorts?.topic),
      byHookType: mapCohortArray(analytics.monetization?.cohorts?.hookType),
      byViralTrigger: mapCohortArray(analytics.monetization?.cohorts?.viralTrigger),
      byEmotionalTrigger: mapCohortArray(analytics.monetization?.cohorts?.emotionalTrigger),
      byStructureVersion: mapCohortArray(analytics.monetization?.cohorts?.structureVersion),
      byReengagePresence: mapCohortArray(analytics.monetization?.cohorts?.reengagePresence),
    },
    topPerformers: videos.slice(0, 5),
    worstPerformers: [...videos].reverse().slice(0, 5),
    insights: buildObservationInsights(videos, analytics),
    decisions: buildObservationDecisions(videos, analytics),
  };

  persistSnapshot(snapshot);
  return snapshot;
}

function buildObservationVideo(video = {}, experimentMap = new Map()) {
  const normalized = normalizeVideo(video);
  const script = ensureLegacyFields(normalized.script || video.script || video.script_json || {});
  const commentsPer1kViews = calculateCommentsPer1kViews(normalized.comments, normalized.views);
  const engagementProxy = calculateEngagementProxy(normalized.likes, normalized.comments, normalized.shares);
  const retentionSegments = buildRetentionSegments(normalized);
  const experiment = resolveExperiment(video, script, experimentMap);

  return {
    id: String(normalized.id || ''),
    title: normalized.title || '',
    views: normalized.views,
    likes: normalized.likes,
    comments: normalized.comments,
    shares: normalized.shares,
    retention: normalized.retention,
    estimatedDuration: Number(normalized.durationSeconds || 0),
    commentsPer1kViews,
    engagementProxy,
    dataSources: {
      views: video.youtube_views ? 'youtube' : 'internal',
      likes: video.youtube_likes ? 'youtube' : 'internal',
      comments: video.youtube_comments ? 'youtube' : 'internal',
      duration: video.youtube_duration_seconds ? 'youtube' : 'internal',
      retention: 'estimated',
    },
    monetizationScore: normalized.monetizationScore,
    monetizationBreakdown: {
      retention: round(normalized.scoreBreakdown?.retentionScore || 0),
      engagement: round(
        (normalized.scoreBreakdown?.engagementScore || 0) +
        (normalized.scoreBreakdown?.commentScore || 0) +
        (normalized.scoreBreakdown?.shareScore || 0) +
        (normalized.scoreBreakdown?.likeScore || 0)
      ),
      reach: round(normalized.scoreBreakdown?.reachScore || 0),
      topic: round(normalized.scoreBreakdown?.topicScore || 0),
      structure: round(normalized.scoreBreakdown?.structureScore || 0),
    },
    structureVersion: normalized.structureVersion || 'legacy_v1',
    hasReengage: Boolean(normalized.hasReengage),
    segments: {
      hook: script.hook || '',
      open_loop: script.open_loop || '',
      micro_value: script.micro_value || '',
      escalation: script.escalation || '',
      reengage: script.reengage || '',
      peak: script.peak || '',
      open_ending: script.open_ending || '',
      soft_cta: script.soft_cta || '',
    },
    retentionSegments,
    reengageMetrics: {
      retentionDropBeforeReengage: round(normalized.retentionDropBeforeReengage || 0),
      retentionRecoveryAfterReengage: round(normalized.retentionRecoveryAfterReengage || 0),
      reengageEffectivenessScore: round(normalized.reengageEffectivenessScore || 0),
    },
    classification: {
      topic: normalized.topic || 'unknown',
      hookType: normalized.hookType || 'unknown',
      viralTrigger: normalized.viralTrigger || 'unknown',
      emotionalTrigger: normalized.emotionalTrigger || 'unknown',
    },
    experiment,
  };
}

function buildChannelMonetization(videos = [], analytics = {}) {
  const channel = analytics.youtubeIntegration?.channel || null;
  const recent30Views = (analytics.trend30 || []).reduce((sum, item) => sum + (item.views || 0), 0);
  const projectedShorts90d = channel?.shortsViews90d || (recent30Views * 3);
  const avgDuration = average(videos.map((video) => video.estimatedDuration || 0));
  const estimatedWatchHours = videos.reduce((sum, video) => {
    const watchedSeconds = (video.views || 0) * ((video.estimatedDuration || avgDuration || 0) * ((video.retention || 0) / 100));
    return sum + (watchedSeconds / 3600);
  }, 0);
  const subscribersCurrent = channel?.subscriberCount ?? null;
  const subscribersRequired = 1000;
  const shortsRequired = 10000000;
  const watchHoursRequired = 4000;
  const subscribersMissing = subscribersCurrent == null ? null : Math.max(subscribersRequired - subscribersCurrent, 0);
  const shortsMissing = Math.max(shortsRequired - projectedShorts90d, 0);
  const watchHoursMissing = Math.max(watchHoursRequired - estimatedWatchHours, 0);
  const dailyViewsRate = recent30Views / 30;
  const daysToShorts = dailyViewsRate > 0 ? shortsMissing / dailyViewsRate : null;
  const weeklyGrowthViews = channel?.weeklyViewDelta ?? (analytics.trend7 || []).reduce((sum, item) => sum + (item.views || 0), 0);
  const weeklyGrowthSubs = channel?.weeklySubscriberDelta ?? null;
  const confidence = channel?.weeklyViewDelta != null && videos.length >= 8
    ? 'alta'
    : (analytics.trend30 || []).length >= 7
      ? 'media'
      : 'baja';
  const routeProgress = Math.max(
    subscribersCurrent != null ? (subscribersCurrent / subscribersRequired) * 100 : 0,
    projectedShorts90d ? (projectedShorts90d / shortsRequired) * 100 : 0,
    estimatedWatchHours ? (estimatedWatchHours / watchHoursRequired) * 100 : 0
  );
  const status = routeProgress >= 100
    ? 'Listo para monetizar'
    : routeProgress >= 85
      ? 'Muy cerca'
      : routeProgress >= 60
        ? 'Cerca'
        : 'No listo';
  const bottleneck = subscribersCurrent == null
    ? 'faltan suscriptores reales conectados y sigue faltando volumen válido'
    : shortsMissing > Math.max((watchHoursMissing * 10), 100000)
      ? 'faltan views válidas de Shorts'
      : watchHoursMissing > 0
        ? 'faltan horas de visualización'
        : subscribersMissing > 0
          ? 'faltan suscriptores'
          : 'no hay cuello de botella claro';

  return {
    status,
    sources: {
      subscribers: subscribersCurrent == null ? 'missing' : 'youtube',
      shortsViews90d: channel?.shortsViews90d ? 'youtube_estimated_from_recent_uploads' : 'internal_projection',
      watchHours: 'internal_estimation',
    },
    current: {
      subscribers: subscribersCurrent,
      shortsViews90d: round(projectedShorts90d),
      watchHours: round(estimatedWatchHours),
      totalChannelViews: channel?.viewCount ?? null,
      totalVideos: channel?.videoCount ?? null,
    },
    required: {
      subscribers: subscribersRequired,
      shortsViews90d: shortsRequired,
      watchHours: watchHoursRequired,
    },
    progress: {
      subscribers: subscribersCurrent == null ? null : round((subscribersCurrent / subscribersRequired) * 100),
      shortsViews90d: round((projectedShorts90d / shortsRequired) * 100),
      watchHours: round((estimatedWatchHours / watchHoursRequired) * 100),
    },
    missing: {
      subscribers: subscribersMissing,
      shortsViews90d: round(shortsMissing),
      watchHours: round(watchHoursMissing),
    },
    projection: {
      dailyViewsRate: round(dailyViewsRate),
      weeklyGrowthViews: round(weeklyGrowthViews),
      weeklyGrowthSubscribers: weeklyGrowthSubs,
      daysToShorts: daysToShorts ? round(daysToShorts) : null,
      confidence,
    },
    bottleneck,
  };
}

function buildRetentionSegments(video = {}) {
  const retention = Number(video.retention || 0);
  const drop = Number(video.retentionDropBeforeReengage || 0);
  const recovery = Number(video.retentionRecoveryAfterReengage || 0);
  const early = clamp(retention + 30, 35, 96);
  const openLoop = clamp(retention + 12, 24, 88);
  const preReengage = clamp(retention - drop, 8, 78);
  const postReengage = clamp(preReengage + recovery, 8, 80);
  const ending = clamp(postReengage - 10, 6, 68);

  return {
    '0-5s': round(early),
    '5-15s': round(openLoop),
    '15-25s': round(preReengage),
    '25-40s': round(postReengage),
    '40-60s': round(ending),
  };
}

function buildObservationInsights(videos = [], analytics = {}) {
  const insights = [];
  const videosWithReengage = videos.filter((video) => video.hasReengage);
  const videosWithoutReengage = videos.filter((video) => !video.hasReengage);
  const avgRetentionWithReengage = average(videosWithReengage.map((video) => video.retention));
  const avgRetentionWithoutReengage = average(videosWithoutReengage.map((video) => video.retention));
  if (videosWithReengage.length && videosWithoutReengage.length && avgRetentionWithReengage > avgRetentionWithoutReengage) {
    insights.push({
      explanation: 'Los vídeos con reengage activo sostienen mejor la retención media.',
      evidence: {
        withReengage: round(avgRetentionWithReengage),
        withoutReengage: round(avgRetentionWithoutReengage),
        sampleSize: videosWithReengage.length,
      },
      recommendation: 'Mantener reengage explícito y observar qué fórmulas recuperan mejor tras el segundo 20.',
    });
  }

  const bestCommentHook = bestCohortBy(videos, 'classification.hookType', 'commentsPer1kViews', 2);
  if (bestCommentHook) {
    insights.push({
      explanation: `El hook type "${bestCommentHook.key}" concentra más comentarios por 1.000 views.`,
      evidence: {
        hookType: bestCommentHook.key,
        avgCommentsPer1kViews: round(bestCommentHook.avgMetric),
        sampleSize: bestCommentHook.count,
      },
      recommendation: 'Usar ese tipo de hook como baseline cuando el objetivo sea conversación y no solo reach.',
    });
  }

  const bestTopic = bestCohortBy(videos, 'classification.topic', 'monetizationScore', 2);
  if (bestTopic) {
    insights.push({
      explanation: `El topic "${bestTopic.key}" lidera en monetización agregada.`,
      evidence: {
        topic: bestTopic.key,
        avgMonetizationScore: round(bestTopic.avgMetric),
        sampleSize: bestTopic.count,
      },
      recommendation: 'Escalar variaciones del mismo topic con hooks y peaks distintos antes de abrir temas nuevos.',
    });
  }

  const retentionRisk = analytics.monetization?.retentionCurve?.find((point) => point.key === 'reengage_risk');
  if (retentionRisk && retentionRisk.value < 40) {
    insights.push({
      explanation: 'La curva simplificada indica caída fuerte en el tramo 15-25s.',
      evidence: {
        segment: retentionRisk.label,
        estimatedRetention: round(retentionRisk.value),
      },
      recommendation: 'Revisar si el valor llega demasiado tarde o si el reengage entra sin suficiente tensión previa.',
    });
  }

  const weakCtaVideos = videos.filter((video) => video.segments.soft_cta && video.commentsPer1kViews < 6).slice(0, 3);
  if (weakCtaVideos.length) {
    insights.push({
      explanation: 'Hay vídeos con soft CTA presente pero poca conversión a comentario.',
      evidence: {
        sampleTitles: weakCtaVideos.map((video) => video.title),
        avgCommentsPer1kViews: round(average(weakCtaVideos.map((video) => video.commentsPer1kViews))),
      },
      recommendation: 'Comparar CTAs de identificación vs fricción suave para separar mejor conversación de cierre genérico.',
    });
  }

  return insights;
}

function buildObservationDecisions(videos = [], analytics = {}) {
  const decisions = [];
  const bestFormat = firstOf(analytics.monetization?.cohorts?.hookType);
  const bestTopic = firstOf(analytics.monetization?.cohorts?.topic);
  const weakestTopic = lastOf(analytics.monetization?.cohorts?.topic);
  const weakReengageCluster = bestCohortBy(
    videos.filter((video) => video.hasReengage),
    'classification.hookType',
    'reengageMetrics.reengageEffectivenessScore',
    2,
    'asc'
  );

  if (bestFormat) {
    decisions.push({
      action: `Repetir formato ${bestFormat.key}`,
      reason: `Promedia ${round(bestFormat.avgScore)} de monetización en ${bestFormat.count} vídeos.`,
      priority: 'alta',
    });
  }

  if (bestTopic) {
    decisions.push({
      action: `Escalar topic ${bestTopic.key}`,
      reason: `Es el topic con mejor score medio y ya tiene señal suficiente para serie.`,
      priority: 'alta',
    });
  }

  if (weakestTopic && weakestTopic.count >= 2) {
    decisions.push({
      action: `Evitar topic ${weakestTopic.key}`,
      reason: `Es el cohort con peor monetización media dentro del histórico disponible.`,
      priority: 'media',
    });
  }

  if (weakReengageCluster) {
    decisions.push({
      action: `Mejorar reengage en hooks ${weakReengageCluster.key}`,
      reason: `Ese grupo cae en efectividad de reengage (${round(weakReengageCluster.avgMetric)}).`,
      priority: 'alta',
    });
  }

  const lowPeakVideos = videos.filter((video) => video.monetizationBreakdown.structure < 4 && video.retention < 45).slice(0, 3);
  if (lowPeakVideos.length) {
    decisions.push({
      action: 'Reforzar peak en vídeos con baja conversión estructural',
      reason: `Hay ${lowPeakVideos.length} casos donde la estructura no está sosteniendo retención suficiente.`,
      priority: 'media',
    });
  }

  return decisions;
}

function resolveExperiment(video = {}, script = {}, experimentMap = new Map()) {
  const experimentId = video.abExperimentId || video.ab_experiment_id || script.abExperimentId || null;
  const variantId = video.abVariantId || video.ab_variant_id || script.abVariantId || null;
  const directKey = experimentId && variantId ? `${experimentId}:${variantId}` : null;
  const experiment = directKey ? experimentMap.get(directKey) : experimentMap.get(String(video.id || ''));

  return {
    testedVariable: experiment?.testedVariable || 'none',
    segmentType: experiment?.segmentType || 'none',
    variantIntent: experiment?.variantIntent || 'none',
  };
}

function loadExperimentMap() {
  const map = new Map();
  const v2 = normalizeExperiments(readJSON(EXPERIMENTS_V2_PATH, []));
  const legacy = normalizeExperiments(readJSON(EXPERIMENTS_LEGACY_PATH, []));

  v2.forEach((experiment) => {
    getVariantsList(experiment).forEach((variant) => {
      const payload = {
        testedVariable: variant.testedVariable || experiment.testedVariable || 'unknown',
        segmentType: variant.segmentType || experiment.segmentType || 'unknown',
        variantIntent: variant.variantIntent || experiment.variantIntent || 'unknown',
      };
      if (experiment.experimentId && variant.variantId) {
        map.set(`${experiment.experimentId}:${variant.variantId}`, payload);
      }
      if (variant.jobId) {
        map.set(String(variant.jobId), payload);
      }
    });
  });

  legacy.forEach((experiment) => {
    getVariantsList(experiment).forEach((variant) => {
      const payload = {
        testedVariable: variant.testedVariable || experiment.testedVariable || 'legacy_hook_test',
        segmentType: variant.segmentType || experiment.segmentType || 'hook',
        variantIntent: variant.variantIntent || experiment.variantIntent || 'legacy_variant',
      };
      if (experiment.experimentId && variant.variantId) {
        map.set(`${experiment.experimentId}:${variant.variantId}`, payload);
      }
      if (variant.jobId) {
        map.set(String(variant.jobId), payload);
      }
    });
  });

  return map;
}

function normalizeExperiments(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  return Object.values(raw).filter((item) => item && typeof item === 'object');
}

function getVariantsList(experiment = {}) {
  if (Array.isArray(experiment.variants)) return experiment.variants;
  if (experiment.variants && typeof experiment.variants === 'object') {
    return Object.entries(experiment.variants).map(([variantId, variant]) => ({
      variantId,
      ...(variant || {}),
    }));
  }
  return [];
}

function mapCohortArray(cohorts = []) {
  return (cohorts || []).map((cohort) => ({
    key: cohort.key,
    count: cohort.count,
    avgViews: round(cohort.avgViews || 0),
    avgRetention: round(cohort.avgRetention || 0),
    avgMonetizationScore: round(cohort.avgScore || 0),
    avgReengageDrop: round(cohort.avgReengageDrop || 0),
  }));
}

function bestCohortBy(videos = [], keyPath, metricPath, minCount = 1, order = 'desc') {
  const groups = new Map();

  videos.forEach((video) => {
    const key = String(getByPath(video, keyPath) || 'unknown').trim() || 'unknown';
    const metric = Number(getByPath(video, metricPath) || 0);
    if (!groups.has(key)) groups.set(key, { key, count: 0, totalMetric: 0 });
    const group = groups.get(key);
    group.count += 1;
    group.totalMetric += metric;
  });

  const sorted = [...groups.values()]
    .filter((group) => group.count >= minCount)
    .map((group) => ({ ...group, avgMetric: group.totalMetric / group.count }))
    .sort((a, b) => order === 'asc' ? a.avgMetric - b.avgMetric : b.avgMetric - a.avgMetric);

  return sorted[0] || null;
}

function getByPath(target = {}, pathKey = '') {
  return pathKey.split('.').reduce((value, key) => value && value[key], target);
}

function persistSnapshot(snapshot) {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const day = snapshot.generatedAt.slice(0, 10);
  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, `snapshot_${day}.json`),
    JSON.stringify(snapshot, null, 2)
  );
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function calculateCommentsPer1kViews(comments = 0, views = 0) {
  if (!views) return 0;
  return (comments / views) * 1000;
}

function calculateEngagementProxy(likes = 0, comments = 0, shares = 0) {
  return likes + (comments * 2) + (shares * 3);
}

function average(values = []) {
  const valid = values.filter((value) => typeof value === 'number' && !Number.isNaN(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function round(value) {
  return Number(Number(value || 0).toFixed(1));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function firstOf(list = []) {
  return Array.isArray(list) && list.length ? list[0] : null;
}

function lastOf(list = []) {
  return Array.isArray(list) && list.length ? list[list.length - 1] : null;
}

module.exports = {
  generateObservationSnapshot,
};
