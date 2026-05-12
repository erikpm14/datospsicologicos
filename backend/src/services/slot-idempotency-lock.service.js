/**
 * slot-idempotency-lock.service.js
 * Garantiza que solo UN vídeo se puede publicar por slot.
 * Previene doble publicación de principal + backup en mismo slot.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const LOCKS_FILE = path.resolve(__dirname, '../../data/slot-publication-locks.json');
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos: tiempo máximo de upload

/**
 * Genera una clave de slot única: YYYY-MM-DD_HH-mm_timezone
 */
function generateSlotKey(slotDate, slotTime, timezone = 'Europe-Madrid') {
  if (!slotDate || !slotTime) return null;

  // slotDate: "2026-05-11", slotTime: "14:30"
  const dateStr = slotDate.replace(/-/g, '-'); // YYYY-MM-DD
  const timeStr = slotTime.replace(/:/g, '-'); // HH-mm
  return `${dateStr}_${timeStr}_${timezone}`;
}

/**
 * Lee el archivo de locks
 */
function readLocks() {
  if (!fs.existsSync(LOCKS_FILE)) {
    return { locks: [], metadata: { version: '1.0' } };
  }
  try {
    return JSON.parse(fs.readFileSync(LOCKS_FILE, 'utf8'));
  } catch (err) {
    logger.error('[SLOT_LOCK] Error reading locks file:', err.message);
    return { locks: [], metadata: { version: '1.0' } };
  }
}

/**
 * Escribe el archivo de locks
 */
