#!/usr/bin/env node
/**
 * LATE SLOT RECOVERY
 * 
 * Publica EXACTAMENTE el videoId del slot perdido
 * Sin seleccionar otro vídeo, sin generar nada
 * 
 * Uso: node scripts/late-slot-recovery.js <videoId> [slotTime]
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const logger = require('../src/utils/logger');
const { publishAll } = require('../src/services/publisher');
const { validateReadyVideo } = require('../src/services/ready-video-validator.service');

const videoId = process.argv[2];
const slotTime = process.argv[3] || '21:15';
const slotDate = '2026-05-05';
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, '../output-fase1-test');

if (!videoId) {
  console.error('❌ Usage: node late-slot-recovery.js <videoId> [slotTime]');
  process.exit(1);
}

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║           LATE SLOT RECOVERY — MANUAL PUBLISH           ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

console.log(`Target video: ${videoId}`);
console.log(`Original slot: ${slotDate} ${slotTime}`);
console.log(`Recovery reason: backend_offline_at_slot\n`);

// Validate video exists and is ready
const videoDir = path.join(OUTPUT_DIR, videoId);
const outputMp4 = path.join(videoDir, 'output.mp4');
const scriptPath = path.join(videoDir, 'script.json');
const genMetaPath = path.join(videoDir, 'generation-metadata.json');

console.log('Validations:');

if (!fs.existsSync(outputMp4)) {
  console.error(`❌ output.mp4 not found: ${outputMp4}`);
  process.exit(1);
}
console.log(`✅ output.mp4 exists (${Math.round(fs.statSync(outputMp4).size / 1024 / 1024 * 10) / 10}MB)`);

if (!fs.existsSync(scriptPath)) {
  console.error(`❌ script.json not found`);
  process.exit(1);
}
console.log(`✅ script.json exists`);

const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
const genMeta = JSON.parse(fs.readFileSync(genMetaPath, 'utf8'));

// Verify no youtube_id
if (genMeta.youtubeId) {
  console.error(`❌ Video already has youtubeId: ${genMeta.youtubeId}`);
  process.exit(1);
}
console.log(`✅ No youtube_id (not published)`);

// Verify no published.json
const publishedPath = path.join(videoDir, 'published.json');
if (fs.existsSync(publishedPath)) {
  console.error(`❌ published.json exists (already published)`);
  process.exit(1);
}
console.log(`✅ No published.json (not published)`);

// Verify background applied
if (!genMeta.backgroundPlan || !genMeta.backgroundPlan.appliedToRender) {
  console.error(`❌ Background not applied to render`);
  process.exit(1);
}
console.log(`✅ backgroundPlan.appliedToRender=true`);

// Verify dynamic render (from generation-metadata, not legacy render-metadata)
if (!genMeta.renderMode || genMeta.renderMode !== 'dynamic_background_timeline') {
  console.error(`❌ renderMode is ${genMeta.renderMode || 'undefined'}, expected dynamic_background_timeline`);
  process.exit(1);
}
console.log(`✅ renderMode=dynamic_background_timeline (from generation-metadata)`);

console.log('\n✅ All validations passed. Ready to publish.\n');

// Centralized READY video validation
console.log(`[LATE_SLOT_RECOVERY_READY_VALIDATION_STARTING]`);
const validation = validateReadyVideo(videoId);

if (!validation.ready) {
  console.error(`\n[LATE_SLOT_RECOVERY_VALIDATION_FAILED]`);
  console.error(`Validation errors:`);
  validation.errors.forEach(e => console.error(`  - ${e}`));
  logger.error(`[LATE_SLOT_RECOVERY_VALIDATION_FAILED] videoId=${videoId}`);
  logger.error(`Validation errors: ${validation.errors.join('; ')}`);
  process.exit(1);
}

console.log(`[LATE_SLOT_RECOVERY_READY_VALIDATION_PASSED] All centralized checks passed\n`);

// Publish with late-slot-recovery source
console.log(`[LATE_SLOT_RECOVERY_STARTED] videoId=${videoId} slot=${slotDate} ${slotTime}`);

(async () => {
  try {
    const publishResult = await publishAll(outputMp4, script, null, {
      source: 'late-slot-recovery',
      isManual: true,
      slotDate,
      slotTime,
      reason: 'backend_offline_at_slot',
      missedSlot: `${slotDate} ${slotTime}`,
      operator: process.env.OPERATOR || 'system'
    });

    if (publishResult.success) {
      console.log(`\n[LATE_SLOT_RECOVERY_SUCCESS]`);
      console.log(`  videoId: ${videoId}`);
      console.log(`  youtubeId: ${publishResult.youtubeId}`);
      console.log(`  URL: https://www.youtube.com/watch?v=${publishResult.youtubeId}`);
      console.log(`  operator: ${process.env.OPERATOR || 'system'}\n`);
      
      // Update metadata
      genMeta.youtubeId = publishResult.youtubeId;
      genMeta.publishedAt = new Date().toISOString();
      genMeta.recoveryPublication = {
        reason: 'backend_offline_at_slot',
        missedSlot: `${slotDate} ${slotTime}`,
        operator: process.env.OPERATOR || 'system'
      };
      fs.writeFileSync(genMetaPath, JSON.stringify(genMeta, null, 2));
      
      // Create published.json
      fs.writeFileSync(publishedPath, JSON.stringify({
        youtubeId: publishResult.youtubeId,
        publishedAt: new Date().toISOString(),
        source: 'late-slot-recovery',
        reason: 'backend_offline_at_slot'
      }, null, 2));
      
      console.log('[LATE_SLOT_RECOVERY_METADATA_UPDATED]');
      process.exit(0);
    } else {
      console.error(`\n[LATE_SLOT_RECOVERY_FAILED]`);
      console.error(`  reason: ${publishResult.reason || 'unknown'}`);
      console.error(`  error: ${publishResult.error || 'unknown error'}\n`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n[LATE_SLOT_RECOVERY_FAILED]`);
    console.error(`  error: ${err.message}\n`);
    process.exit(1);
  }
})();
