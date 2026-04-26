const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');
const { getFullAnalytics } = require('./analytics-tracker');
const { refreshYouTubeIntegration } = require('./youtube-integration.service');

const DATA_DIR = path.resolve(__dirname, '../../data');
const CACHE_FILE = path.join(DATA_DIR, 'youtube-channel-analysis-cache.json');
const CACHE_TTL_MS = (parseInt(process.env.YOUTUBE_ANALYSIS_CACHE_MINUTES || '15', 10) || 15) * 60 * 1000;
const SHORTS_MONETIZATION_TARGET = 10000000;
const SUBSCRIBER_MONETIZATION_TARGET = 1000;
const ANALYSIS_TZ = process.env.ANALYSIS_TIMEZONE || 'Europe/Madrid';

async function generateYouTubeChannelAnalysis(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const cached = readJSON(CACHE_FILE, null);
  if (!forceRefresh && cached?.generatedAt && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) {
    return cached;
  }

  const internal = getFullAnalytics();
  const youtube = await refreshYouTubeIntegration(internal.allVideos || []);

  let payload;
  try {
    payload = await buildYouTubeDrivenAnalysis(internal, youtube);
  } catch (error) {
    logger.warn(`YouTube channel analysis fallback: ${error.message}`);
    payload = await buildFallbackAnalysis(internal, youtube, error.message);
  }

  writeJSON(CACHE_FILE, payload);
  return payload;
}

