#!/usr/bin/env node
/**
 * clean-generated.js
 * Elimina ÚNICAMENTE artefactos generados de vídeo/audio/render.
 * Preserva TODO el aprendizaje del sistema: data/*.json, patterns, experiments, etc.
 *
 * Uso: node scripts/clean-generated.js [--dry-run] [--keep-stock]
 *   --dry-run    : muestra qué se borraría sin borrar nada
 *   --keep-stock : no borra los clips de stock descargados de Pexels
 */

const fs   = require('fs');
const path = require('path');

const ROOT         = path.resolve(__dirname, '..');
const DRY_RUN      = process.argv.includes('--dry-run');
const KEEP_STOCK   = process.argv.includes('--keep-stock');

const OUTPUT_DIR   = path.join(ROOT, 'backend', 'output');
const STOCK_DIR    = path.join(ROOT, 'backend', 'assets', 'stock-footage');
const KOKORO_TMP   = path.join(ROOT, 'backend', 'assets', 'kokoro');
const QUEUE_DONE   = path.join(ROOT, 'backend', 'queue', 'done');
const QUEUE_FAILED = path.join(ROOT, 'backend', 'queue', 'failed');

// DATA: NEVER TOUCH THESE
const PROTECTED_DATA_DIR = path.join(ROOT, 'backend', 'data');

let totalFiles = 0;
let totalBytes = 0;

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function rmFile(p) {
  const size = sizeOf(p);
  if (DRY_RUN) {
    console.log(`  [dry] would delete: ${path.relative(ROOT, p)} (${(size / 1024).toFixed(0)} KB)`);
  } else {
    fs.unlinkSync(p);
  }
  totalFiles++;
  totalBytes += size;
}

function rmDir(p) {
  if (!fs.existsSync(p)) return;
  const size = sizeOf(p);
  if (DRY_RUN) {
    console.log(`  [dry] would rmdir:  ${path.relative(ROOT, p)}`);
  } else {
    fs.rmSync(p, { recursive: true, force: true });
  }
  totalFiles++;
  totalBytes += size;
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(50 - title.length)}`);
}

// ── Guardia de seguridad ──────────────────────────────────────────────────────
if (!fs.existsSync(PROTECTED_DATA_DIR)) {
  console.error('ERROR: backend/data no existe. Aborting.');
  process.exit(1);
}

console.log(DRY_RUN ? '🔍 DRY RUN — no se borra nada' : '🧹 Limpiando artefactos generados...');

// ── 1. Output de vídeos renderizados ─────────────────────────────────────────
section('backend/output (vídeos renderizados)');
if (fs.existsSync(OUTPUT_DIR)) {
  const entries = fs.readdirSync(OUTPUT_DIR);
  let count = 0;
  for (const d of entries) {
    const full = path.join(OUTPUT_DIR, d);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      rmDir(full); count++;
    } else if (/\.(mp4|wav|mp3|webm)$/.test(d)) {
      rmFile(full); count++;
    }
  }
  console.log(`  → ${count} artefactos de output`);
} else {
  console.log('  (ya vacío)');
}

// ── 2. Stock footage descargado ───────────────────────────────────────────────
if (!KEEP_STOCK) {
  section('backend/assets/stock-footage (clips Pexels)');
  if (fs.existsSync(STOCK_DIR)) {
    const clips = fs.readdirSync(STOCK_DIR).filter(f => /^pexels_.*\.mp4$/.test(f));
    for (const f of clips) {
      rmFile(path.join(STOCK_DIR, f));
    }
    console.log(`  → ${clips.length} clips de Pexels`);
  } else {
    console.log('  (directorio no existe)');
  }
} else {
  console.log('\n── stock-footage (--keep-stock, omitido)');
}

// ── 3. Archivos temporales de Kokoro ─────────────────────────────────────────
section('backend/assets/kokoro (WAVs temporales)');
if (fs.existsSync(KOKORO_TMP)) {
  const wavs = fs.readdirSync(KOKORO_TMP).filter(f => /\.(wav|mp3)$/.test(f));
  for (const f of wavs) {
    rmFile(path.join(KOKORO_TMP, f));
  }
  console.log(`  → ${wavs.length} archivos de audio temporales`);
} else {
  console.log('  (directorio no existe)');
}

// ── 4. Queue done/failed ──────────────────────────────────────────────────────
section('backend/queue/done (jobs procesados)');
if (fs.existsSync(QUEUE_DONE)) {
  const jobs = fs.readdirSync(QUEUE_DONE);
  for (const f of jobs) {
    rmFile(path.join(QUEUE_DONE, f));
  }
  console.log(`  → ${jobs.length} job files procesados`);
} else {
  console.log('  (directorio no existe)');
}

section('backend/queue/failed (jobs fallidos)');
if (fs.existsSync(QUEUE_FAILED)) {
  const jobs = fs.readdirSync(QUEUE_FAILED);
  for (const f of jobs) {
    rmFile(path.join(QUEUE_FAILED, f));
  }
  console.log(`  → ${jobs.length} job files fallidos`);
} else {
  console.log('  (directorio no existe)');
}

// ── Resumen ───────────────────────────────────────────────────────────────────
const mb = (totalBytes / 1024 / 1024).toFixed(1);
console.log(`\n${'═'.repeat(55)}`);
if (DRY_RUN) {
  console.log(`✅ DRY RUN completado — se borrarían ${totalFiles} items (${mb} MB)`);
  console.log('   Ejecuta sin --dry-run para borrar realmente.');
} else {
  console.log(`✅ Limpieza completada — ${totalFiles} items eliminados (${mb} MB liberados)`);
  console.log('   El sistema mantiene toda su inteligencia acumulada.');
  console.log('   backend/data/*.json — intacto ✓');
}
