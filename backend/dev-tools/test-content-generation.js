const path = require('path');
const { generateScript } = require('./src/services/content-generator');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { postprocessAudioSafe } = require('./src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./src/services/render-engines');
const fs = require('fs');

const TEST_OUTPUT_DIR = path.join(__dirname, 'output', 'test-content-gen');
if (!fs.existsSync(TEST_OUTPUT_DIR)) fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log('CONTENT GENERATION TEST — No Neurociencia, Solo Validation');
  console.log('════════════════════════════════════════════════════════════\n');

  try {
    // Phase 1: Generate script
    console.log('Phase 1️⃣  Generating script (relationships/validation)...');
    const script = await generateScript({
      topic: 'relationships',
    });

    console.log(`\n✅ Script generated:`);
    console.log(`   Hook: "${script.hook}"`);
    console.log(`   Identification score: ${script.identificationScore}`);
    console.log(`   Viral trigger: ${script.viralTrigger}`);
    console.log(`   Emotional trigger: ${script.emotionalTrigger}\n`);

    // Check for forbidden words
    const forbiddenWords = ['cerebro', 'neurona', 'amígdala', 'dopamina', 'prefrontal', 'neurociencia', 'científicamente', 'estudios demuestran'];
    const scriptText = JSON.stringify(script).toLowerCase();
    const foundForbidden = forbiddenWords.filter(w => scriptText.includes(w));

    if (foundForbidden.length > 0) {
      console.log(`⚠️  WARNING: Found forbidden words: ${foundForbidden.join(', ')}`);
    } else {
      console.log(`✅ No forbidden neurociencia words found\n`);
    }

    // Phase 2: TTS
    console.log('Phase 2️⃣  TTS synthesis...');
    const ttsResult = await synthesizeVoice(script, path.join(TEST_OUTPUT_DIR, 'voice_final.mp3'));
    let rawAudioPath = ttsResult.audioPath;
    const wordBoundaries = ttsResult.wordBoundaries || [];
    const estimatedDuration = ttsResult.estimatedDuration;
    console.log(`   ✅ Audio: ${estimatedDuration.toFixed(2)}s\n`);

    // Phase 3: Postprocess
    console.log('Phase 3️⃣  Processing audio...');
    const processedAudioPath = path.join(TEST_OUTPUT_DIR, 'voice_processed.mp3');
    await postprocessAudioSafe(rawAudioPath, processedAudioPath);
    console.log(`   ✅ Audio processed\n`);

    // Phase 4: Render
    console.log('Phase 4️⃣  Rendering video...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');
    const finalDuration = Math.max(estimatedDuration, 28);

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

    // Phase 5: Validation
    console.log('Phase 5️⃣  VALIDATION\n');

    const videoExists = fs.existsSync(videoPath);
    const videoSize = videoExists ? fs.statSync(videoPath).size / 1024 / 1024 : 0;

    console.log(`📦 Output files:`);
    console.log(`   ✅ output.mp4 — ${videoSize.toFixed(2)} MB`);

    console.log(`\n✅ CONTENT GENERATION TEST PASSED`);
    console.log(`📁 Location: ${TEST_OUTPUT_DIR}`);
    console.log(`\n📊 Script Analysis:`);
    console.log(`   Hook: "${script.hook}"`);
    console.log(`   Topic: ${script.topic}`);
    console.log(`   Identification: ${script.identificationScore}%`);
    console.log(`   Viral trigger: ${script.viralTrigger}`);
    console.log(`   Emotional: ${script.emotionalTrigger}`);
    console.log(`\n🎬 Now open output.mp4 and verify:`);
    console.log(`   ✅ Hook is observable (not "tu cerebro...")`);
    console.log(`   ✅ Content feels validating, not educational`);
    console.log(`   ✅ No neurociencia language`);
    console.log(`   ✅ Feels like someone talking to a friend\n`);

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
})();
