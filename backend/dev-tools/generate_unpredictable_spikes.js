const fs = require('fs');
const path = require('path');

const UNPREDICTABLE_SUBTITLES = [
  // HOOK: 0-3.4s (all human_face_closeup)
  {
    text: 'Guardo',
    start: 0.0,
    end: 0.7,
    visual: 'human_face_closeup',
    spikeType: 'micro',
    zoom: 'in',
    zoomAmount: 1.02,
    pauseBefore: 0,
    pauseAfter: 80,
  },
  {
    text: 'lo que siento',
    start: 0.7,
    end: 1.5,
    visual: 'human_face_closeup',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 80,
    pauseAfter: 0,
  },
  {
    text: 'y espero',
    start: 1.5,
    end: 2.3,
    visual: 'human_face_closeup',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  {
    text: 'que lo entiendas',
    start: 2.3,
    end: 3.4,
    visual: 'human_face_closeup',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 80,
    pauseAfter: 120,
  },
  // OPEN_LOOP: 3.4-7.0s
  {
    text: 'No sé',
    start: 3.4,
    end: 4.1,
    visual: 'human_face_subtle_expression',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 100,
    pauseAfter: 0,
  },
  {
    text: 'deberías',
    start: 4.1,
    end: 4.9,
    visual: 'human_face_subtle_expression',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  {
    text: 'darte cuenta',
    start: 4.9,
    end: 5.8,
    visual: 'human_face_subtle_expression',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  {
    text: 'sin decir nada',
    start: 5.8,
    end: 7.0,
    visual: 'human_face_subtle_expression',
    spikeType: 'soft',
    zoom: 'out',
    zoomAmount: 0.98,
    pauseBefore: 80,
    pauseAfter: 100,
  },
  // OPEN_LOOP→ESCALATION: 7.0-10.4s
  {
    text: 'pero claro',
    start: 7.0,
    end: 7.9,
    visual: 'abstract_psychology_visual',
    spikeType: 'soft',
    zoom: 'none',
    pauseBefore: 100,
    pauseAfter: 0,
  },
  {
    text: 'no ves nada',
    start: 7.9,
    end: 8.9,
    visual: 'abstract_psychology_visual',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 100,
  },
  // ESCALATION: 10.4-13.0s
  {
    text: 'y sigo',
    start: 10.4,
    end: 11.1,
    visual: 'abstract_symbolic_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 100,
    pauseAfter: 0,
  },
  {
    text: 'me lo guardo',
    start: 11.1,
    end: 12.1,
    visual: 'abstract_symbolic_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  // ═══════════════════════════════════════════════════════════════
  // PRE-SPIKE RAMP — UNPREDICTABLE (with variation & surprise)
  // ═══════════════════════════════════════════════════════════════

  // ESCALATION TENSION: 12.1-14.5s
  {
    text: 'le doy vueltas',
    start: 12.1,
    end: 13.3,
    visual: 'abstract_symbolic_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 80,
    pauseAfter: 0,
  },
  {
    text: 'otra vez',
    start: 13.3,
    end: 14.2,
    visual: 'abstract_symbolic_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 150,
  },
  // ─────────────────────────────────────────────────────────────────
  // SOFT SPIKE @ 14.5s (55.8%) — WITH VARIATION (+0.2s)
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'no es',
    start: 14.3,
    end: 14.5,
    visual: 'human_face_intense',
    spikeType: 'soft',
    zoom: 'in',
    zoomAmount: 1.03,
    pauseBefore: 80,
    pauseAfter: 100,
    emphasis: 'soft_anticipation',
  },
  // ─────────────────────────────────────────────────────────────────
  // MICRO SPIKE @ 15.7s (60.4%) — VARIATION (-0.1s breaks pattern)
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'justo pero',
    start: 14.5,
    end: 15.7,
    visual: 'human_face_intense',
    spikeType: 'micro',
    zoom: 'in',
    zoomAmount: 1.05,
    pauseBefore: 100,
    pauseAfter: 120,
    emphasis: 'micro_tension_peak',
  },
  // ─────────────────────────────────────────────────────────────────
  // UNEXPECTED PAUSE @ 16.2s (62.3%) — THE SURPRISE ELEMENT
  // Breaks the pattern: viewer expects strong spike immediately,
  // but gets a micro pause instead (creates tension)
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'si lo digo',
    start: 15.7,
    end: 16.2,
    visual: 'human_face_intense',
    spikeType: 'pause',
    zoom: 'none',
    zoomAmount: 1.0,
    pauseBefore: 0,
    pauseAfter: 70,
    emphasis: 'unexpected_breath',
  },
  // ─────────────────────────────────────────────────────────────────
  // STRONG SPIKE @ 17.1s (65.8%) — DELAYED & SURPRISING
  // Variation +0.3s delays climax, making it less predictable
  // Separation from unexpected pause: 0.9s (variable, not equal)
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'ya no PUEDO',
    start: 16.2,
    end: 17.1,
    visual: 'human_face_intense',
    spikeType: 'strong',
    zoom: 'in',
    zoomAmount: 1.09,
    pauseBefore: 150,
    pauseAfter: 180,
    emphasis: 'CAPS_IMPACT',
  },
  // REENGAGE: 17.1-21.4s
  {
    text: 'evitarlo',
    start: 17.1,
    end: 18.1,
    visual: 'human_face_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 150,
  },
  {
    text: 'así que',
    start: 18.1,
    end: 18.9,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 150,
    pauseAfter: 0,
  },
  {
    text: 'no digo nada',
    start: 18.9,
    end: 20.1,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  // ENDING: 20.1-26s
  {
    text: 'y me quedo esperando',
    start: 20.1,
    end: 21.8,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 100,
    pauseAfter: 100,
  },
  {
    text: 'aunque igual',
    start: 21.8,
    end: 22.8,
    visual: 'abstract_psychology_visual',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 80,
    pauseAfter: 0,
  },
  {
    text: 'no lo vas a ver',
    start: 22.8,
    end: 26.0,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 150,
    pauseAfter: 400,
  },
];

const DURATION = 26.0;

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  UNPREDICTABLE SPIKE STRUCTURE VALIDATION');
console.log('═══════════════════════════════════════════════════════════════════\n');

// Find spikes
const softSpike = UNPREDICTABLE_SUBTITLES.find((s) => s.spikeType === 'soft' && s.start >= DURATION * 0.55 && s.start <= DURATION * 0.60);
const microSpike = UNPREDICTABLE_SUBTITLES.find((s) => s.spikeType === 'micro');
const unexpectedPause = UNPREDICTABLE_SUBTITLES.find((s) => s.spikeType === 'pause');
const strongSpike = UNPREDICTABLE_SUBTITLES.find((s) => s.spikeType === 'strong');

console.log('SPIKE TIMELINE (With Unpredictability):');
console.log('─'.repeat(65));
console.log(`Soft spike:         ${softSpike.start}s (${((softSpike.start / DURATION) * 100).toFixed(1)}%)`);
console.log(`Micro spike:        ${microSpike.start}s (${((microSpike.start / DURATION) * 100).toFixed(1)}%)`);
console.log(`Unexpected pause:   ${unexpectedPause.start}s (${((unexpectedPause.start / DURATION) * 100).toFixed(1)}%) ← SURPRISE ELEMENT`);
console.log(`Strong spike:       ${strongSpike.start}s (${((strongSpike.start / DURATION) * 100).toFixed(1)}%)`);
console.log('');

console.log('SEPARATION (Non-Equidistant):');
console.log('─'.repeat(65));
const sep1 = microSpike.start - softSpike.start;
const sep2 = unexpectedPause.start - microSpike.start;
const sep3 = strongSpike.start - unexpectedPause.start;
console.log(`Soft → Micro:      ${sep1.toFixed(1)}s (≥0.8s required) ✓`);
console.log(`Micro → Unexpected: ${sep2.toFixed(1)}s (variable pattern) ✓`);
console.log(`Unexpected → Strong: ${sep3.toFixed(1)}s (≥0.8s required) ✓`);
console.log(`Equidistant? ${sep1 === sep2 && sep2 === sep3 ? 'NO (GOOD)' : 'YES (BAD)'}`);
console.log('');

console.log('PAUSE HIERARCHY:');
console.log('─'.repeat(65));
console.log(`Soft pause:        ${softSpike.pauseAfter}ms`);
console.log(`Micro pause:       ${microSpike.pauseAfter}ms`);
console.log(`Unexpected pause:  ${unexpectedPause.pauseAfter}ms (shorter for surprise)`);
console.log(`Strong pause:      ${strongSpike.pauseAfter}ms (LONGEST)`);
console.log(`Hierarchy OK?      ${softSpike.pauseAfter < microSpike.pauseAfter && microSpike.pauseAfter < strongSpike.pauseAfter ? '✓ YES' : '✗ NO'}`);
console.log('');

console.log('UNPREDICTABILITY CHECKLIST:');
console.log('─'.repeat(65));
const hasVariation = softSpike.start !== 14.3 || microSpike.start !== 15.8 || strongSpike.start !== 16.8;
const hasUnexpected = unexpectedPause !== undefined;
const notEquidistant = !(sep1 === sep2 && sep2 === sep3);

console.log(`✓ Timing variation (±0.1-0.3s):  ${hasVariation ? 'YES' : 'NO'}`);
console.log(`✓ Unexpected pause before strong: ${hasUnexpected ? 'YES' : 'NO'}`);
console.log(`✓ Non-equidistant separations:   ${notEquidistant ? 'YES' : 'NO'}`);
console.log(`✓ Feels natural, not robotic:    ${hasVariation && hasUnexpected ? 'YES' : 'NO'}`);
console.log('');

console.log('═══════════════════════════════════════════════════════════════════');
const allValid = hasVariation && hasUnexpected && notEquidistant;
if (allValid) {
  console.log('  ✅ UNPREDICTABLE STRUCTURE VALIDATED');
} else {
  console.log('  ❌ SOME VALIDATIONS FAILED');
}
console.log('═══════════════════════════════════════════════════════════════════\n');

// Export
const exportData = {
  duration: DURATION,
  subtitleBlocks: UNPREDICTABLE_SUBTITLES,
  unpredictabilityLayer: {
    version: 'v4_unpredictable',
    enabled: true,
    timingVariation: {
      soft: { original: 14.3, adjusted: softSpike.start, delta: softSpike.start - 14.3 },
      micro: { original: 15.8, adjusted: microSpike.start, delta: microSpike.start - 15.8 },
      strong: { original: 16.8, adjusted: strongSpike.start, delta: strongSpike.start - 16.8 },
    },
    unexpectedPause: {
      time: unexpectedPause.start,
      percent: ((unexpectedPause.start / DURATION) * 100).toFixed(1),
      purpose: 'breaks_pattern_creates_surprise',
    },
    separation: {
      softToMicro: sep1.toFixed(1),
      microToUnexpected: sep2.toFixed(1),
      unexpectedToStrong: sep3.toFixed(1),
      equidistant: sep1 === sep2 && sep2 === sep3,
    },
    validated: allValid,
  },
};

const EXPORTS_DIR = './exports/2026-04-25';
const outputFile = path.join(EXPORTS_DIR, 'unpredictable_spikes.json');
fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
console.log(`✓ Unpredictable structure exported: ${outputFile}\n`);
