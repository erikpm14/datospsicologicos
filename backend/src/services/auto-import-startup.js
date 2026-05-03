/**
 * auto-import-startup.js
 *
 * Inicia el servicio de auto-sync en segundo plano.
 * Se ejecuta automáticamente cuando la app arranca.
 *
 * Configuración via .env:
 *   AUTO_IMPORT_ENABLED=true (default)
 *   AUTO_IMPORT_INTERVAL_MINUTES=5 (default)
 */

const logger = require('../utils/logger');

let started = false;

/**
 * Iniciar auto-sync si está habilitado
 */
function initAutoImport() {
  if (started) return;

  const enabled = process.env.AUTO_IMPORT_ENABLED !== 'false';
  if (!enabled) {
    logger.debug('[AUTO_IMPORT] Disabled by env (AUTO_IMPORT_ENABLED=false)');
    return;
  }

  try {
    const { startAutoSync } = require('./auto-import-from-output.service');
    startAutoSync();
    started = true;
  } catch (err) {
    logger.warn(`[AUTO_IMPORT] Failed to start: ${err.message}`);
  }
}

/**
 * Detener auto-sync (para shutdown gracioso)
 */
function shutdownAutoImport() {
  if (!started) return;

  try {
    const { stopAutoSync } = require('./auto-import-from-output.service');
    stopAutoSync();
    started = false;
  } catch (err) {
    logger.warn(`[AUTO_IMPORT] Shutdown error: ${err.message}`);
  }
}

module.exports = {
  initAutoImport,
  shutdownAutoImport
};
