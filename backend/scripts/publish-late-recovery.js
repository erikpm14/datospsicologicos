#!/usr/bin/env node
/**
 * FASE 0 — Publicación tardía inmediata
 * Publica vídeos ya renderizados sin tocar LLM
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const logger = require('../src/utils/logger');
const { shouldBlockDuplicate, getRecentPublishedVideos } = require('../src/services/duplicate-hard-block.service');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../output-fase1-test'));

async function main() {
  console.log('[MANUAL_LATE_PUBLISH_STARTED]');
  logger.info('[MANUAL_LATE_PUBLISH_STARTED]');

  try {
    // Step 1: Scan ready videos
    const candidates = [];
    const dirs = fs.readdirSync(OUTPUT_DIR)
      .filter(d => fs.statSync(path.join(OUTPUT_DIR, d)).isDirectory());

    for (const videoId of dirs) {
      const videoDir = path.join(OUTPUT_DIR, videoId);
      const mp4Path = path.join(videoDir, 'output.mp4');
      const scriptPath = path.join(videoDir, 'script.json');
      const publishedPath = path.join(videoDir, 'published.json');

      // Hard blocks
      if (!fs.existsSync(mp4Path)) continue;
      if (fs.existsSync(publishedPath)) continue;
      if (!fs.existsSync(scriptPath)) continue;

      const stats = fs.statSync(mp4Path);
      if (stats.size < 100 * 1024) continue;

      let script;
      try {
        script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
      } catch {
        continue;
      }

      candidates.push({
        videoId,
        sizeKB: (stats.size / 1024).toFixed(0),
        viralityScore: script.viralityScore || 0,
        topic: script.topic || 'unknown',
        hook: (script.hook || '').substring(0, 50),
        script,
      });
    }

    console.log(`[MANUAL_LATE_PUBLISH_CANDIDATES] count=${candidates.length}`);
    logger.info(`[MANUAL_LATE_PUBLISH_CANDIDATES] count=${candidates.length}`);

    if (candidates.length === 0) {
      console.log('[MANUAL_LATE_PUBLISH_NO_CANDIDATES] No valid videos found');
      logger.error('[MANUAL_LATE_PUBLISH_NO_CANDIDATES] No valid videos found');
      process.exit(1);
    }

    // Step 2: Check duplicates for top candidate
    const { publishAll } = require('../src/services/publisher');
    const { saveVideo } = require('../src/services/analytics-tracker');

    candidates.sort((a, b) => (b.viralityScore || 0) - (a.viralityScore || 0));
    const selected = candidates[0];

    console.log(`[MANUAL_LATE_PUBLISH_SELECTED] videoId=${selected.videoId.substring(0, 8)}...`);
    logger.info(`[MANUAL_LATE_PUBLISH_SELECTED] videoId=${selected.videoId} | virality=${selected.viralityScore} | topic=${selected.topic}`);

    // CENTRALIZED DUPLICATE CHECK — against last 20 published videos
    const recentPublished = getRecentPublishedVideos(20);
    const duplicateCheck = shouldBlockDuplicate(selected.script, recentPublished);

    if (duplicateCheck.blocked) {
      console.log(`[MANUAL_LATE_PUBLISH_BLOCKED_DUPLICATE] reason=${duplicateCheck.reason} matched=${duplicateCheck.matchedVideoId}`);
      logger.error(
        `[MANUAL_LATE_PUBLISH_BLOCKED_DUPLICATE] videoId=${selected.videoId} | ` +
        `matched_with=${duplicateCheck.matchedVideoId} | ` +
        `match_reasons=[${duplicateCheck.matchReasons.join(', ')}]`
      );
      console.log('[MANUAL_LATE_PUBLISH_NO_LLM_USED]');
      process.exit(1);
    }

    // Step 3: Publish
    const videoPath = path.join(OUTPUT_DIR, selected.videoId, 'output.mp4');
    logger.info(`[MANUAL_LATE_PUBLISH_PUBLISHING] videoId=${selected.videoId} size=${selected.sizeKB}KB`);

    const { results, errors } = await publishAll(videoPath, selected.script, null, {
      source: 'publish-late-recovery',
      isManual: true,
      skipPrepublishVisualQC: false,
    });
    const publishedIds = {};

    for (const r of results) {
      if (r.platform === 'tiktok') publishedIds.tiktokId = r.publishId;
      if (r.platform === 'instagram') publishedIds.instagramId = r.mediaId;
      if (r.platform === 'youtube') publishedIds.youtubeId = r.videoId;
    }

    // Step 4: Mark as published
    const publishedFilePath = path.join(OUTPUT_DIR, selected.videoId, 'published.json');
    fs.writeFileSync(publishedFilePath, JSON.stringify({
      publishedAt: new Date().toISOString(),
      lateRecovery: true,
      platforms: results.map(r => r.platform),
      errors,
      ...publishedIds,
    }, null, 2));

    // Step 5: Save to analytics
    try {
      await saveVideo({
        id: selected.videoId,
        title: selected.script?.title || selected.videoId,
        topic: selected.topic,
        hook: selected.hook,
        viralityScore: selected.viralityScore,
        script: { ...selected.script, lateRecovery: true },
        ...publishedIds,
      });
    } catch (err) {
      logger.warn(`[MANUAL_LATE_PUBLISH_ANALYTICS_FAILED] ${err.message}`);
    }

    console.log(`[MANUAL_LATE_PUBLISH_SUCCESS] youtubeId=${publishedIds.youtubeId || 'N/A'}`);
    logger.info(`[MANUAL_LATE_PUBLISH_SUCCESS] videoId=${selected.videoId} | youtubeId=${publishedIds.youtubeId || 'N/A'} | platforms=${results.map(r => r.platform).join(',')}`);

    console.log('[MANUAL_LATE_PUBLISH_NO_LLM_USED]');
    logger.info('[MANUAL_LATE_PUBLISH_NO_LLM_USED]');

    process.exit(0);
  } catch (err) {
    console.log(`[MANUAL_LATE_PUBLISH_FAILED] error=${err.message}`);
    logger.error(`[MANUAL_LATE_PUBLISH_FAILED] ${err.message}`, err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[MANUAL_LATE_PUBLISH_CRASHED] ${err.message}`);
  logger.error(`[MANUAL_LATE_PUBLISH_CRASHED] ${err.message}`, err);
  process.exit(1);
});