async function buildYouTubeDrivenAnalysis(internal, youtube) {
  const channel = youtube?.channel || null;
  if (!channel) throw new Error('youtube_channel_unavailable');

  const recentUploads = await fetchRecentUploads(120);
  const recentShorts = recentUploads.filter((video) => (video.durationSeconds || 0) > 0 && (video.durationSeconds || 0) <= 180);
  const recentShortIds = recentShorts.map((video) => video.youtubeId).filter(Boolean);

  const [channel7d, channel30d, shorts30d, shorts90d, videoAnalytics] = await Promise.all([
    queryTotals({ days: 7 }),
    queryTotals({ days: 30 }),
    queryTotals({ days: 30, filters: 'creatorContentType==SHORTS' }).catch(() => null),
    queryTotals({ days: 90, filters: 'creatorContentType==SHORTS' }).catch(() => null),
    recentShortIds.length ? queryVideoAnalytics(recentShortIds.slice(0, 50)) : Promise.resolve([]),
  ]);

  const internalByYoutubeId = new Map((internal.allVideos || []).map((video) => [String(video.youtube_id || ''), video]));
  const internalByTitle = new Map((internal.allVideos || []).map((video) => [normalizeText(video.title || video.hook || ''), video]));
  const analyticsByVideoId = new Map(videoAnalytics.map((video) => [video.videoId, video]));

  const videos = recentShorts.map((video) => {
    const stats = analyticsByVideoId.get(video.youtubeId) || null;
    const internalVideo = internalByYoutubeId.get(String(video.youtubeId || '')) || internalByTitle.get(normalizeText(video.title || '')) || null;
    const views = stats?.views ?? video.views ?? internalVideo?.views ?? 0;
    const likes = stats?.likes ?? video.likes ?? internalVideo?.likes ?? 0;
    const comments = stats?.comments ?? video.comments ?? internalVideo?.comments ?? 0;
    const shares = stats?.shares ?? internalVideo?.shares ?? 0;
    const commentsPer1kViews = views > 0 ? (comments / views) * 1000 : 0;
    const engagementProxy = likes + (comments * 2) + (shares * 3);
    const publishedLocal = formatPublishedSlot(video.publishedAt);

    return {
      videoId: video.youtubeId,
      title: video.title,
      publishedAt: video.publishedAt,
      publishedLocal,
      date: video.publishedAt ? video.publishedAt.slice(0, 10) : null,
      publishHour: publishedLocal.hourLabel,
      publishRange: publishedLocal.rangeLabel,
      durationSeconds: video.durationSeconds,
      views,
      likes,
      comments,
      shares,
      commentsPer1kViews: round(commentsPer1kViews, 2),
      engagementProxy,
      averageViewDuration: round(stats?.averageViewDuration ?? 0, 2),
      estimatedMinutesWatched: round(stats?.estimatedMinutesWatched ?? 0, 2),
      engagedViews: round(stats?.engagedViews ?? 0, 2),
      subscribersGained: round(stats?.subscribersGained ?? 0, 2),
      subscribersLost: round(stats?.subscribersLost ?? 0, 2),
      dataSources: {
        views: stats?.views != null ? 'youtube_analytics' : video.views != null ? 'youtube_data' : 'internal',
        likes: stats?.likes != null ? 'youtube_analytics' : video.likes != null ? 'youtube_data' : 'internal',
        comments: stats?.comments != null ? 'youtube_analytics' : video.comments != null ? 'youtube_data' : 'internal',
        shares: stats?.shares != null ? 'youtube_analytics' : 'internal',
      },
      internalContext: internalVideo ? {
        internalId: internalVideo.id,
        topic: internalVideo.topic || null,
        hookType: internalVideo.hookType || null,
        viralTrigger: internalVideo.viralTrigger || null,
        emotionalTrigger: internalVideo.emotionalTrigger || null,
        monetizationScore: internalVideo.monetizationScore || null,
      } : null,
    };
  });

  const scoredVideos = scoreVideos(videos);
  const topVideos = scoredVideos.slice(0, 3).map((video) => ({
    ...video,
    why: buildVideoReason(video, scoredVideos, 'top'),
  }));
  const worstVideos = [...scoredVideos].reverse().slice(0, 3).map((video) => ({
    ...video,
    why: buildVideoReason(video, scoredVideos, 'worst'),
  }));

  const hourAnalysis = buildHourAnalysis(scoredVideos);
  const patterns = buildPatterns(scoredVideos);
  const monetization = buildMonetization({
    channel,
    channel7d,
    channel30d,
    shorts30d,
    shorts90d,
    youtube,
  });
  const recommendations = buildRecommendations({
    topVideos,
    worstVideos,
    patterns,
    hourAnalysis,
    monetization,
  });

  const summary = {
    state: summarizeChannelState(channel7d, channel30d, monetization),
    topVideos: topVideos.map((video) => `${video.title}: ${video.why}`),
    worstVideos: worstVideos.map((video) => `${video.title}: ${video.why}`),
    patterns: patterns.highlights,
    optimalHours: hourAnalysis.summary,
    monetization: monetization.summary,
    nextActions: recommendations.slice(0, 5),
  };

  return {
    generatedAt: new Date().toISOString(),
    source: {
      channel: 'youtube_data',
      analytics: 'youtube_analytics',
      fallbackInternal: true,
    },
    channel: {
      title: channel.title,
      channelId: channel.channelId,
      subscribers: channel.subscriberCount,
      totalViews: channel.viewCount,
      totalVideos: channel.videoCount,
      viewsLast7d: round(channel7d.views || 0, 0),
      viewsLast30d: round(channel30d.views || 0, 0),
      shortsViewsLast30d: round(shorts30d?.views ?? 0, 0),
      shortsViewsLast90d: round(shorts90d?.views ?? youtube?.channel?.shortsViews90d ?? 0, 0),
      engagedViewsLast30d: round(shorts30d?.engagedViews ?? 0, 0),
      netSubscribersLast30d: round((channel30d.subscribersGained || 0) - (channel30d.subscribersLost || 0), 0),
      trend: computeTrend(channel7d, channel30d),
    },
    videos: scoredVideos,
    topVideos,
    worstVideos,
    patterns,
    publishingHours: hourAnalysis,
    monetization,
    recommendations,
    summary,
    summaryText: buildSummaryText(summary),
  };
}

async function queryTotals({ days, filters = null }) {
  const endDate = analyticsEndDate();
  const startDate = shiftDate(endDate, -(days - 1));
  const row = await youtubeAnalyticsQuery({
    ids: 'channel==MINE',
    startDate,
    endDate,
    metrics: 'views,engagedViews,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost',
    filters,
  });
  return rowToObject(row)[0] || {};
}

