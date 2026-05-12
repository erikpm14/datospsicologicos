const { validateReadyVideo } = require('../src/services/ready-video-validator.service');

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║    PHASE 1: VALIDATE SLOT 14:30 VIDEOS               ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

const principal = 'e6b82cf5-5fa4-4803-9ead-3525b894e824';
const backup = 'e1673217-7f2f-4f0a-81ae-71a2cbfd5abd';

console.log('PRINCIPAL VIDEO:');
console.log(`  VideoId: ${principal}\n`);
const valPrincipal = validateReadyVideo(principal);
console.log(`  Ready: ${valPrincipal.ready ? '✓ YES - CAN PUBLISH' : '✗ NO'}`);

if (!valPrincipal.ready) {
  console.log('\n  Errors:');
  valPrincipal.errors.forEach(e => console.log(`    ✗ ${e}`));
  console.log('\n  → Will attempt BACKUP\n');
} else {
  console.log('\n  Checks:');
  Object.entries(valPrincipal.checks).forEach(([check, result]) => {
    if (typeof result === 'object') return;
    console.log(`    ${result ? '✓' : '✗'} ${check}`);
  });
}

console.log('\n' + '─'.repeat(56));
console.log('\nBACKUP VIDEO:');
console.log(`  VideoId: ${backup}\n`);
const valBackup = validateReadyVideo(backup);
console.log(`  Ready: ${valBackup.ready ? '✓ YES - CAN PUBLISH' : '✗ NO'}`);

if (!valBackup.ready) {
  console.log('\n  Errors:');
  valBackup.errors.forEach(e => console.log(`    ✗ ${e}`));
} else {
  console.log('\n  Checks:');
  Object.entries(valBackup.checks).forEach(([check, result]) => {
    if (typeof result === 'object') return;
    console.log(`    ${result ? '✓' : '✗'} ${check}`);
  });
}

console.log('\n' + '─'.repeat(56));
console.log('\nRECOVERY READINESS:');
if (valPrincipal.ready) {
  console.log('  ✓ Principal READY - will use for recovery');
  process.exit(0);
} else if (valBackup.ready) {
  console.log('  ✓ Principal FAILED - backup READY - will use backup');
  process.exit(1);
} else {
  console.log('  ✗ Both principal AND backup FAILED - cannot recover');
  process.exit(2);
}
