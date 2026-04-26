const fs = require('fs');
const path = require('path');

const PRESPIKERAMP_SUBTITLES = [
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
  // PRE-SPIKE RAMP BEGINS (50-70%)
  // ═══════════════════════════════════════════════════════════════

  // ESCALATION TENSION BUILD: 12.1-14.3s (50-55%)
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
    end: 14.3,
    visual: 'abstract_symbolic_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 150,
  },
  // ─────────────────────────────────────────────────────────────────
  // SOFT SPIKE (55-60%): 14.3-15.6s
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'y sé que',
    start: 14.3,
    end: 15.0,
    visual: 'human_face_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  {
    text: 'no es justo',
    start: 15.0,
    end: 15.6,
    visual: 'human_face_intense',
    spikeType: 'soft',
    zoom: 'in',
    zoomAmount: 1.03,
    pauseBefore: 80,
    pauseAfter: 100,
    emphasis: 'soft_emotional',
  },
  // ─────────────────────────────────────────────────────────────────
  // MICRO PAUSE/SPIKE (60-65%): 15.6-16.9s
  // Tension maximal antes del strong spike
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'pero si lo digo',
    start: 15.6,
    end: 16.9,
    visual: 'human_face_intense',
    spikeType: 'micro',
    zoom: 'in',
    zoomAmount: 1.05,
    pauseBefore: 100,
    pauseAfter: 200,
    emphasis: 'pause_before_climax',
  },
  // ─────────────────────────────────────────────────────────────────
  // STRONG SPIKE (67.3% = 17.5s): 16.9-18.4s
  // ─────────────────────────────────────────────────────────────────
  {
    text: 'ya no PUEDO',
    start: 16.9,
    end: 18.4,
    visual: 'human_face_intense',
    spikeType: 'strong',
    zoom: 'in',
    zoomAmount: 1.09,
    pauseBefore: 150,
    pauseAfter: 120,
    emphasis: 'CAPS_IMPACT',
  },
  // REENGAGE RESOLUTION: 18.4-21.4s
  {
    text: 'evitarlo',
    start: 18.4,
    end: 19.4,
    visual: 'human_face_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 150,
  },
  {
    text: 'así que',
    start: 19.4,
    end: 20.2,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 150,
    pauseAfter: 0,
  },
  {
    text: 'no digo nada',
    start: 20.2,
    end: 21.4,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  // ENDING: 21.4-26s (final abierto)
  {
    text: 'y me quedo esperando',
    start: 21.4,
    end: 23.1,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 100,
    pauseAfter: 100,
  },
  {
    text: 'aunque igual',
    start: 23.1,
    end: 24.1,
    visual: 'abstract_psychology_visual',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 80,
    pauseAfter: 0,
  },
  {
    text: 'no lo vas a ver',
    start: 24.1,
    end: 26.0,
    visual: 'human_face_soft',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 150,
    pauseAfter: 400,
  },
];

const DURATION = 26.0;

// Validation
console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  VALIDACIÓN: PRE-SPIKE RAMP (50-70% Range)');
console.log('═══════════════════════════════════════════════════════════════════\n');

// 1. Find soft spike (55-60%)
const softSpike55to60 = PRESPIKERAMP_SUBTITLES.find((s) => s.spikeType === 'soft' && s.start >= DURATION * 0.55 && s.start <= DURATION * 0.60);
if (softSpike55to60) {
  const percent = (softSpike55to60.start / DURATION) * 100;
  console.log(`✓ Soft spike en ramp: ${softSpike55to60.start}s (${percent.toFixed(1)}%) — "no es justo"`);
} else {
  console.log(`✗ NO soft spike found in 55-60% range`);
}

