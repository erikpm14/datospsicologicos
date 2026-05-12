/**
 * publish-guard.service.js
 *
 * Centralizado guard para publicación a YouTube.
 * TODOS los intentos de publicación deben pasar por aquí.
 *
 * Reglas:
 * 1. Publication freeze = BLOQUEO TOTAL
 * 2. Source desconocido = BLOQUEO
 * 3. Fuentes automáticas requieren: AUTO_PUBLISH_ENABLED=true + slot match + READY
 * 4. Fuentes manuales requieren: ALLOW_MANUAL_PUBLISH=true + MANUAL_AUTHORIZATION_CONFIRMED=true
 * 5. Fuentes prohibidas SIEMPRE
 * 6. Checks obligatorios: metadata, QC, diversity, backgrounds, não publicado antes
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const logger = require('../utils/logger');
const { validateReadyVideo } = require('./ready-video-validator.service');
const { getActiveLock } = require('./publish-idempotency-lock.service');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const FREEZE_STATE_PATH = path.resolve(DATA_DIR, 'publication-freeze.json');
const SLOT_STATE_PATH = path.resolve(DATA_DIR, 'slot-lock-state.json');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

// Fuentes permitidas automaticamente
const AUTHORIZED_AUTOMATIC_SOURCES = ['PublishScheduler'];

// Fuentes permitidas manualmente (si ALLOW_MANUAL_PUBLISH=true)
const AUTHORIZED_MANUAL_SOURCES = [
  'manual-late-publish',
  'publish-late-recovery',
  'publish-next-valid',
  'retry-publish-video',
  'manual-publish-until-success',
  'late-slot-recovery',
];

// Fuentes PROHIBIDAS siempre (intentos de evasion)
const PROHIBITED_SOURCES = [
  'slot-protection-daemon',
  'nearest-slot-protection',
  'queue-processor',
  'slot-protection-rearm',
  'emergency-generate-no-llm',
  'manual-generate-video',
  'test',
  'test-e2e',
  'unknown',
  'undefined',
  '',
];

/**
 * Verifica si el sistema está congelado
 */
function isPublicationFrozen() {
  try {
    if (!fs.existsSync(FREEZE_STATE_PATH)) return false;
    const freezeState = JSON.parse(fs.readFileSync(FREEZE_STATE_PATH, 'utf8'));
    return freezeState.status === 'FROZEN';
  } catch {
    return false;
  }
}

/**
 * Lee el estado del slot lock
 */