async function queryVideoAnalytics(videoIds = []) {
  const rows = [];
  const chunks = chunk(videoIds, 20);
  for (const ids of chunks) {
    const response = await youtubeAnalyticsQuery({
      ids: 'channel==MINE',
      startDate: shiftDate(analyticsEndDate(), -89),
      endDate: analyticsEndDate(),
      dimensions: 'video',
      metrics: 'views,engagedViews,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained,subscribersLost',
      filters: `video==${ids.join(',')}`,
      sort: '-views',
      maxResults: ids.length,
    });
    rows.push(...rowToObject(response));
  }
  return rows.map((row) => ({
    videoId: row.video,
    views: Number(row.views || 0),
    engagedViews: Number(row.engagedViews || 0),
    estimatedMinutesWatched: Number(row.estimatedMinutesWatched || 0),
    averageViewDuration: Number(row.averageViewDuration || 0),
    likes: Number(row.likes || 0),
    comments: Number(row.comments || 0),
    shares: Number(row.shares || 0),
    subscribersGained: Number(row.subscribersGained || 0),
    subscribersLost: Number(row.subscribersLost || 0),
  }));
}

async function fetchRecentUploads(limit = 120) {
  const channelResponse = await youtubeDataChannels();
  const playlistId = channelResponse.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) return [];

  const uploads = [];
  let pageToken = null;
  while (uploads.length < limit) {
    const page = await youtubeDataGet('/playlistItems', {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: Math.min(50, limit - uploads.length),
      pageToken,
    });
    const items = page.data?.items || [];
    uploads.push(...items);
    pageToken = page.data?.nextPageToken || null;
    if (!pageToken || !items.length) break;
  }

  const ids = uploads.map((item) => item.contentDetails?.videoId).filter(Boolean);
  const detailsMap = await fetchVideoDetails(ids);

  return uploads.map((item) => {
    const youtubeId = item.contentDetails?.videoId;
    const detail = detailsMap.get(youtubeId) || {};
    return {
      youtubeId,
      title: detail.title || item.snippet?.title || '',
      publishedAt: detail.publishedAt || item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || null,
      durationSeconds: detail.durationSeconds || null,
      views: detail.views ?? null,
      likes: detail.likes ?? null,
      comments: detail.comments ?? null,
      thumbnails: detail.thumbnails || item.snippet?.thumbnails || null,
    };
  }).filter((item) => item.youtubeId);
}

async function fetchVideoDetails(ids = []) {
  const map = new Map();
  const chunks = chunk(ids.filter(Boolean), 50);
  for (const idsChunk of chunks) {
    const response = await youtubeDataGet('/videos', {
      part: 'snippet,statistics,contentDetails',
      id: idsChunk.join(','),
      maxResults: idsChunk.length,
    });
    (response.data?.items || []).forEach((item) => {
      map.set(item.id, {
        title: item.snippet?.title || '',
        publishedAt: item.snippet?.publishedAt || null,
        durationSeconds: parseISODuration(item.contentDetails?.duration),
        views: toNumber(item.statistics?.viewCount),
        likes: toNumber(item.statistics?.likeCount),
        comments: toNumber(item.statistics?.commentCount),
        thumbnails: item.snippet?.thumbnails || null,
      });
    });
  }
  return map;
}

async function youtubeAnalyticsQuery(params) {
  const accessToken = await getYouTubeAccessToken();
  const response = await axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
    params,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 20000,
  });
  return response.data;
}

async function youtubeDataChannels() {
  if (process.env.YOUTUBE_CHANNEL_ID) {
    return youtubeDataGet('/channels', {
      part: 'contentDetails,snippet,statistics',
      id: process.env.YOUTUBE_CHANNEL_ID,
    });
  }

  const accessToken = await getYouTubeAccessToken();
  return axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { part: 'contentDetails,snippet,statistics', mine: true },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 20000,
  });
}

async function youtubeDataGet(endpoint, params) {
  return axios.get(`https://www.googleapis.com/youtube/v3${endpoint}`, {
    params: {
      ...params,
      key: process.env.YOUTUBE_API_KEY,
    },
    timeout: 20000,
  });
}

async function getYouTubeAccessToken() {
  const response = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }, { timeout: 20000 });
  if (!response.data?.access_token) throw new Error('youtube_access_token_missing');
  return response.data.access_token;
}

