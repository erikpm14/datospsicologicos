const { ensureLegacyFields } = require('../utils/script-segments');

const TOPIC_VALUE = {
  dark_psychology: 94,
  body_language: 90,
  relationships: 91,
  workplace: 84,
  communication: 86,
  cognitive_biases: 88,
  social_skills: 78,
  emotions: 80,
  memory: 82,
  habits: 76,
  motivation: 68,
  first_impressions: 79,
  self_esteem: 72,
};

function buildMonetizationDashboard(videos = []) {
  const normalized = videos.map(normalizeVideo).sort((a, b) => b.monetizationScore - a.monetizationScore);
  const topVideos = normalized.slice(0, 5);
  const lowVideos = [...normalized].sort((a, b) => a.monetizationScore - b.monetizationScore).slice(0, 5);
  const avgScore = average(normalized.map((video) => video.monetizationScore));
  const avgRetention = average(normalized.map((video) => video.retention));
  const avgViews = average(normalized.map((video) => video.views));
  const avgComments = average(normalized.map((video) => video.comments));
  const bestFormat = buildCohort(normalized, 'hookType')[0] || null;
  const bestTopic = buildCohort(normalized, 'topic')[0] || null;
  const worstTopic = [...buildCohort(normalized, 'topic')].reverse()[0] || null;
  const reengageDrop = average(normalized.map((video) => video.reengageDrop));
  const avgReengageEffectiveness = average(normalized.map((video) => video.reengageEffectivenessScore));

  return {
    summary: {
      totalVideos: normalized.length,
      avgScore,
      avgRetention,
      avgViews: Math.round(avgViews),
      avgComments: Math.round(avgComments),
      topScore: topVideos[0]?.monetizationScore || 0,
      bestFormat: bestFormat?.key || null,
      bestTopic: bestTopic?.key || null,
      reengageCoverage: percentage(normalized.filter((video) => video.hasReengage).length, normalized.length),
      avgReengageEffectiveness,
    },
    topVideos,
    lowVideos,
    retentionCurve: buildRetentionCurve(normalized),
    cohorts: {
      topic: buildCohort(normalized, 'topic'),
      hookType: buildCohort(normalized, 'hookType'),
      structureVersion: buildCohort(normalized, 'structureVersion'),
      viralTrigger: buildCohort(normalized, 'viralTrigger'),
      effectName: buildCohort(normalized, 'effectName'),
      emotionalTrigger: buildCohort(normalized, 'emotionalTrigger'),
      reengagePresence: buildCohort(normalized, 'reengagePresence'),
    },
    insights: buildInsights({ videos: normalized, avgScore, avgRetention, avgViews, reengageDrop, bestFormat, bestTopic }),
    decisions: buildDecisions({ videos: normalized, avgRetention, bestFormat, bestTopic, worstTopic, reengageDrop }),
  };
}

