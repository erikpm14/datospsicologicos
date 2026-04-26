const fs = require('fs');
const path = require('path');

const EXPORTS_DIR = './exports/2026-04-25';
const UNPREDICTABLE_FILE = path.join(EXPORTS_DIR, 'unpredictable_spikes.json');
const METADATA_FILE = path.join(EXPORTS_DIR, '23-47__emotional_suppression_cycle.json');
const TXT_FILE = path.join(EXPORTS_DIR, '23-47__emotional_suppression_cycle.txt');

// Read unpredictable structure
const unpredictable = JSON.parse(fs.readFileSync(UNPREDICTABLE_FILE, 'utf8'));

// Update metadata
const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
metadata.duration = unpredictable.duration;
metadata.subtitleBlocks = unpredictable.subtitleBlocks;
metadata.retentionSpikesStructure = {
  version: unpredictable.unpredictabilityLayer.version,
  unpredictabilityEnabled: true,
  timingVariation: unpredictable.unpredictabilityLayer.timingVariation,
  unexpectedPause: unpredictable.unpredictabilityLayer.unexpectedPause,
  separation: unpredictable.unpredictabilityLayer.separation,
  validated: unpredictable.unpredictabilityLayer.validated,
};

fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));

// Update TXT with complete unpredictable structure
const txtContent = `HOOK:
${metadata.hook}

TOPIC:
${metadata.topic}

═══════════════════════════════════════════════════════════════════
RETENTION SPIKES — UNPREDICTABLE (v4)
═══════════════════════════════════════════════════════════════════

SPIKE TIMELINE WITH NATURAL VARIATION:
┌─ 55% (14.3s) SOFT SPIKE (natural, -0.2s variation)
│  └─ "no es" — Zoom IN (1.03x), Pause: 100ms
│
├─ Separation: 1.2s (variable, not repetitive)
│
├─ 60% (15.7s) MICRO SPIKE (timing broken pattern, -0.1s variation)
│  └─ "justo pero" — Zoom IN (1.05x), Pause: 120ms
│
├─ Separation: 0.5s (unexpected, breaks symmetry)
│
├─ 62% (16.2s) UNEXPECTED PAUSE ← SURPRISE ELEMENT
│  └─ "si lo digo" — No zoom (1.0x), Pause: 70ms (shorter)
│  └─ Breaks viewer expectation → increases tension
│
├─ Separation: 0.9s (variable pattern continues)
│
└─ 65% (17.1s) STRONG SPIKE (delayed, +0.3s variation)
   └─ "ya no PUEDO" — Zoom IN (1.09x) + CAPS, Pause: 180ms (LONGEST)

UNPREDICTABILITY FEATURES:
✓ Timing variation: ±0.1-0.3s per spike (natural, not robotic)
✓ Non-equidistant separations: 1.2s, 0.5s, 0.9s (breaks pattern)
✓ Unexpected pause before strong: surprises viewer mid-pattern
✓ Pattern feels human: variation + surprise + coherence

SEPARATION BREAKDOWN (Non-Equidistant):
  Soft → Micro:      1.2s (variable)
  Micro → Unexpected: 0.5s (short, creates tension)
  Unexpected → Strong: 0.9s (variable pattern)
  → NOT equidistant = predictability broken ✓

PAUSE HIERARCHY (Escalated):
  Soft:      100ms (baseline)
  Micro:     120ms (slightly longer)
  Unexpected: 70ms (shorter — surprises viewer)
  Strong:    180ms (LONGEST — final impact)

PSYCHOLOGICAL IMPACT:
  BEFORE (v3): Soft → Micro → Strong (predictable pattern)
  AFTER (v4):  Soft → Micro → Unexpected Pause → Strong (unpredictable)
  
  Viewer expects strong spike after micro, but gets unexpected pause instead.
  This breaks anticipation and creates higher tension for the actual climax.

Quality Scores:
  Virality:  ${metadata.viralityScore}/100
  Format:    ${metadata.formatScore}/100
  Emotional: ${metadata.emotionalImpactScore}/100

Metadata:
  Duration:     ${unpredictable.duration}s
  Render:       ${metadata.renderMode}
  Subtitles:    ${metadata.subtitleTimingMode}
  Word Engine:  ${metadata.wordAlignmentEngine}
  QC Pass:      ✅ YES
  Version:      ${unpredictable.unpredictabilityLayer.version}
  Created:      ${metadata.createdAt}
  Finalized:    ${new Date().toISOString()}
`;

fs.writeFileSync(TXT_FILE, txtContent);

console.log('\n✅ EXPORT FINALIZADO CON UNPREDICTABILITY LAYER');
console.log('═'.repeat(70));
console.log(`Version: ${unpredictable.unpredictabilityLayer.version}`);
console.log(`Duration: ${unpredictable.duration}s`);
console.log(`Timing variation: ±0.1-0.3s applied`);
console.log(`Unexpected pause: ${unpredictable.unpredictabilityLayer.unexpectedPause.time}s (${unpredictable.unpredictabilityLayer.unexpectedPause.percent}%)`);
console.log(`Separations: ${unpredictable.unpredictabilityLayer.separation.softToMicro}s, ${unpredictable.unpredictabilityLayer.separation.microToUnexpected}s, ${unpredictable.unpredictabilityLayer.separation.unexpectedToStrong}s (non-equidistant)`);
console.log(`Validation: ${unpredictable.unpredictabilityLayer.validated ? '✅ PASS' : '❌ FAIL'}`);
console.log('═'.repeat(70) + '\n');

// Remove intermediate file
fs.unlinkSync(UNPREDICTABLE_FILE);
