/**
 * TEST AISLADO: Caption-Sync Validation
 *
 * Objetivo: Validar que la corrección de drift funciona correctamente
 * antes de permitir publicación.
 *
 * Pasos:
 * 1. Tomar vídeo existente con voice_proc.mp3
 * 2. Forzar render con CAPTION_SYNC (sin Whisper)
 * 3. Generar output_test_caption_sync.mp4
 * 4. Validar captions-debug.json
 * 5. Reporte: CAPTION_SYNC_VALIDATED=true/false
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const { renderVideoWithRouter } = require('./src/services/video-renderer');
const logger = require('./src/utils/logger');

const TEST_VIDEO_ID = '51ef6963-d243-4a17-9bec-b048a0c3a8cb';
const OUTPUT_DIR = path.resolve(`./output/${TEST_VIDEO_ID}`);
const AUDIO_PATH = path.join(OUTPUT_DIR, 'voice_proc.mp3');
const SCRIPT_PATH = path.join(OUTPUT_DIR, 'script.json');
const DEBUG_JSON_PATH = path.join(OUTPUT_DIR, 'captions-debug.json');
const METADATA_PATH = path.join(OUTPUT_DIR, 'render-metadata.json');

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║        TEST: CAPTION-SYNC VALIDATION                  ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

// Validación preliminar
console.log(`1️⃣  VALIDACIÓN PRELIMINAR\n`);

if (!fs.existsSync(SCRIPT_PATH)) {
  console.error(`❌ script.json no encontrado: ${SCRIPT_PATH}`);
  process.exit(1);
}

if (!fs.existsSync(AUDIO_PATH)) {
  console.error(`❌ voice_proc.mp3 no encontrado: ${AUDIO_PATH}`);
  process.exit(1);
}

console.log(`✅ script.json existe`);
console.log(`✅ voice_proc.mp3 existe\n`);

// Cargar script
const script = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf8'));
console.log(`2️⃣  RENDERIZANDO CON CAPTION-SYNC\n`);
console.log(`   VideoID: ${TEST_VIDEO_ID}`);
console.log(`   Script duration: ${script.duration}s`);
console.log(`   Virality: ${script.viralityScore}`);
console.log(`   Humanity: ${script.humanityScore}\n`);

// Ejecutar render — FORZAR CAPTION-SYNC deshabilitando Whisper
(async () => {
  try {
    // Override Whisper para forzar caption-sync
    process.env.WHISPER_WORD_TIMESTAMPS_ENABLED = 'false';

    const renderStart = Date.now();

    const result = await renderVideoWithRouter({
      audioPath: AUDIO_PATH,
      script,
      outputDir: OUTPUT_DIR,
      videoId: TEST_VIDEO_ID,
      renderMode: 'video_use',
      skipPexels: true, // evitar descargas
    });

    const renderDuration = (Date.now() - renderStart) / 1000;

    console.log(`\n✅ Render completado en ${renderDuration.toFixed(1)}s`);
    console.log(`   Output MP4: ${result.outputPath}`);
    console.log(`   File size: ${(fs.statSync(result.outputPath).size / 1024 / 1024).toFixed(2)}MB\n`);

    // Leer captions-debug.json
    console.log(`3️⃣  VALIDANDO CAPTIONS-DEBUG.JSON\n`);

    if (!fs.existsSync(DEBUG_JSON_PATH)) {
      console.error(`❌ captions-debug.json no encontrado: ${DEBUG_JSON_PATH}`);
      process.exit(1);
    }

    const debugData = JSON.parse(fs.readFileSync(DEBUG_JSON_PATH, 'utf8'));

    console.log(`   AudioDuration: ${debugData.audioDuration.toFixed(3)}s`);
    console.log(`   VoiceSegments detected: ${debugData.voiceSegmentsCount}`);
    console.log(`   Captions generated: ${debugData.captionsCount}`);
    console.log(`   Caption source: ${debugData.source}\n`);

    // Validaciones
    console.log(`4️⃣  VALIDACIONES\n`);

    const validations = [];
    let allPass = true;

    // V1: Caption count razonable
    const expectedMinCaptions = Math.floor(script.duration / 2.5); // máx 2.5s por caption
    const expectedMaxCaptions = Math.ceil(script.duration / 0.8); // mín 0.8s
    const captionCountValid = debugData.captionsCount >= expectedMinCaptions && debugData.captionsCount <= expectedMaxCaptions;
    validations.push({
      name: 'Caption count reasonable',
      pass: captionCountValid,
      details: `${debugData.captionsCount} captions (expected ${expectedMinCaptions}-${expectedMaxCaptions})`,
    });

    // V2: First caption
    const firstCaption = debugData.firstCaption;
    const firstValid = firstCaption && firstCaption.start >= 0 && firstCaption.start < 1.0;
    validations.push({
      name: 'First caption starts near 0s',
      pass: firstValid,
      details: `start=${firstCaption?.start?.toFixed(3)}s`,
    });

    // V3: Last caption no excede audioDuration
    const lastCaption = debugData.lastCaption;
    const lastValid = lastCaption && lastCaption.end <= debugData.audioDuration + 0.1;
    validations.push({
      name: 'Last caption <= audioDuration',
      pass: lastValid,
      details: `end=${lastCaption?.end?.toFixed(3)}s, audio=${debugData.audioDuration.toFixed(3)}s`,
    });

    // V4: No overlaps (verificar en la lista completa)
    const captions = debugData.captions || [];
    let overlapsFound = 0;
    for (let i = 1; i < captions.length; i++) {
      if (captions[i].start < captions[i - 1].end + 0.01) {
        overlapsFound++;
      }
    }
    const noOverlaps = overlapsFound === 0;
    validations.push({
      name: 'No overlaps between captions',
      pass: noOverlaps,
      details: `${overlapsFound} overlaps found`,
    });

    // V5: Subtítulos sincronizados en puntos clave (10s, 20s, 30s, final)
    const keyPoints = [10, 20, 30, Math.max(script.duration - 5, script.duration - 2)];
    let syncValid = true;
    const syncDetails = [];

    for (const t of keyPoints) {
      const capAtTime = captions.find(c => c.start <= t && c.end > t);
      if (capAtTime) {
        syncDetails.push(`@${t.toFixed(0)}s: "${capAtTime.text.slice(0, 20)}..."`);
      } else {
        syncDetails.push(`@${t.toFixed(0)}s: NO CAPTION`);
        if (t < script.duration - 2) syncValid = false;
      }
    }
    validations.push({
      name: 'Subtitles at key timestamps',
      pass: syncValid,
      details: syncDetails.join(' | '),
    });

    // V6: Caption source es válido (speech-segment o fallback)
    const sourceValid = ['final-audio-speech-segment', 'fallback-estimated', 'whisper'].includes(debugData.source);
    validations.push({
      name: 'Caption source valid',
      pass: sourceValid,
      details: debugData.source,
    });

    // Imprimir validaciones
    for (const v of validations) {
      const status = v.pass ? '✅' : '❌';
      console.log(`   ${status} ${v.name}`);
      console.log(`      ${v.details}\n`);
      if (!v.pass) allPass = false;
    }

    // Drift analysis with tuning awareness
    console.log(`5️⃣  DRIFT ANALYSIS & TUNING\n`);

    if (captions.length > 0) {
      const firstCapDrift = captions[0].start;
      const lastCapDrift = Math.abs(captions[captions.length - 1].end - debugData.audioDuration);
      const driftTarget = 0.35;  // objetivo de tuning: < 350ms
      const driftThreshold = 0.8; // tolerancia: < 800ms

      console.log(`   Initial drift (caption 0 start): ${firstCapDrift.toFixed(3)}s`);
      console.log(`   Final drift (last caption vs audio end): ${lastCapDrift.toFixed(3)}s`);

      let driftStatus = '❌ EXCEED';
      if (lastCapDrift < driftTarget) {
        driftStatus = '✅ EXCELLENT';
      } else if (lastCapDrift < driftThreshold) {
        driftStatus = '⚠️ ACCEPTABLE';
      }

      console.log(`   Status: ${driftStatus} (target: ${driftTarget}s, max: ${driftThreshold}s)\n`);

      if (lastCapDrift >= driftThreshold) {
        allPass = false;
      }
    }

    // RESULTADO FINAL
    console.log(`════════════════════════════════════════════════════════\n`);
    console.log(`📊 RESULTADO FINAL\n`);

    const validationStatus = allPass ? '✅ PASS' : '❌ FAIL';
    const captionSource = debugData.source || 'unknown';
    const captionSyncValidated = allPass ? 'true' : 'false';

    console.log(`   CAPTION_SYNC_VALIDATED: ${captionSyncValidated}`);
    console.log(`   captionSource: ${captionSource}`);
    console.log(`   Status: ${validationStatus}\n`);

    if (allPass) {
      console.log(`✅ PERMITIR PUBLISH EN SLOT\n`);
      console.log(`   El sistema de captions-sync está funcionando correctamente.`);
      console.log(`   Los subtítulos se mantienen sincronizados a lo largo del vídeo.\n`);
    } else {
      console.log(`❌ BLOQUEAR PUBLISH\n`);
      console.log(`   El sistema de captions-sync tiene problemas.`);
      console.log(`   El vídeo debe quedar en revisión.\n`);
    }

    console.log(`📋 Debug JSON: ${DEBUG_JSON_PATH}\n`);

    // Guardar reporte
    const reportPath = path.join(OUTPUT_DIR, 'caption-sync-test-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          testVideoId: TEST_VIDEO_ID,
          timestamp: new Date().toISOString(),
          renderDuration: renderDuration.toFixed(1),
          captions: debugData,
          validations,
          result: {
            CAPTION_SYNC_VALIDATED: allPass,
            captionSource,
            status: validationStatus,
          },
        },
        null,
        2
      )
    );

    console.log(`📄 Reporte guardado: ${reportPath}\n`);

    process.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    console.error(err.stack);
    process.exit(1);
  }
})();
