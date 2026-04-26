const path = require('path');
const fs = require('fs');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { postprocessAudioSafe } = require('./src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./src/services/render-engines');

const TEST_SCRIPT = {
  hook: '¿Por qué algunas personas logran sus objetivos y otras no?',
  claim: 'La ciencia revela un patrón simple.',
  explanation: 'Los ganadores usan una técnica llamada visualización.',
  cta: 'Pruébalo hoy y cambia tu vida.',
};

const TEST_OUTPUT_DIR = path.join(__dirname, 'output', 'test-voice-speed');
if (!fs.existsSync(TEST_OUTPUT_DIR)) fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

(async () => {
  console.log('🎙️  Testing voice speed (rates -6% to -8%)...\n');
  
  try {
    // 1. TTS
    console.log('Synthesizing voice...');
    const ttsResult = await synthesizeVoice(TEST_SCRIPT, path.join(TEST_OUTPUT_DIR, 'voice_final.mp3'));
    let rawAudioPath = ttsResult.audioPath;
    const wordBoundaries = ttsResult.wordBoundaries || [];
    const estimatedDuration = ttsResult.estimatedDuration;
    console.log(`✅ Audio: ${estimatedDuration.toFixed(2)}s\n`);

    // 2. Postprocess audio
    console.log('Processing audio...');
    const processedAudioPath = path.join(TEST_OUTPUT_DIR, 'voice_processed.mp3');
    await postprocessAudioSafe(rawAudioPath, processedAudioPath);
    console.log(`✅ Audio processed\n`);

    // 3. Render video
    console.log('Rendering video...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');
    
    await renderVideoWithRouter({
      script: TEST_SCRIPT,
      audioPath: processedAudioPath,
      audioDuration: estimatedDuration,
      outputPath: videoPath,
      themeId: 'theme_modern',
      wordBoundaries,
      sectionDurations: {
        hook: { start: 0, duration: estimatedDuration * 0.4 },
        claim: { start: estimatedDuration * 0.4, duration: estimatedDuration * 0.3 },
        micro_value: { start: estimatedDuration * 0.7, duration: estimatedDuration * 0.3 },
      },
      bgStyle: 'single_focus_pexels',
    });

    console.log(`✅ Render complete\n`);
    console.log(`📁 Output: ${TEST_OUTPUT_DIR}`);
    console.log(`📄 Video: ${videoPath}`);
    console.log(`\n🎬 Now check: Does the voice sound natural and not rushed?`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
