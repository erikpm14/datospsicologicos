#!/usr/bin/env node
require('../backend/node_modules/dotenv').config({ path: './backend/.env' });

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

process.env.VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH = 'true';
process.env.OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

const logger = require('../backend/src/utils/logger');
const { synthesizeVoice } = require('../backend/src/services/voice-synthesizer');
const { postprocessAudioSafe, getProcessedAudioPath } = require('../backend/src/services/audio-postprocess');
const { renderVideoWithRouter } = require('../backend/src/services/render-engines');
const { checkProductionQuality } = require('../backend/src/services/production-quality-checker');

const EXAMPLE_SCRIPT = {
  id: `test-${randomUUID()}`,
  title: 'El efecto Halo: tu primer error mental',
  topic: 'cognitive_biases',
  effectName: 'halo',
  hook: 'Si alguien te parece brillante en dos segundos, puede que tu cerebro ya te haya engañado.',
  open_loop: 'Y no tiene nada que ver con inteligencia real. Tiene que ver con una trampa automática de percepción.',
  micro_value: 'Se llama efecto Halo. Cuando ves un rasgo atractivo, tu mente rellena el resto con cualidades que nadie demostró.',
  escalation: 'Por eso una cara segura parece más competente, una voz bonita parece más creíble y una postura firme parece más inteligente aunque no haya pruebas.',
  reengage: 'Lo peligroso es que no decides hacerlo. Tu cerebro lo hace antes de que empieces a razonar.',
  peak: 'En milisegundos ya cambió tu juicio, tu confianza y hasta la forma en que vas a escuchar lo siguiente que esa persona diga.',
  open_ending: 'Así que la próxima vez que alguien te impresione demasiado rápido, pregúntate si estás viendo realidad o una proyección.',
  soft_cta: 'Si quieres detectar más sesgos invisibles que mueven tus decisiones sin permiso, quédate por aquí.',
  psychologicalFact: 'El efecto Halo hace que un rasgo positivo percibido contamine la evaluación del resto.',
  viralTrigger: 'curiosity',
  emotionalTrigger: 'validation',
  keywords: ['halo', 'sesgo', 'mente', 'psicología'],
  hashtags: ['#psicologia', '#mente', '#sesgo'],
  claim: 'Tu cerebro asocia un rasgo atractivo con cualidades que no fueron demostradas.',
  explanation: 'Ese atajo mental acelera el juicio social, pero también distorsiona competencia, credibilidad y confianza.',
  cta: 'Quédate para detectar más sesgos invisibles.',
  viralityScore: 72,
  formatScore: 82,
  emotionScore: 76,
  contentVersion: 'v2',
  estimatedWords: 126,
  durationSeconds: 42,
};

async function runTest() {
  logger.info('VIDEO-USE TEST | Render sin publicar');
  const testId = `test-${Date.now()}`;
  const outputDir = path.resolve(process.env.OUTPUT_DIR, 'video-use', testId);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  logger.info(`[test-video-use] output=${outputDir}`);

  const audioPathHint = path.join(outputDir, 'voice.mp3');
  const { audioPath, sectionDurations, wordBoundaries } = await synthesizeVoice(EXAMPLE_SCRIPT, audioPathHint);

  const processedAudioPath = getProcessedAudioPath(audioPath);
  const { audioPath: finalAudioPath } = await postprocessAudioSafe(audioPath, processedAudioPath);

  const videoPath = path.join(outputDir, 'output.mp4');
  const renderResult = await renderVideoWithRouter({
    script: EXAMPLE_SCRIPT,
    audioPath: finalAudioPath,
    audioDuration: EXAMPLE_SCRIPT.durationSeconds,
    outputPath: videoPath,
    themeId: 'dark_psychology',
    wordBoundaries,
    sectionDurations,
  });

  const qcResult = await checkProductionQuality(outputDir, EXAMPLE_SCRIPT);

  const metadata = {
    testId,
    timestamp: new Date().toISOString(),
    engine: 'video_use',
    blockedPublish: true,
    qcResult,
    files: {
      video: videoPath,
      audio: finalAudioPath,
    },
  };

  fs.writeFileSync(path.join(outputDir, 'test-metadata.json'), JSON.stringify(metadata, null, 2));

  logger.info(`[test-video-use] video=${renderResult.videoPath}`);
  logger.info(`[test-video-use] qc_passed=${qcResult.passed} score=${qcResult.score}`);
}

runTest().catch((error) => {
  logger.error(`[test-video-use] failed: ${error.message}`);
  process.exit(1);
});