function normalizeVideo(video = {}) {
  const script = ensureLegacyFields(video.script || video.script_json || {});
  const views = Number(video.max_views ?? video.views ?? 0);
  const likes = Number(video.max_likes ?? video.likes ?? 0);
  const comments = Number(video.max_comments ?? video.comments ?? 0);
  const shares = Number(video.max_shares ?? video.shares ?? 0);
  const engagementRate = Number(video.max_engagement ?? video.engagement_rate ?? video.engagementRate ?? 0);
  const topic = video.topic || script.topic || 'unknown';
  const hookType = video.hookType || script.selectedHookType || script.hookType || 'unknown';
  const structureVersion = script.structureVersion || 'legacy_v1';
  const retention = estimateRetention({ video, script, engagementRate, views, comments, shares });
  const reengageDrop = estimateReengageDrop({ script, retention, engagementRate, comments, shares });
  const topicValue = TOPIC_VALUE[topic] || 70;
  const commentRate = views > 0 ? (comments / views) * 100 : 0;
  const shareRate = views > 0 ? (shares / views) * 100 : 0;
  const likeRate = views > 0 ? (likes / views) * 100 : 0;
  const retentionScore = retention * 0.34;
  const engagementScore = Math.min(engagementRate * 7, 18);
  const commentScore = Math.min(commentRate * 220, 14);
  const shareScore = Math.min(shareRate * 260, 14);
  const likeScore = Math.min(likeRate * 12, 8);
  const reachScore = Math.min(Math.log10(views + 1) * 11, 12);
  const topicScore = topicValue * 0.12;
  const structureScore = (script.hasReengage ? 4 : 0) + (structureVersion === 'open_loop_escalation_v1' ? 3 : 0);
  const monetizationScore = clamp(Math.round(
    retentionScore +
    engagementScore +
    commentScore +
    shareScore +
    likeScore +
    reachScore +
    topicScore +
    structureScore
  ), 0, 100);
  const retentionDropBeforeReengage = estimateRetentionDropBeforeReengage({ script, retention, engagementRate });
  const retentionRecoveryAfterReengage = estimateRetentionRecoveryAfterReengage({ script, retention, comments, shares, engagementRate });
  const reengageEffectivenessScore = estimateReengageEffectiveness({ script, retentionDropBeforeReengage, retentionRecoveryAfterReengage, comments, shares });

  return {
    ...video,
    script,
    id: video.id,
    title: video.title || script.title || video.hook || script.hook,
    hook: video.hook || script.hook || '',
    topic,
    hookType,
    structureVersion,
    viralTrigger: script.viralTrigger || 'unknown',
    effectName: script.effectName || 'unknown',
    emotionalTrigger: script.emotionalTrigger || 'unknown',
    reengagePresence: script.hasReengage ? 'with_reengage' : 'without_reengage',
    views,
    likes,
    comments,
    shares,
    retention,
    avgRetention: retention,
    reengageDrop,
    retentionDropBeforeReengage,
    retentionRecoveryAfterReengage,
    reengageEffectivenessScore,
    engagementRate,
    durationSeconds: script.durationSeconds || video.durationSeconds || 0,
    hasReengage: Boolean(script.hasReengage),
    open_loop: script.open_loop || '',
    micro_value: script.micro_value || '',
    escalation: script.escalation || '',
    reengage: script.reengage || '',
    peak: script.peak || '',
    open_ending: script.open_ending || '',
    soft_cta: script.soft_cta || '',
    claim: script.claim || '',
    explanation: script.explanation || '',
    cta: script.cta || '',
    scoreBreakdown: {
      retentionScore: Math.round(retentionScore),
      engagementScore: Math.round(engagementScore),
      commentScore: Math.round(commentScore),
      shareScore: Math.round(shareScore),
      likeScore: Math.round(likeScore),
      reachScore: Math.round(reachScore),
      topicScore: Math.round(topicScore),
      structureScore: Math.round(structureScore),
    },
    monetizationScore,
  };
}

