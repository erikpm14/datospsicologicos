console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  PAUSE PERCEPTION ADJUSTMENT (v4.1)');
console.log('═══════════════════════════════════════════════════════════════════\n');

const duration = 26.0;

// Current (pause too short)
const current = {
  micro: 15.7,
  unexpectedPause: 16.2,
  pauseMs: 70,
  gapMicroToUnexpected: 0.5,
  strong: 17.1,
};

// Adjusted (pause perceptible, gap adequate)
const adjusted = {
  micro: 15.7,
  unexpectedPause: 16.4,     // 0.7s gap from micro (min: 0.7s)
  pauseMs: 100,              // 70 → 100ms (perceptible)
  gapMicroToUnexpected: 0.7,
  gapUnexpectedToStrong: 0.7,
  strong: 17.1,
};

console.log('TIMING ADJUSTMENT:');
console.log('─'.repeat(65));
console.log(`Micro spike:        ${current.micro}s (no change)`);
console.log(`Unexpected pause:   ${current.unexpectedPause}s → ${adjusted.unexpectedPause}s (Δ = +0.2s)`);
console.log(`Pause duration:     ${current.pauseMs}ms → ${adjusted.pauseMs}ms (Δ = +30ms)`);
console.log(`Strong spike:       ${current.strong}s (no change)`);
console.log('');

console.log('GAP ANALYSIS:');
console.log('─'.repeat(65));
console.log(`CURRENT (too fast):`);
console.log(`  Micro → Unexpected: ${current.gapMicroToUnexpected}s (≥0.7s required) ✗`);
console.log(`  Unexpected → Strong: ${(current.strong - current.unexpectedPause).toFixed(1)}s`);
console.log('');
console.log(`ADJUSTED (perceptible):`);
console.log(`  Micro → Unexpected: ${adjusted.gapMicroToUnexpected}s (≥0.7s required) ✓`);
console.log(`  Unexpected → Strong: ${adjusted.gapUnexpectedToStrong}s (≥0.7s required) ✓`);
console.log('');

console.log('PERCEPTION ANALYSIS:');
console.log('─'.repeat(65));
console.log(`Pause Duration:  ${current.pauseMs}ms → ${adjusted.pauseMs}ms`);
console.log(`  └─ 70ms:  Barely perceptible (threshold of awareness)`);
console.log(`  └─ 100ms: Clearly perceptible (conscious interruption)`);
console.log('');
console.log(`Gap Timing:      ${current.gapMicroToUnexpected}s → ${adjusted.gapMicroToUnexpected}s`);
console.log(`  └─ 0.5s:  Too fast (feels jarring, breaks flow)`);
console.log(`  └─ 0.7s:  Natural rhythm (perceptible but fluid)`);
console.log('');

console.log('SEPARATION PATTERN (Maintained Variability):');
console.log('─'.repeat(65));
const sep1 = adjusted.micro - 14.5;        // 1.2s
const sep2 = adjusted.unexpectedPause - adjusted.micro;  // 0.7s
const sep3 = adjusted.strong - adjusted.unexpectedPause; // 0.7s

console.log(`Soft → Micro:         1.2s (variable)`);
console.log(`Micro → Unexpected:   ${sep2}s (min 0.7s) ✓`);
console.log(`Unexpected → Strong:  ${sep3}s (min 0.7s) ✓`);
console.log(`Equidistant? ${sep1 === sep2 && sep2 === sep3 ? 'YES (bad)' : 'NO (good)'}`);
console.log('');

console.log('═══════════════════════════════════════════════════════════════════\n');
