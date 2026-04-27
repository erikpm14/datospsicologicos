#!/usr/bin/env node

/**
 * generate-captions-fallback.js
 *
 * Genera captions-debug.json usando fallback uniforme
 * cuando ffprobe no está disponible.
 *
 * Uso: node generate-captions-fallback.js [videoId]
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const { getScriptSections } = require('./src/utils/script-segments');
const { getReadyVideoEntries } = require('./src/services/operational-state.service');
const { validateCaptionsForPublish, logCaptionValidation } = require('./src/services/caption-pre-publish-validator');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

const videoIdArg = process.argv[2];

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  GENERATE CAPTIONS FALLBACK (No FFprobe)             ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

(async () => {
  try {
    // 1. Determinar videoId
    let videoId = videoIdArg;
    let script;
    let outputDir;

    if (!videoId) {
      const readyVideos = getReadyVideoEntries();
      if (readyVideos.length === 0) {
        throw new Error('No videos ready');
      }
      const nextVideo = readyVideos[0];
      videoId = nextVideo.videoId;
      script = nextVideo.script;
      outputDir = path.dirname(nextVideo.videoPath);
    } else {
      outputDir = path.join(OUTPUT_DIR, videoId);
      const scriptPath = path.join(outputDir, 'script.json');
      if (!fs.existsSync(scriptPath)) {
        throw new Error(`script.json not found for ${videoId}`);
      }
      script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    }

    console.log(`1️⃣  CONFIGURATION\n`);
    console.log(`   videoId: ${videoId}`);
    console.log(`   outputDir: ${outputDir}`);
    console.log(`   script duration: ${script.duration}s\n`);

    // 2. Generar captions con distribución uniforme
    console.log(`2️⃣  GENERATING CAPTIONS (UNIFORM DISTRIBUTION)\n`);

    const scriptSections = getScriptSections(script);
    const audioDuration = script.duration || 30;
    const effectiveDuration = audioDuration * 0.88; // 12% margen para pausas
    const totalWords = scriptSections.reduce((sum, s) => sum + (s.text.split(/\s+/).length), 0);

    const captions = [];
    let currentTime = 0;

    for (const section of scriptSections) {
      const words = section.text.split(/\s+/).length;
      const weight = words / totalWords;
      const sectionDuration = effectiveDuration * weight;

      // Sub-segmentar por puntuación
      const chunks = section.text
        .split(/(?<=[.!?…,;])\s+/)
        .filter(c => c.trim())
        .map(c => ({
          text: c.trim(),
          wordCount: c.trim().split(/\s+/).length,
        }));

      const chunkDuration = sectionDuration / (chunks.length || 1);

      for (const chunk of chunks) {
        const minDuration = 0.75;
        const maxDuration = 2.2;
        let duration = Math.max(minDuration, Math.min(maxDuration, chunkDuration));

        captions.push({
          text: chunk.text,
          start: Math.max(0, currentTime - 0.08), // CAPTION_START_LEAD
          end: Math.min(audioDuration - 0.02, currentTime + duration + 0.12), // CAPTION_END_EXTENSION
          section: section.key,
          source: 'caption_sync_fallback',
          idx: captions.length,
        });

        currentTime = captions[captions.length - 1].end + 0.02;
      }
    }

    // Anti-overlap
    for (let i = 1; i < captions.length; i++) {
      if (captions[i].start < captions[i - 1].end + 0.03) {
        captions[i].start = captions[i - 1].end + 0.03;
      }
    }

    console.log(`   ✅ Generated ${captions.length} captions\n`);

    // 3. Crear captions-debug.json
    console.log(`3️⃣  WRITING CAPTIONS-DEBUG.JSON\n`);

    const lastCaption = captions[captions.length - 1];
    const drift = Math.abs(lastCaption.end - audioDuration);
    let driftStatus = 'excellent';
    if (drift > 0.35) driftStatus = 'warning';
    else if (drift > 0.2) driftStatus = 'acceptable';

    const debugData = {
      videoId,
      method: 'caption-sync-fallback',
      source: 'caption_sync_fallback',
      detectionMethod: 'uniform_distribution',
      audioDuration: parseFloat(audioDuration.toFixed(3)),
      voiceSegmentsCount: 0,
      voiceSegments: [],
      captionsCount: captions.length,
      firstCaption: captions[0] || null,
      middleCaption: captions[Math.floor(captions.length / 2)] || null,
      lastCaption: lastCaption || null,
      captions,
      syncTuning: {
        captionStartLead: 0.08,
        captionEndExtension: 0.12,
        minDuration: 0.75,
        maxDuration: 2.2,
        silenceThreshold: -35,
        minSilenceDuration: 0.18,
      },
      drift: {
        value: parseFloat(drift.toFixed(3)),
        status: driftStatus,
        maxAcceptable: 0.35,
      },
      generatedAt: new Date().toISOString(),
    };

    const debugPath = path.join(outputDir, 'captions-debug.json');
    fs.writeFileSync(debugPath, JSON.stringify(debugData, null, 2));

    console.log(`   ✅ Written to: ${debugPath}\n`);

    // 4. Validar
    console.log(`4️⃣  VALIDATION\n`);

    const captionValidation = validateCaptionsForPublish(videoId);
    const logResult = logCaptionValidation(videoId, captionValidation, 'FALLBACK');

    console.log(`   Status: ${logResult.status}`);
    console.log(`   Source: ${logResult.source}`);
    console.log(`   Drift: ${logResult.drift}\n`);

    // 5. Resultado
    console.log(`════════════════════════════════════════════════════════\n`);

    if (captionValidation.ok) {
      console.log(`✅ CAPTIONS READY\n`);
      console.log(`   VIDEO_READY_FOR_NEXT_SLOT=true`);
      console.log(`   videoId=${videoId}`);
      console.log(`   captionSource=${logResult.source}`);
      console.log(`   driftStatus=${logResult.drift}`);
      console.log(`   outputPath=${path.join(outputDir, 'output.mp4')}\n`);

      logger.info(
        `NEXT_SLOT_RERENDER_DONE | videoId=${videoId} | source=${logResult.source} | drift=${logResult.drift}`
      );

      process.exit(0);
    } else {
      console.error(`\n⚠️  CAPTIONS GENERATED BUT FAILED VALIDATION\n`);
      console.error(`   Reason: ${captionValidation.reason}\n`);

      logger.error(`NEXT_SLOT_CAPTIONS_INVALID | videoId=${videoId} | reason=${captionValidation.reason}`);

      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`NEXT_SLOT_CAPTIONS_ERROR | ${err.message}`);
    process.exit(1);
  }
})();