function scoreVideos(videos = []) {
  if (!videos.length) return [];
  const metrics = {
    views: videos.map((video) => video.views || 0),
    commentsPer1kViews: videos.map((video) => video.commentsPer1kViews || 0),
    engagementProxy: videos.map((video) => video.engagementProxy || 0),
    averageViewDuration: videos.map((video) => video.averageViewDuration || 0),
  };

  return [...videos]
    .map((video) => {
      const score =
        normalize(video.views, metrics.views) * 0.35 +
        normalize(video.commentsPer1kViews, metrics.commentsPer1kViews) * 0.25 +
        normalize(video.engagementProxy, metrics.engagementProxy) * 0.20 +
        normalize(video.averageViewDuration, metrics.averageViewDuration) * 0.20;

      return {
        ...video,
        performanceScore: round(score * 100, 1),
      };
    })
    .sort((a, b) => b.performanceScore - a.performanceScore);
}

function buildHourAnalysis(videos = []) {
  const byRange = aggregateBy(videos, (video) => video.publishRange);
  const byHour = aggregateBy(videos, (video) => video.publishHour);

  const rangeRows = finalizeGroups(byRange);
  const hourRows = finalizeGroups(byHour);
  const stableRangeRows = rangeRows.filter((row) => row.sampleSize >= 2);
  const stableHourRows = hourRows.filter((row) => row.sampleSize >= 2);

  const bestRange = stableRangeRows[0] || rangeRows[0] || null;
  const worstRange = stableRangeRows[stableRangeRows.length - 1] || rangeRows[rangeRows.length - 1] || null;
  const bestHours = (stableHourRows.length ? stableHourRows : hourRows).slice(0, 3);
  const worstHours = [...(stableHourRows.length ? stableHourRows : hourRows)].reverse().slice(0, 3);

  return {
    bestRange,
    worstRange,
    bestHours,
    worstHours,
    byRange: rangeRows,
    byExactHour: hourRows,
    summary: buildHoursSummary(bestRange, worstRange, bestHours),
  };
}

function buildPatterns(videos = []) {
  const winners = videos.slice(0, Math.max(3, Math.ceil(videos.length * 0.35)));
  const losers = [...videos].reverse().slice(0, Math.max(3, Math.ceil(videos.length * 0.35)));

  const topics = comparePatternDimension(winners, losers, 'topic');
  const hooks = comparePatternDimension(winners, losers, 'hookType');
  const triggers = comparePatternDimension(winners, losers, 'viralTrigger');

  return {
    topics,
    hooks,
    triggers,
    highlights: [
      topics[0] ? `Tema con mejor señal: ${topics[0].label}` : null,
      hooks[0] ? `Hook con mejor señal: ${hooks[0].label}` : null,
      triggers[0] ? `Trigger con mejor señal: ${triggers[0].label}` : null,
    ].filter(Boolean),
  };
}

function buildMonetization({ channel, channel7d, channel30d, shorts30d, shorts90d, youtube }) {
  const currentSubscribers = Number(channel?.subscriberCount || 0);
  const currentShortsViews90d = Number(shorts90d?.views ?? youtube?.channel?.shortsViews90d ?? 0);
  const netSubs30d = Number((channel30d?.subscribersGained || 0) - (channel30d?.subscribersLost || 0));
  const shortsViews30d = Number(shorts30d?.views || 0);
  const subsPerDay = netSubs30d > 0 ? netSubs30d / 30 : 0;
  const shortsViewsPerDay = shortsViews30d > 0 ? shortsViews30d / 30 : currentShortsViews90d > 0 ? currentShortsViews90d / 90 : 0;
  const subsMissing = Math.max(SUBSCRIBER_MONETIZATION_TARGET - currentSubscribers, 0);
  const shortsViewsMissing = Math.max(SHORTS_MONETIZATION_TARGET - currentShortsViews90d, 0);
  const daysToSubs = subsPerDay > 0 ? Math.ceil(subsMissing / subsPerDay) : null;
  const daysToShorts = shortsViewsPerDay > 0 ? Math.ceil(shortsViewsMissing / shortsViewsPerDay) : null;
  const bottleneck = shortsViewsMissing > 0 && (daysToShorts == null || daysToShorts >= (daysToSubs || 0)) ? 'shorts_views' : subsMissing > 0 ? 'subscribers' : 'ready';
  const progressSubscribers = round((currentSubscribers / SUBSCRIBER_MONETIZATION_TARGET) * 100, 1);
  const progressShortsViews = round((currentShortsViews90d / SHORTS_MONETIZATION_TARGET) * 100, 1);

  return {
    currentSubscribers,
    subscriberTarget: SUBSCRIBER_MONETIZATION_TARGET,
    currentShortsViews90d,
    shortsViewsTarget90d: SHORTS_MONETIZATION_TARGET,
    progressSubscribers,
    progressShortsViews,
    subscribersMissing: subsMissing,
    shortsViewsMissing,
    estimatedDaysToSubscribers: daysToSubs,
    estimatedDaysToShortsViews: daysToShorts,
    estimatedDaysToMonetization: daysToSubs == null && daysToShorts == null ? null : Math.max(daysToSubs || 0, daysToShorts || 0),
    confidence: (youtube?.history || []).length >= 10 ? 'media' : 'baja',
    bottleneck,
    summary: buildMonetizationSummary({
      currentSubscribers,
      progressSubscribers,
      currentShortsViews90d,
      progressShortsViews,
      bottleneck,
      daysToSubs,
      daysToShorts,
    }),
  };
}

