#!/usr/bin/env node
/**
 * SLOT PROTECTION DAEMON
 *
 * Ejecuta continuamente para garantizar que el slot más cercano siempre esté cerrado.
 *
 * Responsabilidades:
 * 1. Detectar el slot más cercano cada N minutos
 * 2. Verificar si está cerrado
 * 3. Si no está cerrado, desencadenar generación
 * 4. Mantener estado persistente
 * 5. Invalidar reservas si fallan
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const logger = require('../src/utils/logger');
const {
  detectNearestSlot,
  reserveSlot,
  invalidateReservation,
  isVideoReady,
} = require('../src/services/nearest-slot-protection.service');
const { addVideoToQueue } = require('../src/queue/video-processor');

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Verificar cada 5 minutos
const DATA_DIR = path.join(__dirname, '../data');
const SLOT_STATE_PATH = path.join(DATA_DIR, 'slot-lock-state.json');

let isRunning = true;
let checkInProgress = false;

async function checkAndProtectSlot() {
  if (checkInProgress) {
    logger.debug('[slot-protection-daemon] Check already in progress, skipping');
    return;
  }

  checkInProgress = true;

  try {
    // Detectar el slot más cercano
    const slotDetection = await detectNearestSlot();

    if (!slotDetection.success) {
      logger.error(`[slot-protection-daemon] Detection failed: ${slotDetection.error}`);
      checkInProgress = false;
      return;
    }

    const slot = slotDetection.slot;

    // Si el slot ya está cerrado, nothing to do
    if (slotDetection.locked) {
      logger.info(`[slot-protection-daemon] Slot ${slot.date} ${slot.time} is protected by ${slotDetection.videoId}`);
      checkInProgress = false;
      return;
    }

    // El slot no está cerrado, necesitamos candidato
    console.log('[NEAREST_SLOT_GENERATION_STARTED]');
    logger.info('[NEAREST_SLOT_GENERATION_STARTED]');

    try {
      // Intenta generar usando queue normal (LLM si está disponible)
      const queueEntry = await addVideoToQueue({
        topic: null,
        manual: false,
        source: 'slot-protection',
        slotProtection: true, // Marcar que es para protección de slot
      });

      console.log(`[NEAREST_SLOT_GENERATION_QUEUED] jobId=${queueEntry.jobId}`);
      logger.info(`[NEAREST_SLOT_GENERATION_QUEUED] jobId=${queueEntry.jobId} for slot ${slot.date} ${slot.time}`);

      // Nota: El vídeo se reservará cuando la generación complete y pase todas las validaciones.
      // Ver integration con video-processor para hook de "ready".

    } catch (queueErr) {
      logger.error(`[NEAREST_SLOT_GENERATION_FAILED] ${queueErr.message}`);
    }

  } catch (err) {
    logger.error(`[slot-protection-daemon] Unexpected error: ${err.message}`, err);
  } finally {
    checkInProgress = false;
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║       SLOT PROTECTION DAEMON                   ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  console.log('[SLOT_PROTECTION_DAEMON_STARTED]');
  logger.info('[SLOT_PROTECTION_DAEMON_STARTED]');

  // Hacer verificación inicial
  await checkAndProtectSlot();

  // Luego, verificar periodicamente
  const interval = setInterval(async () => {
    if (isRunning) {
      await checkAndProtectSlot();
    }
  }, CHECK_INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[SLOT_PROTECTION_DAEMON_SHUTTING_DOWN]');
    logger.info('[SLOT_PROTECTION_DAEMON_SHUTTING_DOWN]');
    isRunning = false;
    clearInterval(interval);
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[SLOT_PROTECTION_DAEMON_INTERRUPTED]');
    logger.info('[SLOT_PROTECTION_DAEMON_INTERRUPTED]');
    isRunning = false;
    clearInterval(interval);
    process.exit(0);
  });

  console.log(`[DAEMON_RUNNING] Checking slot protection every ${CHECK_INTERVAL_MS / 1000 / 60} minutes`);
  logger.info(`[DAEMON_RUNNING] Protection check interval: ${CHECK_INTERVAL_MS / 1000 / 60} minutes`);
}

main().catch(err => {
  console.error(`[DAEMON_CRASHED] ${err.message}`);
  logger.error(`[DAEMON_CRASHED] ${err.message}`, err);
  process.exit(1);
});
