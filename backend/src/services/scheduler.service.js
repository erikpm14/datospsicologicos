/**
 * scheduler.service.js
 * Scheduler autónomo de GENERACIÓN de contenido.
 * Separado completamente del scheduler de publicación.
 *
 * Activa si AUTO_GENERATION_ENABLED=true
 * Intervalo configurable: CONTENT_GENERATION_INTERVAL_HOURS
 * No genera si la cola está llena: QUEUE_MAX_PENDING
 */

require('dotenv').config();
const cron   = require('node-cron');
const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');
const { formatDurationMs } = require('../utils/perf-tracker');
const { getQueueSnapshot, getOperationalThresholds, touchPipelineState } = require('./operational-state.service');
const { notifyQueueLow, notifyGenerationStalled, notifySystemRecovered } = require('./telegram-notifier');

const SCHEDULER_LOG_PATH = path.resolve('./data/scheduler-generation-log.json');

let schedulerJob = null;
let isRunning    = false;
let lastRun      = null;
let lastResult   = null;

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function readJSON(file, def = []) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return def; }
}

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────
//  CICLO DE GENERACIÓN
// ─────────────────────────────────────────────

// Devuelve cuántos vídeos en output/ pasan el umbral de publicación y están listos
function countPublishableVideos() {
  return getQueueSnapshot().readyCount;
}

