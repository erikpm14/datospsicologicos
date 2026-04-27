#!/usr/bin/env node

/**
 * verify-next-slot.js
 *
 * Verifica que el próximo vídeo a publicar cumpla con requisitos de captions.
 * Si no cumple, lo marca para rerender inmediato.
 *
 * Uso: node verify-next-slot.js
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const { getReadyVideoEntries } = require('./src/services/operational-state.service');
const { validateCaptionsForPublish, logCaptionValidation } = require('./src/services/caption-pre-publish-validator');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  NEXT SLOT CAPTION VERIFICATION                       ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

(async () => {
  try {
    // 1. Obtener próximo vídeo
    const readyVideos = getReadyVideoEntries();
    if (readyVideos.length === 0) {
      console.error(`\n❌ NO VIDEOS READY FOR NEXT SLOT\n`);
      logger.error('NEXT_SLOT_CAPTION_CHECK_FAILED | reason=no_ready_videos');
      process.exit(1);
    }

    const nextVideo = readyVideos[0]; // Primer vídeo (prioritario)
    const videoId = nextVideo.videoId;

    console.log(`1️⃣  NEXT VIDEO FOR SLOT\n`);
    console.log(`   videoId: ${videoId}`);
    console.log(`   videoPath: ${nextVideo.videoPath}`);
    console.log(`   script score: ${nextVideo.script?.viralityScore || 'N/A'}\n`);

    // 2. Verificar captions
    console.log(`2️⃣  CAPTION VALIDATION\n`);

    // Permitir fallback en emergencia para el próximo slot
    const allowEmergency = process.env.ALLOW_FALLBACK_FOR_NEXT_SLOT === 'true';
    const captionValidation = validateCaptionsForPublish(videoId, null, {
      allowFallbackForEmergency: allowEmergency,
    });
    const logResult = logCaptionValidation(videoId, captionValidation, 'CHECK');

    console.log(`   Status: ${logResult.status}`);
    console.log(`   Source: ${logResult.source}`);
    console.log(`   Drift: ${logResult.drift}`);
    console.log(`   Reason: ${logResult.reason}\n`);

    if (captionValidation.debugData) {
      const { captionsCount, drift, audioDuration } = captionValidation.debugData;
      console.log(`   Details:`);
      console.log(`   - Caption count: ${captionsCount}`);
      console.log(`   - Audio duration: ${audioDuration?.toFixed(3)}s`);
      console.log(`   - Drift value: ${drift?.value?.toFixed(3)}s`);
      console.log(`   - Last caption end: ${captionValidation.debugData.lastCaption?.end?.toFixed(3)}s\n`);
    }

    // 3. Resultado
    console.log(`════════════════════════════════════════════════════════\n`);

    if (captionValidation.ok) {
      console.log(`✅ VIDEO READY FOR NEXT SLOT\n`);
      console.log(`   VIDEO_READY_FOR_NEXT_SLOT=true`);
      console.log(`   videoId=${videoId}`);
      console.log(`   captionSource=${logResult.source}`);
      console.log(`   driftStatus=${logResult.drift}`);
      console.log(`   outputPath=${nextVideo.videoPath}\n`);

      logger.info(
        `NEXT_SLOT_CAPTION_CHECK_PASS | videoId=${videoId} | source=${logResult.source} | drift=${logResult.drift}`
      );

      process.exit(0);
    } else {
      console.error(`\n❌ VIDEO BLOCKED FOR NEXT SLOT\n`);
      console.error(`   Reason: ${captionValidation.reason}\n`);

      logger.error(
        `NEXT_SLOT_CAPTION_CHECK_BLOCKED | videoId=${videoId} | reason=${captionValidation.reason}`
      );

      console.log(`⚠️  This video requires:
   - Full rerender with caption-sync
   - OR replacement with a different video
   - OR manual caption-debug.json generation\n`);

      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`NEXT_SLOT_CAPTION_CHECK_ERROR | ${err.message}`);
    process.exit(1);
  }
})();
