require('dotenv').config();
const cron = require('node-cron');
const logger = require('../utils/logger');
const {
  getOperationalThresholds,
  getQueueSnapshot,
  readPipelineState,
  writePipelineState,
  getExpectedPublishSlot,
  getMinutesSince,
} = require('./operational-state.service');
const {
  notifyQueueLow,
  notifyPipelineBlocked,
  notifySystemRecovered,
} = require('./telegram-notifier');

let watchdogJob = null;
let isChecking = false;

async function runWatchdogCheck() {
  if (isChecking) return;
  isChecking = true;

  try {
    logger.info('PipelineWatchdog: check started');
    const thresholds = getOperationalThresholds();
    const snapshot = getQueueSnapshot();
    const state = readPipelineState();
    const expectedSlot = getExpectedPublishSlot();
    const nowIso = new Date().toISOString();
    let recovered = false;

    if (snapshot.readyCount < thresholds.minReady) {
      logger.warn(`PipelineWatchdog: low ready detected | ready=${snapshot.readyCount}/${thresholds.minReady} | inPipeline=${snapshot.inPipeline}`);
      await notifyQueueLow({
        readyCount: snapshot.readyCount,
        minReady: thresholds.minReady,
        inPipeline: snapshot.inPipeline,
        reason: 'watchdog_low_ready',
      });
      try {
        const { runGenerationCycle } = require('./scheduler.service');
        logger.info('PipelineWatchdog: forcing top-up recovery');
        await runGenerationCycle({ urgent: true });
        recovered = true;
      } catch (err) {
        logger.warn(`Watchdog: top-up recovery failed | ${err.message}`);
      }
    }

    const noRecentProgress = getMinutesSince(state.lastProgressAt) >= thresholds.progressStaleMinutes;
    if (noRecentProgress && snapshot.totalBuffered === 0) {
      logger.warn(`PipelineWatchdog: no real progress detected | stale=${getMinutesSince(state.lastProgressAt)}min`);
      await notifyPipelineBlocked({
        reason: 'no_real_progress',
        detail: `sin progreso ${getMinutesSince(state.lastProgressAt)} min y cola vacía`,
      });
      try {
        const { runGenerationCycle } = require('./scheduler.service');
        logger.info('PipelineWatchdog: forcing generation recovery after no progress');
        await runGenerationCycle({ urgent: true });
        recovered = true;
      } catch (err) {
        logger.warn(`Watchdog: stalled generation recovery failed | ${err.message}`);
      }
    }

    const staleActive = snapshot.activeJobs.find((job) => getMinutesSince(job.lastProgressAt || job.startedAt || job.createdAt) >= thresholds.activeStaleMinutes);
    if (staleActive) {
      logger.warn(`PipelineWatchdog: stale active job detected | job=${staleActive.id}`);
      await notifyPipelineBlocked({
        reason: 'active_job_stale',
        detail: `job ${staleActive.id} sin avance ${getMinutesSince(staleActive.lastProgressAt || staleActive.startedAt || staleActive.createdAt)} min`,
      });
    }

    const staleReady = snapshot.readyVideos.find((video) => getMinutesSince(video.createdAt) >= thresholds.readyStaleHours * 60);
    if (staleReady) {
      logger.warn(`PipelineWatchdog: stale ready video detected | video=${staleReady.videoId} | aged=${getMinutesSince(staleReady.createdAt)}min`);
      await notifyPipelineBlocked({
        reason: 'ready_video_stale',
        detail: `video ${staleReady.videoId} listo desde hace ${getMinutesSince(staleReady.createdAt)} min — next publish slot will handle it`,
      });

      const publishOnStale = process.env.PIPELINE_WATCHDOG_PUBLISH_ON_STALE !== 'false';
      if (publishOnStale) {
        try {
          const { runPublishCycle } = require('./publish-scheduler.service');
          logger.info('PipelineWatchdog: forcing publish recovery for stale ready video');
          await runPublishCycle({ force: true });
          recovered = true;
        } catch (err) {
          logger.warn(`Watchdog: stale ready publish recovery failed | ${err.message}`);
        }
      } else {
        logger.info('PipelineWatchdog: stale publish forcing disabled — waiting for scheduled slot');
      }
    }

    if (expectedSlot && snapshot.readyCount === 0 && snapshot.inPipeline === 0) {
      const publishState = state.publishLastSuccessfulAt ? getMinutesSince(state.publishLastSuccessfulAt) : Number.POSITIVE_INFINITY;
      if (publishState >= thresholds.publishMissGraceMinutes) {
        logger.warn(`PipelineWatchdog: publish slot missed | slot=${expectedSlot.slot}`);
        await notifyPipelineBlocked({
          reason: 'publish_slot_missed',
          detail: `slot ${expectedSlot.slot} sin ready ni publish reciente`,
        });
      }
    }

    writePipelineState({
      watchdogLastCheckedAt: nowIso,
      watchdogSnapshot: {
        readyCount: snapshot.readyCount,
        inPipeline: snapshot.inPipeline,
        failedCount: snapshot.failedCount,
      },
    });
    logger.info(`PipelineWatchdog: check finished | ready=${snapshot.readyCount} | pending=${snapshot.pendingCount} | active=${snapshot.activeCount} | recovered=${recovered}`);

    if (recovered) {
      await notifySystemRecovered({ scope: 'watchdog', detail: 'acción automática ejecutada' });
    }
  } finally {
    isChecking = false;
  }
}

function startPipelineWatchdog() {
  if (watchdogJob) return;
  const cronExpr = process.env.PIPELINE_WATCHDOG_CRON || '*/15 * * * *';
  writePipelineState({
    watchdogStartedAt: new Date().toISOString(),
    watchdogCron: cronExpr,
    watchdogRunning: true,
  });
  logger.info(`PipelineWatchdog: starting | cron=${cronExpr}`);
  watchdogJob = cron.schedule(cronExpr, () => {
    logger.info('PipelineWatchdog: cron triggered');
    runWatchdogCheck().catch((err) => logger.warn(`Watchdog: check failed | ${err.message}`));
  }, { timezone: 'Europe/Madrid' });
  logger.info(`PipelineWatchdog: active (${cronExpr})`);
  setTimeout(() => runWatchdogCheck().catch((err) => logger.warn(`Watchdog startup check failed | ${err.message}`)), 20000);
}

module.exports = {
  startPipelineWatchdog,
  runWatchdogCheck,
};
