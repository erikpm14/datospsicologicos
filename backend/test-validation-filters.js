#!/usr/bin/env node

/**
 * test-validation-filters.js
 * Prueba que los filtros de publicación funcionan correctamente
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './.env') });

const fs = require('fs');
const { validatePublishCandidate, logValidationDecision } = require('./src/services/publish-candidate-validator.service');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

console.log('\n' + '═'.repeat(70));
console.log('VALIDATION FILTERS TEST');
console.log('═'.repeat(70) + '\n');

// Test 1: Vídeo válido (3a2d8a39)
console.log('Test 1: Vídeo válido sin captions-debug.json');
const test1 = validatePublishCandidate({ videoId: '3a2d8a39-2c2f-430c-93ac-c1410b48505b' }, true);
console.log(`  Hard Passed: ${test1.hardPassed ? '✅ YES' : '❌ NO'}`);
console.log(`  Warnings: ${test1.warnings.length}`);
console.log(`  Can Publish: ${test1.canPublish ? '✅ YES' : '❌ NO'}`);
console.log(`  Result: ${test1.hardPassed && !test1.warnings.length ? '✅ PASS CLEAN' : test1.hardPassed ? '✅ PASS WITH WARNINGS' : '❌ REJECTED'}\n`);

// Test 2: Vídeo no existente
console.log('Test 2: Vídeo inexistente (output.mp4 no existe)');
const test2 = validatePublishCandidate({ videoId: 'nonexistent-video-12345' }, true);
console.log(`  Hard Passed: ${test2.hardPassed ? '✅ YES' : '❌ NO'}`);
console.log(`  Hard Blocks: ${test2.hardBlocks.length}`);
console.log(`  Can Publish: ${test2.canPublish ? '✅ YES' : '❌ NO'}`);
console.log(`  Result: ${test2.hardPassed ? '❌ ERROR' : '✅ CORRECTLY REJECTED'}\n`);

// Test 3: Vídeo publicado (tiene published.json)
console.log('Test 3: Vídeo ya publicado (published.json existe)');
const test3 = validatePublishCandidate({ videoId: 'render_fix_1777387508834_4d87acdc' }, true);
console.log(`  Hard Passed: ${test3.hardPassed ? '✅ YES' : '❌ NO'}`);
console.log(`  Hard Blocks: ${test3.hardBlocks.length}`);
console.log(`  Result: ${test3.hardPassed ? '❌ ERROR (debería estar publicado)' : '✅ CORRECTLY REJECTED'}\n`);

// Test 4: Vídeo válido con warnings
console.log('Test 4: Vídeo válido con metadata incompleta');
const test4 = validatePublishCandidate({ videoId: '5a81501b-7e11-49f1-980a-1e2c820ccb8d' }, true);
console.log(`  Hard Passed: ${test4.hardPassed ? '✅ YES' : '❌ NO'}`);
console.log(`  Warnings: ${test4.warnings.length}`);
console.log(`  Quality Score: ${test4.quality}%`);
console.log(`  Result: ${test4.hardPassed ? '✅ PASS (metadata no bloqueante)' : '❌ REJECTED'}\n`);

// SUMMARY
console.log('═'.repeat(70));
console.log('SUMMARY\n');

const results = [
  { name: 'Test 1 (Valid video)', expected: true, actual: test1.hardPassed },
  { name: 'Test 2 (Nonexistent)', expected: false, actual: test2.hardPassed },
  { name: 'Test 3 (Already published)', expected: false, actual: test3.hardPassed },
  { name: 'Test 4 (Valid with warnings)', expected: true, actual: test4.hardPassed }
];

let passed = 0;
results.forEach(r => {
  const status = r.expected === r.actual ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} ${r.name}`);
  if (r.expected === r.actual) passed++;
});

console.log(`\n${passed}/${results.length} tests passed`);

if (passed === results.length) {
  console.log('\n✅ ALL VALIDATION FILTERS WORKING CORRECTLY\n');
  console.log('Hard Blocks (real):');
  console.log('  - MP4 no existe');
  console.log('  - MP4 < 1MB');
  console.log('  - ffprobe falla');
  console.log('  - duración < 8s o > 60s');
  console.log('  - no video stream');
  console.log('  - no audio stream');
  console.log('  - ya publicado');
  console.log('\nWarnings (no bloqueantes):');
  console.log('  - captions-debug.json falta');
  console.log('  - subtitles.ass falta');
  console.log('  - render-metadata.json falta');
  console.log('  - queue flags incompletos');
  console.log('\n═'.repeat(70) + '\n');
  process.exit(0);
} else {
  console.log('\n❌ SOME TESTS FAILED\n');
  process.exit(1);
}
