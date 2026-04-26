const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
const CACHE_FILE = path.join(DATA_DIR, 'youtube-integration-cache.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const CACHE_TTL_MS = (parseInt(process.env.YOUTUBE_CACHE_MINUTES || '10', 10) || 10) * 60 * 1000;

function isConfigured() {
  return Boolean((process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_CHANNEL_ID) || (process.env.YOUTUBE_API_KEY && hasOAuthConfig()));
}

async function refreshYouTubeIntegration(videos = []) {
  const cached = getCachedYouTubeIntegration();
  const internalVideos = videos.length ? videos : readInternalVideos();
  if (!isConfigured()) {
    return cached || buildUnavailableState('missing_credentials');
  }

  if (cached && !isCacheStale(cached.generatedAt)) {
    return cached;
  }

  try {
    const channel = await fetchChannelSnapshot();
    const requestedIds = internalVideos.map((video) => video.youtube_id).filter(Boolean);
    const recentUploads = await fetchRecentUploads(channel.uploadsPlaylistId);
    const matchedUploads = matchUploadsToInternalVideos(internalVideos, recentUploads);
    const videoIds = [...new Set([...requestedIds, ...matchedUploads.map((item) => item.youtubeId)])];
    const videoMap = await fetchVideosByIds(videoIds);

    const resolvedVideos = internalVideos.map((video) => {
      const matched = matchedUploads.find((item) => item.internalId === video.id);
      const youtubeId = video.youtube_id || matched?.youtubeId || null;
      const metrics = youtubeId ? videoMap.get(youtubeId) || null : null;
      return {
        internalId: String(video.id || ''),
        youtubeId,
        matchedBy: video.youtube_id ? 'youtube_id' : matched?.matchedBy || 'none',
        title: metrics?.title || matched?.title || video.title || video.hook || '',
        publishedAt: metrics?.publishedAt || matched?.publishedAt || video.published_at || null,
        views: metrics?.views ?? null,
        likes: metrics?.likes ?? null,
        comments: metrics?.comments ?? null,
        durationSeconds: metrics?.durationSeconds ?? null,
      };
    });

    const history = updateHistory(cached?.history || [], channel);
    const payload = {
      generatedAt: new Date().toISOString(),
      status: 'ok',
      source: 'youtube_api',
      channel: buildChannelMetrics(channel, recentUploads, history),
      videos: resolvedVideos,
      history,
    };

    writeJSON(CACHE_FILE, payload);
    return payload;
  } catch (error) {
    logger.warn(`YouTube integration refresh failed: ${error.response?.data?.error?.message || error.message}`);
    return cached || buildUnavailableState(error.message);
  }
}

function readInternalVideos() {
  return readJSON(VIDEOS_FILE, []);
}

function getCachedYouTubeIntegration() {
  return readJSON(CACHE_FILE, null);
}

async function fetchChannelSnapshot() {
  const response = process.env.YOUTUBE_CHANNEL_ID
    ? await youtubeGet('/channels', {
        part: 'snippet,statistics,contentDetails',
        id: process.env.YOUTUBE_CHANNEL_ID,
      })
    : await youtubeGetMine('/channels', {
        part: 'snippet,statistics,contentDetails',
        mine: true,
      });
  const item = response.data?.items?.[0];
  if (!item) throw new Error('youtube_channel_not_found');

  return {
    channelId: item.id,
    title: item.snippet?.title || '',
    publishedAt: item.snippet?.publishedAt || null,
    subscriberCount: toNumber(item.statistics?.subscriberCount),
    viewCount: toNumber(item.statistics?.viewCount),
    videoCount: toNumber(item.statistics?.videoCount),
    hiddenSubscriberCount: Boolean(item.statistics?.hiddenSubscriberCount),
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || null,
  };
}

async function fetchRecentUploads(playlistId) {
  if (!playlistId) return [];
  const playlist = await youtubeGet('/playlistItems', {
    part: 'snippet,contentDetails',
    playlistId,
    maxResults: 50,
  });
  const items = playlist.data?.items || [];
  const ids = items.map((item) => item.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return [];

  const details = await fetchVideosByIds(ids);
  return ids.map((id) => {
    const meta = details.get(id);
    return meta ? { youtubeId: id, ...meta } : null;
  }).filter(Boolean);
}

async function fetchVideosByIds(ids = []) {
  const map = new Map();
  const chunks = chunk(ids.filter(Boolean), 50);
  for (const idsChunk of chunks) {
    const response = await youtubeGet('/videos', {
      part: 'snippet,statistics,contentDetails',
      id: idsChunk.join(','),
      maxResults: idsChunk.length,
    });
    (response.data?.items || []).forEach((item) => {
      map.set(item.id, {
        title: item.snippet?.title || '',
        publishedAt: item.snippet?.publishedAt || null,
        views: toNumber(item.statistics?.viewCount),
        likes: toNumber(item.statistics?.likeCount),
        comments: toNumber(item.statistics?.commentCount),
        durationSeconds: parseISODuration(item.contentDetails?.duration),
      });
    });
  }
  return map;
}

function buildChannelMetrics(channel, uploads, history) {
  const uploads90d = uploads.filter((item) => {
    if (!item.publishedAt) return false;
    return Date.now() - new Date(item.publishedAt).getTime() <= 90 * 24 * 60 * 60 * 1000;
  });
  const shortsViews90d = uploads90d.reduce((sum, item) => sum + (item.views || 0), 0);
  const weeklyBaseline = findHistorySnapshot(history, 7);
  const monthlyBaseline = findHistorySnapshot(history, 30);
  const weeklySubscriberDelta = weeklyBaseline ? channel.subscriberCount - weeklyBaseline.subscriberCount : null;
  const weeklyViewDelta = weeklyBaseline ? channel.viewCount - weeklyBaseline.viewCount : null;
  const monthlyViewDelta = monthlyBaseline ? channel.viewCount - monthlyBaseline.viewCount : null;

  return {
    channelId: channel.channelId,
    title: channel.title,
    publishedAt: channel.publishedAt,
    subscriberCount: channel.hiddenSubscriberCount ? null : channel.subscriberCount,
    viewCount: channel.viewCount,
    videoCount: channel.videoCount,
    shortsViews90d,
    weeklySubscriberDelta,
    weeklyViewDelta,
    monthlyViewDelta,
    dataSources: {
      subscriberCount: channel.hiddenSubscriberCount ? 'unavailable' : 'youtube',
      viewCount: 'youtube',
      videoCount: 'youtube',
      shortsViews90d: 'youtube_estimated_from_recent_uploads',
    },
  };
}

function matchUploadsToInternalVideos(videos = [], uploads = []) {
  const freeUploads = [...uploads];
  const matches = [];

  videos.forEach((video) => {
    if (video.youtube_id) return;
    const internalTitle = normalizeText(video.title || video.hook || video.script?.hook || '');
    const internalPublished = video.published_at ? new Date(video.published_at).getTime() : null;

    let best = null;
    let bestScore = 0;

    freeUploads.forEach((upload) => {
      const uploadTitle = normalizeText(upload.title || '');
      let score = 0;
      if (internalTitle && uploadTitle) {
        if (uploadTitle.includes(internalTitle) || internalTitle.includes(uploadTitle)) score += 5;
        if (sharedPrefix(uploadTitle, internalTitle) >= 18) score += 3;
      }
      if (internalPublished && upload.publishedAt) {
        const hoursDiff = Math.abs(internalPublished - new Date(upload.publishedAt).getTime()) / 3600000;
        if (hoursDiff <= 24) score += 3;
        else if (hoursDiff <= 72) score += 2;
      }
      if (score > bestScore) {
        best = upload;
        bestScore = score;
      }
    });

    if (best && bestScore >= 4) {
      matches.push({
        internalId: String(video.id || ''),
        youtubeId: best.youtubeId,
        matchedBy: 'title_timestamp_heuristic',
        title: best.title,
        publishedAt: best.publishedAt,
      });
    }
  });

  return matches;
}

function updateHistory(history = [], channel) {
  const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
  const normalized = history.filter((item) => item?.generatedAt && new Date(item.generatedAt).getTime() >= cutoff);
  normalized.push({
    generatedAt: new Date().toISOString(),
    subscriberCount: channel.subscriberCount,
    viewCount: channel.viewCount,
    videoCount: channel.videoCount,
  });
  return normalized.slice(-120);
}

function findHistorySnapshot(history = [], daysBack) {
  const target = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  return [...history]
    .filter((item) => item?.generatedAt)
    .sort((a, b) => Math.abs(new Date(a.generatedAt).getTime() - target) - Math.abs(new Date(b.generatedAt).getTime() - target))[0] || null;
}

function buildUnavailableState(reason) {
  return {
    generatedAt: new Date().toISOString(),
    status: 'unavailable',
    source: 'fallback',
    reason,
    channel: null,
    videos: [],
    history: [],
  };
}

function isCacheStale(generatedAt) {
  if (!generatedAt) return true;
  return Date.now() - new Date(generatedAt).getTime() > CACHE_TTL_MS;
}

function hasOAuthConfig() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);
}

async function youtubeGet(endpoint, params) {
  return axios.get(`https://www.googleapis.com/youtube/v3${endpoint}`, {
    params: {
      ...params,
      key: process.env.YOUTUBE_API_KEY,
    },
    timeout: 15000,
  });
}

async function youtubeGetMine(endpoint, params) {
  const accessToken = await getYouTubeAccessToken();
  return axios.get(`https://www.googleapis.com/youtube/v3${endpoint}`, {
    params,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 15000,
  });
}

async function getYouTubeAccessToken() {
  const response = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }, {
    timeout: 15000,
  });

  if (!response.data?.access_token) throw new Error('youtube_oauth_access_token_missing');
  return response.data.access_token;
}

function parseISODuration(input) {
  if (!input) return null;
  const match = input.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return (hours * 3600) + (minutes * 60) + seconds;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sharedPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
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
  getCachedYouTubeIntegration,
  isConfigured,
  refreshYouTubeIntegration,
};
