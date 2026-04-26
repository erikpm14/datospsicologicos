/**
 * generate-batch.js
 * Genera un lote de videos desde la línea de comandos.
 * Stack: Claude API (pago) + Edge TTS + FFmpeg (gratis).
 *
 * Uso: node scripts/generate-batch.js [count] [topic]
 *
 * Ejemplos:
 *   node scripts/generate-batch.js 3
 *   node scripts/generate-batch.js 1 body_language
 *   node scripts/generate-batch.js 2 relationships
 *
 * Topics disponibles:
 *   body_language | cognitive_biases | relationships |
 *   workplace | first_impressions | social_skills | habits | communication
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { generateBatch } = require('../backend/src/services/content-generator');
const { synthesizeVoice } = require('../backend/src/services/voice-synthesizer');
const { renderVideo } = require('../backend/src/services/video-renderer');
const themes = require('../backend/src/templates/visual-themes.json');

const count = parseInt(process.argv[2] || '1');
const topic = process.argv[3] || null;
const outputBase = path.resolve('./output');

async function run() {
  console.log(`\n🧠 Psychology Shorts Generator (Stack Gratuito)`);
  console.log(`📦 ${count} video(s) | Tema: ${topic || 'auto'}`);
  console.log(`🎙️  TTS: Microsoft Edge (gratis) | 🎬 Render: FFmpeg\n`);

  const scripts = await generateBatch(count);

  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    const videoId = uuidv4();
    const outputDir = path.join(outputBase, videoId);
    fs.mkdirSync(outputDir, { recursive: true });

    console.log(`\n[${i + 1}/${scripts.length}] ${script.title}`);
    console.log(`  Score: ${script.viralityScore}/100 ${script.approved ? '✅' : '⚠️'}`);
    console.log(`  Hook:  "${script.hook}"`);

    console.log('  🎙️  Sintetizando voz (Edge TTS, gratis)...');
    const audioPath = path.join(outputDir, 'voice.mp3');
    const { audioDuration } = await synthesizeVoice(script, audioPath);
    console.log(`  ✓ Audio: ${audioDuration.toFixed(1)}s`);

    console.log('  🎬 Renderizando video (FFmpeg)...');
    const themeId = themes.rotation[i % themes.rotation.length];
    const videoPath = path.join(outputDir, 'output.mp4');
    await renderVideo({ script, audioPath, audioDuration, outputPath: videoPath, themeId });
    console.log(`  ✓ Video: ${videoPath}`);

    fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2));
  }

  console.log(`\n✅ Lote completado. Videos en: ${outputBase}`);
  console.log(`💸 Coste: ~$${(scripts.length * 0.002).toFixed(3)} (solo Claude API)\n`);
}

run().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
