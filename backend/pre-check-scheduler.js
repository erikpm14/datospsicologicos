#!/usr/bin/env node

/**
 * pre-check-scheduler.js
 *
 * Ejecuta ANTES del slot (14:20 o 21:05 CET)
 * Lista candidatos y dice cuál publicará el scheduler
 *
 * Uso: node pre-check-scheduler.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

const OUTPUT_DIR = path.resolve('./output');
const QUEUE_DIR = path.resolve('./queue/done');

console.log('\n' + '='.repeat(70));
console.log('[PRE-CHECK] Analizando candidatos para próximo slot...');
console.log('='.repeat(70));

const now = new Date();
console.log(`Hora actual: ${now.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' })} CET`);

// Listar videos ready
if (!fs.existsSync(QUEUE_DIR)) {
  console.log('❌ No queue/done directory found');
  process.exit(0);
}

const doneFiles = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json'));
console.log(`\n📊 Total en queue/done: ${doneFiles.length}\n`);

if (doneFiles.length === 0) {
  console.log('⚠️  Sin vídeos ready - slot sin candidatos');
  process.exit(0);
}

const candidates = [];

for (const file of doneFiles) {
  try {
    const doneFilePath = path.join(QUEUE_DIR, file);
    const doneData = JSON.parse(fs.readFileSync(doneFilePath, 'utf8'));
    const videoId = doneData.videoId || doneData.id;

    // Check output.mp4 existence
    const outputPath = path.join(OUTPUT_DIR, videoId, 'output.mp4');
    const assPath = path.join(OUTPUT_DIR, videoId, 'subtitles.ass');
    const publishedPath = path.join(OUTPUT_DIR, videoId, 'published.json');

    if (!fs.existsSync(outputPath)) {
      console.log(`⏭️  ${videoId.substring(0, 8)} | output.mp4 MISSING`);
      continue;
    }

    // Check if already published
    if (fs.existsSync(publishedPath)) {
      console.log(`⏭️  ${videoId.substring(0, 8)} | ALREADY PUBLISHED`);
      continue;
    }

    const stats = fs.statSync(outputPath);
    const sizeKB = (stats.size / 1024).toFixed(0);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    // Probe duration
    let duration = 0;
    try {
      const probeOutput = execFileSync(
        ffprobePath,
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', outputPath],
        { encoding: 'utf8', windowsHide: true }
      );
      duration = parseFloat(probeOutput.trim());
    } catch (err) {
      console.log(`⏭️  ${videoId.substring(0, 8)} | ffprobe FAILED`);
      continue;
    }

    // Check duration >= 8s
    const isValid = duration >= 8 && stats.size >= 100 * 1024;

    // Try to get metadata
    const metadataPath = path.join(OUTPUT_DIR, videoId, 'metadata.json');
    let virality = 0, qcScore = 0;
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        virality = metadata.viralityScore || 0;
        qcScore = metadata.qcScore || 0;
      } catch {}
    }

    const status = isValid ? '✅' : '⚠️ ';
    const durationMark = duration < 8 ? 'TRUNCATED' : 'OK';

    candidates.push({
      videoId,
      duration,
      sizeKB: parseInt(sizeKB),
      sizeMB: parseFloat(sizeMB),
      virality,
      qcScore,
      isValid,
      durationMark,
    });

    console.log(`${status} ${videoId.substring(0, 8)} | ${duration.toFixed(1)}s (${durationMark}) | ${sizeMB}MB | virality=${virality} QC=${qcScore}`);
  } catch (err) {
    console.error(`Error processing ${file}:`, err.message);
  }
}

console.log('\n' + '='.repeat(70));

// Summary
const validCandidates = candidates.filter(c => c.isValid);
const truncatedCandidates = candidates.filter(c => c.durationMark === 'TRUNCATED');

if (validCandidates.length === 0) {
  console.log('🔴 [SLOT_WILL_BE_SKIPPED] No hay candidatos válidos >=8s');
  console.log(`   Vídeos truncados (basura): ${truncatedCandidates.length}`);
  if (truncatedCandidates.length > 0) {
    console.log('   No publicaremos estos:');
    truncatedCandidates.forEach(c => {
      console.log(`     - ${c.videoId.substring(0, 8)} (${c.duration.toFixed(1)}s)`);
    });
  }
  console.log('\n   ➜ Late publish: ACTIVADO, esperando vídeo válido en las próximas 2h');
} else {
  // Sort by virality desc
  validCandidates.sort((a, b) => b.virality - a.virality);
  const pick = validCandidates[0];
  console.log(`🟢 [SLOT_WILL_BE_FILLED] Candidato elegido:`);
  console.log(`   videoId: ${pick.videoId}`);
  console.log(`   duración: ${pick.duration.toFixed(1)}s`);
  console.log(`   tamaño: ${pick.sizeMB}MB`);
  console.log(`   virality: ${pick.virality}`);
  console.log(`   QC score: ${pick.qcScore}`);
}

console.log('='.repeat(70) + '\n');
