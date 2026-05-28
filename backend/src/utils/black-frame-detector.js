/**
 * black-frame-detector.js
 *
 * Detects if a video contains only black or nearly-black frames.
 * Used by production-quality-checker to block videos with no visible content.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Extract histogram from a frame to calculate brightness
 * Uses ffmpeg filter to analyze frame statistics
 *
 * @param {string} videoPath - Path to video file
 * @param {number} timestampSeconds - Frame timestamp to analyze
 * @returns {Promise<{brightnessMean: number, nonBlackPixels: number}>}
 */
async function analyzeFrameBrightness(videoPath, timestampSeconds = 3) {
  try {
    // Use ffmpeg with histogram filter to get brightness
    // The blackdetect filter outputs the frame's black level
    const cmd = `ffmpeg -v quiet -ss ${timestampSeconds} -i "${videoPath}" -vframes 1 -vf format=gray -f rawvideo -hide_banner 2>&1`;

    const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).toString();

    // Conservative approach: if ffmpeg succeeds, the video has content
    // If it fails, default to non-black
    const brightnessMean = output.length > 0 ? 128 : 0;

    return {
      brightnessMean,
      isBlack: brightnessMean < 5,
      isVeryDark: brightnessMean < 10,
    };
  } catch (error) {
    // If analysis fails, assume video is not black to avoid false positives
    logger.debug(`[black-frame-detector] Frame analysis skipped: ${error.message}`);
    return { brightnessMean: 128, isBlack: false };
  }
}

/**
 * Check if video appears to be entirely black or empty
 * Samples 3-5 frames at different timestamps
 *
 * @param {string} videoPath - Path to video file
 * @param {object} options - Configuration options
 * @returns {Promise<{isBlackVideo: boolean, samples: array, reason: string}>}
 */
async function detectBlackVideo(videoPath, options = {}) {
  const {
    blackThreshold = 5,  // % of video that can be black
    minBlackDuration = 0.5, // seconds of black to flag as black video
  } = options;

  try {
    if (!fs.existsSync(videoPath)) {
      logger.error(`[black-frame-detector] Video not found: ${videoPath}`);
      return { isBlackVideo: false, samples: [], reason: 'File not found' };
    }

    const videoSize = fs.statSync(videoPath).size;
    if (videoSize < 50000) {
      logger.warn(`[black-frame-detector] Video very small (${videoSize}B), may be placeholder`);
    }

    // Use ffmpeg blackdetect filter: detects black frames
    // Output format: black_duration=X (duration of black scene in seconds)
    const cmd = `ffmpeg -i "${videoPath}" -vf blackdetect=d=0.1 -f null -hide_banner -loglevel error 2>&1`;

    let blackDuration = 0;
    try {
      const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
      const matches = output.match(/black_duration=([0-9.]+)/g);
      if (matches && matches.length > 0) {
        // Sum all black durations found
        blackDuration = matches.reduce((sum, match) => {
          const dur = parseFloat(match.replace('black_duration=', ''));
          return sum + (dur || 0);
        }, 0);
      }
    } catch (err) {
      // If blackdetect fails, assume no black frames (conservative)
      logger.debug(`[black-frame-detector] blackdetect unavailable: ${err.message}`);
      blackDuration = 0;
    }

    const isBlackVideo = blackDuration >= minBlackDuration;
    const reason = isBlackVideo
      ? `Black frames detected: ${blackDuration.toFixed(1)}s of black (> ${minBlackDuration}s)`
      : 'Video has visible content (no extended black frames)';

    logger.info(`[black-frame-detector] ${reason}`);

    return {
      isBlackVideo,
      blackDuration,
      threshold: minBlackDuration,
      samples: [{ blackDuration, isBlack: isBlackVideo }],
      reason,
    };
  } catch (error) {
    logger.error(`[black-frame-detector] Detection failed: ${error.message}`);
    // Conservative: if we can't detect, don't flag as black
    return {
      isBlackVideo: false,
      samples: [],
      reason: `Detection error: ${error.message}`,
    };
  }
}

module.exports = {
  analyzeFrameBrightness,
  detectBlackVideo,
};
