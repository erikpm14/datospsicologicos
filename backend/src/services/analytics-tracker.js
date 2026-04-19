/**
 * analytics-tracker.js
 * Base de datos en JSON (sin dependencias nativas).
 * Guarda videos y métricas en archivos JSON locales.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(path.dirname(process.env.SQLITE_DB_PATH || './data/db'), '.');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const METRICS_FILE = path.join(DATA_DIR, 'metrics.json');

// ─────────────────────────────────────────────
//  HELPERS DE LECTURA/ESCRITURA
// ─────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, defaultValue = []) {
  try {
    if (!fs.existsSync(file)) return defaultValue;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────

function initializeDatabase() {
  ensureDataDir();
  if (!fs.existsSync(VIDEOS_FILE)) writeJSON(VIDEOS_FILE, []);
  if (!fs.existsSync(METRICS_FILE)) writeJSON(METRICS_FILE, []);
  logger.info(`JSON database ready: ${DATA_DIR}`);
}

// ─────────────────────────────────────────────
//  VIDEOS
// ─────────────────────────────────────────────

function saveVideo(videoData) {
  const videos = readJSON(VIDEOS_FILE);
  const existing = videos.findIndex((v) => v.id === videoData.id);
  const record = {
    id: videoData.id,
    title: videoData.title,
    topic: videoData.topic,
    hook: videoData.hook,
    virality_score: videoData.viralityScore,
    tiktok_id: videoData.tiktokId || null,
    instagram_id: videoData.instagramId || null,
    youtube_id: videoData.youtubeId || null,
    theme_id: videoData.themeId,
    script_json: videoData.script,
    status: 'published',
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  if (existing >= 0) {
    videos[existing] = { ...videos[existing], ...record };
  } else {
    videos.push(record);
  }

  writeJSON(VIDEOS_FILE, videos);
  logger.info(`Video saved: ${videoData.id}`);
}

// ─────────────────────────────────────────────
//  MÉTRICAS
// ─────────────────────────────────────────────

function insertMetric({ videoId, platform, views, likes, comments, shares, engagementRate }) {
  const metrics = readJSON(METRICS_FILE);
  metrics.push({
    id: Date.now(),
    video_id: videoId,
    platform,
    recorded_at: new Date().toISOString(),
    views,
    likes,
    comments,
    shares,
    engagement_rate: parseFloat(engagementRate.toFixed(2)),
  });

  // Mantiene solo últimos 10.000 registros
  if (metrics.length > 10000) metrics.splice(0, metrics.length - 10000);
  writeJSON(METRICS_FILE, metrics);
}

// ─────────────────────────────────────────────
//  POLLING
// ─────────────────────────────────────────────

async function pollAllMetrics() {
  logger.info('Starting metrics polling...');
  const videos = readJSON(VIDEOS_FILE).filter((v) => v.status === 'published');
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recent = videos.filter((v) => v.published_at > cutoff);

  for (const video of recent) {
    await Promise.allSettled([
      video.tiktok_id ? pollTikTokMetrics(video) : null,
      video.instagram_id ? pollInstagramMetrics(video) : null,
      video.youtube_id ? pollYouTubeMetrics(video) : null,
    ]);
  }
  logger.info(`Metrics polling done: ${recent.length} videos`);

  // Después de actualizar métricas, evaluar experimentos A/B
  try {
    const { evaluateExperiments } = require('./ab-test-engine');
    const updatedVideos = readJSON(VIDEOS_FILE);
    evaluateExperiments(updatedVideos);
  } catch (abErr) {
    logger.warn(`AB evaluation failed: ${abErr.message}`);
  }

  // Detección temprana de ganadores A/B
  try {
    const { detectEarlyWinners } = require('./early-winner-detector');
    detectEarlyWinners();
  } catch (ewErr) {
    logger.warn(`Early winner detection failed: ${ewErr.message}`);
  }

  // Reconstruir matriz de aprendizaje contextual
  try {
    const { rebuildMatrix } = require('./context-learner');
    rebuildMatrix();
  } catch (clErr) {
    logger.warn(`Context learner rebuild failed: ${clErr.message}`);
  }

  // Clasificar vídeos WINNER/MEDIO/FLOP
  try {
    const { classifyAllVideos } = require('./video-classifier');
    classifyAllVideos();
  } catch (vcErr) {
    logger.warn(`Video classifier failed: ${vcErr.message}`);
  }

  // Minar patrones de hooks ganadores
  try {
    const { minePatterns } = require('./pattern-miner');
    minePatterns();
  } catch (pmErr) {
    logger.warn(`Pattern miner failed: ${pmErr.message}`);
  }

  // Análisis avanzado de rendimiento de hooks → top-hooks.json + insights
  try {
    const { analyzeHookPerformance } = require('./hook-performance-analyzer');
    analyzeHookPerformance();
  } catch (haErr) {
    logger.warn(`Hook performance analysis failed: ${haErr.message}`);
  }

  // Explotar winners detectados automáticamente
  try {
    const { exploitWinningHooks } = require('./hook-performance-analyzer');
    exploitWinningHooks().catch(err => logger.warn(`exploitWinningHooks async error: ${err.message}`));
  } catch (ewErr) {
    logger.warn(`exploitWinningHooks failed: ${ewErr.message}`);
  }
}

async function pollTikTokMetrics(video) {
  try {
    const res = await axios.post(
      'https://open.tiktokapis.com/v2/video/query/',
      { filters: { video_ids: [video.tiktok_id] }, fields: ['id', 'view_count', 'like_count', 'comment_count', 'share_count'] },
      { headers: { Authorization: `Bearer ${process.env.TIKTOK_ACCESS_TOKEN}` }, timeout: 15000 }
    );
    const d = res.data?.data?.videos?.[0];
    if (!d) return;
    const er = d.view_count > 0 ? ((d.like_count + d.comment_count + d.share_count) / d.view_count) * 100 : 0;
    insertMetric({ videoId: video.id, platform: 'tiktok', views: d.view_count, likes: d.like_count, comments: d.comment_count, shares: d.share_count, engagementRate: er });
  } catch (err) {
    logger.error(`TikTok poll failed: ${err.message}`);
  }
}

async function pollInstagramMetrics(video) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v19.0/${video.instagram_id}/insights`, {
      params: { metric: 'plays,likes,comments,shares,reach', access_token: process.env.INSTAGRAM_ACCESS_TOKEN },
      timeout: 15000,
    });
    const m = {};
    for (const item of res.data.data) m[item.name] = item.values?.[0]?.value || 0;
    const er = m.reach > 0 ? ((m.likes + m.comments + m.shares) / m.reach) * 100 : 0;
    insertMetric({ videoId: video.id, platform: 'instagram', views: m.plays || 0, likes: m.likes || 0, comments: m.comments || 0, shares: m.shares || 0, engagementRate: er });
  } catch (err) {
    logger.error(`Instagram poll failed: ${err.message}`);
  }
}

async function pollYouTubeMetrics(video) {
  try {
    const token = await refreshYouTubeToken();
    const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { id: video.youtube_id, part: 'statistics' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    const s = res.data.items?.[0]?.statistics;
    if (!s) return;
    const views = parseInt(s.viewCount || 0);
    const likes = parseInt(s.likeCount || 0);
    const comments = parseInt(s.commentCount || 0);
    const er = views > 0 ? ((likes + comments) / views) * 100 : 0;
    insertMetric({ videoId: video.id, platform: 'youtube', views, likes, comments, shares: 0, engagementRate: er });
  } catch (err) {
    logger.error(`YouTube poll failed: ${err.message}`);
  }
}

async function refreshYouTubeToken() {
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  return res.data.access_token;
}

// ─────────────────────────────────────────────
//  DASHBOARD STATS
// ─────────────────────────────────────────────

function getDashboardStats() {
  const videos = readJSON(VIDEOS_FILE);
  const metrics = readJSON(METRICS_FILE);

  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentMetrics = metrics.filter((m) => m.recorded_at > cutoff30);

  const totalViews = recentMetrics.reduce((s, m) => s + (m.views || 0), 0);
  const avgEngagement = recentMetrics.length
    ? recentMetrics.reduce((s, m) => s + (m.engagement_rate || 0), 0) / recentMetrics.length
    : 0;

  // Top videos por views máximos
  const videoMaxViews = {};
  for (const m of metrics) {
    if (!videoMaxViews[m.video_id] || m.views > videoMaxViews[m.video_id].views) {
      videoMaxViews[m.video_id] = m;
    }
  }

  const topVideos = videos
    .map((v) => ({ ...v, max_views: videoMaxViews[v.id]?.views || 0, max_engagement: videoMaxViews[v.id]?.engagement_rate || 0 }))
    .sort((a, b) => b.max_views - a.max_views)
    .slice(0, 5);

  // Métricas por plataforma y día (últimos 7 días)
  const recentByDay = metrics
    .filter((m) => m.recorded_at > cutoff7)
    .reduce((acc, m) => {
      const date = m.recorded_at.split('T')[0];
      const key = `${m.platform}_${date}`;
      if (!acc[key]) acc[key] = { platform: m.platform, date, views: 0, likes: 0 };
      acc[key].views += m.views || 0;
      acc[key].likes += m.likes || 0;
      return acc;
    }, {});

  return {
    totals: { total_videos: videos.length, total_views: totalViews, avg_engagement: avgEngagement.toFixed(2) },
    topVideos,
    recentMetrics: Object.values(recentByDay).sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// ─────────────────────────────────────────────
//  FULL ANALYTICS (para el nuevo dashboard)
// ─────────────────────────────────────────────

function getFullAnalytics() {
  const videos  = readJSON(VIDEOS_FILE);
  const metrics = readJSON(METRICS_FILE);
  const now     = Date.now();
  const cutoff30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // --- Max métricas por video (mejor snapshot histórico) ---
  const videoMax = {};
  for (const m of metrics) {
    if (!videoMax[m.video_id] || m.views > (videoMax[m.video_id].views || 0)) {
      videoMax[m.video_id] = m;
    }
  }

  // --- Videos enriquecidos ---
  const enriched = videos.map((v) => {
    const mx = videoMax[v.id] || {};
    return {
      ...v,
      max_views:      mx.views           || 0,
      max_engagement: mx.engagement_rate || 0,
      max_likes:      mx.likes           || 0,
      max_comments:   mx.comments        || 0,
      script:         v.script_json      || {},
    };
  });

  // --- KPIs globales ---
  const totalViews  = enriched.reduce((s, v) => s + v.max_views, 0);
  const avgEng      = enriched.length
    ? parseFloat((enriched.reduce((s, v) => s + v.max_engagement, 0) / enriched.length).toFixed(2))
    : 0;
  const avgScore    = enriched.length
    ? Math.round(enriched.reduce((s, v) => s + (v.virality_score || 0), 0) / enriched.length)
    : 0;
  const bestVideo   = [...enriched].sort((a, b) => b.max_views - a.max_views)[0];

  // --- Topic performance ---
  const topicMap = {};
  for (const v of enriched) {
    const t = v.topic || 'unknown';
    if (!topicMap[t]) topicMap[t] = { topic: t, count: 0, totalViews: 0, totalEng: 0, totalScore: 0 };
    topicMap[t].count++;
    topicMap[t].totalViews += v.max_views;
    topicMap[t].totalEng   += v.max_engagement;
    topicMap[t].totalScore += v.virality_score || 0;
  }
  const topicPerformance = Object.values(topicMap).map((t) => ({
    topic:         t.topic,
    count:         t.count,
    avgViews:      t.count ? Math.round(t.totalViews / t.count) : 0,
    avgEngagement: t.count ? parseFloat((t.totalEng / t.count).toFixed(2)) : 0,
    avgScore:      t.count ? Math.round(t.totalScore / t.count) : 0,
    totalViews:    t.totalViews,
  })).sort((a, b) => b.avgViews - a.avgViews);

  // --- Duration analysis ---
  const dBucketsClean = { '0-30s': [], '30-45s': [], '45-60s': [], '60+s': [] };
  for (const v of enriched) {
    const d = v.script?.durationSeconds || 0;
    const b = d <= 30 ? '0-30s' : d <= 45 ? '30-45s' : d <= 60 ? '45-60s' : '60+s';
    dBucketsClean[b].push(v);
  }
  const durationAnalysis = Object.entries(dBucketsClean).map(([range, vs]) => ({
    range,
    count:         vs.length,
    avgViews:      vs.length ? Math.round(vs.reduce((s, v) => s + v.max_views, 0) / vs.length) : 0,
    avgEngagement: vs.length ? parseFloat((vs.reduce((s, v) => s + v.max_engagement, 0) / vs.length).toFixed(2)) : 0,
    avgScore:      vs.length ? Math.round(vs.reduce((s, v) => s + (v.virality_score || 0), 0) / vs.length) : 0,
  }));

  // --- Score breakdown average ---
  const breakdowns = enriched.filter((v) => v.script?.viralityBreakdown).map((v) => v.script.viralityBreakdown);
  const avgBreakdown = breakdowns.length ? {
    hookStrength:    Math.round(breakdowns.reduce((s, b) => s + (b.hookStrength    || 0), 0) / breakdowns.length),
    emotionalTrigger:Math.round(breakdowns.reduce((s, b) => s + (b.emotionalTrigger|| 0), 0) / breakdowns.length),
    relatability:    Math.round(breakdowns.reduce((s, b) => s + (b.relatability    || 0), 0) / breakdowns.length),
    loopPotential:   Math.round(breakdowns.reduce((s, b) => s + (b.loopPotential   || 0), 0) / breakdowns.length),
    durationBonus:   Math.round(breakdowns.reduce((s, b) => s + (b.durationBonus   || 0), 0) / breakdowns.length),
    maxHookStrength: 30, maxEmotionalTrigger: 25, maxRelatability: 20, maxLoopPotential: 15, maxDurationBonus: 10,
  } : null;

  // --- 30-day trend (por día) ---
  const trendMap = {};
  for (const m of metrics.filter((m) => m.recorded_at > cutoff30)) {
    const date = m.recorded_at.split('T')[0];
    if (!trendMap[date]) trendMap[date] = { date, views: 0, likes: 0, comments: 0, engSum: 0, count: 0 };
    trendMap[date].views    += m.views    || 0;
    trendMap[date].likes    += m.likes    || 0;
    trendMap[date].comments += m.comments || 0;
    trendMap[date].engSum   += m.engagement_rate || 0;
    trendMap[date].count++;
  }
  const trend30 = Object.values(trendMap).sort((a, b) => a.date > b.date ? 1 : -1).map((d) => ({
    date:          d.date,
    views:         d.views,
    likes:         d.likes,
    comments:      d.comments,
    avgEngagement: d.count ? parseFloat((d.engSum / d.count).toFixed(2)) : 0,
  }));

  // --- Platform breakdown ---
  const platMap = {};
  for (const m of metrics) {
    if (!platMap[m.platform]) platMap[m.platform] = { platform: m.platform, views: 0, likes: 0, comments: 0 };
    platMap[m.platform].views    += m.views    || 0;
    platMap[m.platform].likes    += m.likes    || 0;
    platMap[m.platform].comments += m.comments || 0;
  }
  const platformTotals = Object.values(platMap);

  // --- All videos (para lista detallada) ---
  const allVideos = [...enriched].sort((a, b) => b.max_views - a.max_views).map((v) => ({
    id:               v.id,
    hook:             v.hook,
    topic:            v.topic,
    virality_score:   v.virality_score,
    youtube_id:       v.youtube_id,
    tiktok_id:        v.tiktok_id,
    instagram_id:     v.instagram_id,
    published_at:     v.published_at,
    max_views:        v.max_views,
    max_engagement:   v.max_engagement,
    max_likes:        v.max_likes,
    max_comments:     v.max_comments,
    durationSeconds:  v.script?.durationSeconds,
    emotionalTrigger: v.script?.emotionalTrigger,
    viralTrigger:     v.script?.viralTrigger,
    viralityBreakdown:v.script?.viralityBreakdown,
    psychologicalFact:v.script?.psychologicalFact,
    hook_text:        v.script?.hook,
    claim:            v.script?.claim,
    cta:              v.script?.cta,
  }));

  // --- 7-day quick trend (para el overview) ---
  const cutoff7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const trend7Map = {};
  for (const m of metrics.filter((m) => m.recorded_at > cutoff7)) {
    const date = m.recorded_at.split('T')[0];
    if (!trend7Map[date]) trend7Map[date] = { date, views: 0 };
    trend7Map[date].views += m.views || 0;
  }
  const trend7 = Object.values(trend7Map).sort((a, b) => a.date > b.date ? 1 : -1);

  return {
    kpis: {
      totalVideos:    videos.length,
      totalViews,
      avgEngagement:  avgEng,
      avgScore,
      bestVideo: bestVideo ? {
        hook:  bestVideo.hook,
        views: bestVideo.max_views,
        topic: bestVideo.topic,
        score: bestVideo.virality_score,
      } : null,
    },
    topicPerformance,
    durationAnalysis,
    avgBreakdown,
    trend30,
    trend7,
    platformTotals,
    allVideos,
    topVideos: allVideos.slice(0, 5),
    bottomVideos: [...allVideos].sort((a, b) => a.max_views - b.max_views).filter((v) => v.max_views > 0).slice(0, 3),
  };
}

module.exports = { initializeDatabase, saveVideo, insertMetric, pollAllMetrics, getDashboardStats, getFullAnalytics };
