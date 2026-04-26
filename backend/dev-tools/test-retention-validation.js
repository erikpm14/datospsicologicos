#!/usr/bin/env node
/**
 * test-retention-validation.js
 * Valida vídeos exportados para cumplimiento de retention spikes
 *
 * Uso: node test-retention-validation.js [days-back]
 */

require('dotenv').config();

const { validateAllExports } = require('./src/services/retention-spike-validator');
const logger = require('./src/utils/logger');

(async () => {
  try {
    const daysBack = parseInt(process.argv[2] || '1');
    const result = await validateAllExports(daysBack);

    if (result.success) {
      logger.info('\n✓ ALL VIDEOS PASSED VALIDATION');
      process.exit(0);
    } else {
      logger.error('\n✗ SOME VIDEOS FAILED VALIDATION');
      process.exit(1);
    }
  } catch (err) {
    logger.error('FATAL ERROR:', err.message);
    process.exit(1);
  }
})();