function buildRecommendations({ topVideos, worstVideos, patterns, hourAnalysis, monetization }) {
  const recommendations = [];

  if (patterns.topics[0]?.winnerShare > patterns.topics[0]?.loserShare) {
    recommendations.push(`Repite el tema ${patterns.topics[0].label}: aparece más en vídeos ganadores que en flojos.`);
  }
  if (patterns.hooks[0]?.winnerShare > patterns.hooks[0]?.loserShare) {
    recommendations.push(`Escala hooks tipo ${patterns.hooks[0].label}: están concentrando mejor rendimiento relativo.`);
  }
  if (hourAnalysis.bestRange?.label && hourAnalysis.worstRange?.label && hourAnalysis.bestRange.label !== hourAnalysis.worstRange.label) {
    recommendations.push(`Mueve publicaciones hacia ${hourAnalysis.bestRange.label} y reduce ${hourAnalysis.worstRange.label}.`);
  }
  if (worstVideos.some((video) => video.commentsPer1kViews < 6)) {
    recommendations.push('Sube comments/1k: hay vídeos que sacan views pero convierten poco en conversación.');
  }
  if (worstVideos.some((video) => video.averageViewDuration < 20)) {
    recommendations.push('Refuerza hook y primer tercio: varios Shorts se quedan con watch time corto.');
  }
  if (monetization.bottleneck === 'shorts_views') {
    recommendations.push('El cuello de botella real es volumen de Shorts con alcance; prioriza formatos escalables sobre vídeos solo correctos.');
  }
  if (monetization.bottleneck === 'subscribers') {
    recommendations.push('El cuello de botella son suscriptores; fuerza CTA más identificativo en los vídeos que ya generan comentarios.');
  }
  if (topVideos[0]) {
    recommendations.push(`Analiza y replica el patrón del top 1: ${topVideos[0].title}.`);
  }

  return [...new Set(recommendations)].slice(0, 8);
}

function summarizeChannelState(channel7d, channel30d, monetization) {
  const trend = computeTrend(channel7d, channel30d);
  if (monetization.bottleneck === 'shorts_views' && trend.direction !== 'up') return 'Canal flojo: hace falta más alcance escalable en Shorts.';
  if (trend.direction === 'up') return 'Canal creciendo: la señal reciente está por encima de la media mensual.';
  if (trend.direction === 'flat') return 'Canal estable: sin caída clara, pero tampoco aceleración.';
  return 'Canal estancado o en retroceso: conviene cortar formatos flojos y concentrar slots.';
}

