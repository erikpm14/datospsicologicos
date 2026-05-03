/**
 * auto-import-from-output.service.js
 *
 * Sincronización automática: detecta vídeos en output/* y crea entries en queue/done
 * si no existen. Evita que el scheduler no vea vídeos que SÍ están renderizados.
 *
 * Se ejecuta cada X minutos (configurable via AUTO_IMPORT_INTERVAL_MINUTES)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const logger = require('../utils/logger');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const QUEUE_DONE_DIR = path.resolve('./queue/done');

/**
 * Validar que un vídeo es publicable
 * @param {string} videoPath - ruta a output.mp4
 * @returns {object} { valid: boolean, error?: string, duration?: number }
 */
function validateVideo(videoPath) {
  try {
    // 1. Archivo existe
    if (!fs.existsSync(videoPath)) {
      return { valid: false, error: 'output.mp4 not found' };
    }

    // 2. Tamaño > 1MB
    const stats = fs.statSync(videoPath);
    if (stats.size < 1024 * 1024) {
      return { valid: false, error: `size too small: ${(stats.size / 1024).toFixed(0)}KB` };
    }

    // 3. ffprobe detecta streams
    let duration = 0;
    try {
      const probeOutput = execFileSync(
        ffprobePath,
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', videoPath],
        { encoding: 'utf8', windowsHide: true }
      );
      duration = parseFloat(probeOutput.trim());
    } catch (err) {
      return { valid: false, error: `ffprobe failed: ${err.message}` };
    }

    // 4. Duración 8-120s
    if (duration < 8 || duration > 120) {
      return { valid: false, error: `duration out of range: ${duration.toFixed(1)}s (need 8-120s)` };
    }

    return { valid: true, duration };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Crear entry automática en queue/done
 * @param {string} videoId - ID del vídeo
 * @param {number} duration - duración del vídeo
 * @returns {boolean} - true si se creó
 */
function createQueueEntry(videoId, duration) {
  try {
    const entryPath = path.join(QUEUE_DONE_DIR, `${videoId}.json`);

    // No sobrescribir si ya existe
    if (fs.existsSync(entryPath)) {
      return false;
    }

    const entry = {
      id: videoId,
      videoId: videoId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'done',
      progress: 100,
      importedFromExistingOutput: true,
      videoFile: `${path.basename(path.dirname(OUTPUT_DIR))}/${videoId}/output.mp4`,
      data: {
        prefabScript: {
          topic: 'auto-imported',
          hook: `Vídeo auto-importado desde output - ${videoId.substring(0, 8)}...`,
          durationSeconds: Math.round(duration),
          viralityScore: 50,
          humanityScore: 50
        }
      },
      qcPassed: true,
      publishable: true,
      notes: `Auto-imported from existing output.mp4 - duration ${duration.toFixed(1)}s`
    };

    fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2));
    logger.info(`[AUTO_IMPORT] Created queue entry for ${videoId} (${duration.toFixed(1)}s)`);
    return true;
  } catch (err) {
    logger.warn(`[AUTO_IMPORT] Failed to create entry for ${videoId}: ${err.message}`);
    return false;
  }
}

/**
 * Ejecutar sync: escanear output y crear entries faltantes
 * @returns {object} { scanned: number, imported: number, errors: number }
 */
function runSync() {
  const results = { scanned: 0, imported: 0, errors: 0, skipped: 0 };

  try {
    if (!fs.existsSync(OUTPUT_DIR)) {
      logger.warn(`[AUTO_IMPORT] OUTPUT_DIR does not exist: ${OUTPUT_DIR}`);
      return results;
    }

    const dirs = fs.readdirSync(OUTPUT_DIR);

    for (const dir of dirs) {
      const videoPath = path.join(OUTPUT_DIR, dir, 'output.mp4');
      results.scanned++;

      // Skip if no output.mp4
      if (!fs.existsSync(videoPath)) {
        continue;
      }

      // Skip if already published
      const publishedPath = path.join(OUTPUT_DIR, dir, 'published.json');
      if (fs.existsSync(publishedPath)) {
        results.skipped++;
        continue;
      }

      // Validate video
      const validation = validateVideo(videoPath);
      if (!validation.valid) {
        logger.debug(`[AUTO_IMPORT] ${dir} skipped: ${validation.error}`);
        results.errors++;
        continue;
      }

      // Try to create entry
      const created = createQueueEntry(dir, validation.duration);
      if (created) {
        results.imported++;
      } else {
        results.skipped++;
      }
    }

    logger.info(
      `[AUTO_IMPORT_COMPLETE] scanned=${results.scanned} imported=${results.imported} ` +
      `skipped=${results.skipped} errors=${results.errors}`
    );

    return results;
  } catch (err) {
    logger.error(`[AUTO_IMPORT] Sync failed: ${err.message}`);
    return results;
  }
}

/**
 * Inicia el servicio de auto-sync periódico
 * Intervalo configurado en AUTO_IMPORT_INTERVAL_MINUTES (default 5 min)
 */
let syncInterval = null;

function startAutoSync() {
  const intervalMinutes = parseInt(process.env.AUTO_IMPORT_INTERVAL_MINUTES || '5', 10);
  const intervalMs = Math.max(60000, intervalMinutes * 60000); // Mínimo 1 min

  logger.info(`[AUTO_IMPORT] Starting auto-sync service (every ${intervalMinutes} min)`);

  // Ejecutar inmediatamente
  runSync();

  // Y luego periódicamente
  syncInterval = setInterval(() => {
    runSync();
  }, intervalMs);
}

/**
 * Detener el servicio
 */
function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    logger.info(`[AUTO_IMPORT] Auto-sync service stopped`);
  }
}

module.exports = {
  runSync,
  startAutoSync,
  stopAutoSync,
  validateVideo,
  createQueueEntry
};
