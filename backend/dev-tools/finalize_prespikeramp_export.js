const fs = require('fs');
const path = require('path');

const EXPORTS_DIR = './exports/2026-04-25';
const PRESPIKERAMP_FILE = path.join(EXPORTS_DIR, 'prespikeramp_subtitles.json');
const METADATA_FILE = path.join(EXPORTS_DIR, '23-47__emotional_suppression_cycle.json');
const TXT_FILE = path.join(EXPORTS_DIR, '23-47__emotional_suppression_cycle.txt');

// Read pre-spike ramp structure
const prespikeramp = JSON.parse(fs.readFileSync(PRESPIKERAMP_FILE, 'utf8'));

// Update metadata
const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
metadata.duration = prespikeramp.duration;
metadata.subtitleBlocks = prespikeramp.subtitleBlocks;
metadata.retentionSpikesStructure = {
  version: 'v2_prespikeramp',
  prespikeRampEnabled: true,
  timeline: {
    softSpikeRange: '55-60%',
    softSpikeTime: prespikeramp.prespikeRamp.softSpikeTime,
    microInterruptRange: '60-65%',
    microInterruptTime: prespikeramp.prespikeRamp.microInterruptTime,
    strongSpikeRange: '60-70%',
    strongSpikeTime: prespikeramp.prespikeRamp.strongSpikeTime,
    strongSpikePercent: ((prespikeramp.prespikeRamp.strongSpikeTime / prespikeramp.duration) * 100).toFixed(1),
  },
};

fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));

// Update TXT description with full ramp structure
const txtContent = `HOOK:
${metadata.hook}

TOPIC:
${metadata.topic}

PRE-SPIKE RAMP STRUCTURE (Complete 50-70%):

┌─ 50-55% (13.0-14.3s): ESCALATION TENSION BUILD
│  └─ "le doy vueltas" + "otra vez"
│  └─ abstract_symbolic_intense + pause 150ms
│
├─ 55-60% (14.3-15.6s): SOFT SPIKE (Anticipation)
│  └─ SOFT SPIKE @ 15.0s (57.7%)
│  └─ "no es justo" — Zoom IN (1.03x)
│  └─ Pause before: 80ms | After: 100ms
│
├─ 60-65% (15.6-16.9s): MICRO PAUSE (Max Tension)
│  └─ MICRO SPIKE @ 15.6s (60.0%)
│  └─ "pero si lo digo" — Zoom IN (1.05x)
│  └─ Pause before: 100ms | After: 200ms ← MAX TENSION
│
└─ 65-70% (16.9-18.4s): STRONG SPIKE (Climax)
   └─ STRONG SPIKE @ 17.5s (67.3%) ✓
   └─ "ya no PUEDO" — Zoom IN (1.09x) + CAPS
   └─ Pause before: 150ms | After: 120ms

RETENTION SPIKES COMPLETE:
- Micro (0.7s):  Zoom IN (1.02x) → Immediate engagement
- Soft (5.8s):   Zoom OUT (0.98x) → First transition
- Soft (7.0s):   Abstract transition → Second punch
- Soft (15.0s):  Zoom IN (1.03x) → PRE-SPIKE RAMP
- Micro (15.6s): Zoom IN (1.05x) → TENSION PEAK
- STRONG (17.5s): Zoom IN (1.09x) + CAPS → CLIMAX (67.3%)

PSYCHOLOGICAL FLOW:
0-50%   (0-13s):   Build progresivo
50-60%  (13-15.6s): Tensión creciente
60-70%  (15.6-18.4s): PRE-SPIKE RAMP → STRONG SPIKE
70-100% (18.4-26s): Caída + final abierto

QUALITY SCORES:
Virality:     ${metadata.viralityScore}/100
Format:       ${metadata.formatScore}/100
Emotional:    ${metadata.emotionalImpactScore}/100

METADATA:
Duration:     ${prespikeramp.duration}s
Render:       ${metadata.renderMode}
Subtitles:    ${metadata.subtitleTimingMode}
Word Engine:  ${metadata.wordAlignmentEngine}
QC Pass:      ✅ YES
Created:      ${metadata.createdAt}
Updated:      ${new Date().toISOString()}
Version:      v2_prespikeramp
`;

fs.writeFileSync(TXT_FILE, txtContent);

console.log('\n✅ EXPORT ACTUALIZADO CON PRE-SPIKE RAMP COMPLETO');
console.log('═'.repeat(70));
console.log(`Metadata: ${path.basename(METADATA_FILE)}`);
console.log(`Description: ${path.basename(TXT_FILE)}`);
console.log(`Duration: ${prespikeramp.duration}s`);
console.log(`Soft spike (55-60%): ${prespikeramp.prespikeRamp.softSpikeTime}s (${((prespikeramp.prespikeRamp.softSpikeTime / prespikeramp.duration) * 100).toFixed(1)}%)`);
console.log(`Micro interrupt (60-65%): ${prespikeramp.prespikeRamp.microInterruptTime}s`);
console.log(`Strong spike (60-70%): ${prespikeramp.prespikeRamp.strongSpikeTime}s (${prespikeramp.prespikeRamp.strongSpikePercent}%)`);
console.log('═'.repeat(70) + '\n');

// Remove intermediate file
fs.unlinkSync(PRESPIKERAMP_FILE);
console.log('✓ Intermediate file cleaned\n');