async function buildFallbackAnalysis(internal, youtube, reason) {
  const recentUploads = await fetchRecentUploads(120).catch(() => []);
  const recentShorts = recentUploads.filter((video) => (video.durationSeconds || 0) > 0 && (video.durationSeconds || 0) <= 180);
  const internalByYoutubeId = new Map((internal.allVideos || []).map((video) => [String(video.youtube_id || ''), video]));
  const internalByTitle = new Map((internal.allVideos || []).map((video) => [normalizeText(video.title || video.hook || ''), video]));

  const sourceVideos = recentShorts.length ? recentShorts : (internal.allVideos || []).map((video) => ({
    youtubeId: video.youtube_id || video.id,
    title: video.title,
    publishedAt: video.published_at,
    durationSeconds: video.durationSeconds || null,
    views: Number(video.views || 0),
    likes: Number(video.likes || 0),
    comments: Number(video.comments || 0),
  }));

  const videos = sourceVideos.map((video) => {
    const internalVideo = internalByYoutubeId.get(String(video.youtubeId || '')) || internalByTitle.get(normalizeText(video.title || '')) || null;
    const publishedLocal = formatPublishedSlot(video.publishedAt);
    const views = Number(video.views ?? internalVideo?.views ?? 0);
    const likes = Number(video.likes ?? internalVideo?.likes ?? 0);
    const comments = Number(video.comments ?? internalVideo?.comments ?? 0);
    const shares = Number(internalVideo?.shares || 0);

    return {
      videoId: video.youtubeId || internalVideo?.id,
      title: video.title || internalVideo?.title,
      publishedAt: video.publishedAt || internalVideo?.published_at || null,
      publishedLocal,
      date: (video.publishedAt || internalVideo?.published_at || '').slice(0, 10) || null,
      publishHour: publishedLocal.hourLabel,
      publishRange: publishedLocal.rangeLabel,
      durationSeconds: video.durationSeconds || internalVideo?.durationSeconds || null,
      views,
      likes,
      comments,
      shares,
      commentsPer1kViews: round(views > 0 ? (comments / views) * 1000 : 0, 2),
      engagementProxy: likes + (comments * 2) + (shares * 3),
      averageViewDuration: 0,
      estimatedMinutesWatched: 0,
      engagedViews: 0,
      subscribersGained: 0,
      subscribersLost: 0,
      dataSources: {
        views: recentShorts.length ? 'youtube_data' : 'internal',
        likes: recentShorts.length ? 'youtube_data' : 'internal',
        comments: recentShorts.length ? 'youtube_data' : 'internal',
        shares: 'internal',
      },
      internalContext: internalVideo ? {
        internalId: internalVideo.id,
        topic: internalVideo.topic || null,
        hookType: internalVideo.hookType || null,
        viralTrigger: internalVideo.viralTrigger || null,
        emotionalTrigger: internalVideo.emotionalTrigger || null,
        monetizationScore: internalVideo.monetizationScore || null,
      } : null,
    };
  });

  const scoredVideos = scoreVideos(videos);
  const topVideos = scoredVideos.slice(0, 3);
  const worstVideos = [...scoredVideos].reverse().slice(0, 3);
  const hourAnalysis = buildHourAnalysis(scoredVideos);
  const patterns = buildPatterns(scoredVideos);
  const history = youtube?.history || [];
  const channelViews7d = deltaFromHistory(history, 'viewCount', youtube?.channel?.viewCount || 0, 7);
  const channelViews30d = deltaFromHistory(history, 'viewCount', youtube?.channel?.viewCount || 0, 30);
  const subs30d = deltaFromHistory(history, 'subscriberCount', youtube?.channel?.subscriberCount || 0, 30);
  const shortsViews30d = recentShorts
    .filter((video) => video.publishedAt && new Date(video.publishedAt).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000)
    .reduce((sum, video) => sum + Number(video.views || 0), 0);
  const monetization = buildMonetization({
    channel: youtube?.channel || null,
    channel7d: { views: channelViews7d || 0 },
    channel30d: { views: channelViews30d || 0, subscribersGained: Math.max(subs30d || 0, 0), subscribersLost: subs30d < 0 ? Math.abs(subs30d) : 0 },
    shorts30d: { views: shortsViews30d || 0 },
    shorts90d: { views: youtube?.channel?.shortsViews90d || 0 },
    youtube,
  });
  monetization.summary = `${monetization.summary} Base actual: YouTube Data API + histórico local; Analytics API aún no disponible.`;
  const recommendations = buildRecommendations({ topVideos, worstVideos, patterns, hourAnalysis, monetization });
  const summary = {
    state: summarizeChannelState({ views: channelViews7d || 0 }, { views: channelViews30d || 0 }, monetization),
    topVideos: topVideos.map((video) => video.title),
    worstVideos: worstVideos.map((video) => video.title),
    patterns: patterns.highlights,
    optimalHours: hourAnalysis.summary,
    monetization: monetization.summary,
    nextActions: recommendations.slice(0, 5),
  };

  return {
    generatedAt: new Date().toISOString(),
    source: {
      channel: youtube?.channel ? 'youtube_data' : 'fallback',
      analytics: 'fallback',
      fallbackInternal: true,
      reason,
    },
    channel: {
      title: youtube?.channel?.title || null,
      channelId: youtube?.channel?.channelId || null,
      subscribers: youtube?.channel?.subscriberCount || null,
      totalViews: youtube?.channel?.viewCount || null,
      totalVideos: youtube?.channel?.videoCount || null,
      viewsLast7d: channelViews7d || null,
      viewsLast30d: channelViews30d || null,
      shortsViewsLast30d: shortsViews30d || null,
      shortsViewsLast90d: youtube?.channel?.shortsViews90d || null,
      engagedViewsLast30d: null,
      netSubscribersLast30d: subs30d || null,
      trend: computeTrend({ views: channelViews7d || 0 }, { views: channelViews30d || 0 }),
    },
    videos: scoredVideos,
    topVideos,
    worstVideos,
    patterns,
    publishingHours: hourAnalysis,
    monetization,
    recommendations,
    summary,
    summaryText: buildSummaryText(summary),
  };
}

