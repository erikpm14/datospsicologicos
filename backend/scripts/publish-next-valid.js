#!/usr/bin/env node
/**
 * Publica el siguiente vídeo VÁLIDO (no duplicado)
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
    // Scan candidates
    const candidates = [];
    const dirs = fs.readdirSync(OUTPUT_DIR)
      .filter(d => fs.statSync(path.join(OUTPUT_DIR, d)).isDirectory());

    for (const videoId of dirs) {
      const videoDir = path.join(OUTPUT_DIR, videoId);
      const mp4Path = path.join(videoDir, 'output.mp4');
      const scriptPath = path.join(videoDir, 'script.json');
      const publishedPath = path.join(videoDir, 'published.json');

      if (!fs.existsSync(mp4Path) || fs.existsSync(publishedPath) || !fs.existsSync(scriptPath)) continue;
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
    candidates.sort((a, b) => (b.viralityScore || 0) - (a.viralityScore || 0));

    // Try each candidate
    const recentPublished = getRecentPublishedVideos(20);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      console.log(`\n[TRYING_CANDIDATE_${i+1}] ${candidate.videoId.substring(0, 8)}... | virality=${candidate.viralityScore} | ${candidate.topic}`);

      const duplicateCheck = shouldBlockDuplicate(candidate.script, recentPublished);

      if (duplicateCheck.blocked) {
        console.log(`  ❌ BLOCKED: ${duplicateCheck.matchReasons.join(', ')}`);
        logger.warn(`[CANDIDATE_REJECTED] ${candidate.videoId} — ${duplicateCheck.reason}`);
        continue;
      }

      console.log(`  ✅ VALID — Publishing now...`);
      const { publishAll } = require('../src/services/publisher');
      const { saveVideo } = require('../src/services/analytics-tracker');

      const videoPath = path.join(OUTPUT_DIR, candidate.videoId, 'output.mp4');
      const { results, errors } = await publishAll(videoPath, candidate.script, null, {
        source: 'publish-next-valid',
        isManual: true,
        skipPrepublishVisualQC: false,
      });
      const publishedIds = {};

      for (const r of results) {
        if (r.platform === 'tiktok') publishedIds.tiktokId = r.publishId;
        if (r.platform === 'instagram') publishedIds.instagramId = r.mediaId;
        if (r.platform === 'youtube') publishedIds.youtubeId = r.videoId;
      }

      const publishedFilePath = path.join(OUTPUT_DIR, candidate.videoId, 'published.json');
      fs.writeFileSync(publishedFilePath, JSON.stringify({
        publishedAt: new Date().toISOString(),
        lateRecovery: true,
        platforms: results.map(r => r.platform),
        errors,
        ...publishedIds,
      }, null, 2));

      try {
        await saveVideo({
          id: candidate.videoId,
          title: candidate.script?.title || candidate.videoId,
          topic: candidate.topic,
          hook: candidate.hook,
          viralityScore: candidate.viralityScore,
          script: { ...candidate.script, lateRecovery: true },
          ...publishedIds,
        });
      } catch (err) {
        logger.warn(`Analytics failed: ${err.message}`);
      }

      console.log(`\n[MANUAL_LATE_PUBLISH_SUCCESS]`);
      console.log(`  VideoId: ${candidate.videoId}`);
      console.log(`  YouTubeId: ${publishedIds.youtubeId || 'N/A'}`);
      console.log(`  Platforms: ${results.map(r => r.platform).join(', ')}`);
      console.log(`[MANUAL_LATE_PUBLISH_NO_LLM_USED]`);
      process.exit(0);
    }

    console.log('\n[NO_VALID_CANDIDATES] All candidates rejected (duplicates or invalid)');
    process.exit(1);
  } catch (err) {
    console.log(`[MANUAL_LATE_PUBLISH_FAILED] ${err.message}`);
    logger.error(`${err.message}`, err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[CRASHED] ${err.message}`);
  process.exit(1);
});
