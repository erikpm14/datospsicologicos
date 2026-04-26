const fs = require('fs');
const path = require('path');

const CORRECTED_SUBTITLES = [
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
  // OPEN_LOOP: 3.4-10.4s
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
  // TRANSITION: 7.0-10.4s
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
  // ESCALATION: 10.4-17.4s (building tension)
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
  {
    text: 'le doy vueltas',
    start: 12.1,
    end: 13.3,
    visual: 'abstract_symbolic_intense',
    spikeType: 'medium',
    zoom: 'in',
    zoomAmount: 1.06,
    pauseBefore: 80,
    pauseAfter: 100,
  },
  {
    text: 'otra vez',
    start: 13.3,
    end: 14.4,
    visual: 'abstract_symbolic_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 120,
    pauseAfter: 150,
  },
  // REENGAGE: 14.4-17.5s (transition to strong spike)
  {
    text: 'y sé que',
    start: 14.4,
    end: 15.2,
    visual: 'human_face_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 0,
  },
  {
    text: 'no es justo',
    start: 15.2,
    end: 16.1,
    visual: 'human_face_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 80,
    pauseAfter: 0,
  },
  {
    text: 'pero si lo digo',
    start: 16.1,
    end: 17.5,
    visual: 'human_face_intense',
    spikeType: 'none',
    zoom: 'none',
    pauseBefore: 0,
    pauseAfter: 100,
  },
  // STRONG SPIKE @ 17.5s (67.3% = VALID)
  {
    text: 'ya no PUEDO',
    start: 17.5,
    end: 18.4,
    visual: 'human_face_intense',
    spikeType: 'strong',
    zoom: 'in',
    zoomAmount: 1.09,
    pauseBefore: 100,
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
console.log('  VALIDACIÓN DE RETENTION SPIKES (ESTRUCTURA CORREGIDA)');
console.log('═══════════════════════════════════════════════════════════════════\n');

// 1. Find strong spike
const strongSpike = CORRECTED_SUBTITLES.find((s) => s.spikeType === 'strong');
if (strongSpike) {
  const percent = (strongSpike.start / DURATION) * 100;
  const valid = strongSpike.start >= DURATION * 0.60 && strongSpike.start <= DURATION * 0.70;
  console.log(`Strong spike timestamp: ${strongSpike.start}s`);
  console.log(`Porcentaje de duración: ${percent.toFixed(1)}%`);
  console.log(`Rango válido: 60-70% (${(DURATION * 0.60).toFixed(2)}s - ${(DURATION * 0.70).toFixed(2)}s)`);
  console.log(`Validación: ${valid ? '✅ PASS' : '❌ FAIL'}\n`);
}

// 2. Check hook
const hookBlocks = CORRECTED_SUBTITLES.filter((s) => s.end <= 3.4);
const hookValid = hookBlocks.every((s) => s.visual === 'human_face_closeup');
console.log(`Hook (0-3.4s): ${hookValid ? '✅ PASS' : '❌ FAIL'} (all human_face_closeup)`);

// 3. Check spikes
const spikes = {
  micro: CORRECTED_SUBTITLES.filter((s) => s.spikeType === 'micro').length,
  soft: CORRECTED_SUBTITLES.filter((s) => s.spikeType === 'soft').length,
  medium: CORRECTED_SUBTITLES.filter((s) => s.spikeType === 'medium').length,
  strong: CORRECTED_SUBTITLES.filter((s) => s.spikeType === 'strong').length,
};
const spikesValid = spikes.micro >= 1 && spikes.soft >= 1 && spikes.medium >= 1 && spikes.strong >= 1;
console.log(`Spikes: ${spikesValid ? '✅ PASS' : '❌ FAIL'} (${spikes.micro}x micro, ${spikes.soft}x soft, ${spikes.medium}x medium, ${spikes.strong}x strong)\n`);

// 4. Check emotional words have face
const emotionalWords = ['no es justo', 'ya no PUEDO', 'evitarlo'];
let emotionalValid = true;
for (const block of CORRECTED_SUBTITLES) {
  for (const word of emotionalWords) {
    if (block.text.toLowerCase().includes(word.toLowerCase()) && !block.visual.includes('human_face')) {
      console.log(`❌ FAIL: "${block.text}" should have human_face visual`);
      emotionalValid = false;
    }
  }
}
if (emotionalValid) console.log(`Emotional words: ✅ PASS (all have human_face)\n`);

// 5. Check max gap
let lastVisualChange = 0;
let maxGap = 0;
let lastVisual = null;
for (const block of CORRECTED_SUBTITLES) {
  if (block.visual !== lastVisual) {
    const gap = block.start - lastVisualChange;
    maxGap = Math.max(maxGap, gap);
    lastVisualChange = block.start;
    lastVisual = block.visual;
  }
}
const gapValid = maxGap <= 6;
console.log(`Max visual gap: ${gapValid ? '✅ PASS' : '❌ FAIL'} (${maxGap.toFixed(2)}s ≤ 6s)\n`);

// 6. Segment distribution
console.log('Distribución de segmentos:');
console.log(`  0-13% (0-3.4s):   HOOK`);
console.log(`  13-40% (3.4-10.4s): OPEN_LOOP`);
console.log(`  40-67% (10.4-17.5s): ESCALATION + REENGAGE PRE-SPIKE`);
console.log(`  60-70% (15.6-18.2s): STRONG SPIKE @ 17.5s ✓`);
console.log(`  67-100% (17.5-26s): STRONG SPIKE + REENGAGE + ENDING\n`);

console.log('═══════════════════════════════════════════════════════════════════\n');

// Export corrected structure
const exportData = {
  duration: DURATION,
  subtitleBlocks: CORRECTED_SUBTITLES,
  validation: {
    strongSpikeTime: strongSpike ? strongSpike.start : null,
    strongSpikePercent: strongSpike ? ((strongSpike.start / DURATION) * 100).toFixed(1) : null,
    hookValid,
    spikesValid,
    emotionalValid,
    gapValid,
    allValid: hookValid && spikesValid && emotionalValid && gapValid && strongSpike && ((strongSpike.start / DURATION) >= 0.60 && (strongSpike.start / DURATION) <= 0.70),
  },
};

const EXPORTS_DIR = './exports/2026-04-25';
const outputFile = path.join(EXPORTS_DIR, 'corrected_subtitles.json');
fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
console.log(`✓ Corrected structure exported to: ${outputFile}\n`);

if (exportData.validation.allValid) {
  console.log('✅ ALL VALIDATIONS PASSED - STRUCTURE IS PRODUCTION-READY\n');
} else {
  console.log('❌ SOME VALIDATIONS FAILED - REVIEW REQUIRED\n');
}
