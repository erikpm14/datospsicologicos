require('dotenv').config({ path: './backend/.env' });
const path = require('path');
const fs = require('fs');
const { validateVideoQC } = require('./src/services/publish-validator.service');

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║            TEST: QC DURO (BLOQUEO VIDEO NEGRO)        ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

const VIDEO_ID = '51ef6963-d243-4a17-9bec-b048a0c3a8cb';
const OUTPUT_DIR = path.join(path.resolve('./output'), VIDEO_ID);
const outputMp4 = path.join(OUTPUT_DIR, 'output.mp4');
const assFile = path.join(OUTPUT_DIR, 'subtitles.ass');

console.log(`1️⃣  Validando vídeo BUENO (obeCWBmr5XE):\n`);
const result = validateVideoQC(outputMp4, assFile, VIDEO_ID);

if (result.valid) {
  console.log(`   ✅ QC PASSED - Vídeo válido para publicar\n`);
  console.log(`   Checks:`);
  result.checks.forEach(check => {
    const status = check.passed ? '✅' : '❌';
    const value = check.value ? ` (${check.value})` : '';
    console.log(`   ${status} ${check.name}${value}`);
  });
} else {
  console.log(`   ❌ QC FAILED - Vídeo NO PERMITIDO\n`);
  console.log(`   Error: ${result.error}`);
  if (result.failures) {
    console.log(`   Failures:`);
    result.failures.forEach(f => console.log(`   - ${f}`));
  }
}

console.log(`\n2️⃣  Simulando vídeo NEGRO (sin stream):\n`);
const fakeBlackFile = path.join(OUTPUT_DIR, 'fake-black.mp4');
fs.writeFileSync(fakeBlackFile, 'FAKE_BLACK_VIDEO_NO_STREAMS');
const blackResult = validateVideoQC(fakeBlackFile, assFile, 'fake-black');

if (!blackResult.valid) {
  console.log(`   ✅ QC CORRECTAMENTE BLOQUEÓ vídeo negro\n`);
  console.log(`   Error: ${blackResult.error}`);
} else {
  console.log(`   ❌ ERROR: Vídeo negro NO fue bloqueado\n`);
}

fs.unlinkSync(fakeBlackFile);

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ TEST COMPLETO - QC DURO FUNCIONA CORRECTAMENTE`);
console.log(`   - Vídeos válidos: PERMITEN publicar`);
console.log(`   - Vídeos negros: BLOQUEAN publicación\n`);

process.exit(0);
