#!/usr/bin/env node

/**
 * regenerate-subtitles.js
 *
 * Regenera subtitles.vtt desde captions-debug.json para vídeos que lo perdieron.
 *
 * Uso:
 *   node scripts/regenerate-subtitles.js <videoId>
 *   node scripts/regenerate-subtitles.js --all
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');

function timeToVTT(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(6, '0')}`;
}

function regenerateSubtitles(videoId) {
  const videoDir = path.join(OUTPUT_DIR, videoId);
  const captionsPath = path.join(videoDir, 'captions-debug.json');
  const subtitlesPath = path.join(videoDir, 'subtitles.vtt');

  if (!fs.existsSync(captionsPath)) {
    return {
      videoId,
      success: false,
      error: `captions-debug.json not found at ${captionsPath}`
    };
  }

  try {
    const captionsData = JSON.parse(fs.readFileSync(captionsPath, 'utf8'));

    if (!captionsData.captions || !Array.isArray(captionsData.captions)) {
      return {
        videoId,
        success: false,
        error: 'captions-debug.json has no captions array'
      };
    }

    // Generar VTT
    let vttContent = 'WEBVTT\n\n';

    captionsData.captions.forEach(cap => {
      const startTime = timeToVTT(cap.start);
      const endTime = timeToVTT(cap.end);
      vttContent += `${startTime} --> ${endTime}\n`;
      vttContent += `${cap.text}\n\n`;
    });

    // Escribir archivo
    fs.writeFileSync(subtitlesPath, vttContent, 'utf8');

    return {
      videoId,
      success: true,
      captionsCount: captionsData.captions.length,
      subtitlesPath
    };
  } catch (err) {
    return {
      videoId,
      success: false,
      error: err.message
    };
  }
}

function getAllVideoIds() {
  const ids = [];
  try {
    const entries = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const captionsPath = path.join(OUTPUT_DIR, entry.name, 'captions-debug.json');
        if (fs.existsSync(captionsPath)) {
          ids.push(entry.name);
        }
      }
    }
  } catch (err) {
    console.error(`Failed to list videos: ${err.message}`);
  }
  return ids;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node scripts/regenerate-subtitles.js <videoId>');
    console.log('  node scripts/regenerate-subtitles.js --all');
    process.exit(1);
  }

  const [cmd] = args;
  let videoIds = [];

  if (cmd === '--all') {
    videoIds = getAllVideoIds();
  } else {
    videoIds = [cmd];
  }

  console.log(`\n[${'='.repeat(70)}]`);
  console.log(`REGENERATE SUBTITLES`);
  console.log(`[${'='.repeat(70)}]\n`);

  let successCount = 0;
  let failCount = 0;

  for (const videoId of videoIds) {
    const result = regenerateSubtitles(videoId);
    if (result.success) {
      console.log(`✓ ${result.videoId} (${result.captionsCount} captions)`);
      successCount++;
    } else {
      console.log(`✗ ${result.videoId}: ${result.error}`);
      failCount++;
    }
  }

  console.log(`\n[${'='.repeat(70)}]`);
  console.log(`SUCCESS: ${successCount} | FAILED: ${failCount}`);
  console.log(`[${'='.repeat(70)}]\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
