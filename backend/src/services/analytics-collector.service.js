/**
 * analytics-collector.service.js
 *
 * Recopila datos de performance de cada vídeo exportado.
 * - Lee metadata de exports
 * - Acumula en video-performance-log.json
 * - Trigger: cada nuevo export
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const EXPORTS_BASE = path.resolve('./exports');
const ANALYTICS_DIR = path.resolve('./analytics');
const PERFORMANCE_LOG = path.join(ANALYTICS_DIR, 'video-performance-log.json');

/**
 * Asegurar que existen directorios
 */
function ensureAnalyticsDir() {
  if (!fs.existsSync(ANALYTICS_DIR)) {
    fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
  }
}

/**
 * Obtener o crear el log de performance
 */
function initializePerformanceLog() {
  ensureAnalyticsDir();
  if (!fs.existsSync(PERFORMANCE_LOG)) {
    fs.writeFileSync(PERFORMANCE_LOG, JSON.stringify({ videos: [] }, null, 2));
  }
}

/**
 * Extraer datos de un export metadata.json
 */
function extractVideoMetadata(metadataPath) {
  try {
    if (!fs.existsSync(metadataPath)) return null;

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    return {
      videoId: metadata.id,
      hook: metadata.hook,
      hookType: metadata.hookType || 'observable', // default
      topic: metadata.topic,
      duration: metadata.duration,
      viralityScore: metadata.viralityScore,
      formatScore: metadata.formatScore,
      emotionalImpactScore: metadata.emotionalImpactScore,
      publishSlot: metadata.publishSlot || 'unknown',
      exportedAt: metadata.exportedAt,
      createdAt: metadata.createdAt,
    };
  } catch (err) {
    logger.warn(`Failed to extract metadata from ${metadataPath}:`, err.message);
    return null;
  }
}

/**
 * Recopilar un nuevo vídeo en el log
 */
function collectVideoPerformance(metadataPath) {
  try {
    initializePerformanceLog();

    const videoData = extractVideoMetadata(metadataPath);
    if (!videoData) {
      logger.warn('Could not extract video data from export');
      return null;
    }

    // Leer log actual
    const log = JSON.parse(fs.readFileSync(PERFORMANCE_LOG, 'utf8'));

    // Evitar duplicados
    if (log.videos.some(v => v.videoId === videoData.videoId)) {
      logger.warn(`Video ${videoData.videoId} already in log`);
      return null;
    }

    // Agregar nuevo vídeo
    log.videos.push({
      ...videoData,
      collectedAt: new Date().toISOString(),
    });

    // Guardar
    fs.writeFileSync(PERFORMANCE_LOG, JSON.stringify(log, null, 2));

    logger.info(`Video collected: ${videoData.videoId} (virality: ${videoData.viralityScore})`);

    return {
      collected: true,
      totalVideos: log.videos.length,
      shouldAnalyze: log.videos.length % 10 === 0,
    };
  } catch (err) {
    logger.error('Analytics collector error:', { error: err.message });
    return null;
  }
}

/**
 * Obtener todos los vídeos del log
 */
function getPerformanceLog() {
  initializePerformanceLog();
  try {
    const log = JSON.parse(fs.readFileSync(PERFORMANCE_LOG, 'utf8'));
    return log.videos || [];
  } catch (err) {
    logger.error('Failed to read performance log:', err.message);
    return [];
  }
}

/**
 * Limpiar el log (solo para reset completo)
 */
function resetPerformanceLog() {
  try {
    ensureAnalyticsDir();
    fs.writeFileSync(PERFORMANCE_LOG, JSON.stringify({ videos: [] }, null, 2));
    logger.info('Performance log reset');
  } catch (err) {
    logger.error('Failed to reset performance log:', err.message);
  }
}

module.exports = {
  collectVideoPerformance,
  getPerformanceLog,
  resetPerformanceLog,
  extractVideoMetadata,
  PERFORMANCE_LOG,
  ANALYTICS_DIR,
};
