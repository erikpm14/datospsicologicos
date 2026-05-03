/**
 * performance-tracker.service.js
 * Tracking de rendimiento de vídeos sin modificar pipeline
 *
 * Registra:
 * - Hook usado + pattern
 * - Topic + viralityTier
 * - Duración
 * - Fecha publicación + videoId
 *
 * Propósito: Analizar qué hooks/temas generan más views
 *
 * Uso:
 * const tracker = require('./performance-tracker.service');
 * await tracker.trackScriptGeneration(script);
 * await tracker.trackVideoRender(videoId, duration);
 * await tracker.trackPublish(videoId, youtubeId, publishDate);
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve('./data');
const PERFORMANCE_FILE = path.join(DATA_DIR, 'video-performance.json');

// Asegurar que el directorio existe
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Cargar el archivo de performance actual
function loadPerformanceData() {
  try {
    ensureDataDir();
    if (fs.existsSync(PERFORMANCE_FILE)) {
      const content = fs.readFileSync(PERFORMANCE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    logger.warn(`[performance-tracker] Error loading performance data: ${err.message}`);
  }
  return { videos: [], metadata: { lastUpdate: null, totalTracked: 0 } };
}

// Guardar el archivo de performance
function savePerformanceData(data) {
  try {
    ensureDataDir();
    fs.writeFileSync(PERFORMANCE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error(`[performance-tracker] Error saving performance data: ${err.message}`);
  }
}

// Registrar información de generación de script
async function trackScriptGeneration(script = {}) {
  try {
    const data = loadPerformanceData();

    const entry = {
      videoId: script.videoId || null,
      hook: script.hook || null,
      pattern_used: script.pattern_used || null,
      topic: script.topic || null,
      viralityTier: null, // Se completará en publish
      duration: null,
      publishedAt: null,
      youtubeId: null,
      generatedAt: new Date().toISOString(),
      source: 'script_generation',
    };

    data.videos.push(entry);
    data.metadata.lastUpdate = new Date().toISOString();
    data.metadata.totalTracked = data.videos.length;

    savePerformanceData(data);

    logger.info(`[performance-tracker] ✓ Script tracked | hook="${script.hook?.substring(0, 30)}..." | topic=${script.topic}`);
    return entry;
  } catch (err) {
    logger.error(`[performance-tracker] Error tracking script: ${err.message}`);
    return null;
  }
}

// Registrar duración del vídeo renderizado
async function trackVideoRender(videoId, duration, metadata = {}) {
  try {
    const data = loadPerformanceData();

    // Buscar la entrada más reciente con este videoId o sin completar
    let entry = data.videos.find(v => v.videoId === videoId);

    if (!entry) {
      // Si no existe, crear una nueva
      entry = {
        videoId,
        hook: null,
        pattern_used: null,
        topic: null,
        viralityTier: null,
        duration: null,
        publishedAt: null,
        youtubeId: null,
        generatedAt: new Date().toISOString(),
        source: 'video_render',
      };
      data.videos.push(entry);
    }

    // Actualizar duración
    entry.duration = duration;
    entry.renderedAt = new Date().toISOString();

    // Agregar virality tier si viene en metadata
    if (metadata.viralityTier) {
      entry.viralityTier = metadata.viralityTier;
    }

    data.metadata.lastUpdate = new Date().toISOString();
    savePerformanceData(data);

    logger.info(`[performance-tracker] ✓ Video render tracked | videoId=${videoId} | duration=${duration}s`);
    return entry;
  } catch (err) {
    logger.error(`[performance-tracker] Error tracking render: ${err.message}`);
    return null;
  }
}

// Registrar publicación en YouTube
async function trackPublish(videoId, youtubeId, publishDate = null) {
  try {
    const data = loadPerformanceData();

    // Buscar la entrada con este videoId
    let entry = data.videos.find(v => v.videoId === videoId);

    if (!entry) {
      // Si no existe, crear una nueva
      entry = {
        videoId,
        hook: null,
        pattern_used: null,
        topic: null,
        viralityTier: null,
        duration: null,
        publishedAt: null,
        youtubeId: null,
        generatedAt: new Date().toISOString(),
        source: 'publish',
      };
      data.videos.push(entry);
    }

    // Actualizar información de publicación
    entry.youtubeId = youtubeId;
    entry.publishedAt = publishDate || new Date().toISOString();

    data.metadata.lastUpdate = new Date().toISOString();
    savePerformanceData(data);

    logger.info(`[performance-tracker] ✓ Publish tracked | videoId=${videoId} | youtubeId=${youtubeId}`);
    return entry;
  } catch (err) {
    logger.error(`[performance-tracker] Error tracking publish: ${err.message}`);
    return null;
  }
}

// Analizar performance
function getPerformanceAnalysis() {
  try {
    const data = loadPerformanceData();
    const videos = data.videos || [];

    if (videos.length === 0) {
      return {
        totalVideos: 0,
        byHook: {},
        byTopic: {},
        byTier: {},
        analysis: 'No data yet',
      };
    }

    // Agrupar por hook
    const byHook = {};
    videos.forEach(v => {
      const hook = v.hook || 'UNKNOWN';
      if (!byHook[hook]) {
        byHook[hook] = { count: 0, published: 0, avgDuration: 0, durations: [] };
      }
      byHook[hook].count++;
      if (v.youtubeId) byHook[hook].published++;
      if (v.duration) byHook[hook].durations.push(v.duration);
    });

    // Calcular promedio de duración
    Object.keys(byHook).forEach(hook => {
      const durations = byHook[hook].durations;
      if (durations.length > 0) {
        byHook[hook].avgDuration = (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1);
      }
      delete byHook[hook].durations;
    });

    // Agrupar por topic
    const byTopic = {};
    videos.forEach(v => {
      const topic = v.topic || 'UNKNOWN';
      if (!byTopic[topic]) {
        byTopic[topic] = { count: 0, published: 0, avgDuration: 0, durations: [] };
      }
      byTopic[topic].count++;
      if (v.youtubeId) byTopic[topic].published++;
      if (v.duration) byTopic[topic].durations.push(v.duration);
    });

    Object.keys(byTopic).forEach(topic => {
      const durations = byTopic[topic].durations;
      if (durations.length > 0) {
        byTopic[topic].avgDuration = (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1);
      }
      delete byTopic[topic].durations;
    });

    // Agrupar por virality tier
    const byTier = {};
    videos.forEach(v => {
      const tier = v.viralityTier || 'UNKNOWN';
      if (!byTier[tier]) {
        byTier[tier] = { count: 0, published: 0 };
      }
      byTier[tier].count++;
      if (v.youtubeId) byTier[tier].published++;
    });

    return {
      totalVideos: videos.length,
      published: videos.filter(v => v.youtubeId).length,
      byHook,
      byTopic,
      byTier,
    };
  } catch (err) {
    logger.error(`[performance-tracker] Error analyzing performance: ${err.message}`);
    return { error: err.message };
  }
}

// Obtener top hooks por publicaciones exitosas
function getTopHooks(limit = 5) {
  try {
    const analysis = getPerformanceAnalysis();
    const hooks = Object.entries(analysis.byHook || {})
      .map(([hook, stats]) => ({
        hook,
        count: stats.count,
        published: stats.published,
        publicationRate: ((stats.published / stats.count) * 100).toFixed(1),
        avgDuration: stats.avgDuration,
      }))
      .sort((a, b) => b.published - a.published)
      .slice(0, limit);

    return hooks;
  } catch (err) {
    logger.error(`[performance-tracker] Error getting top hooks: ${err.message}`);
    return [];
  }
}

// Obtener top topics
function getTopTopics(limit = 5) {
  try {
    const analysis = getPerformanceAnalysis();
    const topics = Object.entries(analysis.byTopic || {})
      .map(([topic, stats]) => ({
        topic,
        count: stats.count,
        published: stats.published,
        publicationRate: ((stats.published / stats.count) * 100).toFixed(1),
        avgDuration: stats.avgDuration,
      }))
      .sort((a, b) => b.published - a.published)
      .slice(0, limit);

    return topics;
  } catch (err) {
    logger.error(`[performance-tracker] Error getting top topics: ${err.message}`);
    return [];
  }
}

// Exportar datos para dashboard
function exportDashboardData() {
  try {
    const data = loadPerformanceData();
    const analysis = getPerformanceAnalysis();

    return {
      summary: {
        totalTracked: data.metadata.totalTracked,
        lastUpdate: data.metadata.lastUpdate,
        published: analysis.published,
        pending: (analysis.totalVideos - analysis.published),
      },
      analysis,
      topHooks: getTopHooks(10),
      topTopics: getTopTopics(10),
      rawData: data.videos.slice(-50), // Últimos 50 vídeos
    };
  } catch (err) {
    logger.error(`[performance-tracker] Error exporting dashboard: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = {
  trackScriptGeneration,
  trackVideoRender,
  trackPublish,
  getPerformanceAnalysis,
  getTopHooks,
  getTopTopics,
  exportDashboardData,
  loadPerformanceData,
  PERFORMANCE_FILE,
};
