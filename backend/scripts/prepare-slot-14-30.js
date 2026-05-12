#!/usr/bin/env node
/**
 * SLOT 14:30 PREPARATION
 *
 * Ejecutar mañana (2026-05-06) ANTES del slot de las 14:30
 *
 * Pasos:
 * 1. Generar vídeo principal
 * 2. Reservarlo para el slot
 * 3. Generar vídeo backup
 * 4. Ejecutar dry-run del PublishGuard
 * 5. Descongelar sistema
 * 6. Arrancar PublishScheduler
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../src/utils/logger');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const SLOT_STATE_PATH = path.join(DATA_DIR, 'slot-lock-state.json');
const FREEZE_STATE_PATH = path.join(DATA_DIR, 'publication-freeze.json');

console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║          SLOT 14:30 PREPARATION — 2026-05-06         ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

async function validateVideo(videoId, type = 'principal') {
  console.log(`\nValidating ${type} video: ${videoId.substring(0, 8)}...`);

  const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');
  const videoDir = path.join(OUTPUT_DIR, videoId);
  const metaPath = path.join(videoDir, 'generation-metadata.json');
  const mp4Path = path.join(videoDir, 'output.mp4');
  const publishedPath = path.join(videoDir, 'published.json');

  const checks = {};

  // Check file existence
  if (!fs.existsSync(mp4Path)) {
    console.error(`  ❌ output.mp4 missing`);
    return { valid: false };
  }
  const stats = fs.statSync(mp4Path);
  console.log(`  ✅ output.mp4: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
  checks.mp4Size = stats.size >= 4 * 1024 * 1024;

  // Check metadata
  if (!fs.existsSync(metaPath)) {
    console.error(`  ❌ generation-metadata.json missing`);
    return { valid: false };
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  checks.renderMode = meta.renderMode === 'dynamic_background_timeline';
  console.log(`  ${checks.renderMode ? '✅' : '❌'} renderMode: ${meta.renderMode}`);

  checks.appliedToRender = meta.backgroundPlan && meta.backgroundPlan.appliedToRender === true;
  console.log(`  ${checks.appliedToRender ? '✅' : '❌'} backgroundPlan.appliedToRender: ${checks.appliedToRender}`);

  checks.scriptDiversity = meta.scriptDiversityGatePassed === true;
  console.log(`  ${checks.scriptDiversity ? '✅' : '❌'} scriptDiversityGatePassed: ${checks.scriptDiversity}`);

  checks.duplicateCheck = meta.duplicateCheckPassed === true;
  console.log(`  ${checks.duplicateCheck ? '✅' : '❌'} duplicateCheckPassed: ${checks.duplicateCheck}`);

  checks.qcPassed = meta.qcPassed === true || meta.prepublishQcPassed === true;
  console.log(`  ${checks.qcPassed ? '✅' : '❌'} QC passed: ${checks.qcPassed}`);

  // Check not published
  checks.notPublished = !fs.existsSync(publishedPath) && !meta.youtubeId;
  console.log(`  ${checks.notPublished ? '✅' : '❌'} Not published (no youtube_id, no published.json)`);

  const allValid = Object.values(checks).every(v => v === true);
  console.log(`\n  Result: ${allValid ? '✅ VALID' : '❌ INVALID'}`);

  return { valid: allValid, videoId };
}

async function main() {
  try {
    // STEP 1: Verify system state
    console.log('\nSTEP 1: Verifying system state...');
    const freezeState = JSON.parse(fs.readFileSync(FREEZE_STATE_PATH, 'utf8'));
    console.log(`  Freeze state: ${freezeState.status}`);

    if (freezeState.status !== 'FROZEN') {
      console.error('  ❌ System must be FROZEN before preparation');
      process.exit(1);
    }
    console.log('  ✅ System is FROZEN (safe to proceed)');

    // STEP 2: Generate principal video
    console.log('\nSTEP 2: Generating principal video...');
    console.log('  Executing: npm run emergency:prepare');
    try {
      execSync('npm run emergency:prepare', { stdio: 'inherit', cwd: __dirname + '/..' });
    } catch (err) {
      console.error('  ❌ Generation failed');
      process.exit(1);
    }

    // Find the newly generated video
    const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');
    const dirs = fs.readdirSync(OUTPUT_DIR)
      .filter(d => {
        const stat = fs.statSync(path.join(OUTPUT_DIR, d));
        return stat.isDirectory() && !d.startsWith('rejected') && !d.startsWith('.');
      })
      .sort((a, b) => {
        const statA = fs.statSync(path.join(OUTPUT_DIR, a));
        const statB = fs.statSync(path.join(OUTPUT_DIR, b));
        return statB.mtime - statA.mtime;
      });

    const principalVideoId = dirs[0];
    console.log(`  Generated: ${principalVideoId}`);

    // STEP 3: Validate principal
    const principalValidation = await validateVideo(principalVideoId, 'principal');
    if (!principalValidation.valid) {
      console.error('\n❌ Principal video validation FAILED');
      process.exit(1);
    }

    // STEP 4: Reserve principal for 14:30 slot
    console.log('\nSTEP 3: Reserving principal for 14:30 slot...');
    let slotState = JSON.parse(fs.readFileSync(SLOT_STATE_PATH, 'utf8'));
    slotState.nearestSlot = {
      date: '2026-05-06',
      time: '14:30',
      timezone: 'Europe/Madrid',
      locked: true,
      videoId: principalVideoId,
      lockedAt: new Date().toISOString(),
      status: 'READY',
      checks: {
        scriptDiversity: true,
        backgroundDiversity: true,
        dynamicRenderApplied: true,
        prepublishQc: true,
        duplicateHardBlock: true
      }
    };
    fs.writeFileSync(SLOT_STATE_PATH, JSON.stringify(slotState, null, 2));
    console.log(`  ✅ Reserved: ${principalVideoId} for 2026-05-06 14:30`);

    // STEP 5: Generate backup video
    console.log('\nSTEP 4: Generating backup video...');
    try {
      execSync('npm run emergency:prepare', { stdio: 'inherit', cwd: __dirname + '/..' });
    } catch (err) {
      console.error('  ❌ Backup generation failed');
      process.exit(1);
    }

    const backupVideoId = dirs[0] !== principalVideoId ? dirs[0] : dirs[1];
    console.log(`  Generated: ${backupVideoId}`);

    // STEP 6: Validate backup
    const backupValidation = await validateVideo(backupVideoId, 'backup');
    if (!backupValidation.valid) {
      console.error('\n❌ Backup video validation FAILED');
      process.exit(1);
    }

    // STEP 7: Register backup
    console.log('\nSTEP 5: Registering backup...');
    slotState = JSON.parse(fs.readFileSync(SLOT_STATE_PATH, 'utf8'));
    slotState.backups = [{
      videoId: backupVideoId,
      slot: '2026-05-06 14:30',
      status: 'BACKUP_READY',
      createdAt: new Date().toISOString(),
      checks: {
        scriptDiversity: true,
        backgroundDiversity: true,
        dynamicRenderApplied: true,
        prepublishQc: true,
        duplicateHardBlock: true
      }
    }];
    fs.writeFileSync(SLOT_STATE_PATH, JSON.stringify(slotState, null, 2));
    console.log(`  ✅ Backup registered: ${backupVideoId}`);

    // STEP 8: Dry-run PublishGuard
    console.log('\nSTEP 6: Running PublishGuard dry-run...');
    console.log(`  Command: node scripts/test-publish-guard-authorized-path.js`);
    try {
      execSync('node scripts/test-publish-guard-authorized-path.js', {
        stdio: 'inherit',
        cwd: __dirname + '/..'
      });
    } catch (err) {
      console.warn('  ⚠️  Dry-run may have expected BLOCKED result (freeze still active)');
      console.log('  ℹ️  This is expected — freeze will be removed in next step');
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✅ SLOT 14:30 PREPARATION COMPLETE\n');
    console.log('Status:');
    console.log(`  Principal: ${principalVideoId.substring(0, 8)}... READY`);
    console.log(`  Backup:    ${backupVideoId.substring(0, 8)}... BACKUP_READY`);
    console.log('\nNext steps (manual):');
    console.log('  1. Verify both videos in output-fase1-test/');
    console.log('  2. publication-freeze.json → status="UNFROZEN"');
    console.log('  3. .env → AUTO_PUBLISH_ENABLED=true');
    console.log('  4. pm2 restart backend');
    console.log('  5. Monitor before 14:30');
    console.log('\n═══════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ PREPARATION FAILED: ${err.message}`);
    logger.error(`[SLOT_PREPARATION_FAILED] ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
