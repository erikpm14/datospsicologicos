console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  INTRODUCCIÓN DE IMPREVISIBILIDAD CONTROLADA');
console.log('═══════════════════════════════════════════════════════════════════\n');

const duration = 26.0;

// Current (too perfect) timing
const current = {
  soft: 14.3,
  micro: 15.8,
  strong: 16.8,
};

// Adjusted with variation (±0.2-0.4s) and unpredictability
const adjusted = {
  soft: 14.5,        // +0.2s variation (less obvious)
  micro: 15.7,       // -0.1s variation (broken pattern)
  unexpectedPause: 16.2, // NEW: micro pausa inesperada (62.3%)
  strong: 17.1,      // +0.3s variation (delays expectations)
};

console.log('TIMING ADJUSTMENT:');
console.log('─'.repeat(65));
console.log(`Soft spike:          ${current.soft}s → ${adjusted.soft}s (Δ = +0.2s)`);
console.log(`Micro spike:         ${current.micro}s → ${adjusted.micro}s (Δ = -0.1s)`);
console.log(`Unexpected pause:    NEW @ ${adjusted.unexpectedPause}s (62.3%)`);
console.log(`Strong spike:        ${current.strong}s → ${adjusted.strong}s (Δ = +0.3s)`);
console.log('');

console.log('SEPARATION ANALYSIS:');
console.log('─'.repeat(65));
const sep1_current = current.micro - current.soft;
const sep1_adjusted = adjusted.micro - adjusted.soft;
const sep2_adjusted = adjusted.unexpectedPause - adjusted.micro;
const sep3_adjusted = adjusted.strong - adjusted.unexpectedPause;

console.log(`CURRENT (Perfect):     Soft→Micro: ${sep1_current}s,  Micro→Strong: ${current.strong - current.micro}s`);
console.log(`ADJUSTED (Varied):     Soft→Micro: ${sep1_adjusted.toFixed(1)}s,  Micro→Pause: ${sep2_adjusted.toFixed(1)}s,  Pause→Strong: ${sep3_adjusted.toFixed(1)}s`);
console.log('');

console.log('UNPREDICTABILITY CHECKLIST:');
console.log('─'.repeat(65));
const equidistant = sep1_adjusted === sep2_adjusted && sep2_adjusted === sep3_adjusted;
const hasUnexpected = adjusted.unexpectedPause !== undefined;
const timing_varied = adjusted.soft !== current.soft || adjusted.micro !== current.micro;

console.log(`✓ Spikes NOT equidistant:      ${!equidistant ? 'YES' : 'NO'}`);
console.log(`  └─ Soft→Micro: ${sep1_adjusted.toFixed(1)}s,  Micro→Pause: ${sep2_adjusted.toFixed(1)}s,  Pause→Strong: ${sep3_adjusted.toFixed(1)}s`);
console.log(`✓ Unexpected pause before strong: ${hasUnexpected ? 'YES' : 'NO'}`);
console.log(`  └─ @ ${adjusted.unexpectedPause}s (62.3% — breaks pattern)`);
console.log(`✓ Timing variation applied:   ${timing_varied ? 'YES' : 'NO'}`);
console.log(`  └─ Deviation: ±0.1-0.3s (natural, not robotic)`);
console.log('');

console.log('PSYCHOLOGICAL EFFECT:');
console.log('─'.repeat(65));
console.log(`CURRENT:  Soft (14.3s) → Micro (15.8s) → Strong (16.8s)`);
console.log(`          Pattern is predictable, viewer anticipates strong spike\n`);
console.log(`ADJUSTED: Soft (14.5s) → Micro (15.7s) → Unexpected (16.2s) → Strong (17.1s)`);
console.log(`          Pattern broken by unexpected pause, viewer surprised`);
console.log('');

console.log('═══════════════════════════════════════════════════════════════════\n');