function buildVideoReason(video, allVideos, mode) {
  const medianViews = median(allVideos.map((item) => item.views || 0));
  const medianCommentsPer1k = median(allVideos.map((item) => item.commentsPer1kViews || 0));
  const medianDuration = median(allVideos.map((item) => item.averageViewDuration || 0));

  if (mode === 'top') {
    if (video.commentsPer1kViews >= medianCommentsPer1k && video.averageViewDuration >= medianDuration) return 'combina conversación y retención por encima de la media';
    if (video.views >= medianViews && video.commentsPer1kViews >= medianCommentsPer1k) return 'mezcla alcance y comentarios mejor que el resto';
    return 'está por encima de la media en rendimiento relativo';
  }

  if (video.views >= medianViews && video.commentsPer1kViews < medianCommentsPer1k) return 'saca views pero no convierte en comentarios';
  if (video.averageViewDuration < medianDuration) return 'se cae antes que la media en watch time';
  return 'rinde por debajo de la media del canal';
}

function buildHoursSummary(bestRange, worstRange, bestHours) {
  if (!bestRange && !worstRange) return 'No hay suficiente histórico para recomendar horas.';
  const bestHourLabel = bestHours[0]?.label ? ` Mejores horas exactas: ${bestHours.map((row) => row.label).join(', ')}.` : '';
  if (bestRange && worstRange) return `Mejor franja: ${bestRange.label}. Peor franja: ${worstRange.label}.${bestHourLabel}`;
  return `Franja con mejor señal: ${bestRange?.label || worstRange?.label}.${bestHourLabel}`;
}

function buildMonetizationSummary({ currentSubscribers, progressSubscribers, currentShortsViews90d, progressShortsViews, bottleneck, daysToSubs, daysToShorts }) {
  const bottleneckText = bottleneck === 'shorts_views'
    ? 'El cuello de botella actual son las views válidas de Shorts.'
    : bottleneck === 'subscribers'
      ? 'El cuello de botella actual son los suscriptores.'
      : 'Ya estás listo para monetizar por la vía de Shorts.';
  return `Subs: ${currentSubscribers} (${progressSubscribers}%). Shorts 90d: ${Math.round(currentShortsViews90d)} (${progressShortsViews}%). ${bottleneckText} ETA subs: ${daysToSubs ?? 'n/d'} días. ETA Shorts: ${daysToShorts ?? 'n/d'} días.`;
}

function buildSummaryText(summary) {
  return [
    `Estado del canal: ${summary.state}`,
    `Top vídeos: ${summary.topVideos.join(' | ') || 'sin datos'}`,
    `Peores vídeos: ${summary.worstVideos.join(' | ') || 'sin datos'}`,
    `Patrones: ${summary.patterns.join(' | ') || 'sin señal suficiente'}`,
    `Horarios: ${summary.optimalHours}`,
    `Monetización: ${summary.monetization}`,
    `Acciones: ${summary.nextActions.join(' | ') || 'sin acciones claras'}`,
  ].join('\n');
}

function aggregateBy(videos, getKey) {
  return videos.reduce((acc, video) => {
    const key = getKey(video) || 'sin_dato';
    if (!acc[key]) acc[key] = [];
    acc[key].push(video);
    return acc;
  }, {});
}

