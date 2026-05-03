/**
 * ffmpeg-fallback-monitor.js
 * Verifica que el bypass de ffmpeg sea TEMPORAL, no permanente
 *
 * Si el bypass sigue activo después de 1 slot → ALERT CRÍTICO a Telegram
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getFFprobe } = require('../utils/ffmpeg-resolver');

const MONITOR_STATE_FILE = path.resolve('./data/ffmpeg-fallback-monitor.json');

function initMonitor() {
  const state = {
    fallbackActivatedAt: null,
    slotsWithFallback: 0,
    lastCheckAt: new Date().toISOString(),
    status: 'monitoring'
  };

  if (!fs.existsSync(MONITOR_STATE_FILE)) {
    fs.writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state, null, 2));
  }

  return state;
}

function recordFallbackUsage(videoId, reason) {
  try {
    let state = initMonitor();

    if (fs.existsSync(MONITOR_STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(MONITOR_STATE_FILE, 'utf8'));
    }

    if (!state.fallbackActivatedAt) {
      state.fallbackActivatedAt = new Date().toISOString();
      state.slotsWithFallback = 1;
      logger.warn(`FFMPEG_FALLBACK_ACTIVATED: first usage at ${state.fallbackActivatedAt}`);
    } else {
      state.slotsWithFallback += 1;
    }

    state.lastCheckAt = new Date().toISOString();
    state.lastVideoId = videoId;
    state.lastReason = reason;

    fs.writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state, null, 2));

    // CRITICAL: Si ffmpeg está disponible pero el bypass sigue activo, hay un problema
    if (getFFprobe() && state.slotsWithFallback > 1) {
      logger.error(`FFMPEG_FALLBACK_PERSISTENT: ffmpeg IS available but fallback used ${state.slotsWithFallback} times — BUG IN QC LOGIC`);
      return { alert: 'CRITICAL', reason: 'ffmpeg_available_but_fallback_used' };
    }

    return { alert: null, state };
  } catch (err) {
    logger.error(`Failed to record fallback usage: ${err.message}`);
    return { alert: null };
  }
}

function checkFallbackStatus() {
  try {
    if (!fs.existsSync(MONITOR_STATE_FILE)) {
      return { status: 'not_monitoring' };
    }

    const state = JSON.parse(fs.readFileSync(MONITOR_STATE_FILE, 'utf8'));

    // Si el bypass fue activado pero ffmpeg ahora está disponible → ERROR
    if (state.fallbackActivatedAt && getFFprobe()) {
      const activatedAt = new Date(state.fallbackActivatedAt);
      const now = new Date();
      const minutesAgo = Math.round((now - activatedAt) / 60000);

      logger.error(`FFMPEG_FALLBACK_RECOVERY_FAILED: bypass activated ${minutesAgo} min ago but ffmpeg is NOW available`);
      return {
        status: 'fallback_should_be_disabled',
        fallbackActivatedAt: state.fallbackActivatedAt,
        minutesAgo,
        slotsAffected: state.slotsWithFallback,
        ffmpegNowAvailable: true
      };
    }

    // Si el bypass sigue activo después de 1 slot → ALERTA
    if (state.slotsWithFallback > 1) {
      return {
        status: 'fallback_persistent',
        slotsWithFallback: state.slotsWithFallback,
        alert: 'CRITICAL'
      };
    }

    return {
      status: 'normal',
      fallbackUsageCount: state.slotsWithFallback
    };
  } catch (err) {
    logger.error(`Failed to check fallback status: ${err.message}`);
    return { status: 'error', error: err.message };
  }
}

function resetMonitor() {
  try {
    if (fs.existsSync(MONITOR_STATE_FILE)) {
      fs.unlinkSync(MONITOR_STATE_FILE);
      logger.info('FFMPEG_FALLBACK_MONITOR: reset');
    }
  } catch (err) {
    logger.error(`Failed to reset monitor: ${err.message}`);
  }
}

module.exports = {
  initMonitor,
  recordFallbackUsage,
  checkFallbackStatus,
  resetMonitor,
};