function writeLocks(data) {
  try {
    fs.writeFileSync(LOCKS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    logger.error('[SLOT_LOCK] Error writing locks file:', err.message);
    throw err;
  }
}

/**
 * Intenta adquirir el lock para un slot
 * Retorna { acquired: boolean, reason?: string, existingLock?: object }
 */
function acquireSlotLock(slotDate, slotTime, videoId, timezone = 'Europe-Madrid') {
  const slotKey = generateSlotKey(slotDate, slotTime, timezone);

  if (!slotKey) {
    return {
      acquired: false,
      reason: 'Invalid slotDate or slotTime',
    };
  }

  const locks = readLocks();
  const existingLock = locks.locks.find(l => l.slotKey === slotKey);

  // ✓ Sin lock previo = puede crear uno nuevo
  if (!existingLock) {
    const newLock = {
      slotKey,
      status: 'uploading',
      videoId,
      youtubeId: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      expiresAt: new Date(Date.now() + LOCK_TIMEOUT_MS).toISOString(),
      reason: null,
      backupAttempts: [],
    };

    locks.locks.push(newLock);
    locks.metadata.lastUpdated = new Date().toISOString();
    writeLocks(locks);

    logger.info('[SLOT_LOCK_ACQUIRED]', {
      slotKey,
      videoId,
      expiresAt: newLock.expiresAt,
    });

    return { acquired: true, slotKey };
  }

  // ✗ Ya existe lock
  if (existingLock.status === 'published') {
    return {
      acquired: false,
      reason: 'SLOT_ALREADY_PUBLISHED',
      existingLock,
      detail: `Slot ${slotKey} already has published video ${existingLock.videoId}`,
    };
  }

  if (existingLock.status === 'uploading') {
    const startedMs = new Date(existingLock.startedAt).getTime();
    const nowMs = Date.now();
    const elapsedMs = nowMs - startedMs;

    // ✓ Si expiró el timeout, permitir retry
    if (elapsedMs > LOCK_TIMEOUT_MS) {
      logger.warn('[SLOT_LOCK_EXPIRED]', {
        slotKey,
        previousVideoId: existingLock.videoId,
        elapsedSeconds: Math.floor(elapsedMs / 1000),
      });

      // Marcar como fallido
      existingLock.status = 'failed';
      existingLock.completedAt = new Date().toISOString();
      existingLock.failureReason = 'Lock timeout - upload took too long';

      // Permitir nuevo intento
      const newLock = {
        slotKey,
        status: 'uploading',
        videoId,
        youtubeId: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        expiresAt: new Date(Date.now() + LOCK_TIMEOUT_MS).toISOString(),
        reason: 'retry after previous lock expired',
        backupAttempts: [],
      };

      locks.locks = locks.locks.map(l => l.slotKey === slotKey ? existingLock : l);
      locks.locks.push(newLock);
      locks.metadata.lastUpdated = new Date().toISOString();
      writeLocks(locks);

      return { acquired: true, slotKey, isRetry: true };
    }

    // ✗ Aún está en progreso, bloquear
    return {
      acquired: false,
      reason: 'SLOT_UPLOAD_IN_PROGRESS',
      existingLock,
      detail: `Upload for ${existingLock.videoId} still in progress (${Math.floor(elapsedMs / 1000)}s elapsed)`,
    };
  }

  return {
    acquired: false,
    reason: 'SLOT_LOCK_UNKNOWN_STATUS',
    existingLock,
  };
}

/**
 * Marca un lock como publicado exitosamente
 */
function markSlotAsPublished(slotKey, videoId, youtubeId) {
  const locks = readLocks();
  const lock = locks.locks.find(l => l.slotKey === slotKey && l.videoId === videoId);

  if (!lock) {
    logger.error('[SLOT_LOCK] Lock not found for completion:', { slotKey, videoId });
    return false;
  }

  lock.status = 'published';
  lock.youtubeId = youtubeId;
  lock.completedAt = new Date().toISOString();

  locks.metadata.lastUpdated = new Date().toISOString();
  writeLocks(locks);

  logger.info('[SLOT_LOCK_PUBLISHED]', {
    slotKey,
    videoId,
    youtubeId,
  });

  return true;
}

/**
 * Marca un lock como fallido (permite retry/fallback)
 */
function markSlotAsFailed(slotKey, videoId, reason) {
  const locks = readLocks();
  const lock = locks.locks.find(l => l.slotKey === slotKey && l.videoId === videoId);

  if (!lock) {
    logger.error('[SLOT_LOCK] Lock not found for failure:', { slotKey, videoId });
    return false;
  }

  lock.status = 'failed';
  lock.completedAt = new Date().toISOString();
  lock.failureReason = reason;

  locks.metadata.lastUpdated = new Date().toISOString();
  writeLocks(locks);

  logger.info('[SLOT_LOCK_FAILED]', {
    slotKey,
    videoId,
    reason,
  });

  return true;
}

/**
 * Intenta backup SOLO si principal falló y slot aún no tiene publicación
 */
function canAttemptBackup(slotKey, primaryVideoId) {
  const locks = readLocks();
  const primaryLock = locks.locks.find(l => l.slotKey === slotKey && l.videoId === primaryVideoId);

  // Debe existir lock del principal
  if (!primaryLock) {
    return { allowed: false, reason: 'PRIMARY_LOCK_NOT_FOUND' };
  }

  // Principal debe haber FALLADO, no publicado
  if (primaryLock.status === 'published') {
    return { allowed: false, reason: 'PRIMARY_ALREADY_PUBLISHED' };
  }

  if (primaryLock.status === 'uploading') {
    return { allowed: false, reason: 'PRIMARY_STILL_UPLOADING' };
  }

  // Principal falló, permitir backup
  if (primaryLock.status === 'failed') {
    return { allowed: true };
  }

  return { allowed: false, reason: 'UNKNOWN_PRIMARY_STATUS' };
}

/**
 * Registra intento de backup (para auditoría)
 */
function recordBackupAttempt(slotKey, primaryVideoId, backupVideoId, outcome) {
  const locks = readLocks();
  const primaryLock = locks.locks.find(l => l.slotKey === slotKey && l.videoId === primaryVideoId);

  if (!primaryLock) {
    logger.error('[SLOT_LOCK] Primary lock not found for backup attempt:', { slotKey, primaryVideoId });
    return false;
  }

  primaryLock.backupAttempts = primaryLock.backupAttempts || [];
  primaryLock.backupAttempts.push({
    videoId: backupVideoId,
    timestamp: new Date().toISOString(),
    outcome, // 'success', 'failed', 'blocked', etc.
  });

  locks.metadata.lastUpdated = new Date().toISOString();
  writeLocks(locks);

  return true;
}

module.exports = {
  generateSlotKey,
  acquireSlotLock,
  markSlotAsPublished,
  markSlotAsFailed,
  canAttemptBackup,
  recordBackupAttempt,
  readLocks,
};
