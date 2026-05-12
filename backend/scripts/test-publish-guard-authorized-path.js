#!/usr/bin/env node
/**
 * TEST: Authorized Publication Path (DRY-RUN)
 *
 * Simula publicación REAL de PublishScheduler con todos los requisitos:
 * - source="PublishScheduler"
 * - AUTO_PUBLISH_ENABLED=true
 * - Slot exacto válido
 * - videoId reservado
 * - Metadata completa
 *
 * IMPORTANTE:
 * - NO sube a YouTube
 * - Solo valida que guard PERMITIRÍA la publicación
 * - Resultado: [PUBLISH_GUARD_ALLOWED]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const logger = require('../src/utils/logger');
const { assertPublishAllowed, getSlotLockState, getVideoMetadata } = require('../src/services/publish-guard.service');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║   AUTHORIZED PUBLICATION PATH TEST (DRY-RUN)           ║');
console.log('║   Valida que PublishScheduler PODRÍA publicar          ║');
console.log('║   SIN subir realmente a YouTube                        ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

async function test() {
  try {
    // ─────────────────────────────────────────────
    // STEP 1: Verificar estado del slot
    // ─────────────────────────────────────────────
    console.log('STEP 1: Verificar estado del slot\n');

    const slotState = getSlotLockState();
    if (!slotState || !slotState.nearestSlot) {
      console.error('❌ ERROR: No hay slot reservado en slot-lock-state.json');
      process.exit(1);
    }

    const reserved = slotState.nearestSlot;
    console.log(`  ✅ Slot reservado:`);
    console.log(`     Date: ${reserved.date}`);
    console.log(`     Time: ${reserved.time}`);
    console.log(`     VideoId: ${reserved.videoId.substring(0, 8)}...`);
    console.log(`     Locked: ${reserved.locked}`);
    console.log(`     Status: ${reserved.status}\n`);

    // ─────────────────────────────────────────────
    // STEP 2: Verificar metadata del video reservado
    // ─────────────────────────────────────────────
    console.log('STEP 2: Verificar metadata del video reservado\n');

    const metadata = getVideoMetadata(reserved.videoId);
    if (!metadata) {
      console.error(`❌ ERROR: No metadata para videoId=${reserved.videoId}`);
      process.exit(1);
    }

    const checks = {
      scriptDiversityGatePassed: metadata.scriptDiversityGatePassed === true,
      backgroundPlanApplied: metadata.backgroundPlan?.appliedToRender === true,
      dynamicRenderMode: metadata.backgroundPlan?.renderMode === 'dynamic_background_timeline',
      prepublishQcPassed: metadata.prepublishQcPassed === true || metadata.qcPassed === true,
      duplicateCheckPassed: metadata.duplicateCheckPassed === true,
    };

    console.log(`  Metadata checks:`);
    for (const [check, passed] of Object.entries(checks)) {
      console.log(`    ${passed ? '✅' : '❌'} ${check}`);
    }

    const allChecksPassed = Object.values(checks).every(v => v === true);
    if (!allChecksPassed) {
      console.error(`\n❌ ERROR: Metadata checks failed`);
      process.exit(1);
    }
    console.log();

    // ─────────────────────────────────────────────
    // STEP 3: Verificar output.mp4
    // ─────────────────────────────────────────────
    console.log('STEP 3: Verificar output.mp4\n');

    const videoPath = path.resolve(OUTPUT_DIR, reserved.videoId, 'output.mp4');
    if (!fs.existsSync(videoPath)) {
      console.error(`❌ ERROR: output.mp4 no existe: ${videoPath}`);
      process.exit(1);
    }

    const stats = fs.statSync(videoPath);
    const sizeMB = stats.size / 1024 / 1024;
    console.log(`  ✅ output.mp4 encontrado`);
    console.log(`     Size: ${sizeMB.toFixed(1)}MB`);
    console.log(`     Min required: 4MB`);

    if (stats.size < 4 * 1024 * 1024) {
      console.error(`❌ ERROR: Archivo muy pequeño`);
      process.exit(1);
    }
    console.log();

    // ─────────────────────────────────────────────
    // STEP 4: Configuración necesaria
    // ─────────────────────────────────────────────
    console.log('STEP 4: Configuración necesaria\n');

    const configChecks = {
      'AUTO_PUBLISH_ENABLED': process.env.AUTO_PUBLISH_ENABLED,
      'YOUTUBE_REFRESH_TOKEN': process.env.YOUTUBE_REFRESH_TOKEN ? '(configured)' : '(NOT configured)',
    };

    console.log(`  Configuration status:`);
    for (const [key, value] of Object.entries(configChecks)) {
      const ok = value === 'true' || value === '(configured)';
      console.log(`    ${ok ? '✅' : '⚠️ '} ${key}=${value}`);
    }
    console.log();

    // ─────────────────────────────────────────────
    // STEP 5: Simular llamada a publish guard
    // ─────────────────────────────────────────────
    console.log('STEP 5: Guard check simulation\n');

    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    console.log(`  Current date/time: ${currentDate} ${currentTime}`);
    console.log(`  Reserved slot:     ${reserved.date} ${reserved.time}`);
    console.log();

    // SIMULACIÓN: SI el slot fuera actual
    if (currentDate === reserved.date) {
      console.log(`  ℹ️  NOTA: Slot es HOY. Usando fecha actual para test.\n`);
    } else {
      console.log(`  ℹ️  NOTA: Slot es para ${reserved.date}. Simulando para test.\n`);
    }

    const guardResult = assertPublishAllowed({
      videoId: reserved.videoId,
      source: 'PublishScheduler',
      slotDate: reserved.date,
      slotTime: reserved.time,
    });

    console.log(`  Guard Result:`);
    console.log(`    Allowed: ${guardResult.allowed}`);
    console.log(`    Reason: ${guardResult.reason}`);
    if (guardResult.errors.length > 0) {
      console.log(`    Errors: ${guardResult.errors.join(', ')}`);
    }
    console.log();

    // ─────────────────────────────────────────────
    // FINAL VERDICT
    // ─────────────────────────────────────────────
    console.log('═'.repeat(60));

    if (guardResult.allowed) {
      console.log('✅ AUTHORIZED PATH VALID\n');
      console.log('Summary:');
      console.log(`  ✅ Video metadata: PASS`);
      console.log(`  ✅ Output file: PASS (${sizeMB.toFixed(1)}MB)`);
      console.log(`  ✅ Slot match: PASS (${reserved.date} ${reserved.time})`);
      console.log(`  ✅ Source authorized: PASS (PublishScheduler)`);
      console.log(`  ✅ Publication guard: WOULD ALLOW\n`);

      console.log('Result: [PUBLISH_GUARD_ALLOWED]\n');
      console.log('This video COULD be published if:');
      console.log(`  • AUTO_PUBLISH_ENABLED=true`);
      console.log(`  • Slot time matches exactly (${reserved.date} ${reserved.time})`);
      console.log(`  • YouTube OAuth token is valid\n`);

      logger.info(`[TEST_AUTHORIZED_PATH_PASS] videoId=${reserved.videoId}`);
      process.exit(0);
    } else {
      console.log('❌ AUTHORIZED PATH BLOCKED\n');
      console.log(`Reason: ${guardResult.reason}\n`);
      console.log(`Errors: ${guardResult.errors.join(', ')}\n`);

      logger.error(`[TEST_AUTHORIZED_PATH_BLOCKED] videoId=${reserved.videoId} reason=${guardResult.reason}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ TEST FAILED: ${err.message}\n`);
    logger.error(`[TEST_AUTHORIZED_PATH_CRASH] ${err.message}`, err);
    process.exit(1);
  }
}

test();
