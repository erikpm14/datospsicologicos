/**
 * audio-subtitle-mapper.js
 * Maps subtitle blocks to real voice segments detected from audio.
 * Distributes text intelligently across detected voice regions to maintain synchronization.
 */

const logger = require('../utils/logger');

/**
 * Maps subtitle blocks to real voice segments.
 * Distributes script content across detected voice segments maintaining proper timing.
 *
 * @param {Array} scriptBlocks - Script content blocks with text
 * @param {Array} voiceSegments - Real voice segments [{start, end, duration}] from silencedetect
 * @param {number} totalDuration - Total video duration in seconds
 * @returns {Array<{text, startTime, endTime, duration}>} - Synchronized subtitle blocks
 */
function mapSubtitlesToVoiceSegments(scriptBlocks, voiceSegments, totalDuration) {
  if (!voiceSegments || voiceSegments.length === 0) {
    logger.warn('AudioSubtitleMapper: no voice segments available, fallback to estimated timing');
    return buildEstimatedFallback(scriptBlocks, totalDuration);
  }

  const mappedBlocks = [];
  const totalWords = scriptBlocks.reduce((sum, b) => sum + (b.text.split(/\s+/).length || 1), 0);
  let segmentIndex = 0;
  let currentOffset = 0;

  for (let i = 0; i < scriptBlocks.length; i++) {
    const block = scriptBlocks[i];
    const wordCount = block.text.split(/\s+/).length || 1;
    const wordRatio = wordCount / totalWords;

    if (segmentIndex >= voiceSegments.length) {
      // Remaining blocks after segments exhausted
      const remainingDuration = totalDuration - voiceSegments[voiceSegments.length - 1].end;
      const blockDuration = Math.max(0.5, remainingDuration / (scriptBlocks.length - i));
      mappedBlocks.push({
        text: block.text,
        startTime: voiceSegments[voiceSegments.length - 1].end + currentOffset,
        endTime: voiceSegments[voiceSegments.length - 1].end + currentOffset + blockDuration,
        duration: blockDuration,
      });
      currentOffset += blockDuration;
      continue;
    }

    const segment = voiceSegments[segmentIndex];
    const segmentDuration = segment.end - segment.start;

    // Distribute block across segment proportional to word count
    const blockDuration = Math.min(segmentDuration, segmentDuration * wordRatio);
    const startTime = segment.start + currentOffset;
    const endTime = Math.min(segment.end, startTime + blockDuration);

    mappedBlocks.push({
      text: block.text,
      startTime,
      endTime,
      duration: endTime - startTime,
    });

    currentOffset += (endTime - startTime);

    // Move to next segment if current one is exhausted
    if (currentOffset >= segmentDuration) {
      segmentIndex++;
      currentOffset = 0;
    }
  }

  logger.info(`AudioSubtitleMapper: mapped ${mappedBlocks.length} blocks to ${voiceSegments.length} voice segments`);
  return mappedBlocks;
}

/**
 * Builds estimated/fallback timing when voice segments unavailable.
 * Uses proportional distribution based on total duration.
 */
function buildEstimatedFallback(scriptBlocks, totalDuration) {
  const totalWords = scriptBlocks.reduce((sum, b) => sum + (b.text.split(/\s+/).length || 1), 0);
  let currentTime = 0.2; // Start 0.2s into video

  return scriptBlocks.map((block) => {
    const wordCount = block.text.split(/\s+/).length || 1;
    const blockDuration = (wordCount / totalWords) * (totalDuration * 0.85);
    const startTime = currentTime;
    const endTime = currentTime + blockDuration;
    currentTime = endTime + 0.05; // 50ms gap between blocks
    return {
      text: block.text,
      startTime,
      endTime,
      duration: blockDuration,
    };
  });
}

module.exports = { mapSubtitlesToVoiceSegments, buildEstimatedFallback };
