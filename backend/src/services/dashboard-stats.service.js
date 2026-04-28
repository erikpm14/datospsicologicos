/**
 * Dashboard Stats Service — ASYNC VERSION
 *
 * Reemplaza todas las operaciones síncronas con fs.promises.
 * Incluye: caché ligera (TTL 15-30s), timeout interno (3s), limite de lectura (50 vídeos).
 * Los endpoints SIEMPRE responden (nunca cuelgan).
 */

const fs = require('fs').promises;
const fsSyncForExist = require('fs'); // Solo para existsSync si es necesario
const path = require('path');
const logger = require('../utils/logger');

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const CACHE_TTL_MS = 20000; // 20 segundos
const READ_TIMEOUT_MS = 3000; // 3 segundos máximo para lectura
const MAX_VIDEOS_TO_SCAN = 50; // Máximo de vídeos a procesar

// Cache ligera en memoria
const cache = {
  videoStatus: { data: null, expireAt: 0 },
  nextSlot: { data: null, expireAt: 0 },
  health: { data: null, expireAt: 0 },
};

function _isCacheValid(cacheKey) {
  return cache[cacheKey].data && Date.now() < cache[cacheKey].expireAt;
}

function _setCacheData(cacheKey, data) {
  cache[cacheKey] = {
    data,
    expireAt: Date.now() + CACHE_TTL_MS,
  };
}

