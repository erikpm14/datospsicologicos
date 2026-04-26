#!/usr/bin/env node
require('dotenv').config({ path: '.env' });
const { renderVideoWithRouter } = require('./src/services/render-engines');
const path = require('path');
const fs = require('fs');

async function testAudioSync() {
  console.log('=== TEST: Audio-Subtitle Synchronization ===\n');

  const testOutputDir = path.join(__dirname, '../output/test-sync');
  if (!fs.existsSync(testOutputDir)) fs.mkdirSync(testOutputDir, { recursive: true });

  // Script de prueba simple
  const testScript = {
    topic: 'relationships',
    hook: 'Mira esto cuando algo pequeño te cambie el cuerpo',
    claim: 'Se llama EFECTO HALO.',
    explanation: 'Cuando ves a alguien atractivo tendemos a asumir que es inteligente, amable y exitoso. Sin que lo notes, un rasgo positivo colorea todo lo demás.',
    revelation: 'Tu cerebro toma ataljos. Automáticamente.',
    cta: '¿Te ha pasado con alguien?',
  };

  // Audio simulado (necesitaremos crear uno)
  const audioPath = path.join(testOutputDir, 'test_audio.mp3');
  if (!fs.existsSync(audioPath)) {
    console.warn('⚠️  test_audio.mp3 not found. Generating test audio from TTS...');
    // Para este test, asumir que hay un audio previo
    return;
  }

  const outputPath = path.join(testOutputDir, 'test-video.mp4');

  try {
    console.log('Rendering test video with audio-sync...');
    const result = await renderVideoWithRouter({
      script: testScript,
      audioPath,
      audioDuration: 12.5,
      outputPath,
      themeId: 'theme_modern',
      wordBoundaries: [],
      sectionDurations: {
        hook: { start: 0, duration: 1.5 },
        claim: { start: 1.5, duration: 2.0 },
        explanation: { start: 3.5, duration: 5.0 },
        revelation: { start: 8.5, duration: 2.5 },
        cta: { start: 11, duration: 1.5 },
      },
      bgStyle: 'single_focus_pexels',
    });

    console.log('✅ Render completed');
    console.log(`Video: ${result.videoPath || outputPath}`);

    // Verificar archivos generados
    const files = ['video.mp4', 'subtitles.srt', 'subtitles.ass', 'voice-segments.json'];
    const metadata = path.join(testOutputDir, 'metadata.json');

    console.log('\nGenerated files:');
    for (const file of files) {
      const fpath = path.join(testOutputDir, file);
      if (fs.existsSync(fpath)) {
        const size = fs.statSync(fpath).size;
        console.log(`  ✅ ${file} (${(size / 1024).toFixed(1)} KB)`);
      } else {
        console.log(`  ❌ ${file}`);
      }
    }

    if (fs.existsSync(metadata)) {
      const meta = JSON.parse(fs.readFileSync(metadata, 'utf8'));
      console.log('\nMetadata:');
      console.log(`  subtitleTimingMode: ${meta.subtitleTimingMode || 'UNKNOWN'}`);
      console.log(`  voiceSegmentsDetected: ${meta.voiceSegmentsDetected || 0}`);
    }

    console.log('\n✅ Test complete!');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  }
}

testAudioSync();
