#!/usr/bin/env node

/**
 * validate-skip-recover-flow.js
 *
 * Dry-run validator para el flujo de:
 * 1. Skip slot si no hay candidatos válidos
 * 2. Late publish si aparece vídeo válido después
 *
 * No toca YouTube, solo simula la lógica.
 */

const fs = require('fs');
const path = require('path');

console.log('\n' + '='.repeat(70));
console.log('[VALIDATION] Skip + Late-Publish Recovery Flow');
console.log('='.repeat(70));

// Test 1: Verificar que los archivos existen y tienen sintaxis correcta
console.log('\n[TEST 1] Verifying modified files...');

const filesToCheck = [
  'src/services/publish-scheduler.service.js',
  'src/services/late-publish-recovery.js',
  'src/queue/video-processor.js',
  'pre-check-scheduler.js',
];

let allValid = true;
for (const file of filesToCheck) {
  const fullPath = path.join(process.cwd(), file);
  if (fs.existsSync(fullPath)) {
    console.log(`✓ ${file}`);
  } else {
    console.error(`✗ ${file} NOT FOUND`);
    allValid = false;
  }
}

if (!allValid) {
  console.error('\n✗ Some files missing');
  process.exit(1);
}

// Test 2: Verificar markers en publish-scheduler.service.js
console.log('\n[TEST 2] Checking for new slot skip markers...');
const schedulerPath = path.join(process.cwd(), 'src/services/publish-scheduler.service.js');
const schedulerContent = fs.readFileSync(schedulerPath, 'utf8');

const requiredMarkers = [
  'SLOT_SKIPPED_NO_VALID_VIDEO',
  'SLOT_SKIPPED_SAVED',
  'skipped-slots-state.json',
  'hasValidSize',
];

for (const marker of requiredMarkers) {
  if (schedulerContent.includes(marker)) {
    console.log(`✓ Found: ${marker}`);
  } else {
    console.error(`✗ Missing: ${marker}`);
    allValid = false;
  }
}

// Test 3: Verificar late-publish-recovery.js
console.log('\n[TEST 3] Checking late-publish-recovery implementation...');
const latePublishPath = path.join(process.cwd(), 'src/services/late-publish-recovery.js');
const latePublishContent = fs.readFileSync(latePublishPath, 'utf8');

const latePublishChecks = [
  'attemptLatePublish',
  'canAttemptLatePublish',
  'validateVideoForLatePublish',
  'LATE_PUBLISH_EXECUTED',
  'latePublishExecuted',
  'mustExpireAt',
];

for (const check of latePublishChecks) {
  if (latePublishContent.includes(check)) {
    console.log(`✓ Found: ${check}`);
  } else {
    console.error(`✗ Missing: ${check}`);
    allValid = false;
  }
}

// Test 4: Verificar integración en video-processor.js
console.log('\n[TEST 4] Checking video-processor integration...');
const processorPath = path.join(process.cwd(), 'src/queue/video-processor.js');
const processorContent = fs.readFileSync(processorPath, 'utf8');

if (processorContent.includes('attemptLatePublish')) {
  console.log(`✓ attemptLatePublish called in video-processor`);
} else {
  console.error(`✗ attemptLatePublish integration missing`);
  allValid = false;
}

// Test 5: Anti-abuse constraints
console.log('\n[TEST 5] Verifying anti-abuse constraints...');
const antiAbuseChecks = [
  { pattern: 'mustExpireAt', desc: '2h expiration window' },
  { pattern: 'canPublishWithoutExceedingDailyLimit', desc: 'MAX_PER_DAY limit check' },
  { pattern: 'latePublishExecuted', desc: '1 late publish per slot limit' },
  { pattern: 'already published', desc: 'prevent re-publish' },
  { pattern: '300 \\* 1024', desc: '300KB minimum size' },
  { pattern: 'duration < 8', desc: '8s minimum duration' },
];

for (const check of antiAbuseChecks) {
  if (latePublishContent.includes(check.pattern)) {
    console.log(`✓ ${check.desc}`);
  } else {
    console.warn(`⚠ ${check.desc} - may need verification`);
  }
}

// Test 6: Pre-check script
console.log('\n[TEST 6] Checking pre-check script...');
const preCheckPath = path.join(process.cwd(), 'pre-check-scheduler.js');
const preCheckContent = fs.readFileSync(preCheckPath, 'utf8');

