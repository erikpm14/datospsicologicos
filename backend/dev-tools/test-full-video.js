const path = require('path');
const fs = require('fs');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { postprocessAudioSafe } = require('./src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./src/services/render-engines');

// Script completo de 28-32 segundos — usando estructura correcta
const FULL_SCRIPT = {
  hook: '¿Sabías que tu cerebro tiene un botón de pánico que presionas sin saberlo?',
  open_loop: 'La amígdala es el guardián de tus miedos.',
  micro_value: 'Controla tu cuerpo en milisegundos sin que te des cuenta.',
  escalation: 'Cuando ves algo amenazante, la amígdala envía una señal antes de que conscientemente lo proceses.',
  reengage: 'Es completamente automático, involuntario, primitivo. Tu corteza prefrontal llega tarde al juego.',
  peak: 'Por eso reaccionas antes de pensar. Tus emociones dominan tu lógica en cada momento.',
  open_ending: 'Pero aquí está el secreto que nunca te enseñaron: puedes reentrenar tu amígdala.',
  soft_cta: 'Con repetición y exposición gradual, recables tu cerebro. Domina tu miedo y dominas tu vida. Empieza hoy.',
};

const TEST_OUTPUT_DIR = path.join(__dirname, 'output', 'test-full-video');
if (!fs.existsSync(TEST_OUTPUT_DIR)) fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log('FULL VIDEO TEST — 28-32s Production Quality');
  console.log('════════════════════════════════════════════════════════════\n');

  try {
    // Phase 1: TTS
    console.log('Phase 1️⃣  TTS synthesis...');
    const ttsResult = await synthesizeVoice(FULL_SCRIPT, path.join(TEST_OUTPUT_DIR, 'voice_final.mp3'));
    let rawAudioPath = ttsResult.audioPath;
    const wordBoundaries = ttsResult.wordBoundaries || [];
    const estimatedDuration = ttsResult.estimatedDuration;
    console.log(`   ✅ Audio: ${estimatedDuration.toFixed(2)}s (target: 28-32s)\n`);

    // Check duration
    if (estimatedDuration < 25) {
      console.log(`   ⚠️  WARNING: Audio too short (${estimatedDuration.toFixed(2)}s < 25s)`);
    }

    // Phase 2: Postprocess audio
    console.log('Phase 2️⃣  Processing audio...');
    const processedAudioPath = path.join(TEST_OUTPUT_DIR, 'voice_processed.mp3');
    const postResult = await postprocessAudioSafe(rawAudioPath, processedAudioPath);
    console.log(`   ✅ Audio processed\n`);

    // Phase 3: Render video
    console.log('Phase 3️⃣  Rendering video...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');

    const finalDuration = Math.max(estimatedDuration, 28);

    await renderVideoWithRouter({
      script: FULL_SCRIPT,
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

    // Phase 4: Validation
    console.log('Phase 4️⃣  VALIDATION\n');

    const files = {
      'output.mp4': videoPath,
      'voice_processed.mp3': processedAudioPath,
    };

    const stats = {};
    for (const [name, filePath] of Object.entries(files)) {
      if (fs.existsSync(filePath)) {
        const size = fs.statSync(filePath).size;
        stats[name] = `${(size / 1024 / 1024).toFixed(2)} MB`;
      }
    }

    console.log('📦 Output files:');
    for (const [name, size] of Object.entries(stats)) {
      console.log(`   ✅ ${name} — ${size}`);
    }

    console.log(`\n✅ VIDEO GENERATED SUCCESSFULLY`);
    console.log(`📁 Location: ${TEST_OUTPUT_DIR}`);
    console.log(`📄 File: output.mp4`);
    console.log(`\n🎬 VALIDATION CHECKLIST:`);
    console.log(`   ✅ Duration >= 25s: ${estimatedDuration >= 25 ? 'PASS' : 'FAIL'}`);
    console.log(`   ? Voice natural (no acelerado): LISTEN & CHECK`);
    console.log(`   ? Subtítulos legibles: LISTEN & CHECK`);
    console.log(`   ? Texto ajustado al ancho: LISTEN & CHECK`);
    console.log(`\n⚠️  DO NOT PUBLISH until you manually verify the video.\n`);

  } catch (err) {
    console.error('\n❌ RENDER FAILED:', err.message);
    process.exit(1);
  }
})();