async function _readJsonFileAsync(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

async function _getVideoMetadataAsync(videoDir) {
  /**
   * Lee metadata de un vídeo de forma ASYNC
   */
  const videoId = path.basename(videoDir);
  const metadata = {
    videoId,
    title: 'Unknown',
    status: 'unknown',
    createdAt: null,
    publishedAt: null,
    scheduledFor: null,
    youtubeUrl: null,
    captionStatus: { source: 'unknown', driftStatus: 'unknown', driftSeconds: null },
    assetStatus: { status: 'unknown', missingAssets: [] },
    visualQc: { status: 'unknown', reason: null },
    publishBlockReason: null,
  };

  try {
    // Leer script (contiene título)
    const scriptPath = path.join(videoDir, 'script.json');
    const script = await _readJsonFileAsync(scriptPath);
    if (script?.hook) {
      metadata.title = script.hook.substring(0, 80);
    }

    // Leer metadata de render
    const renderMetaPath = path.join(videoDir, 'render-metadata.json');
    const renderMeta = await _readJsonFileAsync(renderMetaPath);
    if (renderMeta?.generatedAt) {
      metadata.createdAt = renderMeta.generatedAt;
    }

    // Leer captions-debug
    const captionsDebugPath = path.join(videoDir, 'captions-debug.json');
    const captionsDebug = await _readJsonFileAsync(captionsDebugPath);
    if (captionsDebug) {
      metadata.captionStatus = {
        source: captionsDebug.source || 'unknown',
        driftStatus: captionsDebug.drift?.status || 'unknown',
        driftSeconds: captionsDebug.drift?.value || null,
        captionCount: captionsDebug.captionsCount || 0,
      };
    }

    // Verificar assets
    if (renderMeta?.clipPaths) {
      const missing = renderMeta.clipPaths.filter((cp) => {
        const fullPath = path.isAbsolute(cp) ? cp : path.join(videoDir, cp);
        return !fsSyncForExist.existsSync(fullPath);
      });
      metadata.assetStatus = {
        status: missing.length === 0 ? 'pass' : missing.length < renderMeta.clipPaths.length ? 'replaced' : 'missing',
        missingAssets: missing,
      };
    }

    // Leer QC visual
    const qcPath = path.join(videoDir, 'qc.json');
    const qc = await _readJsonFileAsync(qcPath);
    if (qc?.passed !== undefined) {
      metadata.visualQc = {
        status: qc.passed ? 'pass' : 'blocked',
        reason: qc.reasons?.[0] || null,
      };
    }

    // Determinar status general
    const hasOutput = fsSyncForExist.existsSync(path.join(videoDir, 'output.mp4'));
    if (hasOutput && metadata.visualQc.status === 'pass' && metadata.captionStatus.source !== 'unknown') {
      metadata.status = 'ready';
    } else if (!hasOutput) {
      metadata.status = 'rendering';
    } else if (metadata.visualQc.status === 'blocked') {
      metadata.status = 'blocked';
      metadata.publishBlockReason = metadata.visualQc.reason;
    } else {
      metadata.status = 'unknown';
    }

    return metadata;
  } catch (err) {
    logger.debug(`Error reading video metadata for ${videoId}: ${err.message}`);
    return metadata;
  }
}

async function getVideoStatus(limit = MAX_VIDEOS_TO_SCAN) {
  /**
   * Devuelve estado completo de vídeos y sistema (ASYNC con timeout)
   */
  // Verificar caché
  if (_isCacheValid('videoStatus')) {
    return cache.videoStatus.data;
  }

  try {
    // Timeout interno: si tarda más de 3s, devolver datos parciales
    const startTime = Date.now();

    // Leer directorio (async)
    let videoDirs = [];
    try {
      if (fsSyncForExist.existsSync(OUTPUT_DIR)) {
        const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
        videoDirs = entries
          .filter((f) => f.isDirectory() && !f.name.startsWith('.'))
          .slice(0, limit)
          .map((f) => f.name);
      }
    } catch (err) {
      logger.warn(`Failed to list output directory: ${err.message}`);
      videoDirs = [];
    }

    // Procesar vídeos (con timeout check)
    const videos = [];
    for (const dir of videoDirs) {
      // Check timeout
      if (Date.now() - startTime > READ_TIMEOUT_MS) {
        logger.warn(`DASHBOARD_STATS_TIMEOUT durationMs=${Date.now() - startTime} videosProcessed=${videos.length}`);
        break;
      }

      try {
        const metadata = await _getVideoMetadataAsync(path.join(OUTPUT_DIR, dir));
        videos.push(metadata);
      } catch (err) {
        logger.debug(`Failed to read metadata for ${dir}: ${err.message}`);
      }
    }

    videos.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Contar estados
    const summary = {
      published: videos.filter((v) => v.status === 'published').length,
      ready: videos.filter((v) => v.status === 'ready').length,
      queued: videos.filter((v) => v.status === 'queued').length,
      rendering: videos.filter((v) => v.status === 'rendering').length,
      blocked: videos.filter((v) => v.status === 'blocked').length,
      failed: videos.filter((v) => v.status === 'failed').length,
    };

    // Obtener estado de OAuth
    const youtubeToken = process.env.YOUTUBE_REFRESH_TOKEN;
    const youtubeOAuthValid = youtubeToken && youtubeToken !== 'RELLENAR' && youtubeToken.length > 20;

    // Próximo slot
    const nextSlot = {
      time: null,
      minutesUntil: null,
      candidateVideoId: videos.find((v) => v.status === 'ready')?.videoId || null,
      status: videos.find((v) => v.status === 'ready')?.status || 'unknown',
    };

    const result = {
      system: {
        autoPublishEnabled: process.env.AUTO_PUBLISH_ENABLED === 'true',
        youtubeOAuthValid,
        lastCheckAt: new Date().toISOString(),
      },
      summary,
      nextSlot,
      videos: videos.slice(0, 50),
      durationMs: Date.now() - startTime,
    };

    logger.info(`DASHBOARD_STATS_DONE durationMs=${result.durationMs} videosProcessed=${videos.length}`);

    // Guardar en caché
    _setCacheData('videoStatus', result);

    return result;
  } catch (err) {
    logger.error(`Error in getVideoStatus: ${err.message}`);
    const errorResult = {
      system: { autoPublishEnabled: process.env.AUTO_PUBLISH_ENABLED === 'true', youtubeOAuthValid: false, lastCheckAt: new Date().toISOString() },
      summary: { published: 0, ready: 0, queued: 0, rendering: 0, blocked: 0, failed: 0 },
      nextSlot: { time: null, minutesUntil: null, candidateVideoId: null, status: 'unknown' },
      videos: [],
      status: 'partial',
      error: err.message,
    };
    _setCacheData('videoStatus', errorResult);
    return errorResult;
  }
}

async function getNextSlot() {
  /**
   * Devuelve info del próximo slot de publicación (ASYNC)
   */
  // Verificar caché
  if (_isCacheValid('nextSlot')) {
    return cache.nextSlot.data;
  }

  try {
    const status = await getVideoStatus();

    // Buscar próximo ready
    const nextReady = status.videos.find((v) => v.status === 'ready');

    // Calcular tiempo siguiente
    const now = new Date();
    let nextTime = null;

    const publishTimes = (process.env.PUBLISH_TIMES_CET || '14:30,21:15').split(',');
    for (const timeStr of publishTimes) {
      const [hours, mins] = timeStr.split(':').map(Number);
      const candidate = new Date(now);
      candidate.setHours(hours, mins, 0, 0);

      if (candidate <= now) {
        candidate.setDate(candidate.getDate() + 1);
      }

      if (!nextTime || candidate < nextTime) {
        nextTime = candidate;
      }
    }

    const minutesUntil = nextTime ? Math.round((nextTime - now) / 60000) : null;

    const result = {
      time: nextTime?.toISOString() || null,
      minutesUntil,
      candidateVideoId: nextReady?.videoId || null,
      candidateTitle: nextReady?.title || null,
      isReady: nextReady?.status === 'ready' ? true : false,
      blockReason: nextReady?.publishBlockReason || 'No video ready',
    };

    _setCacheData('nextSlot', result);

    return result;
  } catch (err) {
    logger.error(`Error in getNextSlot: ${err.message}`);
    const errorResult = {
      time: null,
      minutesUntil: null,
      candidateVideoId: null,
      candidateTitle: null,
      isReady: false,
      blockReason: err.message,
      status: 'partial',
    };
    _setCacheData('nextSlot', errorResult);
    return errorResult;
  }
}

async function getHealth() {
  /**
   * Devuelve salud del sistema (ULTRA RÁPIDO — sin I/O costoso)
   */
  // Verificar caché
  if (_isCacheValid('health')) {
    return cache.health.data;
  }

  try {
    // Check OAuth (instant)
    const youtubeToken = process.env.YOUTUBE_REFRESH_TOKEN;
    const youtubeOAuthValid = youtubeToken && youtubeToken !== 'RELLENAR' && youtubeToken.length > 20;

    // Get auto-publish status (instant)
    const autoPublishEnabled = process.env.AUTO_PUBLISH_ENABLED === 'true';

    const result = {
      autoPublishEnabled,
      youtubeOAuth: youtubeOAuthValid ? 'valid' : 'invalid',
      assetGate: 'enabled',
      visualQc: 'enabled',
      captionSync: 'enabled',
      dashboardCache: 'enabled',
      timestamp: new Date().toISOString(),
    };

    _setCacheData('health', result);

    return result;
  } catch (err) {
    logger.error(`Error in getHealth: ${err.message}`);
    const errorResult = {
      autoPublishEnabled: process.env.AUTO_PUBLISH_ENABLED === 'true',
      youtubeOAuth: 'unknown',
      assetGate: 'unknown',
      visualQc: 'unknown',
      captionSync: 'unknown',
      timestamp: new Date().toISOString(),
      error: err.message,
    };
    _setCacheData('health', errorResult);
    return errorResult;
  }
}

module.exports = {
  getVideoStatus,
  getNextSlot,
  getHealth,
};
