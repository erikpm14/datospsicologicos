#!/usr/bin/env node
/**
 * reset-outputs.js
 * RESET CONTROLADO — elimina todos los outputs generados.
 * Preserva inteligencia acumulada (backend/data/).
 *
 * Qué borra:
 *   backend/output/*           → vídeos renderizados (cualquier versión)
 *   backend/assets/kokoro/     → WAVs/MPs3 temporales de TTS
 *   backend/assets/stock-footage/pexels_*.mp4  → clips Pexels
 *   backend/queue/done/*       → jobs completados
 *   backend/queue/failed/*     → jobs fallidos
 *   backend/queue/pending/*    → jobs pendientes (cola antigua)
 *
 * NO TOCA:
 *   backend/data/*.json        → inteligencia del sistema
 *
 * Uso:
 *   node scripts/reset-outputs.js [--dry-run]
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const DRY_RUN  = process.argv.includes('--dry-run');

const OUTPUT_DIR   = path.join(ROOT, 'backend', 'output');
const KOKORO_DIR   = path.join(ROOT, 'backend', 'assets', 'kokoro');
const STOCK_DIR    = path.join(ROOT, 'backend', 'assets', 'stock-footage');
const QUEUE_DONE   = path.join(ROOT, 'backend', 'queue', 'done');
const QUEUE_FAILED = path.join(ROOT, 'backend', 'queue', 'failed');
const QUEUE_PEND   = path.join(ROOT, 'backend', 'queue', 'pending');
const DATA_DIR     = path.join(ROOT, 'backend', 'data');

// Guardia de seguridad
if (!fs.existsSync(DATA_DIR)) {
  console.error('ABORT: backend/data no existe. Abortando reset.');
  process.exit(1);
}

let totalItems = 0;
let totalBytes = 0;

function rmDir(p) {
  if (!fs.existsSync(p)) return;
  try {
    const stat = fs.statSync(p);
    if (!stat.isDirectory()) return;
    // contar tamaño
    try {
      const files = fs.readdirSync(p);
      for (const f of files) {
        try { totalBytes += fs.statSync(path.join(p, f)).size; } catch {}
      }
    } catch {}
    if (DRY_RUN) {
      console.log(`  [dry] rm -rf ${path.relative(ROOT, p)}`);
    } else {
      fs.rmSync(p, { recursive: true, force: true });
    }
    totalItems++;
  } catch (e) {
    console.error(`  WARN: no pude borrar ${p}: ${e.message}`);
  }
}

function rmFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter(f => !pattern || pattern.test(f));
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        totalBytes += stat.size;
        if (DRY_RUN) {
          console.log(`  [dry] rm ${path.relative(ROOT, full)}`);
        } else {
          fs.unlinkSync(full);
        }
        totalItems++;
      }
    } catch {}
  }
  return files.length;
}

function section(title) {
  console.log(`\n── ${title}`);
}

console.log(DRY_RUN ? '🔍 DRY RUN — no se borra nada' : '🔄 RESET DE OUTPUTS — iniciando...');

// 1. Output de vídeos renderizados (todos, sin excepción)
section('backend/output — todos los vídeos renderizados');
if (fs.existsSync(OUTPUT_DIR)) {
  const entries = fs.readdirSync(OUTPUT_DIR);
  for (const entry of entries) {
    const full = path.join(OUTPUT_DIR, entry);
    try {
      if (fs.statSync(full).isDirectory()) {
        rmDir(full);
      } else if (/\.(mp4|wav|mp3)$/.test(entry)) {
        totalBytes += fs.statSync(full).size;
        if (!DRY_RUN) fs.unlinkSync(full);
        totalItems++;
      }
    } catch {}
  }
  console.log(`  → ${totalItems} vídeos eliminados`);
} else {
  console.log('  (directorio no existe)');
}

// 2. Kokoro TTS temporales
section('backend/assets/kokoro — audios TTS temporales');
const kokoroBefore = totalItems;
rmFiles(KOKORO_DIR, /\.(wav|mp3)$/);
console.log(`  → ${totalItems - kokoroBefore} archivos de audio`);

// 3. Clips Pexels
section('backend/assets/stock-footage — clips Pexels');
const stockBefore = totalItems;
rmFiles(STOCK_DIR, /^pexels_.*\.mp4$/);
console.log(`  → ${totalItems - stockBefore} clips Pexels`);

// 4. Cola: done / failed / pending
section('backend/queue — done / failed / pending');
const queueBefore = totalItems;
rmFiles(QUEUE_DONE,   /\.json$/);
rmFiles(QUEUE_FAILED, /\.json$/);
rmFiles(QUEUE_PEND,   /\.json$/);
console.log(`  → ${totalItems - queueBefore} job files`);

// Resumen
const mb = (totalBytes / 1024 / 1024).toFixed(1);
console.log(`\n${'═'.repeat(50)}`);
if (DRY_RUN) {
  console.log(`✅ DRY RUN: se borrarían ${totalItems} items (${mb} MB)`);
  console.log('   Ejecuta sin --dry-run para borrar realmente.');
} else {
  console.log(`✅ RESET COMPLETADO: ${totalItems} items eliminados, ${mb} MB liberados`);
  console.log('   La inteligencia del sistema está intacta:');
  console.log('   backend/data/*.json — NO tocado ✓');
}
