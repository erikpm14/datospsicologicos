#!/usr/bin/env node

/**
 * audit-av-sync.js
 *
 * Script para auditar sincronización audio/vídeo de vídeos generados.
 *
 * Uso:
 *   node scripts/audit-av-sync.js <videoId>
 *   node scripts/audit-av-sync.js --all-ready
 *   node scripts/audit-av-sync.js --all
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const logger = require('../src/utils/logger');

const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffprobePath = ffprobeInstaller.path;
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');

// Criterio de validación
const MAX_AV_DRIFT_SECONDS = 0.35;

function getVideoStreamDuration(mp4Path) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1:noprint_filename=1',
      mp4Path
    ];

    const proc = spawn(ffprobePath, args);

    proc.stdout.on('data', (data) => {
      const match = data.toString().trim();
      if (match) {
        resolve(parseFloat(match));
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr}`));
      } else {
        resolve(0);
      }
    });

    proc.on('error', reject);
  });
}

function getAudioStreamDuration(mp4Path) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const args = [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1:noprint_filename=1',
      mp4Path
    ];

    const proc = spawn(ffprobePath, args);

    proc.stdout.on('data', (data) => {
      const match = data.toString().trim();
      if (match) {
        resolve(parseFloat(match));
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr}`));
      } else {
        resolve(0);
      }
    });

    proc.on('error', reject);
  });
}

async function auditVideoAvSync(videoId) {
  const videoDir = path.join(OUTPUT_DIR, videoId);
  const mp4Path = path.join(videoDir, 'output.mp4');

  if (!fs.existsSync(mp4Path)) {
    return {
      videoId,
      status: 'MISSING_MP4',
      error: `output.mp4 not found at ${mp4Path}`,
      pass: false,
    };
  }

  try {
    const videoDuration = await getVideoStreamDuration(mp4Path);
    const audioDuration = await getAudioStreamDuration(mp4Path);

    const gap = Math.abs(videoDuration - audioDuration);
    const pass = gap <= MAX_AV_DRIFT_SECONDS && videoDuration > 0 && audioDuration > 0;

    return {
      videoId,
      status: pass ? 'PASS' : 'FAIL',
      containerDuration: videoDuration,
      videoDuration,
      audioDuration,
      gap,
      maxAllowedDrift: MAX_AV_DRIFT_SECONDS,
      pass,
      error: pass ? null : `Gap ${gap.toFixed(2)}s exceeds max ${MAX_AV_DRIFT_SECONDS}s`,
    };
  } catch (err) {
    return {
      videoId,
      status: 'ERROR',
      error: err.message,
      pass: false,
    };
  }
}

function getAllVideoIds() {
  const ids = [];
  try {
    const entries = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const mp4Path = path.join(OUTPUT_DIR, entry.name, 'output.mp4');
        if (fs.existsSync(mp4Path)) {
          ids.push(entry.name);
        }
      }
    }
  } catch (err) {
    logger.error(`Failed to list videos: ${err.message}`);
  }
  return ids;
}

function getReadyVideoIds() {
  // Buscar vídeos con validateReadyVideo PASS
  // Por ahora, asumir todos los que tienen output.mp4
  return getAllVideoIds();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node scripts/audit-av-sync.js <videoId>');
    console.log('  node scripts/audit-av-sync.js --all-ready');
    console.log('  node scripts/audit-av-sync.js --all');
    process.exit(1);
  }

  const [cmd] = args;
  let videoIds = [];

  if (cmd === '--all-ready') {
    videoIds = getReadyVideoIds();
  } else if (cmd === '--all') {
    videoIds = getAllVideoIds();
  } else {
    videoIds = [cmd];
  }

  console.log(`\n[${'='.repeat(70)}]`);
  console.log(`AUDIO/VIDEO SYNC AUDIT`);
  console.log(`[${'='.repeat(70)}]\n`);

  const results = [];
  for (const videoId of videoIds) {
    const result = await auditVideoAvSync(videoId);
    results.push(result);
  }

  // Mostrar resultados en tabla
  console.log('RESULTS:');
  console.log('-'.repeat(70));

  let passCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.pass) {
      passCount++;
      console.log(`✓ ${result.videoId}`);
      console.log(`  Video: ${result.videoDuration.toFixed(2)}s | Audio: ${result.audioDuration.toFixed(2)}s | Gap: ${result.gap.toFixed(2)}s`);
    } else {
      failCount++;
      console.log(`✗ ${result.videoId}`);
      if (result.status === 'MISSING_MP4') {
        console.log(`  ${result.error}`);
      } else if (result.status === 'ERROR') {
        console.log(`  ERROR: ${result.error}`);
      } else {
        console.log(`  Video: ${result.videoDuration.toFixed(2)}s | Audio: ${result.audioDuration.toFixed(2)}s | Gap: ${result.gap.toFixed(2)}s (max: ${result.maxAllowedDrift}s)`);
      }
    }
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`TOTAL: ${results.length} videos`);
  console.log(`PASS: ${passCount} | FAIL: ${failCount}`);

  if (failCount > 0) {
    console.log(`\n⚠️  ${failCount} videos have AV synchronization issues!`);
    console.log(`These videos should be regenerated before publication.`);
    process.exit(1);
  } else {
    console.log(`\n✓ All videos passed AV sync validation!`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`FATAL ERROR: ${err.message}`);
  process.exit(1);
});
