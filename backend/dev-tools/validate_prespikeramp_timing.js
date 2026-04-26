const duration = 26.0;

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  PRESPIKERAMP TIMING VALIDATION (Fine Tuning)');
console.log('═══════════════════════════════════════════════════════════════════\n');

// Proposed timing (with 0.8s minimum separation)
const softSpike = 14.8;      // 57.0% (55-60% range)
const microSpike = 15.8;     // 60.8% (60-65% range)
const strongSpike = 17.5;    // 67.3% (60-70% range)

console.log('PROPOSED SPIKE TIMING:');
console.log('─'.repeat(65));
console.log(`Soft spike:   ${softSpike}s (${((softSpike / duration) * 100).toFixed(1)}%) - Range: 55-60%`);
console.log(`Micro spike:  ${microSpike}s (${((microSpike / duration) * 100).toFixed(1)}%) - Range: 60-65%`);
console.log(`Strong spike: ${strongSpike}s (${((strongSpike / duration) * 100).toFixed(1)}%) - Range: 60-70%`);
console.log('');

console.log('SPIKE SEPARATION VALIDATION:');
console.log('─'.repeat(65));
const softToMicro = microSpike - softSpike;
const microToStrong = strongSpike - microSpike;

console.log(`Soft → Micro:  ${softToMicro}s (minimum: 0.8s) ${softToMicro >= 0.8 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`Micro → Strong: ${microToStrong}s (minimum: 0.8s) ${microToStrong >= 0.8 ? '✓ PASS' : '✗ FAIL'}`);
console.log('');

console.log('PAUSE TIMING (Escalated):');
console.log('─'.repeat(65));
console.log(`Soft spike pause:   80-120ms  → Target: 100ms`);
console.log(`Micro spike pause:  100-150ms → Target: 120ms`);
console.log(`Strong spike pause: 150-250ms → Target: 180ms (LONGEST)`);
console.log('');

console.log('VALIDATION CHECKLIST:');
console.log('─'.repeat(65));
const checks = [
  ['Soft in 55-60%', softSpike >= duration * 0.55 && softSpike <= duration * 0.60],
  ['Micro in 60-65%', microSpike >= duration * 0.60 && microSpike <= duration * 0.65],
  ['Strong in 60-70%', strongSpike >= duration * 0.60 && strongSpike <= duration * 0.70],
  ['Soft→Micro gap ≥0.8s', softToMicro >= 0.8],
  ['Micro→Strong gap ≥0.8s', microToStrong >= 0.8],
  ['Strong pause > Micro pause', 180 > 120],
  ['Strong pause > Soft pause', 180 > 100],
];

let allValid = true;
for (const [check, valid] of checks) {
  console.log(`  ${valid ? '✓' : '✗'} ${check}`);
  if (!valid) allValid = false;
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
if (allValid) {
  console.log('  ✅ ALL TIMING VALIDATIONS PASSED');
} else {
  console.log('  ❌ SOME VALIDATIONS FAILED — NEED ADJUSTMENT');
}
console.log('═══════════════════════════════════════════════════════════════════\n');
