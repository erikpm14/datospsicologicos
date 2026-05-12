/**
 * PUBLISH IDEMPOTENCY LOCK SERVICE
 *
 * Prevents concurrent uploads of the same videoId to YouTube.
 * Uses atomic file operations (fs.open with "wx" flag) for race-condition-free locking.
 *
 * CRITICAL: This is the final defense against the 5a81501b triple-publication issue.
 * Two concurrent uploads cannot both proceed past this lock.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');
const LOCK_EXPIRY_MINUTES = 30; // Lock expires after 30 minutes

/**
 * Creates an atomic idempotency lock for a videoId
 * Uses fs.open with "wx" flag (exclusive write) - atomic at OS level
 *
 * @param {string} videoId - The video ID to lock
 * @param {object} context - { source, reason, pid? }
 * @returns {object} { acquired: boolean, error?: string, lockPath?: string, existingLock?: object }
 */
function acquirePublishLock(videoId, context = {}) {
  if (!videoId || typeof videoId !== 'string') {
    return { acquired: false, error: 'Invalid videoId' };
  }

  const videoDir = path.join(OUTPUT_DIR, videoId);
  const lockPath = path.join(videoDir, 'publishing-lock.json');

  const lockData = {
    videoId,
    source: context.source || 'unknown',
    reason: context.reason || 'standard_publish',
    createdAt: new Date().toISOString(),
    pid: context.pid || process.pid,
    status: 'upload_in_progress',
    hostname: require('os').hostname(),
  };

  logger.info(`[PUBLISH_IDEMPOTENCY_LOCK_CREATE_ATTEMPT] videoId=${videoId} source=${context.source}`);

  try {
    // Ensure directory exists
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }

    // ATOMIC OPERATION: fs.open with "wx" flag fails if file exists
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, JSON.stringify(lockData, null, 2));
    fs.closeSync(fd);

    logger.info(`[PUBLISH_IDEMPOTENCY_LOCK_CREATED] videoId=${videoId} lockPath=${lockPath}`);
    return {
      acquired: true,
      lockPath,
      lockData,
    };
  } catch (err) {
    // Lock file already exists - another upload in progress
    if (err.code === 'EEXIST') {
      let existingLock = null;
      try {
        existingLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      } catch {}

      logger.error(`[PUBLISH_BLOCKED_ALREADY_IN_PROGRESS] videoId=${videoId} existing_source=${existingLock?.source || 'unknown'}`);
      logger.error(`[CONCURRENT_UPLOAD_DETECTED] videoId=${videoId} new_source=${context.source} existing_source=${existingLock?.source}`);

      return {
        acquired: false,
        error: 'Another upload already in progress for this videoId',
        existingLock,
      };
    }

    // Other error (permission, etc)
    logger.error(`[PUBLISH_IDEMPOTENCY_LOCK_CREATE_FAILED] videoId=${videoId} error=${err.message}`);
    return {
      acquired: false,
      error: `Failed to create lock: ${err.message}`,
    };
  }
}

/**
 * Release lock after successful publication
 *
 * @param {string} videoId - The video ID
 * @param {boolean} success - True if upload succeeded
 * @param {string} youtubeId - YouTube video ID (if success)
 * @returns {boolean}
 */
function releasePublishLock(videoId, success = false, youtubeId = null) {
  const videoDir = path.join(OUTPUT_DIR, videoId);
  const lockPath = path.join(videoDir, 'publishing-lock.json');

  if (!fs.existsSync(lockPath)) {
    return false;
  }

  try {
    if (success && youtubeId) {
      // Update lock with completion info before removing
      const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      lockData.status = 'completed';
      lockData.youtubeId = youtubeId;
      lockData.completedAt = new Date().toISOString();
      fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2));

      logger.info(`[PUBLISH_IDEMPOTENCY_LOCK_COMPLETED] videoId=${videoId} youtubeId=${youtubeId}`);

      // Remove lock file after marked as completed
      try {
        fs.unlinkSync(lockPath);
        logger.info(`[PUBLISH_IDEMPOTENCY_LOCK_REMOVED] videoId=${videoId}`);
      } catch (rmErr) {
        logger.warn(`[PUBLISH_IDEMPOTENCY_LOCK_REMOVE_FAILED] videoId=${videoId} error=${rmErr.message}`);
      }
    } else {
      // Mark as failed - allow retry
      const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      lockData.status = 'failed';
      lockData.failedAt = new Date().toISOString();
      fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2));

      logger.warn(`[PUBLISH_IDEMPOTENCY_LOCK_FAILED] videoId=${videoId}`);
    }

    return true;
  } catch (err) {
    logger.error(`[PUBLISH_IDEMPOTENCY_LOCK_RELEASE_ERROR] videoId=${videoId} error=${err.message}`);
    return false;
  }
}

/**
 * Check if an active lock exists for this videoId
 * Returns null if no lock or lock is stale
 *
 * @param {string} videoId
 * @returns {object|null} Lock data or null
 */
function getActiveLock(videoId) {
  const videoDir = path.join(OUTPUT_DIR, videoId);
  const lockPath = path.join(videoDir, 'publishing-lock.json');

  if (!fs.existsSync(lockPath)) {
    return null;
  }

  try {
    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const createdAt = new Date(lockData.createdAt);
    const now = new Date();
    const ageMinutes = (now - createdAt) / 60000;

    // Check if lock is stale
    if (ageMinutes > LOCK_EXPIRY_MINUTES) {
      logger.warn(`[STALE_PUBLISH_LOCK_DETECTED] videoId=${videoId} age=${ageMinutes.toFixed(1)}min status=${lockData.status}`);

      // Only allow recovery if upload never completed (no youtubeId, no published.json)
      const publishedPath = path.join(videoDir, 'published.json');
      const metadataPath = path.join(videoDir, 'generation-metadata.json');

      let hasYoutubeId = false;
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          hasYoutubeId = !!metadata.youtubeId;
        } catch {}
      }

      if (!fs.existsSync(publishedPath) && !hasYoutubeId) {
        // Safe to recover - clean up stale lock
        try {
          fs.unlinkSync(lockPath);
          logger.info(`[STALE_PUBLISH_LOCK_RECOVERED] videoId=${videoId} cleaned up`);
          return null;
        } catch (err) {
          logger.error(`[STALE_PUBLISH_LOCK_CLEANUP_FAILED] videoId=${videoId}`);
        }
      }
    }

    // Lock is active
    if (lockData.status === 'upload_in_progress' || lockData.status === 'failed') {
      return lockData;
    }

    // Lock is completed or in unknown state - remove it
    try {
      fs.unlinkSync(lockPath);
    } catch {}
    return null;
  } catch (err) {
    logger.warn(`[PUBLISH_IDEMPOTENCY_LOCK_READ_ERROR] videoId=${videoId} error=${err.message}`);
    return null;
  }
}

module.exports = {
  acquirePublishLock,
  releasePublishLock,
  getActiveLock,
  LOCK_EXPIRY_MINUTES,
};