function finalizeGroups(groups) {
  return Object.entries(groups)
    .map(([label, items]) => ({
      label,
      sampleSize: items.length,
      avgViews: round(avg(items.map((item) => item.views || 0)), 1),
      avgEngagementProxy: round(avg(items.map((item) => item.engagementProxy || 0)), 1),
      avgCommentsPer1kViews: round(avg(items.map((item) => item.commentsPer1kViews || 0)), 2),
      avgPerformanceScore: round(avg(items.map((item) => item.performanceScore || 0)), 1),
    }))
    .sort((a, b) => b.avgPerformanceScore - a.avgPerformanceScore);
}

function comparePatternDimension(winners, losers, key) {
  const winnerCounts = countDimension(winners, key);
  const loserCounts = countDimension(losers, key);
  const labels = [...new Set([...Object.keys(winnerCounts), ...Object.keys(loserCounts)])].filter(Boolean);
  return labels
    .map((label) => ({
      label,
      winnerCount: winnerCounts[label] || 0,
      loserCount: loserCounts[label] || 0,
      winnerShare: winners.length ? round((winnerCounts[label] || 0) / winners.length, 2) : 0,
      loserShare: losers.length ? round((loserCounts[label] || 0) / losers.length, 2) : 0,
      advantage: round(((winnerCounts[label] || 0) / Math.max(winners.length, 1)) - ((loserCounts[label] || 0) / Math.max(losers.length, 1)), 2),
    }))
    .sort((a, b) => b.advantage - a.advantage);
}

function countDimension(videos, key) {
  return videos.reduce((acc, video) => {
    const label = video.internalContext?.[key];
    if (!label) return acc;
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
}

function computeTrend(last7, last30) {
  const avg7 = Number(last7?.views || 0) / 7;
  const avg30 = Number(last30?.views || 0) / 30;
  if (!avg7 || !avg30) return { direction: 'unknown', changePct: null, summary: 'Sin datos suficientes de tendencia.' };
  const delta = ((avg7 - avg30) / avg30) * 100;
  const direction = delta > 12 ? 'up' : delta < -12 ? 'down' : 'flat';
  const summary = direction === 'up'
    ? `El ritmo de views de 7 días está ${round(delta, 1)}% por encima de la media de 30 días.`
    : direction === 'down'
      ? `El ritmo de views de 7 días está ${round(Math.abs(delta), 1)}% por debajo de la media de 30 días.`
      : 'La velocidad de views reciente está estable frente a 30 días.';
  return { direction, changePct: round(delta, 1), summary };
}

function deltaFromHistory(history = [], key, currentValue, days) {
  if (!history.length || currentValue == null) return null;
  const target = Date.now() - days * 24 * 60 * 60 * 1000;
  const baseline = [...history]
    .filter((item) => item?.generatedAt && item[key] != null)
    .sort((a, b) => Math.abs(new Date(a.generatedAt).getTime() - target) - Math.abs(new Date(b.generatedAt).getTime() - target))[0];
  if (!baseline || baseline[key] == null) return null;
  return Number(currentValue) - Number(baseline[key]);
}

function rowToObject(response) {
  const headers = (response?.columnHeaders || []).map((header) => header.name);
  return (response?.rows || []).map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index]])));
}

function formatPublishedSlot(isoString) {
  if (!isoString) return { hourLabel: 'sin_dato', rangeLabel: 'sin_dato' };
  const formatter = new Intl.DateTimeFormat('es-ES', {
    timeZone: ANALYSIS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(isoString));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || '0');
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  const rangeLabel = hour < 6 ? '00:00-06:00' : hour < 12 ? '06:00-12:00' : hour < 18 ? '12:00-18:00' : '18:00-24:00';
  return {
    hourLabel: `${String(hour).padStart(2, '0')}:00`,
    rangeLabel,
    clock: `${String(hour).padStart(2, '0')}:${minute}`,
  };
}

function analyticsEndDate() {
  return shiftDate(new Date().toISOString().slice(0, 10), -2);
}

function shiftDate(baseDate, offsetDays) {
  const date = new Date(`${baseDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function parseISODuration(input) {
  if (!input) return null;
  const match = input.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  return (parseInt(match[1] || '0', 10) * 3600) + (parseInt(match[2] || '0', 10) * 60) + parseInt(match[3] || '0', 10);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function normalize(value, samples) {
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

function avg(values = []) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function median(values = []) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  generateYouTubeChannelAnalysis,
};
