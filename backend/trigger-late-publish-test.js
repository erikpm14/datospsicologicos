const { attemptLatePublish } = require('./src/services/late-publish-recovery');
const logger = require('./src/utils/logger');

const videoId = process.argv[2];

if (!videoId) {
  logger.error('Usage: node trigger-late-publish-test.js <videoId>');
  process.exit(1);
}

logger.warn(`[TEST] Attempting late-publish for: ${videoId}`);

(async () => {
  try {
    const success = await attemptLatePublish(videoId);
    if (success) {
      logger.info(`[TEST] ✓ Late-publish SUCCEEDED`);
    } else {
      logger.info(`[TEST] Late-publish returned false (conditions not met)`);
    }
    process.exit(0);
  } catch (err) {
    logger.error(`[TEST] Late-publish failed: ${err.message}`);
    process.exit(1);
  }
})();
