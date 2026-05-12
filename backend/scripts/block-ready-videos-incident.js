#!/usr/bin/env node
/**
 * block-ready-videos-incident.js
 * Bloquea todos los vídeos READY actuales con needsRevalidation=true
 * después del incidente de 2026-05-12 (doble publicación).
 *
 * TAREA 2: Implementar bloqueo de READY videos
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, '../output-fase1-test');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

function readJSON(filePath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${filePath}: ${err.message}`);
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${filePath}: ${err.message}`);
    throw err;
  }
}

function isReadyVideo(videoId) {
  const dir = path.join(OUTPUT_DIR, videoId);
  const videoPath = path.join(dir, 'output.mp4');
  const scriptPath = path.join(dir, 'script.json');
  const publishedPath = path.join(dir, 'published.json');
  const discardedPath = path.join(dir, 'discarded.json');

  const hasVideo = fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0;
  const hasScript = fs.existsSync(scriptPath);
  const notPublished = !fs.existsSync(publishedPath);
  const notDiscarded = !fs.existsSync(discardedPath);

  return hasVideo && hasScript && notPublished && notDiscarded;
}

function blockVideoForRevalidation(videoId, reason) {
  const dir = path.join(OUTPUT_DIR, videoId);
  const revalidationPath = path.join(dir, 'revalidation-status.json');

  const status = {
    needsRevalidation: true,
    blockedAt: new Date().toISOString(),
    blockReason: reason,
    blockedAfterIncident: true,
    requiredChecks: ['CHECK_20', 'CHECK_21', 'CHECK_22'],
    incident: {
      date: '2026-05-12',
      reason: 'Double publication incident (hWL72kiFkdM, -4j9AxR1veI)',
      rootCause: 'Script parsing bug + missing slot-level idempotency',
    },
  };

  writeJSON(revalidationPath, status);
  return revalidationPath;
}

function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.error(`OUTPUT_DIR not found: ${OUTPUT_DIR}`);
    process.exit(1);
  }

  const dirs = fs.readdirSync(OUTPUT_DIR)
    .filter(name => {
      const stat = fs.statSync(path.join(OUTPUT_DIR, name));
      return stat.isDirectory();
    });

  const readyVideos = dirs.filter(videoId => isReadyVideo(videoId));

  if (readyVideos.length === 0) {
    console.log('✓ No READY videos found to block.');
    process.exit(0);
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ TASK 2 — BLOCKING READY VIDEOS FOR INCIDENT REVALIDATION ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);

  console.log(`Found ${readyVideos.length} READY videos to block:\n`);

  let blockedCount = 0;
  const blockedList = [];

  readyVideos.forEach((videoId, index) => {
    try {
      const revalidationPath = blockVideoForRevalidation(
        videoId,
        'BLOCKED_AFTER_BAD_UPLOAD_INCIDENT_REQUIRES_CHECKS_20_21_22_23'
      );
      blockedCount++;
      blockedList.push(videoId);
      console.log(`  ${index + 1}. ✓ ${videoId}`);
      console.log(`     → ${path.relative(OUTPUT_DIR, revalidationPath)}`);
    } catch (err) {
      console.error(`  ${index + 1}. ✗ ${videoId}: ${err.message}`);
    }
  });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`SUMMARY: ${blockedCount}/${readyVideos.length} blocked successfully\n`);

  if (blockedCount === readyVideos.length) {
    console.log(`✓ All READY videos blocked with needsRevalidation=true`);
    console.log(`✓ Scheduler will skip these videos automatically`);
    console.log(`✓ They must pass CHECK_20/21/22 before republishing\n`);

    // Guardar reporte
    const report = {
      timestamp: new Date().toISOString(),
      action: 'BLOCK_READY_VIDEOS_POST_INCIDENT',
      blockedCount,
      videoIds: blockedList,
      reason: 'Double publication incident (2026-05-12)',
      status: 'SUCCESS',
    };

    const reportPath = path.join(DATA_DIR, 'incident-blocking-report.json');
    writeJSON(reportPath, report);
    console.log(`Report saved: ${reportPath}\n`);

    process.exit(0);
  } else {
    console.error(`\n✗ Failed to block some videos. Manual intervention needed.\n`);
    process.exit(1);
  }
}

main();