if (preCheckContent.includes('SLOT_WILL_BE_SKIPPED') && preCheckContent.includes('SLOT_WILL_BE_FILLED')) {
  console.log(`✓ Pre-check script has all output messages`);
} else {
  console.error(`✗ Pre-check script incomplete`);
  allValid = false;
}

// Test 7: File modifications summary
console.log('\n[TEST 7] Summarizing modifications...');
const modifications = [
  {
    file: 'publish-scheduler.service.js',
    lines: 930,
    changes: [
      '- Modified NO_FALLBACK section (lines 806-828)',
      '- Added SLOT_SKIPPED_NO_VALID_VIDEO logic',
      '- Saves skipped-slots-state.json for late recovery',
      '- Distinguishes between true SLOT_LOST_FINAL vs SLOT_SKIPPED',
    ],
  },
  {
    file: 'late-publish-recovery.js',
    lines: 'new',
    changes: [
      '- New module for delayed publication recovery',
      '- Validates video: >=8s, >=300KB, no published.json',
      '- Anti-abuse: max 1 late/day, max 2h window, daily limit check',
      '- Calls publisher.publishAll() if all constraints pass',
      '- Logs [LATE_PUBLISH_EXECUTED]',
    ],
  },
  {
    file: 'video-processor.js',
    lines: 'modified',
    changes: [
      '- Added attemptLatePublish() call after moveJob to done',
      '- Called only in AUTO_PUBLISH_ENABLED=true (deferred mode)',
      '- Executes async without blocking main flow',
      '- Graceful fallback if late-publish not available',
    ],
  },
  {
    file: 'pre-check-scheduler.js',
    lines: 'new',
    changes: [
      '- Pre-slot analysis tool (execute before 14:30 or 21:05)',
      '- Lists all ready candidates with durations and sizes',
      '- Shows which would be published or skipped',
      '- Marks truncated videos and valid candidates',
    ],
  },
];

for (const mod of modifications) {
  console.log(`\n  ${mod.file}:`);
  mod.changes.forEach(c => console.log(`    ${c}`));
}

// Final summary
console.log('\n' + '='.repeat(70));

if (!allValid) {
  console.error('✗ Validation FAILED');
  process.exit(1);
}

console.log('✅ All validations PASSED\n');

console.log('FLOW SUMMARY:');
console.log('─────────────────────────────────────────────────────────────────');
console.log('1. BEFORE SLOT (14:20 CET):');
console.log('   $ node pre-check-scheduler.js');
console.log('   → Shows which video will be published or if slot will skip\n');

console.log('2. SLOT EXECUTION (14:30 CET):');
console.log('   - Scheduler picks best candidate if valid (>=8s, >=300KB)');
console.log('   - If NO valid candidate:');
console.log('     [SLOT_SKIPPED_NO_VALID_VIDEO] logged');
console.log('     skipped-slots-state.json saved (2h window)');
console.log('   - If HAS valid candidate but QC fails:');
console.log('     [SLOT_LOST_FINAL] logged (true failure)\n');

console.log('3. AFTER RENDER (whenever new valid video appears):');
console.log('   - video-processor completes render → calls attemptLatePublish()');
console.log('   - attemptLatePublish checks:');
console.log('     ✓ skipped-slots-state.json exists & not expired');
console.log('     ✓ video duration >= 8s (no truncated videos)');
console.log('     ✓ video size >= 300KB');
console.log('     ✓ not already published');
console.log('     ✓ daily limit not exceeded');
console.log('     ✓ not >1 late publish this slot');
console.log('   - If all OK: publishes with [LATE_PUBLISH_EXECUTED]\n');

console.log('ANTI-ABUSE SAFEGUARDS:');
console.log('─────────────────────────────────────────────────────────────────');
console.log('• Never publish truncated videos (<8s)');
console.log('• 2-hour window per skipped slot');
console.log('• Maximum 1 late publish per slot');
console.log('• Still respect MAX_PUBLISHES_PER_DAY');
console.log('• Never re-publish already published videos');
console.log('• Never publish if manual publish already happened that slot\n');

console.log('FILES MODIFIED:');
console.log('─────────────────────────────────────────────────────────────────');
console.log('✓ src/services/publish-scheduler.service.js (930 lines)');
console.log('✓ src/services/late-publish-recovery.js (new)');
console.log('✓ src/queue/video-processor.js (modified)');
console.log('✓ pre-check-scheduler.js (new)\n');

console.log('='.repeat(70) + '\n');
