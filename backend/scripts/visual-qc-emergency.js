#!/usr/bin/env node

/**
 * visual-qc-emergency.js
 *
 * Ejecuta visual QC en un vídeo existente.
 * Uso: node scripts/visual-qc-emergency.js <videoId>
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const { validatePrepublish } = require('../src/services/prepublish-visual-qc.service');

const videoId = process.argv[2];

if (!videoId) {
  console.error('\n❌ Usage: node scripts/visual-qc-emergency.js <videoId>\n');
  process.exit(1);
}

(async () => {
  try {
    const outputDir = path.resolve(`../output/${videoId}`);

    if (!fs.existsSync(outputDir)) {
      throw new Error(`Video directory not found: ${outputDir}`);
    }

    const videoPath = path.join(outputDir, 'output.mp4');
    if (!fs.existsSync(videoPath)) {
      throw new Error(`output.mp4 not found: ${videoPath}`);
    }

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  VISUAL QC - EMERGENCY                               ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    console.log(`Video: ${path.basename(videoPath)}`);
    const stats = fs.statSync(videoPath);
    console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(1)}MB\n`);

    // Ejecutar QC
    console.log(`🔍 Running visual QC checks...\n`);
    const result = await validatePrepublish(videoPath, outputDir, videoId);

    // Mostrar resultados
    console.log(`\n════════════════════════════════════════════════════════`);
    console.log(`RESULTS`);
    console.log(`════════════════════════════════════════════════════════\n`);

    const checks = result.checks || {};
    let passedCount = 0;
    let failedCount = 0;

    Object.entries(checks).forEach(([key, value]) => {
      const status = value.ok ? '✅' : '❌';
      const detail = value.reason || (value.ok ? 'OK' : 'FAILED');

      console.log(`${status} ${key.padEnd(20)} ${detail}`);

      if (value.ok) {
        passedCount++;
      } else {
        failedCount++;
      }
    });

    console.log(`\n════════════════════════════════════════════════════════`);
    console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
    console.log(`Result: ${result.ok ? '✅ PASS' : '❌ FAIL'}`);

    if (result.blockedReasons && result.blockedReasons.length > 0) {
      console.log(`Blocked reasons: ${result.blockedReasons.join(', ')}`);
    }

    console.log(`════════════════════════════════════════════════════════\n`);

    if (result.ok) {
      console.log(`✅ VIDEO PASSED VISUAL QC — Safe to publish\n`);
      logger.info(`VISUAL_QC_PASS videoId=${videoId}`);
      process.exit(0);
    } else {
      console.log(`❌ VIDEO FAILED VISUAL QC — DO NOT PUBLISH\n`);
      logger.error(`VISUAL_QC_FAIL videoId=${videoId} reasons=${result.blockedReasons?.join(',')}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`VISUAL_QC_ERROR | ${err.message}`);
    process.exit(1);
  }
})();
