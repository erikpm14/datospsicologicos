#!/usr/bin/env node

/**
 * validate-integration.js
 * Validates that the unified validation system is properly integrated
 */

const fs = require('fs');
const path = require('path');

console.log('\n' + '═'.repeat(70));
console.log('UNIFIED VALIDATION SYSTEM - INTEGRATION VALIDATION');
console.log('═'.repeat(70) + '\n');

const checks = [];

// Check 1: Core validator exists and exports correct functions
console.log('CHECK 1: Core validator module...');
try {
  const validator = require('./src/services/publish-candidate-validator.service');
  const requiredExports = ['validatePublishCandidate', 'validateHardBlocks', 'validateMetadata', 'logValidationDecision'];
  const missingExports = requiredExports.filter(e => !validator[e]);

  if (missingExports.length === 0) {
    console.log('  ✅ All required exports present');
    checks.push({ name: 'Core validator exports', ok: true });
  } else {
    console.log(`  ❌ Missing exports: ${missingExports.join(', ')}`);
    checks.push({ name: 'Core validator exports', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  checks.push({ name: 'Core validator exports', ok: false });
}

// Check 2: Validator works on test videos
console.log('\nCHECK 2: Validator functionality...');
try {
  const { validatePublishCandidate } = require('./src/services/publish-candidate-validator.service');

  // Test with a known valid video
  const result = validatePublishCandidate({ videoId: '3a2d8a39-2c2f-430c-93ac-c1410b48505b' }, true);

  const requiredFields = ['hardPassed', 'hardBlocks', 'warnings', 'quality', 'duration', 'canPublish', 'videoId'];
  const missingFields = requiredFields.filter(f => !(f in result));

  if (missingFields.length === 0 && typeof result.hardPassed === 'boolean') {
    console.log('  ✅ Validator returns correct structure');
    console.log(`     - hardPassed: ${result.hardPassed}`);
    console.log(`     - warnings: ${result.warnings.length}`);
    console.log(`     - quality: ${result.quality}%`);
    checks.push({ name: 'Validator functionality', ok: true });
  } else {
    console.log(`  ❌ Missing fields: ${missingFields.join(', ')}`);
    checks.push({ name: 'Validator functionality', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  checks.push({ name: 'Validator functionality', ok: false });
}

// Check 3: Late-publish integration
console.log('\nCHECK 3: late-publish-recovery integration...');
try {
  const content = fs.readFileSync('./src/services/late-publish-recovery.js', 'utf8');

  if (content.includes("require('./publish-candidate-validator.service'")) {
    console.log('  ✅ late-publish imports core validator');
    checks.push({ name: 'late-publish integration', ok: true });
  } else {
    console.log('  ❌ late-publish does not import core validator');
    checks.push({ name: 'late-publish integration', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  checks.push({ name: 'late-publish integration', ok: false });
}

// Check 4: Scheduler integration
console.log('\nCHECK 4: publish-scheduler integration...');
try {
  const content = fs.readFileSync('./src/services/publish-scheduler.service.js', 'utf8');

  if (content.includes("require('./publish-candidate-validator.service'")) {
    console.log('  ✅ scheduler imports core validator');
    checks.push({ name: 'scheduler integration', ok: true });
  } else {
    console.log('  ❌ scheduler does not import core validator');
    checks.push({ name: 'scheduler integration', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  checks.push({ name: 'scheduler integration', ok: false });
}

// Check 5: Dry-run integration
console.log('\nCHECK 5: dry-run-slot-decision integration...');
try {
  const content = fs.readFileSync('./dry-run-slot-decision.js', 'utf8');

  if (content.includes("require('./src/services/publish-candidate-validator.service'")) {
    console.log('  ✅ dry-run imports core validator');
    checks.push({ name: 'dry-run integration', ok: true });
  } else {
    console.log('  ❌ dry-run does not import core validator');
    checks.push({ name: 'dry-run integration', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  checks.push({ name: 'dry-run integration', ok: false });
}

// Check 6: Documentation exists
console.log('\nCHECK 6: Documentation...');
try {
  const policyExists = fs.existsSync('./VALIDATION_POLICY.md');
  const integrationExists = fs.existsSync('./UNIFIED_VALIDATION_INTEGRATION.md');

  if (policyExists && integrationExists) {
    console.log('  ✅ All documentation files present');
    checks.push({ name: 'Documentation', ok: true });
  } else {
    console.log(`  ❌ Missing: ${!policyExists ? 'VALIDATION_POLICY.md ' : ''}${!integrationExists ? 'UNIFIED_VALIDATION_INTEGRATION.md' : ''}`);
    checks.push({ name: 'Documentation', ok: false });
  }
} catch (err) {
  console.log(`  ❌ Error: ${err.message}`);
  checks.push({ name: 'Documentation', ok: false });
}

// Summary
console.log('\n' + '═'.repeat(70));
console.log('SUMMARY\n');

const passed = checks.filter(c => c.ok).length;
const total = checks.length;

checks.forEach(c => {
  const icon = c.ok ? '✅' : '❌';
  console.log(`${icon} ${c.name}`);
});

console.log(`\n${passed}/${total} checks passed\n`);

if (passed === total) {
  console.log('🎉 UNIFIED VALIDATION SYSTEM FULLY INTEGRATED\n');
  console.log('✨ Key features:');
  console.log('   • 8 hard blocks (technical impossibilities)');
  console.log('   • 7 warnings (non-blocking metadata issues)');
  console.log('   • Unified core validator across all components');
  console.log('   • Videos with valid MP4/audio/video streams publish');
  console.log('   • Clear, observable validation criteria');
  console.log('\n📊 Monitor with:');
  console.log('   node test-validation-filters.js');
  console.log('   node dry-run-slot-decision.js');
  console.log('   pm2 logs backend | grep CANDIDATE\n');
  process.exit(0);
} else {
  console.log('⚠️  Some checks failed. Review integration.\n');
  process.exit(1);
}
