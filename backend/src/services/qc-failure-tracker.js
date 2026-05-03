/**
 * qc-failure-tracker.js
 * Monitorea fallos consecutivos de QC y activa kill-switch si es necesario
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const QC_FAILURE_STATE = path.resolve('./data/qc-failure-state.json');
const QC_FAILURE_THRESHOLD = 3; // 3 fallos consecutivos = kill-switch

/**
 * Lee el estado actual de fallos QC
 */
function getQCFailureState() {
  try {
    if (!fs.existsSync(QC_FAILURE_STATE)) {
      return {
        consecutiveFailures: 0,
        lastFailureVideoId: null,
        lastFailureTime: null,
        killSwitchActive: false,
      };
    }
    return JSON.parse(fs.readFileSync(QC_FAILURE_STATE, 'utf8'));
  } catch (err) {
    logger.warn(`Cannot read QC failure state: ${err.message}`);
    return {
      consecutiveFailures: 0,
      lastFailureVideoId: null,
      lastFailureTime: null,
      killSwitchActive: false,
    };
  }
}

/**
 * Guarda el estado de fallos QC
 */
function saveQCFailureState(state) {
  try {
    const dir = path.dirname(QC_FAILURE_STATE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(QC_FAILURE_STATE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.error(`Failed to save QC failure state: ${err.message}`);
  }
}

/**
 * Registra un fallo de QC y verifica kill-switch
 */
function recordQCFailure(videoId, blockedReasons) {
  const state = getQCFailureState();

  state.consecutiveFailures += 1;
  state.lastFailureVideoId = videoId;
  state.lastFailureTime = new Date().toISOString();

  logger.warn(`QC_FAILURE_RECORDED videoId=${videoId} consecutiveFailures=${state.consecutiveFailures}/${QC_FAILURE_THRESHOLD}`, {
    blockedReasons: blockedReasons || [],
  });

  // Verificar kill-switch
  if (state.consecutiveFailures >= QC_FAILURE_THRESHOLD) {
    state.killSwitchActive = true;
    logger.error(`AUTO_PUBLISH_DISABLED_QC_FAILURE consecutiveFailures=${state.consecutiveFailures}`, {
      threshold: QC_FAILURE_THRESHOLD,
      recommendation: 'Set AUTO_PUBLISH_ENABLED=false and investigate QC failures',
    });

    // Solo si se permite explÃ­citamente (evita apagados silenciosos)
    if (process.env.QC_KILL_SWITCH_WRITE_ENV === 'true') {
      try {
        const envPath = path.resolve('./.env');
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf8');
          // Reemplazar o aÃ±adir AUTO_PUBLISH_ENABLED=false
          if (envContent.includes('AUTO_PUBLISH_ENABLED=')) {
            envContent = envContent.replace(/AUTO_PUBLISH_ENABLED=.+/g, 'AUTO_PUBLISH_ENABLED=false');
          } else {
            envContent += '\nAUTO_PUBLISH_ENABLED=false';
          }
          fs.writeFileSync(envPath, envContent);
          logger.info(`AUTO_PUBLISH_ENABLED set to false in .env due to QC failures`);
        }
      } catch (err) {
        logger.error(`Failed to set AUTO_PUBLISH_ENABLED=false: ${err.message}`);
      }
    }
  }

  saveQCFailureState(state);
  return state;
}

/**
 * Resetea el contador de fallos en caso de Ã©xito de QC
 */
function recordQCSuccess(videoId) {
  const state = getQCFailureState();

  logger.info(`QC_PASS videoId=${videoId} resetConsecutiveFailures`);

  state.consecutiveFailures = 0;
  state.lastFailureVideoId = null;
  state.lastFailureTime = null;
  // NO resetear killSwitchActive automÃ¡ticamente - requiere intervenciÃ³n manual

  saveQCFailureState(state);
  return state;
}

/**
 * Resetea manualmente el kill-switch (requiere intervenciÃ³n)
 */
function resetKillSwitch() {
  const state = getQCFailureState();

  state.killSwitchActive = false;
  state.consecutiveFailures = 0;
  state.lastFailureVideoId = null;
  state.lastFailureTime = null;

  saveQCFailureState(state);

  logger.warn(`QC_FAILURE_TRACKER_MANUAL_RESET killSwitchReset=true`);
  return state;
}

/**
 * Verifica si el kill-switch estÃ¡ activo
 */
function isKillSwitchActive() {
  return getQCFailureState().killSwitchActive;
}

module.exports = {
  getQCFailureState,
  recordQCFailure,
  recordQCSuccess,
  resetKillSwitch,
  isKillSwitchActive,
};

