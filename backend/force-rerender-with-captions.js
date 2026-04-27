#!/usr/bin/env node

/**
 * force-rerender-with-captions.js
 *
 * Genera captions-debug.json para un vídeo existente usando caption-sync afinado.
 * No rerenderiza el vídeo, solo genera los captions basados en audio existente.
 *
 * Uso: node force-rerender-with-captions.js [videoId]
 *      Si no se proporciona videoId, usa el próximo vídeo listo.
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const { buildCaptionsFromFinalAudio } = require('./src/utils/caption-sync');
const { getScriptSections } = require('./src/utils/script-segments');
const { getReadyVideoEntries } = require('./src/services/operational-state.service');
const { validateCaptionsForPublish, logCaptionValidation } = require('./src/services/caption-pre-publish-validator');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

const videoIdArg = process.argv[2];

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  FORCE RERENDER WITH CAPTION-SYNC                     ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

(async () => {
  try {
    // 1. Determinar videoId
    let videoId = videoIdArg;
    let script;
    let audioPath;
    let outputDir;

    if (!videoId) {
      // Usar próximo vídeo ready
      const readyVideos = getReadyVideoEntries();
      if (readyVideos.length === 0) {
        throw new Error('No videos ready for rerender');
      }
      const nextVideo = readyVideos[0];
      videoId = nextVideo.videoId;
      script = nextVideo.script;
      audioPath = path.join(nextVideo.videoPath.replace(/output\.mp4$/, 'voice_proc.mp3'));
      outputDir = path.dirname(nextVideo.videoPath);
    } else {
      // Buscar vídeo específico
      outputDir = path.join(OUTPUT_DIR, videoId);
      const scriptPath = path.join(outputDir, 'script.json');
      const audioCandidates = [
        path.join(outputDir, 'voice_proc.mp3'),
        path.join(outputDir, 'voice.wav'),
      ];

      if (!fs.existsSync(scriptPath)) {
        throw new Error(`script.json not found for ${videoId}`);
      }

      script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));

      // Buscar audio
      audioPath = audioCandidates.find(p => fs.existsSync(p));
      if (!audioPath) {
        throw new Error(`No audio found (voice_proc.mp3 or voice.wav) for ${videoId}`);
      }
    }

    console.log(`1️⃣  RERENDER CONFIGURATION\n`);
    console.log(`   videoId: ${videoId}`);
    console.log(`   outputDir: ${outputDir}`);
    console.log(`   audioPath: ${audioPath}`);
    console.log(`   script score: ${script?.viralityScore || 'N/A'}\n`);

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    if (!fs.existsSync(outputDir)) {
      throw new Error(`Output directory not found: ${outputDir}`);
    }

    // 2. Generar captions con caption-sync
    console.log(`2️⃣  GENERATING CAPTIONS WITH CAPTION-SYNC\n`);

    logger.info(`NEXT_SLOT_RERENDER_STARTED | videoId=${videoId} | audioPath=${audioPath}`);

    const captionStart = Date.now();

    const scriptSections = getScriptSections(script);
    const captions = await buildCaptionsFromFinalAudio({
      finalAudioPath: audioPath,
      scriptSegments: scriptSections,
      videoId,
      outputDir,
    });

    const captionDuration = ((Date.now() - captionStart) / 1000).toFixed(1);

    console.log(`   ✅ Captions generados en ${captionDuration}s`);
    console.log(`   Caption count: ${captions.length}`);
    console.log(`   Output MP4: ${path.join(outputDir, 'output.mp4')}\n`);

    // 3. Validar captions del nuevo render
    console.log(`3️⃣  VALIDATING NEW CAPTIONS\n`);

    const captionValidation = validateCaptionsForPublish(videoId);
    const logResult = logCaptionValidation(videoId, captionValidation, 'RERENDER');

    console.log(`   Status: ${logResult.status}`);
    console.log(`   Source: ${logResult.source}`);
    console.log(`   Drift: ${logResult.drift}`);
    console.log(`   Reason: ${logResult.reason}\n`);

    // 4. Resultado final
    console.log(`════════════════════════════════════════════════════════\n`);

    const outputPath = path.join(outputDir, 'output.mp4');

    if (captionValidation.ok) {
      console.log(`✅ CAPTIONS GENERATION SUCCESSFUL\n`);
      console.log(`   VIDEO_READY_FOR_NEXT_SLOT=true`);
      console.log(`   videoId=${videoId}`);
      console.log(`   captionSource=${logResult.source}`);
      console.log(`   driftStatus=${logResult.drift}`);
      console.log(`   outputPath=${outputPath}\n`);

      logger.info(
        `NEXT_SLOT_RERENDER_DONE | videoId=${videoId} | source=${logResult.source} | drift=${logResult.drift}`
      );

      process.exit(0);
    } else {
      console.error(`\n⚠️  CAPTIONS DID NOT MEET REQUIREMENTS\n`);
      console.error(`   Reason: ${captionValidation.reason}\n`);
      console.error(`   Manual review required.\n`);

      logger.error(`NEXT_SLOT_RERENDER_PARTIAL | videoId=${videoId} | reason=${captionValidation.reason}`);

      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`NEXT_SLOT_RERENDER_ERROR | ${err.message}`);
    process.exit(1);
  }
})();
