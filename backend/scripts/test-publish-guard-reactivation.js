#!/usr/bin/env node

/**
 * test-publish-guard-reactivation.js
 *
 * Final dry-run of PublishGuard for slot 21:15 controlled reactivation
 * Simulates PublishScheduler calling PublishGuard with principal video
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const { assertPublishAllowed } = require('../src/services/publish-guard.service');
const { validateReadyVideo } = require('../src/services/ready-video-validator.service');

(async () => {
  try {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  PUBLISH GUARD DRY-RUN - SLOT 21:15 REACTIVATION       ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    const slot = {
      date: '2026-05-07',
      time: '21:15',
      timezone: 'Europe/Madrid',
    };

    const principalVideoId = 'd44d2810-3934-4bba-b9e7-4bd62ec033a9';
    const backupVideoId = '51f843c1-d8ce-4223-b1ed-099e428b8840';

    console.log(`📍 Slot: ${slot.date} ${slot.time} ${slot.timezone}`);
    console.log(`📺 Principal: ${principalVideoId}`);
    console.log(`📺 Backup: ${backupVideoId}\n`);

    // Step 1: Validate both videos
    console.log(`🔍 STEP 1: Validating principal video...`);
    const principalValidation = validateReadyVideo(principalVideoId);
    const principalValid = principalValidation.valid || principalValidation.ready;

    if (!principalValid) {
      console.error(`❌ Principal validation FAILED:`);
      console.error(principalValidation.errors.join('\n'));
      process.exit(1);
    }
    console.log(`✅ Principal validation PASSED\n`);

    console.log(`🔍 STEP 2: Validating backup video...`);
    const backupValidation = validateReadyVideo(backupVideoId);
    const backupValid = backupValidation.valid || backupValidation.ready;

    if (!backupValid) {
      console.error(`❌ Backup validation FAILED:`);
      console.error(backupValidation.errors.join('\n'));
      process.exit(1);
    }
    console.log(`✅ Backup validation PASSED\n`);

    // Step 2: Check PublishGuard
    console.log(`🔍 STEP 3: Running PublishGuard dry-run...`);

    const guardResult = assertPublishAllowed({
      source: 'PublishScheduler',
      videoId: principalVideoId,
      slotDate: slot.date,
      slotTime: slot.time,
      isManual: false,
    });

    console.log(`\n📋 PublishGuard Result:`);
    console.log(`  allowed: ${guardResult.allowed}`);
    console.log(`  reason: ${guardResult.reason}`);
    console.log(`  checks: ${JSON.stringify(guardResult.checks, null, 4)}`);

    if (!guardResult.allowed) {
      console.error(`\n❌ PUBLISH GUARD BLOCKED:`);
      console.error(guardResult.reason);
      console.error(`Details:`, guardResult.details);
      process.exit(1);
    }

    // Step 3: Check configuration
    console.log(`\n🔍 STEP 4: Verifying configuration...`);

    const configChecks = {
      'AUTO_PUBLISH_ENABLED': process.env.AUTO_PUBLISH_ENABLED === 'true',
      'ALLOW_MANUAL_PUBLISH': process.env.ALLOW_MANUAL_PUBLISH === 'true',
      'MANUAL_AUTHORIZATION_CONFIRMED': process.env.MANUAL_AUTHORIZATION_CONFIRMED === 'true',
    };

    console.log(`Configuration:`);
    console.log(`  AUTO_PUBLISH_ENABLED: ${configChecks.AUTO_PUBLISH_ENABLED} (should be true)`);
    console.log(`  ALLOW_MANUAL_PUBLISH: ${configChecks.ALLOW_MANUAL_PUBLISH} (should be false)`);
    console.log(`  MANUAL_AUTHORIZATION_CONFIRMED: ${configChecks.MANUAL_AUTHORIZATION_CONFIRMED} (should be false)`);

    if (!configChecks.AUTO_PUBLISH_ENABLED) {
      console.error(`❌ Configuration ERROR: AUTO_PUBLISH_ENABLED must be true`);
      process.exit(1);
    }

    if (configChecks.ALLOW_MANUAL_PUBLISH || configChecks.MANUAL_AUTHORIZATION_CONFIRMED) {
      console.error(`❌ Configuration ERROR: Manual publish must remain disabled`);
      process.exit(1);
    }

    // Step 4: Check slot-lock-state
    console.log(`\n🔍 STEP 5: Verifying slot-lock-state.json...`);
    const slotState = JSON.parse(fs.readFileSync('./data/slot-lock-state.json', 'utf8'));

    const principalMatches = slotState.nearestSlot.videoId === principalVideoId;
    const principalReady = slotState.nearestSlot.status === 'READY';
    const backupExists = slotState.backups.some(b => b.videoId === backupVideoId && b.status === 'BACKUP_READY');

    console.log(`Slot State:`);
    console.log(`  Principal correct: ${principalMatches}`);
    console.log(`  Principal ready: ${principalReady}`);
    console.log(`  Backup exists: ${backupExists}`);

    if (!principalMatches || !principalReady || !backupExists) {
      console.error(`❌ Slot state ERROR`);
      process.exit(1);
    }

    // Final result
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅ ALL CHECKS PASSED - READY FOR REACTIVATION         ║`);
    console.log(`╚════════════════════════════════════════════════════════╝`);
    console.log(`\n[PUBLISH_GUARD_ALLOWED]`);
    console.log(`[SLOT_21:15_READY_FOR_PUBLICATION]`);
    console.log(`\nStatus: FROZEN → UNFROZEN complete`);
    console.log(`AUTO_PUBLISH_ENABLED: true`);
    console.log(`Manual publish: disabled`);
    console.log(`\nWaiting for slot 21:15 Europe/Madrid...\n`);

    logger.info(`CONTROLLED_REACTIVATION_APPROVED slot=21:15 principal=${principalVideoId} backup=${backupVideoId}`);
    process.exit(0);

  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`REACTIVATION_TEST_FAILED | ${err.message}`);
    process.exit(1);
  }
})();