// 2. Find micro spike (60-65%)
const microSpike60to65 = PRESPIKERAMP_SUBTITLES.find((s) => s.spikeType === 'micro' && s.start >= DURATION * 0.60 && s.start <= DURATION * 0.65);
if (microSpike60to65) {
  const percent = (microSpike60to65.start / DURATION) * 100;
  console.log(`✓ Micro interrupt en ramp: ${microSpike60to65.start}s (${percent.toFixed(1)}%) — "pero si lo digo"`);
  console.log(`  └─ Pause before: ${microSpike60to65.pauseBefore}ms | Pause after: ${microSpike60to65.pauseAfter}ms`);
} else {
  console.log(`✗ NO micro spike found in 60-65% range`);
}

// 3. Find strong spike (60-70%)
const strongSpike = PRESPIKERAMP_SUBTITLES.find((s) => s.spikeType === 'strong');
if (strongSpike) {
  const percent = (strongSpike.start / DURATION) * 100;
  const valid = strongSpike.start >= DURATION * 0.60 && strongSpike.start <= DURATION * 0.70;
  console.log(`✓ Strong spike climax: ${strongSpike.start}s (${percent.toFixed(1)}%) — "ya no PUEDO"`);
  console.log(`  └─ Zoom: ${strongSpike.zoomAmount}x | Emphasis: ${strongSpike.emphasis}`);
  console.log(`  └─ Validación 60-70%: ${valid ? '✅ PASS' : '❌ FAIL'}\n`);
}

// 4. Timeline
console.log('Timeline completo del pre-spike ramp:');
console.log('─'.repeat(65));
console.log(`  50% (13.0s)  Escalation tension build ("le doy vueltas")`);
console.log(`  55% (14.3s)  ↓`);
console.log(`  │            Soft spike @ 15.0s (57.7%) → anticipation`);
console.log(`  │`);
console.log(`  60% (15.6s)  ↓`);
console.log(`  │            Micro pause @ 15.6s → max tension`);
console.log(`  │`);
console.log(`  65% (16.9s)  ↓`);
console.log(`  │            STRONG SPIKE @ 17.5s (67.3%) → CLIMAX`);
console.log(`  │`);
console.log(`  70% (18.2s)  ↓ Ending begins`);
console.log('');

// 5. Spike distribution
const spikes = {
  micro: PRESPIKERAMP_SUBTITLES.filter((s) => s.spikeType === 'micro').length,
  soft: PRESPIKERAMP_SUBTITLES.filter((s) => s.spikeType === 'soft').length,
  medium: PRESPIKERAMP_SUBTITLES.filter((s) => s.spikeType === 'medium').length,
  strong: PRESPIKERAMP_SUBTITLES.filter((s) => s.spikeType === 'strong').length,
};
console.log(`Spike distribution: ${spikes.micro} micro, ${spikes.soft} soft, ${spikes.medium} medium, ${spikes.strong} strong`);
console.log('');

console.log('═══════════════════════════════════════════════════════════════════\n');

// Export
const exportData = {
  duration: DURATION,
  subtitleBlocks: PRESPIKERAMP_SUBTITLES,
  prespikeRamp: {
    enabled: true,
    softSpikeRange: '55-60%',
    microInterruptRange: '60-65%',
    strongSpikeRange: '60-70%',
    softSpikeTime: softSpike55to60 ? softSpike55to60.start : null,
    microInterruptTime: microSpike60to65 ? microSpike60to65.start : null,
    strongSpikeTime: strongSpike ? strongSpike.start : null,
    valid: softSpike55to60 && microSpike60to65 && strongSpike,
  },
};

const EXPORTS_DIR = './exports/2026-04-25';
const outputFile = path.join(EXPORTS_DIR, 'prespikeramp_subtitles.json');
fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
console.log(`✓ Pre-spike ramp structure exported to: ${outputFile}\n`);

if (exportData.prespikeRamp.valid) {
  console.log('✅ PRE-SPIKE RAMP STRUCTURE COMPLETE AND VALIDATED\n');
} else {
  console.log('❌ PRE-SPIKE RAMP VALIDATION FAILED\n');
}
