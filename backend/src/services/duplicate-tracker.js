/**
 * duplicate-tracker.js
 * FASE 3: Rastrear qué vídeos fueron bloqueados por ser duplicados
 *
 * Guarda:
 * - originalVideoId
 * - similarityScore
 * - duplicateBlocked: true/false
 * - reason
 * - matchedVideos
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DUPLICATE_TRACK_FILE = path.resolve('./data/duplicate-tracking.json');

function ensureTrackerFile() {
  if (!fs.existsSync(DUPLICATE_TRACK_FILE)) {
    const initialData = {
      blockedCount: 0,
      warningCount: 0,
      blocked: [],
      warnings: [],
      metadata: {
        createdAt: new Date().toISOString(),
        lastUpdate: null,
      },
    };
    fs.writeFileSync(DUPLICATE_TRACK_FILE, JSON.stringify(initialData, null, 2));
  }
}

function recordDuplicateBlock(scriptId, detection) {
  try {
    ensureTrackerFile();
    const tracker = JSON.parse(fs.readFileSync(DUPLICATE_TRACK_FILE, 'utf8'));

    const entry = {
      scriptId,
      blockedAt: new Date().toISOString(),
      reason: detection.blockedReason,
      similarityScore: detection.similarityScore,
      exactHookMatches: detection.exactHookMatches.length,
      duplicateRisks: detection.duplicateRisks.length,
      matchedVideos: detection.exactHookMatches
        .slice(0, 3)
        .map(m => ({
          videoId: m.videoId,
          youtubeId: m.youtubeId,
          hook: m.hook.substring(0, 50),
          daysAgo: m.daysAgo,
        })),
      details: detection.blockedReason,
    };

    tracker.blocked.push(entry);
    tracker.blockedCount = tracker.blocked.length;
    tracker.metadata.lastUpdate = new Date().toISOString();

    // Keep only last 500 blocks
    if (tracker.blocked.length > 500) {
      tracker.blocked = tracker.blocked.slice(-500);
    }

    fs.writeFileSync(DUPLICATE_TRACK_FILE, JSON.stringify(tracker, null, 2));

    logger.info(`[DUPLICATE_TRACKED] scriptId=${scriptId} reason=${detection.blockedReason}`);
    return true;
  } catch (err) {
    logger.error(`Failed to record duplicate block: ${err.message}`);
    return false;
  }
}

function recordDuplicateWarning(scriptId, similarity) {
  try {
    ensureTrackerFile();
    const tracker = JSON.parse(fs.readFileSync(DUPLICATE_TRACK_FILE, 'utf8'));

    const entry = {
      scriptId,
      warningAt: new Date().toISOString(),
      similarityScore: similarity,
      notes: `High similarity (${similarity}%) but below block threshold`,
    };

    tracker.warnings.push(entry);
    tracker.warningCount = tracker.warnings.length;
    tracker.metadata.lastUpdate = new Date().toISOString();

    // Keep only last 500 warnings
    if (tracker.warnings.length > 500) {
      tracker.warnings = tracker.warnings.slice(-500);
    }

    fs.writeFileSync(DUPLICATE_TRACK_FILE, JSON.stringify(tracker, null, 2));

    logger.warn(`[DUPLICATE_WARNING_TRACKED] scriptId=${scriptId} similarity=${similarity}%`);
    return true;
  } catch (err) {
    logger.error(`Failed to record duplicate warning: ${err.message}`);
    return false;
  }
}

function getDuplicateStats() {
  try {
    ensureTrackerFile();
    const tracker = JSON.parse(fs.readFileSync(DUPLICATE_TRACK_FILE, 'utf8'));

    return {
      totalBlocked: tracker.blockedCount,
      totalWarnings: tracker.warningCount,
      recentBlocks: tracker.blocked.slice(-10),
      recentWarnings: tracker.warnings.slice(-10),
      blockedReasons: tracker.blocked.reduce((acc, entry) => {
        acc[entry.reason] = (acc[entry.reason] || 0) + 1;
        return acc;
      }, {}),
    };
  } catch (err) {
    logger.error(`Failed to get duplicate stats: ${err.message}`);
    return null;
  }
}

function clearOldEntries(daysToKeep = 30) {
  try {
    ensureTrackerFile();
    const tracker = JSON.parse(fs.readFileSync(DUPLICATE_TRACK_FILE, 'utf8'));

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const beforeCount = tracker.blocked.length + tracker.warnings.length;

    tracker.blocked = tracker.blocked.filter(entry => new Date(entry.blockedAt) > cutoffDate);
    tracker.warnings = tracker.warnings.filter(entry => new Date(entry.warningAt) > cutoffDate);

    tracker.blockedCount = tracker.blocked.length;
    tracker.warningCount = tracker.warnings.length;
    tracker.metadata.lastUpdate = new Date().toISOString();
    tracker.metadata.lastCleanup = new Date().toISOString();

    fs.writeFileSync(DUPLICATE_TRACK_FILE, JSON.stringify(tracker, null, 2));

    const afterCount = tracker.blocked.length + tracker.warnings.length;
    logger.info(`[DUPLICATE_CLEANUP] Removed ${beforeCount - afterCount} old entries (kept last ${daysToKeep} days)`);

    return true;
  } catch (err) {
    logger.error(`Failed to clean duplicate tracking: ${err.message}`);
    return false;
  }
}

module.exports = {
  recordDuplicateBlock,
  recordDuplicateWarning,
  getDuplicateStats,
  clearOldEntries,
};
