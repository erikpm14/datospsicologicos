/**
 * publish-preflight-scheduler.js
 *
 * PREFLIGHT: 30 minutos ANTES de cada slot de publicación
 * Verifica si hay candidato publicable.
 * Si NO hay: intenta generar uno.
 * Si LLM deshabilitado: registra log y continúa SIN romper slot.
 *
 * IMPORTANTE: Este es un scheduler SEPARADO del slot real.
 * Fallo aquí NO debe romper el slot de publicación.
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const { getPublishableCandidates } = require('./publishable-candidates.service');

const PUBLISH_TIMES_CET = process.env.PUBLISH_TIMES_CET || '09:00,13:00,15:30,19:00,21:00';
let preflightRunning = false;

/**
 * Parse publish times from config
 * @returns array of { hour, minute }
 */
function getParsedTimes() {
  return PUBLISH_TIMES_CET.split(',')
    .map(t => {
      const [h, m] = t.trim().split(':').map(Number);
      return { hour: h, minute: m };
    })
    .filter(t => !isNaN(t.hour) && !isNaN(t.minute));
}

/**
 * Calculate next preflight time (30 min before slot)
 */
function getNextPreflightTime() {
  const now = new Date();
  const times = getParsedTimes();

  for (const time of times) {
    let slotTime = new Date();
    slotTime.setHours(time.hour, time.minute, 0, 0);

    const preflightTime = new Date(slotTime.getTime() - 30 * 60 * 1000);

    if (preflightTime > now) {
      return { slotTime, preflightTime, slotHHMM: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}` };
    }
  }

  // No slot found today — use first slot of tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const firstTime = times[0];
  const slotTime = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), firstTime.hour, firstTime.minute, 0, 0);
  const preflightTime = new Date(slotTime.getTime() - 30 * 60 * 1000);

  return { slotTime, preflightTime, slotHHMM: `${String(firstTime.hour).padStart(2, '0')}:${String(firstTime.minute).padStart(2, '0')}` };
}

/**
 * PREFLIGHT CHECK: 30 min before slot
 */
async function runPreflight() {
  if (preflightRunning) {
    logger.warn('[PREFLIGHT_SKIPPED] already running');
    return;
  }

  preflightRunning = true;

  try {
    const next = getNextPreflightTime();
    const slotHHMM = next.slotHHMM;

    logger.info(`[PREFLIGHT_STARTED] slot=${slotHHMM} CET | checking for publishable candidates...`);

    // Check if there's a publishable candidate ready
    const { candidates } = getPublishableCandidates({ maxResults: 1 });

    if (candidates.length > 0) {
      logger.info(
        `[PREFLIGHT_CANDIDATE_FOUND] slot=${slotHHMM} CET | ` +
        `videoId=${candidates[0].videoId.substring(0, 8)}... | ` +
        `virality=${candidates[0].viralityScore} | ` +
        `NO_GENERATION_NEEDED`
      );
      return;
    }

    // No candidate found — try to generate one
    logger.warn(
      `[PREFLIGHT_NO_CANDIDATE] slot=${slotHHMM} CET | ` +
      `attempting to generate before slot...`
    );

    try {
      // Check if LLM is available
      const { checkLLMAvailable } = require('./content-generator');
      const llmStatus = await checkLLMAvailable();

      if (!llmStatus.available) {
        logger.error(
          `[PREFLIGHT_GENERATION_BLOCKED_LLM_LIMIT] slot=${slotHHMM} CET | ` +
          `reason=${llmStatus.reason} | ` +
          `SLOT_WILL_RUN_WITHOUT_PREFLIGHT_GENERATION`
        );
        // Do NOT crash — slot scheduler will handle it
        return;
      }

      // LLM is available — trigger generation
      const { runGenerationCycle } = require('./scheduler.service');
      await runGenerationCycle({ urgent: true, preflight: true });

      logger.info(`[PREFLIGHT_GENERATION_TRIGGERED] slot=${slotHHMM} CET | attempting to generate video`);
    } catch (err) {
      logger.warn(
        `[PREFLIGHT_GENERATION_FAILED] slot=${slotHHMM} CET | ` +
        `error=${err.message} | ` +
        `SLOT_WILL_PROCEED_WITHOUT_PREFLIGHT`
      );
    }
  } catch (err) {
    logger.error(`[PREFLIGHT_CRASHED] ${err.message}`);
  } finally {
    preflightRunning = false;
  }
}

/**
 * Schedule preflight checks
 * Runs at every slot time minus 30 minutes
 */
function schedulePreflights() {
  const times = getParsedTimes();

  times.forEach(time => {
    const cronExpr = `${time.minute} ${time.hour} * * *`;

    // Schedule preflight 30 min BEFORE actual slot
    // We'll run it at the slot time, and check if we're 30 min away
    cron.schedule('*/5 * * * *', () => {
      // Every 5 minutes, check if we should run preflight
      const now = new Date();
      const next = getNextPreflightTime();

      const timeToPreflight = next.preflightTime.getTime() - now.getTime();
      // Run if within 1 minute window
      if (timeToPreflight >= -30000 && timeToPreflight <= 30000) {
        runPreflight().catch(err => {
          logger.error(`[PREFLIGHT_SCHEDULE_ERROR] ${err.message}`);
        });
      }
    });
  });

  logger.info(`[PREFLIGHT_SCHEDULER_INITIALIZED] monitoring ${times.length} publish slots`);
}

/**
 * Startup
 */
function initializePreflightScheduler() {
  if (process.env.AUTO_PUBLISH_ENABLED !== 'true') {
    logger.info('[PREFLIGHT_SCHEDULER] AUTO_PUBLISH_ENABLED=false — skipping initialization');
    return;
  }

  logger.info('[PREFLIGHT_SCHEDULER_STARTING]');
  schedulePreflights();
}

module.exports = {
  initializePreflightScheduler,
  runPreflight,
  getNextPreflightTime,
};
