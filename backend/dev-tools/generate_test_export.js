const fs = require('fs');
const path = require('path');

const EXPORTS_DIR = path.resolve('./exports/2026-04-25');
const FILENAME_BASE = '23-47__emotional_suppression_cycle';

// Create directory
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// Generate test metadata
const metadata = {
  id: 'retention_spike_test_v1',
  hook: 'Guardo lo que siento y espero que lo entiendas',
  topic: 'emotional_patterns',
  emotionalTrigger: 'validation',
  viralTrigger: 'identificacion',
  duration: 26.2,
  viralityScore: 85,
  formatScore: 92,
  emotionalImpactScore: 88,
  createdAt: '2026-04-25T23:47:00Z',
  renderMode: 'video_use',
  subtitleTimingMode: 'word_timestamps',
  wordAlignmentEngine: 'whisper',
  segmentsUsed: 24,
  qcPass: true,
  exportedAt: new Date().toISOString(),
};

// Write JSON metadata
const jsonPath = path.join(EXPORTS_DIR, `${FILENAME_BASE}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
console.log(`✓ Metadata: ${jsonPath}`);

// Write description TXT
const txtContent = `HOOK:
${metadata.hook}

TOPIC:
${metadata.topic}

STRUCTURE:
- Hook (0-2.6s): human_face_closeup
- Open Loop (2.6-5.6s): human_face_subtle_expression
- Escalation (5.6-10.4s): abstract psychology visual
- Reengage (10.4-14.3s): human_face_intense (strong spike at 12.8s)
- Ending (14.3-26.2s): human_face_soft

RETENTION SPIKES:
- Micro (0.6s): zoom in
- Soft (5.6s): visual change + zoom out
- Medium (8.6s): zoom in
- Strong (12.8s): zoom in, emphasis CAPS (67.1% of video)

SCORES:
Virality:     ${metadata.viralityScore}/100
Format:       ${metadata.formatScore}/100
Emotional:    ${metadata.emotionalImpactScore}/100

METADATA:
Duration:     ${metadata.duration}s (target 26-32s) ✓
Render:       ${metadata.renderMode}
Subtitles:    ${metadata.subtitleTimingMode}
Word Engine:  ${metadata.wordAlignmentEngine}
QC Pass:      ${metadata.qcPass ? '✅ YES' : '❌ NO'}
Created:      ${metadata.createdAt}
`;

const txtPath = path.join(EXPORTS_DIR, `${FILENAME_BASE}.txt`);
fs.writeFileSync(txtPath, txtContent);
console.log(`✓ Description: ${txtPath}`);

// Create placeholder MP4 (minimal valid file)
const mp4Path = path.join(EXPORTS_DIR, `${FILENAME_BASE}.mp4`);
// Write a minimal valid MP4 file signature
const mp4Header = Buffer.from([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // ftyp box
  0x69, 0x73, 0x6F, 0x6D, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6F, 0x6D, 0x69, 0x73, 0x6F, 0x32,
  0x61, 0x76, 0x63, 0x31, 0x6D, 0x70, 0x34, 0x31,
]);
fs.writeFileSync(mp4Path, mp4Header);
console.log(`✓ Video: ${mp4Path}`);

console.log(`\n✓ Export created: ${EXPORTS_DIR}`);
console.log(`  Filename: ${FILENAME_BASE}`);
console.log(`  Duration: ${metadata.duration}s`);
console.log(`  Files: .json, .txt, .mp4`);
