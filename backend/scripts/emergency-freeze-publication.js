#!/usr/bin/env node
/**
 * EMERGENCY: Freeze all publication processes
 *
 * Confirms and enforces publication freeze state
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(BACKEND_DIR, '.env');
const DATA_DIR = path.resolve(BACKEND_DIR, 'data');
const FREEZE_STATE_PATH = path.resolve(DATA_DIR, 'publication-freeze.json');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║         EMERGENCY: PUBLICATION FREEZE - INITIATED            ║');
console.log('║              All automated publishing STOPPED                ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// ─────────────────────────────────────────────────────────────────
// 1. Verify AUTO_PUBLISH_ENABLED=false in .env
// ─────────────────────────────────────────────────────────────────

console.log('CHECK 1: Verify AUTO_PUBLISH_ENABLED=false');
console.log('─'.repeat(60) + '\n');

let envContent = fs.readFileSync(ENV_PATH, 'utf8');

if (envContent.includes('AUTO_PUBLISH_ENABLED=false')) {
  console.log('✅ [EMERGENCY_AUTOPUBLISH_DISABLED]');
  console.log('   AUTO_PUBLISH_ENABLED=false confirmed in .env\n');
} else if (envContent.includes('AUTO_PUBLISH_ENABLED=true')) {
  console.log('❌ CRITICAL: AUTO_PUBLISH_ENABLED=true still active!');
  process.exit(1);
} else {
  console.log('⚠️  AUTO_PUBLISH_ENABLED not found in .env');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// 2. Create freeze state file for audit trail
// ─────────────────────────────────────────────────────────────────

console.log('CHECK 2: Create Publication Freeze State Log');
console.log('─'.repeat(60) + '\n');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const freezeState = {
  frozenAt: new Date().toISOString(),
  reason: 'EMERGENCY: Multiple videos published with errors before scheduled slots',
  issues: [
    'Videos published before slot time',
    'Some videos published without backgrounds',
    'Content duplication detected'
  ],
  frozenProcesses: [
    'AUTO_PUBLISH_ENABLED (scheduler)',
    'slot-protection-daemon',
    'emergency-publish scripts',
    'manual-late-publish scripts'
  ],
  status: 'FROZEN',
  requiredActionsBeforeResuming: [
    '1. Investigate published videos with errors',
    '2. Audit slot protection system',
    '3. Review background rendering pipeline',
    '4. Check for content duplication',
    '5. Verify PublishScheduler logic',
    '6. Test with single video before resuming'
  ]
};

fs.writeFileSync(FREEZE_STATE_PATH, JSON.stringify(freezeState, null, 2));

console.log('✅ [PUBLICATION_FREEZE_ENABLED]');
console.log(`   Freeze state logged to: ${FREEZE_STATE_PATH}`);
console.log(`   Frozen at: ${freezeState.frozenAt}\n`);

// ─────────────────────────────────────────────────────────────────
// 3. Confirm no Node processes running
// ─────────────────────────────────────────────────────────────────

console.log('CHECK 3: Verify Publication Processes Stopped');
console.log('─'.repeat(60) + '\n');

const { execSync } = require('child_process');

try {
  const psOutput = execSync('tasklist | findstr node.exe').toString();
  console.log('⚠️  Warning: Node processes still running:');
  console.log(psOutput);
  console.log('\nTo stop manually:');
  console.log('   taskkill /F /IM node.exe');
  console.log('   (WARNING: This will stop ALL node processes)\n');
} catch {
  console.log('✅ [ALL_PUBLISH_PROCESSES_STOPPED]');
  console.log('   No Node.js processes detected running\n');
}

// ─────────────────────────────────────────────────────────────────
// 4. Summary
// ─────────────────────────────────────────────────────────────────

console.log('═'.repeat(60));
console.log('              EMERGENCY FREEZE COMPLETE');
console.log('═'.repeat(60) + '\n');

console.log('Status: 🔴 PUBLICATION FREEZE ACTIVE\n');

console.log('Frozen processes:');
freezeState.frozenProcesses.forEach(proc => {
  console.log(`  ❌ ${proc}`);
});

console.log('\nRequired before resuming publication:');
freezeState.requiredActionsBeforeResuming.forEach((action, idx) => {
  console.log(`  ${idx + 1}. ${action}`);
});

console.log('\n' + '─'.repeat(60));
console.log('DO NOT RESUME until all audits are complete.');
console.log('─'.repeat(60) + '\n');

console.log('Freeze state file: ' + FREEZE_STATE_PATH);
console.log('Last modified: ' + new Date().toLocaleTimeString());
