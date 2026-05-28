const path = require('path');
const fs = require('fs');

// Force load .env from the correct directory
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

console.log(`[DEBUG] RENDER_MODE=${process.env.RENDER_MODE}`);

const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { postprocessAudioSafe } = require('./src/services/audio-postprocess');

// Clear module cache to force reload with updated env vars
delete require.cache[require.resolve('./src/services/render-engines')];
const { renderVideoWithRouter } = require('./src/services/render-engines');

const TEST_OUTPUT_DIR = path.join(__dirname, 'output', 'test-remotion-fallback');
if (!fs.existsSync(TEST_OUTPUT_DIR)) fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

const FALLBACK_SCRIPT = {
  id: 'test-fallback-remotion',
  topic: 'Test Fallback Visual',
  hook: 'VIDEOSIA Visual Engine Test',
  claim: 'Testing fallback content rendering',
  explanation: 'This is a minimal test script',
  cta: 'Watch the fallback render',
};

(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log('REMOTION FALLBACK CONTENT TEST');
  console.log('════════════════════════════════════════════════════════════\n');

  try {
    // Generate dummy audio with ffmpeg (30 seconds of silence)
    console.log('Phase 1️⃣  Creating dummy audio (30s silence)...');
    const dummyAudioPath = path.join(TEST_OUTPUT_DIR, 'voice.mp3');
    const { execSync } = require('child_process');

    if (!fs.existsSync(dummyAudioPath)) {
      execSync(`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 30 -q:a 9 -acodec libmp3lame "${dummyAudioPath}" 2>/dev/null`, { stdio: 'pipe' });
    }
    console.log(`   ✅ Audio created: 30s\n`);

    console.log('Phase 2️⃣  Preparing audio path...');
    const processedAudioPath = path.join(TEST_OUTPUT_DIR, 'voice_processed.mp3');
    if (!fs.existsSync(processedAudioPath)) {
      fs.copyFileSync(dummyAudioPath, processedAudioPath);
    }
    console.log(`   ✅ Audio ready\n`);

    console.log('Phase 3️⃣  Rendering with REMOTION (FallbackContent)...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');
    const audioDuration = 30; // Dummy audio is 30 seconds

    await renderVideoWithRouter({
      script: FALLBACK_SCRIPT,
      audioPath: processedAudioPath,
      audioDuration,
      outputPath: videoPath,
      themeId: 'theme_modern',
      wordBoundaries: [],
      sectionDurations: {},
      bgStyle: 'single_focus_pexels',
    });

    console.log(`   ✅ Render complete\n`);

    console.log('Phase 4️⃣  OUTPUT VALIDATION\n');

    if (fs.existsSync(videoPath)) {
      const stats = fs.statSync(videoPath);
      console.log(`   ✅ output.mp4 exists: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`);

      const metadataPath = path.join(TEST_OUTPUT_DIR, 'render-metadata.json');
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        console.log('   Metadata:');
        console.log(`     • renderer: ${metadata.renderer}`);
        console.log(`     • visualFallbackUsed: ${metadata.visualFallbackUsed}`);
        console.log(`     • hasKineticCaptions: ${metadata.hasKineticCaptions}`);
        console.log(`     • captionsCount: ${metadata.captionsCount}`);
        console.log(`     • visibleVisuals: ${metadata.visibleVisuals}\n`);
      }
    } else {
      console.log(`   ❌ output.mp4 NOT FOUND\n`);
    }

    console.log('════════════════════════════════════════════════════════════');
    console.log(`TEST COMPLETE - Output: ${TEST_OUTPUT_DIR}`);
    console.log('════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error(`❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
})();