async function runGenerationCycle({ urgent = false } = {}) {
  if (isRunning) {
    logger.warn('GenerationScheduler: already running, skipping');
    return;
  }

  isRunning = true;
  lastRun   = new Date().toISOString();
  const cycleStartedMs = Date.now();
  touchPipelineState({ generationLastStartedAt: lastRun, generationRunning: true });

  try {
    const { addVideoToQueue, getQueueStatus }  = require('../queue/video-processor');
    const thresholds = getOperationalThresholds();
    const snapshot = getQueueSnapshot();
    const publishable = snapshot.readyCount;
    const queueStatus = getQueueStatus();
    const inPipeline  = (queueStatus.waiting || 0) + (queueStatus.active || 0);

    // GATE v2: Buffer policy — máximo de vídeos ready en cola
    const maxQueue        = parseInt(process.env.QUEUE_MAX_PENDING || '3');
    const readyMaxBuffer  = parseInt(process.env.READY_MAX_BUFFER || '3');
    const totalPend       = publishable + inPipeline;
    const belowMinimumReady = publishable < thresholds.minReady;

    if (belowMinimumReady) {
      logger.warn(`GenerationScheduler: low ready detected | ready=${publishable}/${thresholds.minReady} | inPipeline=${inPipeline} | target=${thresholds.targetReady}`);
      await notifyQueueLow({ readyCount: publishable, minReady: thresholds.minReady, inPipeline, reason: 'below_min_ready' });
    }

    // Buffer policy: si hay demasiados vídeos ready, no generar
    if (!urgent && publishable >= readyMaxBuffer) {
      logger.info(`GenerationScheduler: queue buffer full (${publishable}/${readyMaxBuffer} ready) — skipping generation until publish slot`);
      lastResult = { success: false, reason: 'queue_buffer_full', readyCount: publishable, readyMaxBuffer, cycleAt: lastRun, totalMs: Date.now() - cycleStartedMs };
      touchPipelineState({ generationLastFinishedAt: new Date().toISOString(), generationLastResult: lastResult, generationRunning: false });
      return;
    }

    if (!urgent && !belowMinimumReady && totalPend >= maxQueue) {
      logger.info(`GenerationScheduler: queue full (${totalPend}/${maxQueue} — ${publishable} ready + ${inPipeline} processing) — waiting for publish slot`);
      lastResult = { success: false, reason: 'queue_full', totalPending: totalPend, maxQueue, cycleAt: lastRun, totalMs: Date.now() - cycleStartedMs };
      touchPipelineState({ generationLastFinishedAt: new Date().toISOString(), generationLastResult: lastResult, generationRunning: false });
      return;
    }

    // HOTFIX: Regla de urgencia por proximidad a próximo slot
    // Si faltan < 90 min para slot y hay < 3 videos listos → urgente
    const nextSlot = getNextPublishSlot();
    let urgentSlotProximity = false;
    if (nextSlot && nextSlot.minutesUntil >= 0 && nextSlot.minutesUntil < 90) {
      if (publishable < 3) {
        urgentSlotProximity = true;
        logger.warn(`GenerationScheduler: URGENT top-up by slot proximity | nextSlot=${nextSlot.time} (${nextSlot.minutesUntil}min) | ready=${publishable} < 3`);
      }
    }

    // Modo urgente: sin vídeos buenos y sin nada renderizando
    const needsUrgent = urgent || urgentSlotProximity || belowMinimumReady || (publishable === 0 && inPipeline === 0);
    if (needsUrgent) {
      logger.info(`GenerationScheduler: top-up triggered | urgent=${urgent} | slotProximity=${urgentSlotProximity} | ready=${publishable}/${thresholds.targetReady} | inPipeline=${inPipeline}`);
    }

    if (needsUrgent) {
      logger.warn('GenerationScheduler: NO publishable videos — entering urgent mode');
    } else {
      logger.info(`GenerationScheduler: cycle starting... (pending=${totalPend}/${maxQueue} — ${publishable} ready, ${inPipeline} processing)`);
    }

    const maxCycles = needsUrgent ? Math.max(1, parseInt(process.env.GENERATION_URGENT_MAX_CYCLES || '3', 10) || 3) : 1;
    let succeeded   = false;

    for (let i = 0; i < maxCycles; i++) {
      const topic = process.env.CONTENT_DOMAIN || 'ai_tools';
      const jobId = await addVideoToQueue({ topic });

      lastResult = {
        success: true,
        reason: 'job_queued',
        jobId,
        topic,
        attempts: i + 1,
        totalMs: Date.now() - cycleStartedMs,
        urgent:           needsUrgent,
        cycleAt:          lastRun,
      };

      const log = readJSON(SCHEDULER_LOG_PATH, []);
      log.unshift(lastResult);
      writeJSON(SCHEDULER_LOG_PATH, log.slice(0, 100));

      logger.info(`GenerationScheduler: queued | jobId=${jobId} topic=${topic}${needsUrgent ? ' [urgent]' : ''}`);
      succeeded = true;
      touchPipelineState({
        generationLastSuccessfulAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
        lastProgressType: 'generation_queued',
        lastGeneratedJobId: jobId,
      });
      await notifySystemRecovered({ scope: 'generation', detail: `job ${jobId}` });
      break;
    }

    if (needsUrgent && !succeeded) {
      logger.error('GenerationScheduler: urgent mode exhausted all attempts — will retry on next cron tick');
      await notifyGenerationStalled({ reason: lastResult?.reason || 'urgent_generation_failed', attempts: maxCycles });
    }
    logger.info(`GenerationScheduler: cycle finished in ${formatDurationMs(Date.now() - cycleStartedMs)}`);

  } catch (err) {
    logger.error(`GenerationScheduler: cycle error: ${err.message}`);
    lastResult = { success: false, reason: err.message, cycleAt: lastRun, totalMs: Date.now() - cycleStartedMs };
    await notifyGenerationStalled({ reason: err.message });
  } finally {
    isRunning = false;
    touchPipelineState({
      generationLastFinishedAt: new Date().toISOString(),
      generationLastResult: lastResult,
      generationRunning: false,
    });
  }
}

// ─────────────────────────────────────────────
//  HELPERS DE SLOTS
// ─────────────────────────────────────────────

/**
 * Calcula el próximo slot de publicación.
 * Slots default: 09:00, 13:00, 15:30, 19:00, 21:00 (CET)
 */
