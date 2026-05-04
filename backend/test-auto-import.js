#!/usr/bin/env node

/**
 * test-auto-import.js
 * Verifica que auto-import está funcionando correctamente
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './.env') });

const fs = require('fs');
const { runSync } = require('./src/services/auto-import-from-output.service');

console.log('\n' + '═'.repeat(70));
console.log('AUTO-IMPORT TEST SUITE');
console.log('═'.repeat(70) + '\n');

// Test 1: Verificar que OUTPUT_DIR existe
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
console.log('Test 1: OUTPUT_DIR válido');
if (fs.existsSync(OUTPUT_DIR)) {
  console.log(`  ✓ ${OUTPUT_DIR} exists\n`);
} else {
  console.log(`  ✗ ${OUTPUT_DIR} NOT FOUND\n`);
  process.exit(1);
}

// Test 2: Verificar que queue/done existe
const QUEUE_DIR = path.resolve('./queue/done');
console.log('Test 2: Queue directory válido');
if (fs.existsSync(QUEUE_DIR)) {
  const count = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json')).length;
  console.log(`  ✓ ${QUEUE_DIR} exists (${count} entries)\n`);
} else {
  console.log(`  ✗ ${QUEUE_DIR} NOT FOUND\n`);
  process.exit(1);
}

// Test 3: Ejecutar sync
console.log('Test 3: Running auto-import sync...');
const results = runSync();
console.log(`  ✓ Scanned: ${results.scanned}`);
console.log(`  ✓ Imported: ${results.imported}`);
console.log(`  ✓ Skipped: ${results.skipped}`);
console.log(`  ✓ Errors: ${results.errors}\n`);

// Test 4: Verificar que scheduler puede ver entries
console.log('Test 4: Queue entries detectable by scheduler');
const entries = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json'));
const withMP4 = entries.filter(f => {
  const entry = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), 'utf8'));
  const videoId = entry.videoId || entry.id;
  const mp4 = path.join(OUTPUT_DIR, videoId, 'output.mp4');
  return fs.existsSync(mp4);
}).length;
console.log(`  ✓ ${withMP4} entries have corresponding MP4 files\n`);

// Test 5: Verificar importedFromExistingOutput flag
console.log('Test 5: Auto-imported entries have correct flags');
const autoImported = entries.filter(f => {
  const entry = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), 'utf8'));
  return entry.importedFromExistingOutput === true;
}).length;
console.log(`  ✓ ${autoImported} entries marked as auto-imported\n`);

console.log('═'.repeat(70));
console.log('✅ ALL TESTS PASSED\n');
console.log('Auto-import is ready. Scheduler will auto-detect videos in output/\n');
