#!/usr/bin/env node

/**
 * late-slot-recovery-manual.js
 *
 * Manual late-slot-recovery execution for missed slot 21:15
 * Publishes principal video, falls back to backup if needed
 * Full audit trail recording using publisher.js
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const { validateReadyVideo } = require('../src/services/ready-video-validator.service');
const { assertPublishAllowed, recordAuthorizedPublish } = require('../src/services/publish-guard.service');
const { publishAll } = require('../src/services/publisher');

const PRINCIPAL_VIDEO_ID = 'd44d2810-3934-4bba-b9e7-4bd62ec033a9';
const BACKUP_VIDEO_ID = '51f843c1-d8ce-4223-b1ed-099e428b8840';
const MISSED_SLOT = '2026-05-07 21:15 Europe/Madrid';
const OPERATOR = process.env.OPERATOR || 'erik';

(async () => {
  const recoveryStartTime = new Date().toISOString();
  let publishedVideoId = null;
  let youtubeId = null;

  try {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  LATE-SLOT-RECOVERY: SLOT 21:15 EUROPE/MADRID           ║`);
    console.log(`║  Manual execution after slot time                       ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    logger.info(`[LATE_SLOT_RECOVERY_STARTED] missedSlot=${MISSED_SLOT} operator=${OPERATOR}`);

    // ─────────────────────────────────────────────
    // PHASE 1: Validar principal
    // ─────────────────────────────────────────────
    console.log(`🔍 Validating principal: ${PRINCIPAL_VIDEO_ID}\n`);
    const principalValidation = validateReadyVideo(PRINCIPAL_VIDEO_ID);
    const principalReady = principalValidation.valid || principalValidation.ready;

    if (!principalReady) {
      console.log(`❌ Principal validation FAILED\n`);
      logger.warn(`[READY_VIDEO_VALIDATION_FAIL] principal=${PRINCIPAL_VIDEO_ID}`);
      console.log(`🔄 Falling back to backup: ${BACKUP_VIDEO_ID}\n`);

      // Try backup
      const backupValidation = validateReadyVideo(BACKUP_VIDEO_ID);
      const backupReady = backupValidation.valid || backupValidation.ready;

      if (!backupReady) {
        throw new Error(`Both principal and backup failed validation`);
      }

      publishedVideoId = BACKUP_VIDEO_ID;
      console.log(`✅ Backup validation PASSED\n`);
      logger.info(`[BACKUP_VIDEO_PROMOTED] principal failed, using backup=${BACKUP_VIDEO_ID}`);
    } else {
      publishedVideoId = PRINCIPAL_VIDEO_ID;
      console.log(`✅ Principal validation PASSED\n`);
      logger.info(`[READY_VIDEO_VALIDATION_PASS] principal=${PRINCIPAL_VIDEO_ID}`);
    }

    // ─────────────────────────────────────────────
    // PHASE 2: PublishGuard check
    // ─────────────────────────────────────────────
    console.log(`🔐 Checking PublishGuard...\n`);

    const guardResult = assertPublishAllowed({
      source: 'late-slot-recovery',
      videoId: publishedVideoId,
      isManual: true,
    });

    if (!guardResult.allowed) {
      throw new Error(`PublishGuard blocked: ${guardResult.reason}`);
    }

    console.log(`✅ PublishGuard ALLOWED\n`);
    logger.info(`[PUBLISH_GUARD_ALLOWED] source=late-slot-recovery videoId=${publishedVideoId}`);

    // ─────────────────────────────────────────────
    // PHASE 3: Load video metadata and script
    // ─────────────────────────────────────────────
    const videoDir = path.resolve(`output-fase1-test/${publishedVideoId}`);
    const scriptPath = path.join(videoDir, 'script.json');
    const metadataPath = path.join(videoDir, 'generation-metadata.json');
    const mp4Path = path.join(videoDir, 'output.mp4');

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Script not found: ${scriptPath}`);
    }
    if (!fs.existsSync(mp4Path)) {
      throw new Error(`Video file not found: ${mp4Path}`);
    }

    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    script.videoId = publishedVideoId;

    console.log(`📄 Loaded script: "${script.hook}"\n`);

    // ─────────────────────────────────────────────
    // PHASE 4: Publish via publisher.publishAll
    // ─────────────────────────────────────────────
    console.log(`📤 Publishing to YouTube...\n`);

    const publishResult = await publishAll(mp4Path, script, null, {
      source: 'late-slot-recovery',
      isManual: true,
    });

    if (!publishResult || !publishResult.results || publishResult.results.length === 0) {
      throw new Error(`Publishing failed: no successful platforms`);
    }

    const youtubeResult = publishResult.results.find(r => r.platform === 'youtube');
    if (!youtubeResult) {
      throw new Error(`YouTube publish not in results`);
    }

    youtubeId = youtubeResult.videoId;
    console.log(`✅ YouTube publish SUCCESS\n`);
    console.log(`   YouTubeId: ${youtubeId}\n`);
    logger.info(`[YOUTUBE_UPLOAD_SUCCESS] videoId=${publishedVideoId} youtubeId=${youtubeId}`);

    // ─────────────────────────────────────────────
    // PHASE 5: Record audit trail
    // ─────────────────────────────────────────────
    const auditPath = path.join(videoDir, 'publish-audit.json');
    const auditRecord = {
      recoveryType: 'late_slot_recovery',
      missedSlot: MISSED_SLOT,
      publishedAt: new Date().toISOString(),
      recoveryStartTime,
      videoId: publishedVideoId,
      youtubeId,
      youtubeUrl: `https://www.youtube.com/shorts/${youtubeId}`,
      principal: PRINCIPAL_VIDEO_ID,
      backup: BACKUP_VIDEO_ID,
      usedBackup: publishedVideoId === BACKUP_VIDEO_ID,
      operator: OPERATOR,
      authorizationType: 'manual_late_slot_recovery',
      reason: 'controlled_reactivation_after_slot_time',
    };

    fs.writeFileSync(auditPath, JSON.stringify(auditRecord, null, 2));
    console.log(`✅ Audit trail recorded\n`);
    logger.info(`[PUBLISH_AUDIT_RECORDED] videoId=${publishedVideoId} youtubeId=${youtubeId}`);

    // ─────────────────────────────────────────────
    // SUCCESS
    // ─────────────────────────────────────────────
    console.log(`╔════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅ LATE-SLOT-RECOVERY SUCCESS                         ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    console.log(`Published video:  ${publishedVideoId}`);
    console.log(`YouTube ID:       ${youtubeId}`);
    console.log(`YouTube URL:      https://www.youtube.com/shorts/${youtubeId}`);
    console.log(`Missed slot:      ${MISSED_SLOT}`);
    console.log(`Recovery time:    ${new Date().toISOString()}\n`);

    logger.info(`[LATE_SLOT_RECOVERY_SUCCESS] videoId=${publishedVideoId} youtubeId=${youtubeId}`);
    process.exit(0);

  } catch (err) {
    console.error(`\n❌ LATE-SLOT-RECOVERY FAILED\n`);
    console.error(`Error: ${err.message}\n`);

    logger.error(`[LATE_SLOT_RECOVERY_FAILED] error=${err.message}`);
    process.exit(1);
  }
})();