function getNextPublishSlot() {
  try {
    const slotTimesStr = process.env.PUBLISH_TIMES_CET || '09:00,13:00,15:30,19:00,21:00';
    const slots = slotTimesStr.split(',').map(s => {
      const [h, m] = s.trim().split(':').map(Number);
      return { h, m, time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
    }).sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Buscar próximo slot hoy
    for (const slot of slots) {
      const slotMinutes = slot.h * 60 + slot.m;
      if (slotMinutes > currentMinutes) {
        const minutesUntil = slotMinutes - currentMinutes;
        return { time: slot.time, minutesUntil, today: true };
      }
    }

    // Si no hay slot hoy, próximo es el primero de mañana
    const firstSlot = slots[0];
    const minutesUntilMidnight = (24 * 60) - currentMinutes;
    const minutesUntil = minutesUntilMidnight + (firstSlot.h * 60 + firstSlot.m);
    return { time: firstSlot.time, minutesUntil, today: false };
  } catch (err) {
    logger.warn(`getNextPublishSlot error: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
//  CONSTRUCCIÓN DEL CRON
// ─────────────────────────────────────────────

/**
 * Convierte un intervalo en horas a expresión cron que distribuye el día.
 * Ejemplo: 3h → "0 6,9,12,15,18,21 * * *" (cada 3h de 6am a 21pm)
 */
function buildCronExpression(intervalHours) {
  if (intervalHours >= 24) return '0 8 * * *';          // una vez al día
  if (intervalHours >= 12) return '0 8,20 * * *';       // 2x día
  if (intervalHours >= 8)  return '0 8,16 * * *';       // ~2x día
  if (intervalHours >= 6)  return '0 6,12,18 * * *';    // 3x día
  if (intervalHours >= 4)  return '0 6,10,14,18,22 * * *'; // ~5x día
  if (intervalHours >= 3)  return '0 6,9,12,15,18,21 * * *'; // 6x día
  if (intervalHours >= 2)  return '0 0,2,6,8,10,12,14,16,18,20,22 * * *'; // 11x día
  return '0 * * * *'; // cada hora
}

// ─────────────────────────────────────────────
//  API PÚBLICA
// ─────────────────────────────────────────────

function getSchedulerStatus() {
  return {
    type:          'generation',
    enabled:       process.env.AUTO_GENERATION_ENABLED === 'true',
    intervalHours: parseInt(process.env.CONTENT_GENERATION_INTERVAL_HOURS || '3'),
    queueMaxPending: parseInt(process.env.QUEUE_MAX_PENDING || '5'),
    isRunning,
    lastRun,
    lastResult,
    recentLog:     readJSON(SCHEDULER_LOG_PATH, []).slice(0, 5),
  };
}

function startGenerationScheduler() {
  if (process.env.AUTO_GENERATION_ENABLED !== 'true') {
    logger.info('GenerationScheduler: AUTO_GENERATION_ENABLED=false — not starting');
    return;
  }

  if (schedulerJob) {
    logger.warn('GenerationScheduler: already started');
    return;
  }

  const intervalHours = parseInt(process.env.CONTENT_GENERATION_INTERVAL_HOURS || '3');
  const cronExpr      = buildCronExpression(intervalHours);

  logger.info(`GenerationScheduler: starting | interval=${intervalHours}h | cron="${cronExpr}"`);

  schedulerJob = cron.schedule(
    cronExpr,
    async () => {
      logger.info('GenerationScheduler: cron triggered');
      await runGenerationCycle();
    },
    { timezone: 'Europe/Madrid' },
  );

  logger.info('GenerationScheduler: active');
  setTimeout(() => {
    runGenerationCycle({ urgent: true }).catch((err) => logger.warn(`GenerationScheduler: startup warmup failed: ${err.message}`));
  }, 15000);
}

function stopGenerationScheduler() {
  if (schedulerJob) {
    schedulerJob.stop();
    schedulerJob = null;
    logger.info('GenerationScheduler: stopped');
  }
}

module.exports = {
  startGenerationScheduler,
  stopGenerationScheduler,
  runGenerationCycle,
  getSchedulerStatus,
};
