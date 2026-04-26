#!/usr/bin/env node
/**
 * scripts/test-render.js
 * Genera 1 vídeo de prueba con el motor configurado SIN publicar.
 *
 * Uso:
 *   npm run render:test
 *   npm run render:test -- --verbose
 */

require('dotenv').config({ path: './backend/.env' });

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Asegurar que estamos en modo validación (no publicar)
process.env.VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH = 'true';
process.env.OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

const logger = require('./backend/src/utils/logger');
const { synthesizeVoice } = require('./backend/src/services/voice-synthesizer');
const { postprocessAudioSafe } = require('./backend/src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./backend/src/services/render-engines');

/**
 * Script de ejemplo realista para testing
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
  const renderEngine = process.env.VIDEO_RENDER_ENGINE || 'current';

  logger.info('═══════════════════════════════════════════════════');
  logger.info(`  RENDER TEST  |  Engine: ${renderEngine}`);
  logger.info('═══════════════════════════════════════════════════');

  const testId = `test-${Date.now()}`;
  const outputDir = path.resolve(process.env.OUTPUT_DIR, 'test', testId);

  try {
    // 1. Crear directorio
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    logger.info(`\n✓ Output dir: ${outputDir}`);

    // 2. Generar audio (TTS)
    logger.info('\n[1/3] Synthesizing voice...');
    const audioPathHint = path.join(outputDir, 'voice.mp3');
    const { audioPath, sectionDurations, wordBoundaries } = await synthesizeVoice(EXAMPLE_SCRIPT, audioPathHint);
    logger.info(`✓ Audio ready: ${audioPath}`);

    // 3. Postprocesar audio
    logger.info('\n[2/3] Postprocessing audio...');
    const processedAudioPath = audioPath.replace(/\.[^.]+$/, '_proc.mp3');
    const { audioPath: finalAudioPath } = await postprocessAudioSafe(audioPath, processedAudioPath);
    logger.info(`✓ Audio processed: ${finalAudioPath}`);

    // 4. Renderizar vídeo
    logger.info('\n[3/3] Rendering video...');
    logger.info(`Engine: ${renderEngine}`);
    logger.info(`Validation: ${process.env.VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH}`);

    const videoPath = path.join(outputDir, 'output.mp4');
    const renderResult = await renderVideoWithRouter({
      script: EXAMPLE_SCRIPT,
      audioPath: finalAudioPath,
      audioDuration: EXAMPLE_SCRIPT.durationSeconds,
      outputPath: videoPath,
      themeId: 'dark_psychology',
      wordBoundaries: wordBoundaries,
      sectionDurations: sectionDurations,
    });

    logger.info(`✓ Video rendered: ${renderResult}`);

    // 5. Guardar metadata
    const metadata = {
      testId,
      timestamp: new Date().toISOString(),
      script: EXAMPLE_SCRIPT,
      engine: renderEngine,
      validationMode: process.env.VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH === 'true',
      files: {
        video: videoPath,
        audio: finalAudioPath,
      },
      status: 'ready',
    };

    fs.writeFileSync(
      path.join(outputDir, 'test-metadata.json'),
      JSON.stringify(metadata, null, 2)
    );
    logger.info(`✓ Metadata saved`);

    // 6. Resumen
    logger.info('\n═══════════════════════════════════════════════════');
    logger.info('  TEST COMPLETE');
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`\nOutput folder: ${outputDir}`);
    logger.info(`Video file: output.mp4`);
    logger.info(`Audio file: voice_proc.mp3`);
    logger.info(`Metadata: test-metadata.json`);
    logger.info(`\n✓ Video generated with engine: ${renderEngine}`);
    logger.info(`✓ Validation mode: ${process.env.VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH === 'true' ? 'ON (no auto-publish)' : 'OFF'}`);
    logger.info(`✓ Watch video: ${videoPath}`);
    logger.info(`\nTo change engine:\n  export VIDEO_RENDER_ENGINE=shorts (or current, or video_use)\n  npm run render:test\n`);

  } catch (error) {
    logger.error(`\n✗ TEST FAILED`);
    logger.error(`Error: ${error.message}`);
    logger.error(`\nTroubleshooting:\n  1. Check VIDEO_RENDER_ENGINE=${process.env.VIDEO_RENDER_ENGINE}`);
    logger.error(`  2. Check TTS (Kokoro/Edge) is working`);
    logger.error(`  3. Check FFmpeg is in PATH`);
    if (error.stack) logger.error(`\n${error.stack}`);
    process.exit(1);
  }
}

// Ejecutar
runTest().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
