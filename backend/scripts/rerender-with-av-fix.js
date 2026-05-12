#!/usr/bin/env node

/**
 * rerender-with-av-fix.js
 *
 * Re-renderiza vídeos con duración de audio correcta para fijar AV sync.
 * Regenera clipTimeline basado en duración real de audio y re-renderiza el vídeo.
 *
 * Uso:
 *   node scripts/rerender-with-av-fix.js <videoId>
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const logger = require('../src/utils/logger');
const { renderVideoWithRouter } = require('../src/services/render-engines');
const { generateBackgroundTimeline } = require('../src/services/background-diversity.service');

const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffprobePath = ffprobeInstaller.path;
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');

async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath
    ];

    const proc = spawn(ffprobePath, args);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && output.trim()) {
        resolve(parseFloat(output.trim()));
      } else {
        reject(new Error(`Failed to get audio duration`));
      }
    });

    proc.on('error', reject);
  });
}

async function rerenderVideo(videoId) {
  const videoDir = path.join(OUTPUT_DIR, videoId);
  const metadataPath = path.join(videoDir, 'generation-metadata.json');
  const audioPath = path.join(videoDir, 'temp-audio-extract.aac');
  const outputPath = path.join(videoDir, 'output.mp4');

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Metadata not found: ${metadataPath}`);
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio not found: ${audioPath}`);
  }

  console.log(`\n[${'='.repeat(70)}]`);
  console.log(`RERENDER WITH AV FIX: ${videoId}`);
  console.log(`[${'='.repeat(70)}]\n`);

  // Obtener duración de audio real
  console.log(`[STEP_1] Getting audio duration...`);
  const audioDuration = await getAudioDuration(audioPath);
  console.log(`✓ Audio duration: ${audioDuration.toFixed(2)}s`);

  // Cargar metadata
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  // Regenerar clipTimeline con duración correcta
  console.log(`[STEP_2] Regenerating clip timeline with duration ${audioDuration.toFixed(2)}s...`);
  const newBackgroundTimeline = generateBackgroundTimeline(videoId, audioDuration);

  if (!newBackgroundTimeline || !newBackgroundTimeline.plan) {
    throw new Error('Failed to generate new background timeline');
  }

  console.log(`✓ New clip timeline: ${newBackgroundTimeline.plan.clipTimeline.length} clips`);
  console.log(`  Total duration: ${newBackgroundTimeline.plan.clipTimeline[newBackgroundTimeline.plan.clipTimeline.length - 1].end.toFixed(2)}s`);

  // Actualizar metadata con nuevo clipTimeline
  metadata.backgroundPlan.clipTimeline = newBackgroundTimeline.plan.clipTimeline;
  metadata.backgroundPlan.numClips = newBackgroundTimeline.plan.numClips;
  metadata.audioFixAppliedAt = new Date().toISOString();
  metadata.audioFixAudioDuration = audioDuration;

  // Guardar metadata actualizada
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`✓ Updated metadata with new clip timeline`);

  // Re-renderizar con nuevo clipTimeline
  console.log(`[STEP_3] Re-rendering video...`);
  try {
    const renderResult = await renderVideoWithRouter({
      audioPath,
      outputPath,
      audioDuration,
      outputDir: videoDir,
    });

    if (!renderResult.success) {
      throw new Error(`Render failed: ${JSON.stringify(renderResult)}`);
    }

    console.log(`✓ Video rendered successfully`);
    console.log(`  Mode: ${renderResult.renderMode}`);

    // Verificar archivo de salida
    if (!fs.existsSync(outputPath)) {
      throw new Error('Output MP4 not created');
    }

    const stats = fs.statSync(outputPath);
    const sizeInMB = stats.size / (1024 * 1024);
    console.log(`✓ Output file: ${sizeInMB.toFixed(1)}MB`);

    console.log(`\n[${'='.repeat(70)}]`);
    console.log(`✓ RERENDER COMPLETE`);
    console.log(`[${'='.repeat(70)}]\n`);

    return {
      success: true,
      videoId,
      audioDuration,
      outputSize: stats.size,
      clipsGenerated: newBackgroundTimeline.plan.clipTimeline.length,
    };
  } catch (err) {
    console.error(`✗ Render failed: ${err.message}`);
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node scripts/rerender-with-av-fix.js <videoId>');
    process.exit(1);
  }

  const videoId = args[0];

  try {
    const result = await rerenderVideo(videoId);
    console.log(`SUCCESS: ${result.videoId} re-rendered with AV fix`);
    process.exit(0);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  }
}

main();
