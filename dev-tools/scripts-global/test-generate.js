/**
 * test-generate.js
 * Test end-to-end: genera 1 video completo sin publicar.
 * Stack gratuito: Claude API + Edge TTS + FFmpeg + Canvas.
 *
 * Uso: node scripts/test-generate.js
 *   o: cd backend && npm run test:video
 */

// Apunta Node.js a los node_modules del backend para resolver todas las dependencias
const path = require('path');
process.env.NODE_PATH = path.resolve(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

require('dotenv').config({ path: path.resolve(__dirname, '../backend/.env') });

const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

async function test() {
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║  Psychology Shorts — E2E Test         ║');
  console.log('║  Stack: Claude + Edge TTS (GRATIS)    ║');
  console.log('╚═══════════════════════════════════════╝\n');

  // Verifica solo la API key de Claude (lo único de pago)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Falta ANTHROPIC_API_KEY en backend/.env');
    console.error('   Es la única API de pago necesaria.\n');
    process.exit(1);
  }

  const { generateScript } = require('../backend/src/services/content-generator');
  const { synthesizeVoice } = require('../backend/src/services/voice-synthesizer');
  const { renderVideo } = require('../backend/src/services/video-renderer');
  const themes = require('../backend/src/templates/visual-themes.json');

  const videoId = uuidv4().split('-')[0];
  const outputDir = path.resolve('./output/test_' + videoId);
  fs.mkdirSync(outputDir, { recursive: true });

  // ── PASO 1: Guión con Claude ────────────────
  console.log('PASO 1/3: Generando guión con Claude API...');
  console.log('  (Único servicio de pago: ~$0.002 por guión)\n');
  const t1 = Date.now();

  const script = await generateScript({ topic: 'cognitive_biases', forceHighScore: false });

  console.log(`  ✅ Completado en ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log(`  Título:  ${script.title}`);
  console.log(`  Score:   ${script.viralityScore}/100 ${script.approved ? '✅' : '⚠️ bajo umbral'}`);
  console.log(`  Hook:    "${script.hook}"`);
  console.log(`  Trigger: ${script.emotionalTrigger}\n`);

  fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2));

  // ── PASO 2: Voz con Edge TTS (gratis) ───────
  const voice = process.env.EDGE_TTS_VOICE || 'es-ES-AlvaroNeural';
  console.log(`PASO 2/3: Sintetizando voz con Microsoft Edge TTS...`);
  console.log(`  Voz: ${voice} (GRATIS, sin API key)\n`);
  const t2 = Date.now();

  const audioPath = path.join(outputDir, 'voice.mp3');
  const { estimatedDuration: audioDuration, wordCount } = await synthesizeVoice(script, audioPath);

  console.log(`  ✅ Completado en ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  console.log(`  Duración: ${audioDuration.toFixed(1)}s | Palabras: ${wordCount}`);
  console.log(`  Audio:    ${audioPath}\n`);

  // ── PASO 3: Video con FFmpeg (gratis) ───────
  console.log('PASO 3/3: Renderizando video con FFmpeg...');
  console.log('  Fondo: gradiente Canvas | Subtítulos: FFmpeg drawtext\n');
  const t3 = Date.now();

  const themeId = themes.themes[0].id;
  const videoPath = path.join(outputDir, 'output.mp4');
  await renderVideo({ script, audioPath, audioDuration, outputPath: videoPath, themeId });

  const sizeMB = (fs.statSync(videoPath).size / (1024 * 1024)).toFixed(1);
  console.log(`  ✅ Completado en ${((Date.now() - t3) / 1000).toFixed(1)}s`);
  console.log(`  Video:  ${videoPath}`);
  console.log(`  Tamaño: ${sizeMB} MB`);
  console.log(`  Tema:   ${themeId}\n`);

  // ── RESUMEN ────────────────────────────────
  const total = ((Date.now() - t1) / 1000).toFixed(0);
  console.log('╔═══════════════════════════════════════╗');
  console.log(`║  ✅ TEST COMPLETADO en ${total}s            `);
  console.log('╠═══════════════════════════════════════╣');
  console.log(`║  Coste estimado: ~$0.002 (solo Claude) `);
  console.log(`║  Video: output/test_${videoId}/output.mp4`);
  console.log('╚═══════════════════════════════════════╝\n');
}

test().catch((err) => {
  console.error('\n❌ Test fallido:', err.message);
  if (process.env.NODE_ENV !== 'production') console.error(err.stack);
  process.exit(1);
});
