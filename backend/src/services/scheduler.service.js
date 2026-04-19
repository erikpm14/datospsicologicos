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
  const OUTPUT_DIR    = path.resolve(process.env.OUTPUT_DIR || './output');
  const minVirality   = parseInt(process.env.MIN_VIRALITY_SCORE_TO_PUBLISH || '78');

  if (!fs.existsSync(OUTPUT_DIR)) return 0;

  return fs.readdirSync(OUTPUT_DIR).filter((d) => {
    const videoPath     = path.join(OUTPUT_DIR, d, 'output.mp4');
    const scriptPath    = path.join(OUTPUT_DIR, d, 'script.json');
    const publishedPath = path.join(OUTPUT_DIR, d, 'published.json');
    if (!fs.existsSync(videoPath) || !fs.existsSync(publishedPath) === false) return false;
    if (!fs.existsSync(videoPath) || fs.existsSync(publishedPath)) return false;
    if (!fs.existsSync(scriptPath)) return false;
    try {
      const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
      // Vídeos legacy (sin scores del growth engine) se consideran publicables
      if (script.viralityScore === undefined && script.growthContext === undefined) return true;
      return (script.viralityScore || 0) >= minVirality;
    } catch { return false; }
  }).length;
}

async function runGenerationCycle({ urgent = false } = {}) {
  if (isRunning) {
    logger.warn('GenerationScheduler: already running, skipping');
    return;
  }

  isRunning = true;
  lastRun   = new Date().toISOString();

  try {
    const { runGrowthCycle }  = require('./growth-engine');
    const { getQueueStatus }  = require('../queue/video-processor');

    const publishable = countPublishableVideos();
    const queueStatus = getQueueStatus();
    const inPipeline  = (queueStatus.waiting || 0) + (queueStatus.active || 0);

    // GATE v2: MAX_QUEUE = total de vídeos pendientes (renderizados + en pipeline)
    // Estrategia: generate → publicar → medir → ajustar → generar
    const maxQueue   = parseInt(process.env.QUEUE_MAX_PENDING || '3');
    const totalPend  = publishable + inPipeline;
    if (!urgent && totalPend >= maxQueue) {
      logger.info(`GenerationScheduler: queue full (${totalPend}/${maxQueue} — ${publishable} ready + ${inPipeline} processing) — waiting for publish slot`);
      lastResult = { success: false, reason: 'queue_full', totalPending: totalPend, maxQueue, cycleAt: lastRun };
      return;
    }

    // Modo urgente: sin vídeos buenos y sin nada renderizando
    const needsUrgent = publishable === 0 && inPipeline === 0;

    if (needsUrgent) {
      logger.warn('GenerationScheduler: NO publishable videos — entering urgent mode');
    } else {
      logger.info(`GenerationScheduler: cycle starting... (pending=${totalPend}/${maxQueue} — ${publishable} ready, ${inPipeline} processing)`);
    }

    const maxCycles = needsUrgent ? 3 : 1; // v2: reducir intentos urgentes (calidad > volumen)
    let succeeded   = false;

    for (let i = 0; i < maxCycles; i++) {
      const result = await runGrowthCycle({ forceGenerate: needsUrgent, maxRetries: 4 });

      lastResult = {
        success:          result.success,
        reason:           result.reason,
        jobId:            result.jobId,
        topic:            result.script?.topic,
        viralityScore:    result.script?.viralityScore,
        formatMatchScore: result.script?.formatMatchScore,
        attempts:         result.attempts,
        urgent:           needsUrgent,
        cycleAt:          lastRun,
      };

      const log = readJSON(SCHEDULER_LOG_PATH, []);
      log.unshift(lastResult);
      writeJSON(SCHEDULER_LOG_PATH, log.slice(0, 100));

      if (result.success) {
        logger.info(`GenerationScheduler: success | jobId=${result.jobId} topic=${result.script?.topic}${needsUrgent ? ' [urgent]' : ''}`);
        succeeded = true;
        break;
      } else {
        logger.warn(`GenerationScheduler: attempt ${i + 1}/${maxCycles} failed | reason=${result.reason}`);
        if (needsUrgent && i < maxCycles - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    if (needsUrgent && !succeeded) {
      logger.error('GenerationScheduler: urgent mode exhausted all attempts — will retry on next cron tick');
    }

  } catch (err) {
    logger.error(`GenerationScheduler: cycle error: ${err.message}`);
    lastResult = { success: false, reason: err.message, cycleAt: lastRun };
  } finally {
    isRunning = false;
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
  if (intervalHours >= 2)  return '0 6,8,10,12,14,16,18,20,22 * * *'; // 9x día
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
