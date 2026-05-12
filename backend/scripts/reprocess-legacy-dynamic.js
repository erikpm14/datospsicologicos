#!/usr/bin/env node

/**
 * reprocess-legacy-dynamic.js
 *
 * Reprocesses a legacy video to use dynamic_background_timeline renderMode
 * Updates: output.mp4 with new render, generation-metadata.json with flags
 * Usage: node scripts/reprocess-legacy-dynamic.js <videoId>
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const { renderDynamicBackgroundTimeline } = require('../src/services/dynamic-background-renderer');

const videoId = process.argv[2];

if (!videoId) {
  console.error('\n❌ Usage: node scripts/reprocess-legacy-dynamic.js <videoId>\n');
  process.exit(1);
}

(async () => {
  try {
    const outputDir = path.resolve(`output-fase1-test/${videoId}`);

    if (!fs.existsSync(outputDir)) {
      throw new Error(`Video directory not found: ${outputDir}`);
    }

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  REPROCESS LEGACY → DYNAMIC_BACKGROUND_TIMELINE         ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    // Load generation-metadata.json
    const metadataPath = path.join(outputDir, 'generation-metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`generation-metadata.json not found: ${metadataPath}`);
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    console.log(`✅ Loaded metadata: ${metadata.hook}`);
    console.log(`   renderMode: ${metadata.renderMode}`);
    console.log(`   clipTimeline: ${metadata.backgroundPlan.clipTimeline.length} clips`);

    // Verify clipTimeline exists
    if (!metadata.backgroundPlan || !metadata.backgroundPlan.clipTimeline || metadata.backgroundPlan.clipTimeline.length === 0) {
      throw new Error('No clipTimeline found in backgroundPlan');
    }

    // Get audio from existing output.mp4 or voice file
    const oldOutputPath = path.join(outputDir, 'output-legacy.mp4');
    const voicePath = path.join(outputDir, 'voice_proc.mp3');
    const outputPath = path.join(outputDir, 'output.mp4');

    let audioPath = null;
    let videoToExtractFrom = null;

    if (fs.existsSync(voicePath)) {
      audioPath = voicePath;
      console.log(`✅ Audio: ${voicePath}`);
    } else if (fs.existsSync(outputPath)) {
      console.log(`✅ Will extract audio from: ${outputPath}`);
      videoToExtractFrom = outputPath;
    } else if (fs.existsSync(oldOutputPath)) {
      console.log(`✅ Will extract audio from legacy: ${oldOutputPath}`);
      videoToExtractFrom = oldOutputPath;
    } else {
      throw new Error('No audio source found (voice_proc.mp3 or output.mp4)');
    }

    // Calculate duration from subtitles or metadata
    let duration = 35; // fallback
    const vttPath = path.join(outputDir, 'subtitles.vtt');
    if (fs.existsSync(vttPath)) {
      const vttContent = fs.readFileSync(vttPath, 'utf8');
      const lastTimestamp = vttContent.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g);
      if (lastTimestamp && lastTimestamp.length > 0) {
        const last = lastTimestamp[lastTimestamp.length - 1];
        const parts = last.split(':');
        duration = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
        console.log(`✅ Duration from subtitles: ${duration}s`);
      }
    }

    // Backup old output.mp4 if needed
    if (fs.existsSync(outputPath) && videoToExtractFrom !== outputPath) {
      const backupPath = path.join(outputDir, 'output-legacy.mp4');
      fs.copyFileSync(outputPath, backupPath);
      fs.unlinkSync(outputPath);
      console.log(`💾 Backed up old output.mp4 → output-legacy.mp4`);
    }

    // Render dynamic background
    console.log(`\n🎬 Starting dynamic background render...\n`);

    const result = await renderDynamicBackgroundTimeline({
      audioPath,
      videoPath: videoToExtractFrom,
      outputPath,
      clipTimeline: metadata.backgroundPlan.clipTimeline,
      audioDuration: duration,
      outputDir,
    });

    console.log(`\n✅ Render complete: ${(result.size / 1024 / 1024).toFixed(1)}MB`);

    // Update metadata to mark as reprocessed
    metadata.reprocessedAt = new Date().toISOString();
    metadata.reprocessReason = 'legacy to dynamic_background_timeline conversion';
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`✅ Updated generation-metadata.json`);

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅ REPROCESS COMPLETE                                  ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    logger.info(`LEGACY_REPROCESS_SUCCESS videoId=${videoId}`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`LEGACY_REPROCESS_FAILED | ${err.message}`);
    process.exit(1);
  }
})();
