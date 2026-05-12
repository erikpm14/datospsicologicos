/**
 * NEAREST SLOT PROTECTION SERVICE
 *
 * Garantiza que siempre existe un vídeo READY para el próximo slot de publicación.
 *
 * Responsabilidades:
 * 1. Detectar el slot más cercano configurado
 * 2. Verificar si ya está cerrado (tiene vídeo READY)
 * 3. Si no está cerrado, generar/preparar candidato
 * 4. Mantener estado persistente
 * 5. Invalidar reservas si fallan
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { validateReadyVideo } = require('./ready-video-validator.service');

const DATA_DIR = path.join(__dirname, '../../data');
const SLOT_STATE_PATH = path.join(DATA_DIR, 'slot-lock-state.json');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../output-fase1-test'));

// Asegurar que existe el directorio data
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getPublishSlots() {
  // Lee los slots configurados del PublishScheduler
  // Por ahora, retorna slots hardcoded. En el futuro, leer de config.
  return [
    { hour: 14, minute: 30, timezone: 'Europe/Madrid' },
    { hour: 21, minute: 15, timezone: 'Europe/Madrid' },
  ];
}

function getNearestSlot(slots) {
  const now = new Date();
  const nowHour = now.getHours();
  const nowMinute = now.getMinutes();
  const nowTotal = nowHour * 60 + nowMinute;

  // Buscar el slot más cercano de hoy
  for (const slot of slots) {
    const slotTotal = slot.hour * 60 + slot.minute;
    if (slotTotal > nowTotal) {
      return {
        date: now.toISOString().split('T')[0],
        time: `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`,
        timezone: slot.timezone,
      };
    }
  }

  // Si no hay slot hoy, buscar el primero de mañana
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const firstSlot = slots[0];

  return {
    date: tomorrow.toISOString().split('T')[0],
    time: `${String(firstSlot.hour).padStart(2, '0')}:${String(firstSlot.minute).padStart(2, '0')}`,
    timezone: firstSlot.timezone,
  };
}

function loadSlotState() {
  if (!fs.existsSync(SLOT_STATE_PATH)) {
    return {
      nearestSlot: null,
      history: [],
    };
  }

  try {
    return JSON.parse(fs.readFileSync(SLOT_STATE_PATH, 'utf8'));
  } catch {
    return {
      nearestSlot: null,
      history: [],
    };
  }
}

function saveSlotState(state) {
  try {
    fs.writeFileSync(SLOT_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.error(`[nearest-slot-protection] Failed to save state: ${err.message}`);
  }
}

function isVideoReady(videoId) {
  const validation = validateReadyVideo(videoId);
  if (validation.ready) {
    return { ready: true, checks: validation.checks };
  }
  const reason = validation.errors.length > 0 ? validation.errors[0] : 'validation_failed';
  return { ready: false, reason, checks: validation.checks };
}

function checkSlotLocked(slotSpec, state) {
  if (!state.nearestSlot) {
    return { locked: false, reason: 'no_reservation' };
  }

  // Verificar que es el mismo slot
  if (state.nearestSlot.date !== slotSpec.date || state.nearestSlot.time !== slotSpec.time) {
    return { locked: false, reason: 'different_slot' };
  }

  // Verificar que tiene videoId
  if (!state.nearestSlot.videoId) {
    return { locked: false, reason: 'no_video_id' };
  }

  // Verificar que el vídeo sigue READY
  const readyCheck = isVideoReady(state.nearestSlot.videoId);
  if (!readyCheck.ready) {
    return { locked: false, reason: `video_not_ready: ${readyCheck.reason}`, checks: readyCheck.checks };
  }

  return {
    locked: true,
    videoId: state.nearestSlot.videoId,
    lockedAt: state.nearestSlot.lockedAt,
    checks: state.nearestSlot.checks,
  };
}

async function detectNearestSlot() {
  console.log('[NEAREST_SLOT_PROTECTION_STARTED]');
  logger.info('[NEAREST_SLOT_PROTECTION_STARTED]');

  try {
    const slots = getPublishSlots();
    const nearestSlot = getNearestSlot(slots);

    console.log(`[NEAREST_SLOT_DETECTED] ${nearestSlot.date} ${nearestSlot.time}`);
    logger.info(`[NEAREST_SLOT_DETECTED] ${nearestSlot.date} ${nearestSlot.time}`);

    // Cargar estado actual
    const state = loadSlotState();

    console.log('[NEAREST_SLOT_LOCK_CHECK_STARTED]');
    logger.info('[NEAREST_SLOT_LOCK_CHECK_STARTED]');

    const lockStatus = checkSlotLocked(nearestSlot, state);

    if (lockStatus.locked) {
      console.log(`[NEAREST_SLOT_ALREADY_LOCKED] videoId=${lockStatus.videoId}`);
      logger.info(`[NEAREST_SLOT_ALREADY_LOCKED] videoId=${lockStatus.videoId} lockedAt=${lockStatus.lockedAt}`);

      return {
        success: true,
        slot: nearestSlot,
        locked: true,
        videoId: lockStatus.videoId,
      };
    }

    console.log('[NEAREST_SLOT_NOT_LOCKED] Need to prepare candidate');
    logger.info('[NEAREST_SLOT_NOT_LOCKED] No valid reservation for slot');

    return {
      success: true,
      slot: nearestSlot,
      locked: false,
      reason: lockStatus.reason,
      needsCandidate: true,
    };
  } catch (err) {
    console.log(`[NEAREST_SLOT_DETECTION_FAILED] ${err.message}`);
    logger.error(`[NEAREST_SLOT_DETECTION_FAILED] ${err.message}`);
    return {
      success: false,
      error: err.message,
    };
  }
}

function reserveSlot(slotSpec, videoId, checks = {}) {
  try {
    // Validate video before reserving slot
    const validation = validateReadyVideo(videoId);
    if (!validation.ready) {
      const errorMsg = validation.errors.join('; ');
      console.log(`[NEAREST_SLOT_LOCK_REJECTED] videoId=${videoId} reason=${errorMsg}`);
      logger.error(`[NEAREST_SLOT_LOCK_REJECTED] videoId=${videoId}: ${errorMsg}`);
      return { success: false, error: `Validation failed: ${errorMsg}` };
    }

    const state = loadSlotState();

    state.nearestSlot = {
      date: slotSpec.date,
      time: slotSpec.time,
      timezone: slotSpec.timezone,
      locked: true,
      videoId,
      lockedAt: new Date().toISOString(),
      status: 'READY',
      checks: validation.checks,
    };

    saveSlotState(state);

    console.log(`[NEAREST_SLOT_LOCKED] videoId=${videoId}`);
    logger.info(`[NEAREST_SLOT_LOCKED] videoId=${videoId} for ${slotSpec.date} ${slotSpec.time}`);

    return { success: true, slot: slotSpec, videoId };
  } catch (err) {
    console.log(`[NEAREST_SLOT_LOCK_FAILED] ${err.message}`);
    logger.error(`[NEAREST_SLOT_LOCK_FAILED] ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function rearmedNextSlot(publishedVideoId = null) {
  try {
    // Invalidate the consumed reservation
    invalidateReservation('published', publishedVideoId);

    // Recalculate nearest slot
    const slotDetection = await detectNearestSlot();

    if (!slotDetection.success) {
      logger.warn(`[NEXT_NEAREST_SLOT_PROTECTION_REARMED] Detection failed: ${slotDetection.error}`);
      return;
    }

    // If next slot is not locked, trigger queue entry for protection
    if (!slotDetection.locked) {
      try {
        const { addVideoToQueue } = require('../queue/video-processor');

        await addVideoToQueue({
          topic: null,
          manual: false,
          source: 'slot-protection-rearm',
          slotProtection: true,
        });

        console.log(`[NEXT_NEAREST_SLOT_PROTECTION_REARMED] New generation queued for slot ${slotDetection.slot.date} ${slotDetection.slot.time}`);
        logger.info(`[NEXT_NEAREST_SLOT_PROTECTION_REARMED] New generation queued for slot ${slotDetection.slot.date} ${slotDetection.slot.time}`);
      } catch (err) {
        logger.error(`[NEXT_NEAREST_SLOT_PROTECTION_REARMED_QUEUE_ERROR] ${err.message}`);
      }
    } else {
      console.log(`[NEXT_NEAREST_SLOT_ALREADY_PROTECTED] videoId=${slotDetection.videoId}`);
      logger.info(`[NEXT_NEAREST_SLOT_ALREADY_PROTECTED] Next slot already locked with ${slotDetection.videoId}`);
    }
  } catch (err) {
    logger.error(`[NEXT_NEAREST_SLOT_PROTECTION_REARMED_ERROR] ${err.message}`);
  }
}

function invalidateReservation(reason = 'unknown', publishedVideoId = null) {
  try {
    const state = loadSlotState();

    if (state.nearestSlot) {
      const invalidatedVideoId = state.nearestSlot.videoId;
      console.log(`[NEAREST_SLOT_RESERVATION_INVALIDATED] videoId=${invalidatedVideoId} reason=${reason}${publishedVideoId ? ` publishedVideoId=${publishedVideoId}` : ''}`);
      logger.warn(`[NEAREST_SLOT_RESERVATION_INVALIDATED] videoId=${invalidatedVideoId} reason=${reason}`);

      state.nearestSlot = null;
      saveSlotState(state);

      return { success: true, invalidatedVideoId };
    }

    return { success: true, message: 'no_active_reservation' };
  } catch (err) {
    logger.error(`[NEAREST_SLOT_INVALIDATION_FAILED] ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  detectNearestSlot,
  reserveSlot,
  invalidateReservation,
  rearmedNextSlot,
  isVideoReady,
  loadSlotState,
  getNearestSlot,
  getPublishSlots,
};
