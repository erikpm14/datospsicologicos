#!/usr/bin/env node
/**
 * test-retention-spikes.js
 * Script de prueba: genera un vídeo de producción con retention spikes optimizados
 *
 * Uso: node test-retention-spikes.js
 */

require('dotenv').config();

const { generateRetentionSpikesTestVideo } = require('./src/services/retention-spike-validator');
const logger = require('./src/utils/logger');

(async () => {
  try {
    const result = await generateRetentionSpikesTestVideo();

    if (result.success) {
      logger.info('✓ TEST PASSED');
      logger.info(`Export path: ${result.exportPath}`);
      process.exit(0);
    } else {
      logger.error('✗ TEST FAILED');
      result.validation.errors.forEach((e) => logger.error(`  ${e}`));
      process.exit(1);
    }
  } catch (err) {
    logger.error('FATAL ERROR:', err.message);
    process.exit(1);
  }
})();
