#!/usr/bin/env node
/**
 * scripts/test-video-use.js
 * Genera 1 vídeo de prueba con video-use SIN publicar.
 *
 * Uso:
 *   npm run render:video-use:test
 *   npm run render:video-use:test -- --verbose
 *   npm run render:video-use:test -- --engine=video_use
 *
 * Output: ./output/video-use/test-{timestamp}/output.mp4
 */

require('dotenv').config({ path: './backend/.env' });

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configurar variables para la prueba
process.env.VIDEO_RENDER_ENGINE = process.env.VIDEO_RENDER_ENGINE || 'video_use';
process.env.VIDEO_USE_ENABLED = 'true';
process.env.VIDEO_USE_DRY_RUN = 'true';
process.env.OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

const logger = require('./backend/src/utils/logger');
const { synthesizeVoice } = require('./backend/src/services/voice-synthesizer');
const { renderVideoWithRouter } = require('./backend/src/services/render-engines');

/**
 * Script de ejemplo realista
 */
const EXAMPLE_SCRIPT = {
  id: 'test-' + uuidv4(),
  title: 'El efecto Halo: tu primer error mental',
  topic: 'cognitive_biases',
  effectName: 'halo',
  hook: '¿Sabes por qué confías más en gente guapa?',
  open_loop: 'No es por superficial. Es neurología pura.',
  micro_value: 'Se llama efecto Halo. Tu cerebro vincula belleza con COMPETENCIA.',
  escalation: 'Un estudio de Princeton: observaste caras bonitas solo 100 milisegundos. Suficiente para reconfigurar tu criterio de INTELIGENCIA.',
  reengage: 'Lo loco: incluso SABIENDO que ocurre, sigue funcionando.',
  peak: 'Porque no es decisión consciente. Es automático. Es INVOLUNTARIO.',
  open_ending: '¿Cuántas veces hoy juzgaste a alguien primero por su cara?',
  soft_cta: 'Sígueme. Cada semana, un sesgo diferente que SABOTEA tus decisiones.',
  psychologicalFact: 'El efecto Halo: atributos positivos percibidos en una persona mejoran evaluaciones de otros atributos.',
  viralTrigger: 'curiosity',
  emotionalTrigger: 'validation',
  keywords: ['halo', 'sesgo', 'mente', 'psicología'],
  hashtags: ['#psicologia', '#mente', '#sesgo'],
  estimatedWords: 85,
  durationSeconds: 50,
};

/**
 * Ejecuta el test
 */
async function runTest() {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('  VIDEO-USE TEST  |  Render sin publicar');
  logger.info('═══════════════════════════════════════════════════');

  const testId = `test-${Date.now()}`;
  const outputDir = path.resolve(process.env.OUTPUT_DIR, 'video-use', testId);

  try {
    // 1. Crear directorio de salida
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    logger.info(`\n✓ Output dir: ${outputDir}`);

    // 2. Generar audio (TTS)
    logger.info('\n[1/3] Synthesizing voice...');
    const audioPathHint = path.join(outputDir, 'voice.mp3');
    const { audioPath, sectionDurations, wordBoundaries } = await synthesizeVoice(EXAMPLE_SCRIPT, audioPathHint);
    logger.info(`✓ Audio ready: ${audioPath}`);

    // 3. Renderizar vídeo con router (usa video_use si está disponible)
    logger.info('\n[2/3] Rendering video...');
    logger.info(`Engine: ${process.env.VIDEO_RENDER_ENGINE}`);
    logger.info(`DRY_RUN: ${process.env.VIDEO_USE_DRY_RUN} (no publicará)`);

    const videoPath = path.join(outputDir, 'output.mp4');
    const renderResult = await renderVideoWithRouter({
      script: EXAMPLE_SCRIPT,
      audioPath: audioPath,
      audioDuration: EXAMPLE_SCRIPT.durationSeconds,
      outputPath: videoPath,
      themeId: 'dark_psychology',
      wordBoundaries: wordBoundaries,
      sectionDurations: sectionDurations,
    });

    logger.info(`✓ Video rendered: ${renderResult.videoPath}`);

    // 4. Guardar metadata
    const metadata = {
      testId: testId,
      timestamp: new Date().toISOString(),
      script: EXAMPLE_SCRIPT,
      engine: process.env.VIDEO_RENDER_ENGINE,
      dryRun: process.env.VIDEO_USE_DRY_RUN === 'true',
      files: {
        video: videoPath,
        audio: audioPath,
      },
      status: 'ready',
      note: 'Video generado en modo dry-run. NO se ha publicado en YouTube/TikTok.',
    };

    fs.writeFileSync(
      path.join(outputDir, 'test-metadata.json'),
      JSON.stringify(metadata, null, 2)
    );
    logger.info(`✓ Metadata saved`);

    // 5. Resumen
    logger.info('\n═══════════════════════════════════════════════════');
    logger.info('  TEST COMPLETE');
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`\nOutput folder: ${outputDir}`);
    logger.info(`Video file: output.mp4`);
    logger.info(`Audio file: voice.mp3`);
    logger.info(`Metadata: test-metadata.json`);
    logger.info(`\n✓ DRY_RUN: Vídeo generado pero NO publicado`);
    logger.info(`✓ Puedes ver el vídeo en: output/video-use/${testId}/output.mp4`);
    logger.info(`\nPróximos pasos:`);
    logger.info(`  1. Ver vídeo en tu reproductor local`);
    logger.info(`  2. Comparar con motor actual (VIDEO_RENDER_ENGINE=current)`);
    logger.info(`  3. Si está bien, cambiar a: VIDEO_RENDER_ENGINE=video_use`);
    logger.info(`  4. Para publicar, cambiar: VIDEO_USE_DRY_RUN=false\n`);

  } catch (error) {
    logger.error(`\n✗ TEST FAILED`);
    logger.error(`Error: ${error.message}`);
    logger.error(`\nTroubleshooting:`);

    if (error.message.includes('video-use')) {
      logger.error(`  • video-use no disponible`);
      logger.error(`  • Check: VIDEO_RENDER_ENGINE=${process.env.VIDEO_RENDER_ENGINE}`);
      logger.error(`  • Check: VIDEO_USE_ENABLED=${process.env.VIDEO_USE_ENABLED}`);
      logger.error(`  • Verificar que integrations/video-use está clonado`);
    } else if (error.message.includes('Python') || error.message.includes('python')) {
      logger.error(`  • Python no encontrado`);
      logger.error(`  • Check: PYTHON_BIN_VIDEO_USE=${process.env.PYTHON_BIN_VIDEO_USE}`);
      logger.error(`  • En Windows, usar ruta absoluta: C:\\Python310\\python.exe`);
    } else if (error.message.includes('audioPath')) {
      logger.error(`  • Error en TTS`);
      logger.error(`  • Check: KOKORO_ENABLED=${process.env.KOKORO_ENABLED}`);
      logger.error(`  • Check: EDGE_TTS_VOICE=${process.env.EDGE_TTS_VOICE}`);
    } else {
      logger.error(`\n${error.stack}`);
    }

    process.exit(1);
  }
}

// Ejecutar
runTest().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
