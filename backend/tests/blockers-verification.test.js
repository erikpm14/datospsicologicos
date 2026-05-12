#!/usr/bin/env node
/**
 * BLOCKERS VERIFICATION TEST SUITE
 *
 * Verifies that all 6 critical blockers are implemented and functioning:
 * 1. ready-video-validator.service.js created
 * 2. validateReadyVideo() integrated into critical services
 * 3. /api/videos/upload-youtube endpoint removed
 * 4. "publish:now" script removed from package.json
 * 5. Triple publication investigation documented
 * 6. Tests pass without publishing
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BACKEND_DIR = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────
// TEST SETUP
// ─────────────────────────────────────────────

const results = {
  blockers: [
    { id: 1, name: 'ready-video-validator.service.js exists', status: null, error: null },
    { id: 2, name: 'validateReadyVideo integrated in 5 services', status: null, error: null },
    { id: 3, name: '/api/videos/upload-youtube endpoint removed', status: null, error: null },
    { id: 4, name: '"publish:now" script removed from package.json', status: null, error: null },
    { id: 5, name: 'Triple publication investigation documented', status: null, error: null },
    { id: 6, name: 'validateReadyVideo validator works correctly', status: null, error: null },
  ],
  total: 0,
  passed: 0,
  failed: 0,
};

// ─────────────────────────────────────────────
// BLOCKER 1: ready-video-validator.service.js exists
// ─────────────────────────────────────────────

function testBlocker1() {
  const validatorPath = path.join(BACKEND_DIR, 'src/services/ready-video-validator.service.js');

  try {
    assert(fs.existsSync(validatorPath), 'File does not exist');

    const content = fs.readFileSync(validatorPath, 'utf8');
    assert(content.includes('validateReadyVideo'), 'validateReadyVideo function not found');
    assert(content.includes('return {'), 'Function does not return object');
    assert(content.includes('ready: boolean'), 'Return structure missing');

    results.blockers[0].status = 'PASS';
    results.passed++;
    console.log('✓ BLOCKER 1: ready-video-validator.service.js exists and exported');
    return true;
  } catch (err) {
    results.blockers[0].status = 'FAIL';
    results.blockers[0].error = err.message;
    results.failed++;
    console.error('✗ BLOCKER 1 FAILED:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// BLOCKER 2: validateReadyVideo integrated in 5 services
// ─────────────────────────────────────────────

function testBlocker2() {
  const services = [
    { name: 'nearest-slot-protection.service.js', file: 'src/services/nearest-slot-protection.service.js' },
    { name: 'publish-guard.service.js', file: 'src/services/publish-guard.service.js' },
    { name: 'publish-scheduler.service.js', file: 'src/services/publish-scheduler.service.js' },
    { name: 'emergency-generate-no-llm.js', file: 'scripts/emergency-generate-no-llm.js' },
    { name: 'late-slot-recovery.js', file: 'scripts/late-slot-recovery.js' },
  ];

  try {
    let integratedCount = 0;

    for (const service of services) {
      const filePath = path.join(BACKEND_DIR, service.file);
      assert(fs.existsSync(filePath), `${service.name} does not exist`);

      const content = fs.readFileSync(filePath, 'utf8');
      const hasImport = content.includes('validateReadyVideo') || content.includes('ready-video-validator');
      const hasCall = content.includes('validateReadyVideo(');

      if (hasImport && hasCall) {
        integratedCount++;
        console.log(`  ✓ ${service.name}: validateReadyVideo integrated`);
      } else {
        console.log(`  ✗ ${service.name}: validateReadyVideo NOT integrated`);
      }
    }

    assert(integratedCount >= 5, `Only ${integratedCount}/5 services have validateReadyVideo integrated`);

    results.blockers[1].status = 'PASS';
    results.passed++;
    console.log('✓ BLOCKER 2: validateReadyVideo integrated in 5 critical services');
    return true;
  } catch (err) {
    results.blockers[1].status = 'FAIL';
    results.blockers[1].error = err.message;
    results.failed++;
    console.error('✗ BLOCKER 2 FAILED:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// BLOCKER 3: /api/videos/upload-youtube endpoint removed
// ─────────────────────────────────────────────

function testBlocker3() {
  try {
    const serverPath = path.join(BACKEND_DIR, 'src/server.js');
    const content = fs.readFileSync(serverPath, 'utf8');

    // Should NOT contain the unsafe endpoint
    assert(
      !content.includes("app.post('/api/videos/upload-youtube'"),
      '/api/videos/upload-youtube endpoint still exists in server.js'
    );

    // Should NOT call publishToYouTube without guard context
    const lines = content.split('\n');
    let foundDirectCall = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('publishToYouTube') && !lines[i].includes('//')) {
        // Check context - should not be a direct HTTP endpoint call
        const context = lines.slice(Math.max(0, i - 10), i).join('\n');
        if (context.includes("app.post")) {
          foundDirectCall = true;
          break;
        }
      }
    }

    assert(!foundDirectCall, 'Direct publishToYouTube call in HTTP endpoint found');

    results.blockers[2].status = 'PASS';
    results.passed++;
    console.log('✓ BLOCKER 3: /api/videos/upload-youtube endpoint removed');
    return true;
  } catch (err) {
    results.blockers[2].status = 'FAIL';
    results.blockers[2].error = err.message;
    results.failed++;
    console.error('✗ BLOCKER 3 FAILED:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// BLOCKER 4: "publish:now" script removed from package.json
// ─────────────────────────────────────────────

function testBlocker4() {
  try {
    const packageJsonPath = path.join(BACKEND_DIR, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    // Should NOT contain publish:now script
    assert(
      !packageJson.scripts || !packageJson.scripts['publish:now'],
      '"publish:now" script still exists in package.json'
    );

    results.blockers[3].status = 'PASS';
    results.passed++;
    console.log('✓ BLOCKER 4: "publish:now" script removed from package.json');
    return true;
  } catch (err) {
    results.blockers[3].status = 'FAIL';
    results.blockers[3].error = err.message;
    results.failed++;
    console.error('✗ BLOCKER 4 FAILED:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// BLOCKER 5: Triple publication investigation documented
// ─────────────────────────────────────────────

function testBlocker5() {
  try {
    const investigationPath = path.join(BACKEND_DIR, 'data/BLOCKER_5_INVESTIGATION.md');

    assert(fs.existsSync(investigationPath), 'Investigation document does not exist');

    const content = fs.readFileSync(investigationPath, 'utf8');
    assert(content.includes('5a81501b'), 'Investigation does not mention videoId 5a81501b');
    assert(content.includes('Root Cause'), 'Investigation lacks root cause analysis');
    assert(content.includes('9gIjsHDn91s'), 'Investigation does not mention first youtubeId');
    assert(content.includes('nS-RNY9-1po'), 'Investigation does not mention second youtubeId');
    assert(content.includes('uGjbG_t4I7k'), 'Investigation does not mention third youtubeId');

    results.blockers[4].status = 'PASS';
    results.passed++;
    console.log('✓ BLOCKER 5: Triple publication investigation documented');
    return true;
  } catch (err) {
    results.blockers[4].status = 'FAIL';
    results.blockers[4].error = err.message;
    results.failed++;
    console.error('✗ BLOCKER 5 FAILED:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// BLOCKER 6: validateReadyVideo validator works correctly
// ─────────────────────────────────────────────

function testBlocker6() {
  try {
    const { validateReadyVideo } = require('../src/services/ready-video-validator.service');

    // Test 1: Invalid videoId
    const result1 = validateReadyVideo(null);
    assert(!result1.ready, 'Null videoId should not be ready');
    assert(result1.errors && result1.errors.length > 0, 'Should have errors for invalid input');
    console.log('  ✓ Blocks invalid videoId');

    // Test 2: Non-existent videoId
    const result2 = validateReadyVideo('non-existent-video-id-12345');
    assert(!result2.ready, 'Non-existent video should not be ready');
    assert(result2.errors && result2.errors.length > 0, 'Should have errors for missing files');
    console.log('  ✓ Blocks non-existent video');

    // Test 3: Check return structure
    const result3 = validateReadyVideo('some-video-id');
    assert(result3.hasOwnProperty('ready'), 'Missing ready property');
    assert(Array.isArray(result3.errors), 'errors should be array');
    assert(Array.isArray(result3.warnings), 'warnings should be array');
    assert(result3.hasOwnProperty('checks'), 'Missing checks property');
    console.log('  ✓ Returns correct structure');

    // Test 4: Verify all 18 checks are present
    const expectedChecks = [
      'outputExists', 'outputSizeValid', 'metadataExists', 'renderModeDynamic',
      'backgroundAppliedToRender', 'clipTimelineExists', 'visualComplexityPass',
      'subtitlesFileExists', 'subtitlesContentValid', 'subtitlesBurnedIn',
      'scriptDiversityPass', 'backgroundDiversityPass', 'prepublishQcPass',
      'duplicateHardBlockPass', 'noYoutubeId', 'noPublishedJson', 'notRejected',
      'notLegacyRender'
    ];

    const result4 = validateReadyVideo('some-video-id');
    for (const checkName of expectedChecks) {
      assert(result4.checks.hasOwnProperty(checkName), `Missing check: ${checkName}`);
    }
    console.log('  ✓ All 18 validation checks present');

    results.blockers[5].status = 'PASS';
    results.passed++;
    console.log('✓ BLOCKER 6: validateReadyVideo validator works correctly');
    return true;
  } catch (err) {
    results.blockers[5].status = 'FAIL';
    results.blockers[5].error = err.message;
    results.failed++;
    console.error('✗ BLOCKER 6 FAILED:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// RUN ALL TESTS
// ─────────────────────────────────────────────

function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║        BLOCKERS VERIFICATION TEST SUITE (6/6)          ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  testBlocker1();
  testBlocker2();
  testBlocker3();
  testBlocker4();
  testBlocker5();
  testBlocker6();

  results.total = results.passed + results.failed;

  // ─────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                        ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  for (const blocker of results.blockers) {
    const icon = blocker.status === 'PASS' ? '✓' : '✗';
    const status = blocker.status === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`${icon} BLOCKER ${blocker.id}: ${status} - ${blocker.name}`);
    if (blocker.error) {
      console.log(`  Error: ${blocker.error}`);
    }
  }

  console.log(`\nTotal: ${results.passed}/${results.total} blockers verified`);

  if (results.failed === 0) {
    console.log('\n✓ ALL BLOCKERS VERIFIED SUCCESSFULLY');
    console.log('\nNo publications were attempted during testing.');
    console.log('System remains FROZEN - manual reactivation required when ready.\n');
    process.exit(0);
  } else {
    console.log(`\n✗ ${results.failed} BLOCKER(S) FAILED`);
    console.log('Please fix issues above before proceeding.\n');
    process.exit(1);
  }
}

runAllTests();