function buildCohort(videos, key) {
  const map = new Map();

  videos.forEach((video) => {
    const value = String(video[key] || 'unknown').trim() || 'unknown';
    if (!map.has(value)) {
      map.set(value, { key: value, count: 0, totalScore: 0, totalViews: 0, totalRetention: 0, totalReengageDrop: 0 });
    }

    const cohort = map.get(value);
    cohort.count += 1;
    cohort.totalScore += video.monetizationScore;
    cohort.totalViews += video.views;
    cohort.totalRetention += video.retention;
    cohort.totalReengageDrop += video.reengageDrop;
  });

  return [...map.values()]
    .map((cohort) => ({
      key: cohort.key,
      count: cohort.count,
      avgScore: Math.round(cohort.totalScore / cohort.count),
      avgViews: Math.round(cohort.totalViews / cohort.count),
      avgRetention: Math.round(cohort.totalRetention / cohort.count),
      avgReengageDrop: Math.round(cohort.totalReengageDrop / cohort.count),
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

function buildRetentionCurve(videos) {
  const avgRetention = average(videos.map((video) => video.retention));
  const avgReengageDrop = average(videos.map((video) => video.reengageDrop));
  const withReengage = percentage(videos.filter((video) => video.hasReengage).length, videos.length);

  return [
    { key: 'hook', label: '0-5s', value: clamp(Math.round(avgRetention + 32), 62, 96) },
    { key: 'open_loop', label: '5-15s', value: clamp(Math.round(avgRetention + 12), 50, 88) },
    { key: 'reengage_risk', label: '15-25s', value: clamp(Math.round(avgRetention - avgReengageDrop), 20, 78) },
    { key: 'peak', label: '25-40s', value: clamp(Math.round(avgRetention - Math.max(avgReengageDrop - (withReengage / 20), 4)), 18, 72) },
    { key: 'ending', label: '40-60s', value: clamp(Math.round(avgRetention - 12), 14, 65) },
  ];
}

function buildInsights({ videos, avgScore, avgRetention, avgViews, reengageDrop, bestFormat, bestTopic }) {
  const insights = [];
  const highViewsLowScore = videos.filter((video) => video.views > avgViews * 1.35 && video.monetizationScore < avgScore * 0.8);
  if (highViewsLowScore.length) {
    insights.push({
      type: 'warning',
      title: 'Views sin monetización equivalente',
      detail: `${highViewsLowScore.length} vídeo(s) captan views pero no convierten en comentarios, shares o retención.`,
      action: 'Endurecer la promesa del `soft_cta` y cerrar con un uso cotidiano más específico.',
      items: highViewsLowScore.slice(0, 3).map((video) => video.title),
    });
  }

  if (bestFormat && bestFormat.count >= 2) {
    insights.push({
      type: 'success',
      title: 'Formato replicable',
      detail: `El hook type "${bestFormat.key}" lidera con score medio ${bestFormat.avgScore} y retención ${bestFormat.avgRetention}%.`,
      action: 'Lanzar nuevas variaciones en el mismo hook type y mantener topic adyacente.',
      items: [bestFormat.key],
    });
  }

  if (avgRetention < 42 || reengageDrop > 12) {
    insights.push({
      type: 'warning',
      title: 'Caída clara en el tramo de reengage',
      detail: `La caída estimada alrededor del reengage es de ${Math.round(reengageDrop)} puntos.`,
      action: 'Reforzar la frase puente entre `escalation` y `peak` y evitar que el valor fuerte llegue tarde.',
    });
  }

  const reengageWinners = videos.filter((video) => video.reengageEffectivenessScore >= 60);
  if (reengageWinners.length >= 2) {
    insights.push({
      type: 'success',
      title: 'Reengage con señal real',
      detail: `${reengageWinners.length} vídeo(s) muestran recuperación estimada tras el reengage.`,
      action: 'Reutilizar giros y preguntas del tramo reengage en nuevos scripts del mismo cluster.',
      items: reengageWinners.slice(0, 3).map((video) => video.title),
    });
  }

  const byStructure = buildCohort(videos, 'structureVersion');
  const openLoop = byStructure.find((cohort) => cohort.key === 'open_loop_escalation_v1');
  if (openLoop && openLoop.count >= 2) {
    insights.push({
      type: 'info',
      title: 'La estructura nueva ya genera señal',
      detail: `La versión ${openLoop.key} tiene score medio ${openLoop.avgScore} en ${openLoop.count} vídeos.`,
      action: openLoop.avgScore >= avgScore ? 'Priorizar la estructura nueva y mantener fallback legacy solo donde sea necesario.' : 'La estructura nueva ya está integrada, pero necesita hooks más agresivos o mejor peak.',
    });
  }

  const serializableTopic = bestTopic && bestTopic.avgRetention >= 52 ? bestTopic : null;
  if (serializableTopic) {
    insights.push({
      type: 'opportunity',
      title: 'Tema con potencial de serie',
      detail: `"${serializableTopic.key}" sostiene ${serializableTopic.avgRetention}% de retención media.`,
      action: 'Probar secuencia de 2-3 vídeos con el mismo efecto y hooks complementarios.',
      items: [serializableTopic.key],
    });
  }

  return insights;
}

function buildDecisions({ videos, avgRetention, bestFormat, bestTopic, worstTopic, reengageDrop }) {
  const decisions = [];

  if (bestFormat) {
    decisions.push({
      priority: 'alta',
      action: `Repetir el hook type "${bestFormat.key}"`,
      reason: `Es el formato con mejor score medio (${bestFormat.avgScore}).`,
    });
  }

  if (bestTopic) {
    decisions.push({
      priority: 'media',
      action: `Escalar el topic "${bestTopic.key}"`,
      reason: `Combina monetización y retención con ${bestTopic.avgScore} puntos medios.`,
    });
  }

  if (worstTopic && worstTopic.count >= 2) {
    decisions.push({
      priority: 'media',
      action: `Reducir el topic "${worstTopic.key}"`,
      reason: `Es el cohort más flojo en score medio (${worstTopic.avgScore}).`,
    });
  }

  if (avgRetention < 42 || reengageDrop > 12) {
    decisions.push({
      priority: 'alta',
      action: 'Reforzar el reengage',
      reason: 'La caída en el tramo 15-25s sigue siendo el mayor cuello de botella de watch time.',
    });
  }

  const longWinners = videos.filter((video) => video.durationSeconds >= 55 && video.durationSeconds <= 70 && video.monetizationScore >= 70);
  if (longWinners.length) {
    decisions.push({
      priority: 'media',
      action: 'Mantener duración 55-70s',
      reason: `${longWinners.length} vídeo(s) fuertes ya confirman que el rango largo está funcionando.`,
    });
  }

  return decisions;
}

function estimateRetention({ video, script, engagementRate, views, comments, shares }) {
  const direct = [video.retention, video.avgRetention, video.max_retention].find((value) => typeof value === 'number' && !Number.isNaN(value));
  if (typeof direct === 'number') return clamp(Math.round(direct), 0, 100);

  let proxy = 28;
  proxy += Math.min(engagementRate * 6, 18);
  proxy += Math.min((comments / Math.max(views, 1)) * 900, 12);
  proxy += Math.min((shares / Math.max(views, 1)) * 1200, 10);

  const duration = Number(script.durationSeconds || video.durationSeconds || 0);
  if (duration >= 40 && duration <= 65) proxy += 8;
  else if (duration > 65 && duration <= 75) proxy += 6;
  else if (duration >= 25 && duration < 40) proxy += 4;

  if (script.structureVersion === 'open_loop_escalation_v1') proxy += 6;
  if (script.hasReengage) proxy += 5;

  return clamp(Math.round(proxy), 18, 88);
}

function estimateReengageDrop({ script, retention, engagementRate, comments, shares }) {
  let drop = retention >= 55 ? 8 : 14;
  if (script.hasReengage) drop -= 4;
  if (script.structureVersion === 'open_loop_escalation_v1') drop -= 2;
  if (engagementRate >= 5) drop -= 1;
  if ((comments + shares) > 40) drop -= 1;
  return clamp(Math.round(drop), 4, 24);
}

function estimateRetentionDropBeforeReengage({ script, retention, engagementRate }) {
  let drop = retention >= 55 ? 10 : 16;
  if (script.open_loop && script.micro_value) drop -= 2;
  if (engagementRate >= 5) drop -= 1;
  return clamp(Math.round(drop), 5, 26);
}

function estimateRetentionRecoveryAfterReengage({ script, retention, comments, shares, engagementRate }) {
  let recovery = script.hasReengage ? 8 : 2;
  if (retention >= 50) recovery += 4;
  if ((comments + shares) > 20) recovery += 3;
  if (engagementRate >= 4) recovery += 2;
  return clamp(Math.round(recovery), 0, 18);
}

function estimateReengageEffectiveness({ script, retentionDropBeforeReengage, retentionRecoveryAfterReengage, comments, shares }) {
  let score = 30;
  if (script.hasReengage) score += 18;
  score += retentionRecoveryAfterReengage * 2.4;
  score -= retentionDropBeforeReengage * 1.3;
  score += Math.min(comments + shares, 18);
  return clamp(Math.round(score), 0, 100);
}

function average(values = []) {
  const valid = values.filter((value) => typeof value === 'number' && !Number.isNaN(value));
  if (!valid.length) return 0;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1));
}

function percentage(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  buildMonetizationDashboard,
  normalizeVideo,
};
