const path = require('path');
const fs = require('fs');
const { generateScript } = require('./src/services/content-generator');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { postprocessAudioSafe } = require('./src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./src/services/render-engines');

const TEST_OUTPUT_DIR = path.join(__dirname, 'output', 'test-word-timestamps');
if (!fs.existsSync(TEST_OUTPUT_DIR)) fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log('WORD-LEVEL TIMESTAMP INTEGRATION TEST');
  console.log('(Whisper-based subtitle synchronization PRO)');
  console.log('════════════════════════════════════════════════════════════\n');

  try {
    // Phase 1: Generate script
    console.log('Phase 1️⃣  Generating script...');
    const script = await generateScript({ topic: 'relationships' });
    console.log(`   ✅ Hook: "${script.hook}"\n`);

    // Phase 2: TTS
    console.log('Phase 2️⃣  TTS synthesis...');
    const ttsResult = await synthesizeVoice(script, path.join(TEST_OUTPUT_DIR, 'voice_final.mp3'));
    let rawAudioPath = ttsResult.audioPath;
    const wordBoundaries = ttsResult.wordBoundaries || [];
    const estimatedDuration = ttsResult.estimatedDuration;
    console.log(`   ✅ Audio: ${estimatedDuration.toFixed(2)}s\n`);

    // Phase 3: Postprocess
    console.log('Phase 3️⃣  Audio postprocessing...');
    const processedAudioPath = path.join(TEST_OUTPUT_DIR, 'voice_processed.mp3');
    await postprocessAudioSafe(rawAudioPath, processedAudioPath);
    console.log(`   ✅ Audio processed\n`);

    // Phase 4: Render (WITH word timestamps integration)
    console.log('Phase 4️⃣  Rendering video (with word timestamp alignment)...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');
    const finalDuration = Math.max(estimatedDuration, 28);

    try {
      await renderVideoWithRouter({
        script,
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

    // Phase 5: Validation
    console.log('Phase 5️⃣  VALIDATION\n');

    const metadataPath = path.join(TEST_OUTPUT_DIR, 'render-metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    console.log('📊 Metadata:');
    console.log(`   subtitleTimingMode: ${metadata.subtitleTimingMode}`);
    console.log(`   wordTimestampsCount: ${metadata.wordTimestampsCount || 'N/A'}`);
    console.log(`   wordAlignmentEngine: ${metadata.wordAlignmentEngine || 'N/A'}`);
    console.log(`   subtitleBlocksCount: ${metadata.subtitleBlocksCount || 'N/A'}`);
    console.log(`   voiceSegmentsDetected: ${metadata.voiceSegmentsDetected || 'N/A'}`);

    if (metadata.alignmentWarnings && metadata.alignmentWarnings.length > 0) {
      console.log(`   Alignment warnings: ${metadata.alignmentWarnings.join(', ')}`);
    }

    console.log('\n✅ TEST COMPLETED');
    console.log(`📁 Output: ${TEST_OUTPUT_DIR}`);
    console.log(`📄 Video: output.mp4`);
    console.log(`📝 Metadata: render-metadata.json`);

    const subtitleMode = metadata.subtitleTimingMode;
    console.log(`\n🎯 Subtitle Timing Mode: ${subtitleMode}`);

    if (subtitleMode === 'word_timestamps') {
      console.log('   ✅ WORD-LEVEL TIMESTAMPS ACTIVE');
      console.log(`   ✅ ${metadata.wordTimestampsCount} words synchronized by Whisper`);
      console.log('   ✅ Professional-grade subtitle sync (TikTok/Shorts level)');
    } else if (subtitleMode === 'WORD_TIMESTAMPS') {
      console.log('   ✅ WORD-LEVEL TIMESTAMPS ACTIVE (caps mode)');
      console.log(`   ✅ ${metadata.wordTimestampsCount} words synchronized`);
    } else {
      console.log(`   ⚠️  Using fallback mode: ${subtitleMode}`);
      if (subtitleMode === 'estimated_fallback') {
        console.log('   ℹ️  Word timestamps failed, using proportional distribution');
      }
    }

    console.log('\n════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
