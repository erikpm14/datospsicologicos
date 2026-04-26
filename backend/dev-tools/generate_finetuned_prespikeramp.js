const fs = require('fs');
const path = require('path');

const FINETUNED_SUBTITLES = [
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
  // OPEN_LOOP→ESCALATION TRANSITION: 7.0-10.4s
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
  // ESCALATION: 10.4-13.0s (foundation of ramp)
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
  // PRE-SPIKE RAMP — FINE-TUNED (50-70%)
  // ═══════════════════════════════════════════════════════════════

  // ESCALATION TENSION BUILD: 12.1-14.8s (50-56.9%)
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
  // SOFT SPIKE @ 14.8s (56.9%) — 55-60% range
  // Separation to micro: 1.0s ✓
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'no es',
    start: 14.3,
    end: 14.8,
    visual: 'human_face_intense',
    spikeType: 'soft',
    zoom: 'in',
    zoomAmount: 1.03,
    pauseBefore: 80,
    pauseAfter: 100,
    emphasis: 'soft_anticipation',
  },
  // ─────────────────────────────────────────────────────────────────
  // MICRO SPIKE @ 15.8s (60.8%) — 60-65% range
  // Separation from soft: 1.0s ✓
  // Pause: 120ms (escalated from soft's 100ms)
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'pero si',
    start: 15.0,
    end: 15.8,
    visual: 'human_face_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  {
    text: 'lo digo',
    start: 15.8,
    end: 16.8,
    visual: 'human_face_intense',
    spikeType: 'micro',
    zoom: 'in',
    zoomAmount: 1.05,
    pauseBefore: 100,
    pauseAfter: 120,
    emphasis: 'micro_tension_peak',
  },
  // ─────────────────────────────────────────────────────────────────
  // STRONG SPIKE @ 17.5s (67.3%) — 60-70% range
  // Separation from micro: 1.7s ✓
  // Pause: 180ms (LONGEST — escalated from micro's 120ms)
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'ya no PUEDO',
    start: 16.8,
    end: 17.5,
    visual: 'human_face_intense',
    spikeType: 'strong',
    zoom: 'in',
    zoomAmount: 1.09,
    pauseBefore: 150,
    pauseAfter: 180,
    emphasis: 'CAPS_IMPACT',
  },
  // REENGAGE RESOLUTION: 17.5-21.4s
  {
    text: 'evitarlo',
    start: 17.5,
    end: 18.5,
    visual: 'human_face_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 150,
  },
  {
    text: 'así que',
    start: 18.5,
    end: 19.3,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 150,
    pauseAfter: 0,
  },
  {
    text: 'no digo nada',
    start: 19.3,
    end: 20.5,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  // ENDING: 20.5-26s (final abierto)
  {
    text: 'y me quedo esperando',
    start: 20.5,
    end: 22.2,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 100,
    pauseAfter: 100,
  },
  {
    text: 'aunque igual',
    start: 22.2,
    end: 23.2,
    visual: 'abstract_psychology_visual',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 80,
    pauseAfter: 0,
  },
  {
    text: 'no lo vas a ver',
    start: 23.2,
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
console.log('  FINE-TUNED PRE-SPIKE RAMP VALIDATION');
console.log('═══════════════════════════════════════════════════════════════════\n');

// 1. Find spikes
const softSpike = FINETUNED_SUBTITLES.find((s) => s.spikeType === 'soft' && s.start >= DURATION * 0.55 && s.start <= DURATION * 0.60);
const microSpike = FINETUNED_SUBTITLES.find((s) => s.spikeType === 'micro' && s.start >= DURATION * 0.60 && s.start <= DURATION * 0.65);
const strongSpike = FINETUNED_SUBTITLES.find((s) => s.spikeType === 'strong');

const softPercent = softSpike ? (softSpike.start / DURATION) * 100 : null;
const microPercent = microSpike ? (microSpike.start / DURATION) * 100 : null;
const strongPercent = strongSpike ? (strongSpike.start / DURATION) * 100 : null;

console.log('SPIKE PLACEMENT:');
console.log('─'.repeat(65));
console.log(`Soft:   ${softSpike.start}s (${softPercent.toFixed(1)}%) — Range: 55-60%`);
console.log(`Micro:  ${microSpike.start}s (${microPercent.toFixed(1)}%) — Range: 60-65%`);
console.log(`Strong: ${strongSpike.start}s (${strongPercent.toFixed(1)}%) — Range: 60-70%`);
console.log('');

console.log('SPIKE SEPARATION:');
console.log('─'.repeat(65));
const softToMicro = microSpike.start - softSpike.start;
const microToStrong = strongSpike.start - microSpike.start;
console.log(`Soft → Micro:  ${softToMicro}s (min: 0.8s) ${softToMicro >= 0.8 ? '✓' : '✗'}`);
console.log(`Micro → Strong: ${microToStrong.toFixed(1)}s (min: 0.8s) ${microToStrong >= 0.8 ? '✓' : '✗'}`);
console.log('');

console.log('PAUSE ESCALATION:');
console.log('─'.repeat(65));
console.log(`Soft pause:   ${softSpike.pauseAfter}ms (range: 80-120ms) ${softSpike.pauseAfter >= 80 && softSpike.pauseAfter <= 120 ? '✓' : '✗'}`);
console.log(`Micro pause:  ${microSpike.pauseAfter}ms (range: 100-150ms) ${microSpike.pauseAfter >= 100 && microSpike.pauseAfter <= 150 ? '✓' : '✗'}`);
console.log(`Strong pause: ${strongSpike.pauseAfter}ms (range: 150-250ms) ${strongSpike.pauseAfter >= 150 && strongSpike.pauseAfter <= 250 ? '✓' : '✗'}`);
console.log('');

console.log('PAUSE HIERARCHY (CRITICAL):');
console.log('─'.repeat(65));
const softPauseOK = softSpike.pauseAfter < microSpike.pauseAfter;
const microPauseOK = microSpike.pauseAfter < strongSpike.pauseAfter;
console.log(`Soft (${softSpike.pauseAfter}ms) < Micro (${microSpike.pauseAfter}ms) ${softPauseOK ? '✓' : '✗'}`);
console.log(`Micro (${microSpike.pauseAfter}ms) < Strong (${strongSpike.pauseAfter}ms) ${microPauseOK ? '✓' : '✗'}`);
console.log('');

console.log('═══════════════════════════════════════════════════════════════════');

const allValid =
  softToMicro >= 0.8 &&
  microToStrong >= 0.8 &&
  softSpike.pauseAfter >= 80 &&
  softSpike.pauseAfter <= 120 &&
  microSpike.pauseAfter >= 100 &&
  microSpike.pauseAfter <= 150 &&
  strongSpike.pauseAfter >= 150 &&
  strongSpike.pauseAfter <= 250 &&
  softPauseOK &&
  microPauseOK;

if (allValid) {
  console.log('  ✅ ALL FINE-TUNING VALIDATIONS PASSED');
} else {
  console.log('  ❌ SOME VALIDATIONS FAILED');
}
console.log('═══════════════════════════════════════════════════════════════════\n');

// Export
const exportData = {
  duration: DURATION,
  subtitleBlocks: FINETUNED_SUBTITLES,
  prespikeRamp: {
    version: 'v3_finetuned',
    enabled: true,
    softSpike: {
      time: softSpike.start,
      percent: softPercent.toFixed(1),
      range: '55-60%',
      pause: softSpike.pauseAfter,
    },
    microSpike: {
      time: microSpike.start,
      percent: microPercent.toFixed(1),
      range: '60-65%',
      pause: microSpike.pauseAfter,
    },
    strongSpike: {
      time: strongSpike.start,
      percent: strongPercent.toFixed(1),
      range: '60-70%',
      pause: strongSpike.pauseAfter,
    },
    separation: {
      softToMicro: softToMicro,
      microToStrong: microToStrong,
      valid: softToMicro >= 0.8 && microToStrong >= 0.8,
    },
    pauseHierarchy: {
      soft: softSpike.pauseAfter,
      micro: microSpike.pauseAfter,
      strong: strongSpike.pauseAfter,
      escalated: softPauseOK && microPauseOK,
    },
    allValid,
  },
};

const EXPORTS_DIR = './exports/2026-04-25';
const outputFile = path.join(EXPORTS_DIR, 'finetuned_prespikeramp.json');
fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
console.log(`✓ Fine-tuned structure exported: ${outputFile}\n`);
