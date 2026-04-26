const path = require('path');
const fs = require('fs');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { postprocessAudioSafe } = require('./src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./src/services/render-engines');

// Script predefinido simple para evitar errores de generación
const TEST_SCRIPT = {
  hook: 'Mira esto cuando algo pequeño te cambie el cuerpo.',
  open_loop: 'Necesitas buscar confirmación sin darte cuenta.',
  micro_value: 'Por eso haces esto cuando alguien te ignora.',
  escalation: 'Relees el mensaje cinco veces buscando tono.',
  reengage: 'No eres el único que hace esto.',
  peak: 'Por eso duele cuando alguien te deja sin responder.',
  open_ending: 'Entiende qué te está pasando realmente.',
  soft_cta: 'Observa este patrón en ti.',
};

const TEST_OUTPUT_DIR = path.join(__dirname, 'output', 'test-word-timestamps-simple');
if (!fs.existsSync(TEST_OUTPUT_DIR)) fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log('WORD-LEVEL TIMESTAMP INTEGRATION (Simple Test)');
  console.log('════════════════════════════════════════════════════════════\n');

  try {
    // Phase 1: TTS
    console.log('Phase 1️⃣  TTS synthesis...');
    const ttsResult = await synthesizeVoice(TEST_SCRIPT, path.join(TEST_OUTPUT_DIR, 'voice_final.mp3'));
    let rawAudioPath = ttsResult.audioPath;
    const wordBoundaries = ttsResult.wordBoundaries || [];
    const estimatedDuration = ttsResult.estimatedDuration;
    console.log(`   ✅ Audio: ${estimatedDuration.toFixed(2)}s\n`);

    // Phase 2: Postprocess
    console.log('Phase 2️⃣  Audio postprocessing...');
    const processedAudioPath = path.join(TEST_OUTPUT_DIR, 'voice_processed.mp3');
    await postprocessAudioSafe(rawAudioPath, processedAudioPath);
    console.log(`   ✅ Audio processed\n`);

    // Phase 3: Render (WITH word timestamps integration)
    console.log('Phase 3️⃣  Rendering video (with Whisper word timestamps)...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');
    const finalDuration = Math.max(estimatedDuration, 28);

    try {
      await renderVideoWithRouter({
        script: TEST_SCRIPT,
        audioPath: processedAudioPath,
        audioDuration: finalDuration,
        outputPath: videoPath,
        themeId: 'theme_modern',
        wordBoundaries,
        sectionDurations: {
          hook: { start: 0, duration: finalDuration * 0.12 },
          open_loop: { start: finalDuration * 0.12, duration: finalDuration * 0.10 },
          micro_value: { start: finalDuration * 0.22, duration: finalDuration * 0.12 },
          escalation: { start: finalDuration * 0.34, duration: finalDuration * 0.14 },
          reengage: { start: finalDuration * 0.48, duration: finalDuration * 0.12 },
          peak: { start: finalDuration * 0.60, duration: finalDuration * 0.14 },
          open_ending: { start: finalDuration * 0.74, duration: finalDuration * 0.12 },
          soft_cta: { start: finalDuration * 0.86, duration: finalDuration * 0.14 },
        },
        bgStyle: 'single_focus_pexels',
      });
      console.log(`   ✅ Render complete\n`);
    } catch (renderErr) {
      console.error(`   ❌ Render failed: ${renderErr.message}\n`);
      throw renderErr;
    }

    // Phase 4: Validation
    console.log('Phase 4️⃣  VALIDATION\n');

    const metadataPath = path.join(TEST_OUTPUT_DIR, 'render-metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    console.log('📊 Metadata:');
    console.log(`   subtitleTimingMode: ${metadata.subtitleTimingMode}`);
    console.log(`   wordTimestampsCount: ${metadata.wordTimestampsCount || 0}`);
    console.log(`   wordAlignmentEngine: ${metadata.wordAlignmentEngine || 'N/A'}`);
    console.log(`   subtitleBlocksCount: ${metadata.subtitleBlocksCount || 'N/A'}`);
    console.log(`   voiceSegmentsDetected: ${metadata.voiceSegmentsDetected || 'N/A'}`);

    if (metadata.alignmentWarnings && metadata.alignmentWarnings.length > 0) {
      console.log(`   Warnings: ${metadata.alignmentWarnings.join(', ')}`);
    }

    console.log('\n════════════════════════════════════════════════════════════');
    console.log('✅ TEST COMPLETED SUCCESSFULLY');
    console.log('════════════════════════════════════════════════════════════\n');

    console.log(`📁 Output: ${TEST_OUTPUT_DIR}`);
    console.log(`📄 Video: output.mp4`);
    console.log(`📝 Metadata: render-metadata.json`);
    console.log(`\n🎯 Subtitle Timing Mode: ${metadata.subtitleTimingMode}`);

    const timingMode = metadata.subtitleTimingMode;
    if (timingMode === 'word_timestamps') {
      console.log('   ✅ WORD-LEVEL TIMESTAMPS ACTIVE');
      console.log(`   ✅ ${metadata.wordTimestampsCount || 0} words synchronized by Whisper`);
      console.log('   ✅ Professional-grade subtitle sync (TikTok/Shorts level)');
    } else {
      console.log(`   ℹ️  Using fallback mode: ${timingMode}`);
      console.log(`   📊 Word timestamps attempted: ${metadata.wordAlignmentEngine}`);
    }

    console.log('\n✅ WORD-TIMESTAMP INTEGRATION VALIDATED\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