function getSlotLockState() {
  try {
    if (!fs.existsSync(SLOT_STATE_PATH)) return null;
    return JSON.parse(fs.readFileSync(SLOT_STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Verifica si un video ya fue publicado antes
 */
function isVideoAlreadyPublished(videoId) {
  try {
    const videoDir = path.resolve(OUTPUT_DIR, videoId);

    // Check 1: ¿Existe published.json?
    const publishedPath = path.resolve(videoDir, 'published.json');
    if (fs.existsSync(publishedPath)) {
      return true;
    }

    // Check 2: ¿Existe youtube_id en generation-metadata.json?
    const metadataPath = path.resolve(videoDir, 'generation-metadata.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        if (metadata.youtube_id || metadata.youtubeId) {
          return true;
        }
      } catch {}
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Lee metadatos del video
 */
function getVideoMetadata(videoId) {
  try {
    const videoDir = path.resolve(OUTPUT_DIR, videoId);
    const metadataPath = path.resolve(videoDir, 'generation-metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Valida checks obligatorios antes de publicar
 */
function validateMandatoryChecks(videoId, metadata) {
  const errors = [];
  const videoDir = path.resolve(OUTPUT_DIR, videoId);

  // Check 1: output.mp4 existe
  const mp4Path = path.resolve(videoDir, 'output.mp4');
  if (!fs.existsSync(mp4Path)) {
    errors.push('output.mp4 no existe');
  } else {
    // Check fileSize >= 4MB
    const stats = fs.statSync(mp4Path);
    const sizeMB = stats.size / 1024 / 1024;
    if (stats.size < 4 * 1024 * 1024) {
      errors.push(`output.mp4 muy pequeño: ${sizeMB.toFixed(1)}MB < 4MB`);
    }
  }

  // Check 2: generation-metadata.json existe
  if (!metadata) {
    errors.push('generation-metadata.json no existe');
    return errors;
  }

  // Check 3: Script Diversity Gate PASS
  if (metadata.scriptDiversityGatePassed !== true) {
    errors.push('scriptDiversityGatePassed !== true');
  }

  // Check 4: Background Diversity (si hay plan)
  if (metadata.backgroundPlan) {
    if (metadata.backgroundPlan.appliedToRender !== true) {
      errors.push('backgroundPlan.appliedToRender !== true');
    }
    if (!metadata.backgroundPlan.renderMode) {
      errors.push('backgroundPlan.renderMode vacío');
    } else if (metadata.backgroundPlan.renderMode !== 'dynamic_background_timeline') {
      errors.push(`renderMode incorrecto: ${metadata.backgroundPlan.renderMode}`);
    }
  }

  // Check 5: Prepublish QC PASS
  if (metadata.prepublishQcPassed !== true && metadata.qcPassed !== true) {
    errors.push('prepublishQcPassed/qcPassed !== true');
  }

  // Check 6: Duplicate Hard Block PASS
  if (metadata.duplicateCheckPassed !== true) {
    errors.push('duplicateCheckPassed !== true');
  }

  return errors;
}

/**
 * Valida que la publicación sea para el slot correcto (si es automática)
 */
function validateSlotMatch(slotDate, slotTime) {
  const slotState = getSlotLockState();
  if (!slotState || !slotState.nearestSlot) {
    return {
      valid: false,
      reason: 'slot-lock-state.json sin reserva activa',
    };
  }

  const reserved = slotState.nearestSlot;

  // Validar que el slot coincide exactamente
  if (reserved.date !== slotDate || reserved.time !== slotTime) {
    return {
      valid: false,
      reason: `slot mismatch: esperado ${reserved.date} ${reserved.time}, recibido ${slotDate} ${slotTime}`,
    };
  }

  // Validar que está locked
  if (reserved.locked !== true) {
    return {
      valid: false,
      reason: 'slot no está locked',
    };
  }

  return {
    valid: true,
    reservedVideoId: reserved.videoId,
  };
}

/**
 * MAIN: Verifica si publicación está permitida
 *
 * @param {Object} options
 *   - videoId: string (requerido)
 *   - source: string (requerido) - quién está publicando
 *   - slotDate: string (YYYY-MM-DD) - requerido si source=PublishScheduler
 *   - slotTime: string (HH:MM) - requerido si source=PublishScheduler
 *   - isManual: boolean (opcional) - true si es publicación manual
 *
 * @returns { allowed: boolean, reason?: string, errors: [] }
 */
function assertPublishAllowed({ videoId, source, slotDate, slotTime, isManual = false }) {
  logger.info(`[PUBLISH_GUARD_CHECK_STARTED] videoId=${videoId} source=${source} manual=${isManual}`);

  const errors = [];
  const result = {
    allowed: false,
    reason: '',
    errors: [],
    checks: {},
  };

  // ─────────────────────────────────────────────
  // CHECK 1: Publication Freeze
  // ─────────────────────────────────────────────
  if (isPublicationFrozen()) {
    logger.error(`[PUBLISH_BLOCKED_PUBLICATION_FREEZE] videoId=${videoId} source=${source}`);
    result.reason = 'Sistema congelado por publicaciones previas con errores';
    result.errors.push('PUBLICATION_FREEZE_ACTIVE');
    return result;
  }
  result.checks.publicationFrozen = false;

  // ─────────────────────────────────────────────
  // CHECK 2: Source validation
  // ─────────────────────────────────────────────
  if (!source || typeof source !== 'string' || source.trim() === '') {
    logger.error(`[PUBLISH_BLOCKED_UNKNOWN_SOURCE] videoId=${videoId}`);
    result.reason = 'source no proporcionado o vacío';
    result.errors.push('UNKNOWN_SOURCE');
    return result;
  }

  // Normalizar source
  source = source.trim();

  if (PROHIBITED_SOURCES.includes(source)) {
    logger.error(`[PUBLISH_BLOCKED_UNAUTHORIZED_SOURCE] videoId=${videoId} source=${source} (prohibido)`);
    result.reason = `source '${source}' está prohibido`;
    result.errors.push('PROHIBITED_SOURCE');
    return result;
  }

  result.checks.sourceValid = true;
  result.checks.source = source;

  // ─────────────────────────────────────────────
  // CHECK 3: Source-specific authorization
  // ─────────────────────────────────────────────
  let isAuthorized = false;

  if (AUTHORIZED_AUTOMATIC_SOURCES.includes(source)) {
    // Validar PublishScheduler
    if (!process.env.AUTO_PUBLISH_ENABLED || process.env.AUTO_PUBLISH_ENABLED !== 'true') {
      logger.error(`[PUBLISH_BLOCKED_AUTOPUBLISH_DISABLED] videoId=${videoId}`);
      result.reason = 'AUTO_PUBLISH_ENABLED !== true';
      result.errors.push('AUTO_PUBLISH_DISABLED');
      return result;
    }

    // Validar slot match
    if (!slotDate || !slotTime) {
      logger.error(`[PUBLISH_BLOCKED_MISSING_SLOT] videoId=${videoId}`);
      result.reason = 'slotDate/slotTime requeridos para PublishScheduler';
      result.errors.push('MISSING_SLOT_INFO');
      return result;
    }

    const slotMatch = validateSlotMatch(slotDate, slotTime);
    result.checks.slotMatch = slotMatch;

    if (!slotMatch.valid) {
      logger.error(`[PUBLISH_BLOCKED_SLOT_MISMATCH] videoId=${videoId} reason=${slotMatch.reason}`);
      result.reason = slotMatch.reason;
      result.errors.push('SLOT_MISMATCH');
      return result;
    }

    // Validar que videoId coincida con reserva
    const slotState = getSlotLockState();
    if (slotState.nearestSlot.videoId !== videoId) {
      logger.error(`[PUBLISH_BLOCKED_VIDEOID_MISMATCH] videoId=${videoId} reserved=${slotState.nearestSlot.videoId}`);
      result.reason = `videoId no coincide con reserva (esperado ${slotState.nearestSlot.videoId})`;
      result.errors.push('VIDEOID_MISMATCH');
      return result;
    }

    result.checks.slotMatched = true;
    isAuthorized = true;
  } else if (AUTHORIZED_MANUAL_SOURCES.includes(source)) {
    // Validar publicación manual
    if (!process.env.ALLOW_MANUAL_PUBLISH || process.env.ALLOW_MANUAL_PUBLISH !== 'true') {
      logger.error(`[PUBLISH_BLOCKED_MANUAL_NOT_ALLOWED] videoId=${videoId}`);
      result.reason = 'ALLOW_MANUAL_PUBLISH !== true';
      result.errors.push('MANUAL_PUBLISH_NOT_ALLOWED');
      return result;
    }

    if (!process.env.MANUAL_AUTHORIZATION_CONFIRMED || process.env.MANUAL_AUTHORIZATION_CONFIRMED !== 'true') {
      logger.error(`[PUBLISH_BLOCKED_MANUAL_NOT_CONFIRMED] videoId=${videoId}`);
      result.reason = 'MANUAL_AUTHORIZATION_CONFIRMED !== true';
      result.errors.push('MANUAL_NOT_CONFIRMED');
      return result;
    }

    result.checks.manualAuthorized = true;
    isAuthorized = true;
  } else {
    logger.error(`[PUBLISH_BLOCKED_UNKNOWN_SOURCE] videoId=${videoId} source=${source}`);
    result.reason = `source '${source}' no está en lista de autorizadas`;
    result.errors.push('UNKNOWN_SOURCE');
    return result;
  }

  if (!isAuthorized) {
    result.reason = 'No autorizado para esta source';
    result.errors.push('NOT_AUTHORIZED');
    return result;
  }

  result.checks.authorized = true;

  // ─────────────────────────────────────────────
  // CHECK 4: Video already published?
  // ─────────────────────────────────────────────
  if (isVideoAlreadyPublished(videoId)) {
    logger.error(`[PUBLISH_BLOCKED_ALREADY_PUBLISHED] videoId=${videoId}`);
    result.reason = 'Video ya fue publicado antes';
    result.errors.push('ALREADY_PUBLISHED');
    return result;
  }

  result.checks.notAlreadyPublished = true;

  // ─────────────────────────────────────────────
  // CHECK 5: Ready Video Validation
  // ─────────────────────────────────────────────
  const validation = validateReadyVideo(videoId);

  if (!validation.ready) {
    const errorMsg = validation.errors.join('; ');
    logger.error(`[PUBLISH_BLOCKED_READY_VALIDATION_FAILED] videoId=${videoId} errors=${errorMsg}`);
    result.reason = errorMsg;
    result.errors.push(...validation.errors);
    return result;
  }

  result.checks.readyValidation = validation.checks;

  // ─────────────────────────────────────────────
  // CHECK 6: No Active Publish Lock
  // ─────────────────────────────────────────────
  const activeLock = getActiveLock(videoId);

  if (activeLock) {
    logger.error(`[PUBLISH_BLOCKED_ACTIVE_IDEMPOTENCY_LOCK] videoId=${videoId} source=${activeLock.source} status=${activeLock.status}`);
    result.reason = `Upload already in progress (source: ${activeLock.source})`;
    result.errors.push('ACTIVE_PUBLISH_LOCK');
    return result;
  }

  result.checks.noActiveLock = true;

  // ─────────────────────────────────────────────
  // ALL CHECKS PASSED
  // ─────────────────────────────────────────────
  result.allowed = true;
  result.checks.allChecksPassed = true;
  logger.info(`[PUBLISH_GUARD_ALLOWED] videoId=${videoId} source=${source}`);

  return result;
}

/**
 * Registra publicación autorizada en el audit trail
 */
function recordAuthorizedPublish(videoId, youtubeId, source, slotDate, slotTime, operator = 'system') {
  try {
    const publishLogPath = path.resolve(DATA_DIR, 'publish-log.json');
    let publishLog = { published: [] };

    if (fs.existsSync(publishLogPath)) {
      try {
        publishLog = JSON.parse(fs.readFileSync(publishLogPath, 'utf8'));
        if (!Array.isArray(publishLog.published)) {
          publishLog.published = [];
        }
      } catch {}
    }

    publishLog.published.push({
      videoId,
      youtubeId,
      source,
      authorizationType: AUTHORIZED_AUTOMATIC_SOURCES.includes(source) ? 'automatic' : 'manual',
      slotDate,
      slotTime,
      operator,
      publishedAt: new Date().toISOString(),
      guardAllowed: true,
    });

    fs.writeFileSync(publishLogPath, JSON.stringify(publishLog, null, 2));
  } catch (err) {
    logger.warn(`[AUDIT_TRAIL_ERROR] Failed to record publish: ${err.message}`);
  }
}

module.exports = {
  assertPublishAllowed,
  recordAuthorizedPublish,
  isPublicationFrozen,
  isVideoAlreadyPublished,
  getSlotLockState,
  getVideoMetadata,
};
