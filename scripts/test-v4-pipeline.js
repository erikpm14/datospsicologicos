/**
 * test-v4-pipeline.js
 * Test de integridad V4.1 en todo el pipeline
 * Uso: node scripts/test-v4-pipeline.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const { generateScript } = require('../backend/src/services/content-generator');
const { validateVideoV4 } = require('../backend/src/contracts/video-v4.contract');
const { validateForPublish } = require('../backend/src/services/publish-validator.service');

async function testV4Pipeline() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║           V4.1 PIPELINE INTEGRITY TEST                 ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  let passed = 0;
  let failed = 0;

  // Test 1: Generación
  console.log(`\n1️⃣  Testing script generation...`);
  try {
    const script = await generateScript({ topic: 'relationships' });

    if (!script) {
      console.log(`❌ FAIL: generateScript returned null`);
      failed++;
    } else {
      const v4Validation = validateVideoV4(script);

      if (v4Validation.valid) {
        console.log(`✅ PASS: Script generated with V4.1 compliance`);
        console.log(`   - structureVersion: ${script.structureVersion}`);
        console.log(`   - retentionSpikeVersion: ${script.retentionSpikeVersion}`);
        console.log(`   - renderMode: ${script.renderMode}`);
        console.log(`   - subtitleTimingMode: ${script.subtitleTimingMode}`);
        console.log(`   - wordAlignmentEngine: ${script.wordAlignmentEngine}`);
        console.log(`   - viralityScore: ${script.viralityScore}`);
        console.log(`   - duration: ${script.duration}s`);
        passed++;
      } else {
        console.log(`❌ FAIL: Script failed V4 validation`);
        console.log(`   Errors:`);
        v4Validation.errors.forEach(e => console.log(`     - ${e}`));
        failed++;
      }
    }
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    failed++;
  }

  // Test 2: Publicador
  console.log(`\n2️⃣  Testing publish validator...`);
  try {
    const script = await generateScript({ topic: 'habits' });

    if (!script) {
      console.log(`❌ FAIL: No script to validate`);
      failed++;
    } else {
      const publishValidation = validateForPublish({
        id: script.videoId || 'test-video',
        prefabScript: script,
      });

      if (publishValidation.valid) {
        console.log(`✅ PASS: Video eligible for publication`);
        console.log(`   - V4 contract: OK`);
        console.log(`   - Other criteria: OK`);
        passed++;
      } else {
        console.log(`❌ FAIL: ${publishValidation.reason}`);
        if (publishValidation.v4Errors) {
          publishValidation.v4Errors.forEach(e => console.log(`     - ${e}`));
        }
        if (publishValidation.failures) {
          publishValidation.failures.forEach(f => console.log(`     - ${f.field}: ${f.reason}`));
        }
        failed++;
      }
    }
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    failed++;
  }

  // Summary
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 RESULTS`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  if (failed === 0) {
    console.log(`\n🎉 V4.1 PIPELINE IS FULLY COMPLIANT`);
    process.exit(0);
  } else {
    console.log(`\n⚠️  PIPELINE HAS ${failed} FAILURE(S)`);
    process.exit(1);
  }
}

testV4Pipeline().catch(err => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
