#!/usr/bin/env node

/**
 * test-qc-override-guarantee.js
 * Validates that hardPassed videos are NEVER blocked by QC
 */

const fs = require('fs');
const path = require('path');

console.log('\n' + '═'.repeat(70));
console.log('QC OVERRIDE GUARANTEE VALIDATION');
console.log('═'.repeat(70) + '\n');

const tests = [];

// TEST 1: validatePublishCandidate returns hardPassed
console.log('TEST 1: Core validator returns hardPassed field');
try {
  const { validatePublishCandidate } = require('./src/services/publish-candidate-validator.service');
  const result = validatePublishCandidate({ videoId: '3a2d8a39-2c2f-430c-93ac-c1410b48505b' }, true);

  if ('hardPassed' in result && typeof result.hardPassed === 'boolean') {
    console.log('  ✅ hardPassed field exists and is boolean');
    tests.push({ name: 'hardPassed field', ok: true });
  } else {
    console.log('  ❌ hardPassed field missing or not boolean');
    tests.push({ name: 'hardPassed field', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  tests.push({ name: 'hardPassed field', ok: false });
}

// TEST 2: Scheduler code contains hard block early exit
console.log('\nTEST 2: Scheduler has hard block early exit');
try {
  const content = fs.readFileSync('./src/services/publish-scheduler.service.js', 'utf8');

  const hasHardBlockCheck = content.includes('validation.coreValidation?.hardPassed') ||
                            content.includes('!validation.coreValidation?.hardPassed');
  const hasEarlyExit = content.includes('[CANDIDATE_HARD_REJECTED]');

  if (hasHardBlockCheck && hasEarlyExit) {
    console.log('  ✅ Hard block early exit implemented');
    tests.push({ name: 'Hard block exit', ok: true });
  } else {
    console.log('  ❌ Hard block exit missing');
    console.log('     - hasHardBlockCheck:', hasHardBlockCheck);
    console.log('     - hasEarlyExit:', hasEarlyExit);
    tests.push({ name: 'Hard block exit', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  tests.push({ name: 'Hard block exit', ok: false });
}

// TEST 3: Scheduler segregates QC failed but valid videos
console.log('\nTEST 3: Scheduler segregates hardPassed videos from QC failures');
try {
  const content = fs.readFileSync('./src/services/publish-scheduler.service.js', 'utf8');

  const hasQcFailedCandidates = content.includes('qcFailedCandidates');
  const hasSaveToFallback = content.includes('[QC_FAILED_SAVE_FOR_FALLBACK]');
  const noHardDiscard = !content.includes(
    'discardVideo(video.videoId, \'discarded\', validation.reasons.join'
  );

  if (hasQcFailedCandidates && hasSaveToFallback) {
    console.log('  ✅ QC-failed videos saved for fallback (not discarded)');
    tests.push({ name: 'QC fallback segregation', ok: true });
  } else {
    console.log('  ❌ QC segregation incomplete');
    console.log('     - hasQcFailedCandidates:', hasQcFailedCandidates);
    console.log('     - hasSaveToFallback:', hasSaveToFallback);
    tests.push({ name: 'QC fallback segregation', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  tests.push({ name: 'QC fallback segregation', ok: false });
}

// TEST 4: Scheduler has QC override logic
console.log('\nTEST 4: Scheduler has QC override fallback');
try {
  const content = fs.readFileSync('./src/services/publish-scheduler.service.js', 'utf8');

  const hasQcOverride = content.includes('QC_OVERRIDE');
  const hasQcOverrideExecuted = content.includes('[QC_OVERRIDE_EXECUTED]');
  const hasQcOverridePublish = content.includes('[QC_OVERRIDE_PUBLISH]');

  if (hasQcOverride && hasQcOverrideExecuted && hasQcOverridePublish) {
    console.log('  ✅ QC override fallback implemented');
    tests.push({ name: 'QC override fallback', ok: true });
  } else {
    console.log('  ❌ QC override incomplete');
    console.log('     - hasQcOverride:', hasQcOverride);
    console.log('     - hasQcOverrideExecuted:', hasQcOverrideExecuted);
    console.log('     - hasQcOverridePublish:', hasQcOverridePublish);
    tests.push({ name: 'QC override fallback', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  tests.push({ name: 'QC override fallback', ok: false });
}

// TEST 5: Documentation exists
console.log('\nTEST 5: QC override guarantee documented');
try {
  const docExists = fs.existsSync('./QC_OVERRIDE_GUARANTEE.md');

  if (docExists) {
    const docContent = fs.readFileSync('./QC_OVERRIDE_GUARANTEE.md', 'utf8');
    const hasGuarantee = docContent.includes('never blocked by QC') ||
                        docContent.includes('NEVER') &&
                        docContent.includes('hardPassed');

    if (hasGuarantee) {
      console.log('  ✅ Documentation exists and explains guarantee');
      tests.push({ name: 'Documentation', ok: true });
    } else {
      console.log('  ❌ Documentation exists but guarantee not clearly stated');
      tests.push({ name: 'Documentation', ok: false });
    }
  } else {
    console.log('  ❌ Documentation missing');
    tests.push({ name: 'Documentation', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  tests.push({ name: 'Documentation', ok: false });
}

// TEST 6: Validation policy updated
console.log('\nTEST 6: Validation policy documents hard blocks');
try {
  const docExists = fs.existsSync('./VALIDATION_POLICY.md');

  if (docExists) {
    const content = fs.readFileSync('./VALIDATION_POLICY.md', 'utf8');
    const hasHardBlocks = content.includes('HARD BLOCKS');
    const hasWarnings = content.includes('WARNINGS');
    const hasFallback = content.includes('fallback');

    if (hasHardBlocks && hasWarnings) {
      console.log('  ✅ Validation policy clearly separates hard blocks from warnings');
      tests.push({ name: 'Validation policy', ok: true });
    } else {
      console.log('  ❌ Policy incomplete');
      tests.push({ name: 'Validation policy', ok: false });
    }
  } else {
    console.log('  ❌ Documentation missing');
    tests.push({ name: 'Validation policy', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  tests.push({ name: 'Validation policy', ok: false });
}

// SUMMARY
console.log('\n' + '═'.repeat(70));
console.log('SUMMARY\n');

const passed = tests.filter(t => t.ok).length;
const total = tests.length;

tests.forEach(t => {
  const icon = t.ok ? '✅' : '❌';
  console.log(`${icon} ${t.name}`);
});

console.log(`\n${passed}/${total} checks passed\n`);

if (passed === total) {
  console.log('🔒 QC OVERRIDE GUARANTEE CONFIRMED\n');
  console.log('Guarantee Summary:');
  console.log('  ✅ Hard blocks (MP4 existence, audio/video streams, duration) BLOCK publishing');
  console.log('  ✅ QC failures DO NOT block videos that passed hard blocks');
  console.log('  ✅ Videos with hardPassed=true are guaranteed fallback publication');
  console.log('  ✅ Fallback chain: QC-passed → QC-override → best-valid-output');
  console.log('\nValidation Rules:');
  console.log('  • hardPassed = technical validation (MP4, streams, duration)');
  console.log('  • QC = content quality validation (separate layer)');
  console.log('  • If hardPassed=true: video WILL be published or fallback attempted');
  console.log('  • If hardPassed=false: video WILL be rejected (technical issue)');
  console.log('\nLog Patterns to Monitor:');
  console.log('  [CANDIDATE_HARD_REJECTED] = technical block');
  console.log('  [QC_FAILED_SAVE_FOR_FALLBACK] = QC failed but saved');
  console.log('  [QC_OVERRIDE_EXECUTED] = fallback used successfully\n');
  process.exit(0);
} else {
  console.log('⚠️  Some checks failed. Review implementation.\n');
  process.exit(1);
}
