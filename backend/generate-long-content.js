#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./src/utils/logger');

async function generateLongContent() {
  try {
    const script = {
      id: 'long_content',
      hook: 'Tu potencial es infinito',
      claim: 'Tienes todo lo que necesitas dentro de ti',
      explanation: `Tu potencial es infinito y tienes todo lo que necesitas dentro de ti. Cada día es una nueva oportunidad para avanzar y crecer. Eres más capaz de lo que crees posible. No importa cuántas veces hayas caído, siempre puedes levantarte de nuevo. Tu fuerza viene de adentro, no de afuera. Tú decides qué significa el éxito. Tú decides cuándo rendirte, y la respuesta es nunca. Cree en ti, porque el mundo necesita tu luz. Nadie es más fuerte que tú. Nadie es más inteligente que tú. Nadie puede detenerte excepto tú mismo. Así que hoy, en este momento, decide que vas a avanzar. Decide que vas a crecer. Decide que vas a lograr tus metas. Porque el mundo está esperando tu mejor versión. Tu familia necesita tu mejor versión. Tú necesitas tu mejor versión. No es tarde. No es imposible. Tú puedes. Tú puedes lograrlo.`,
      cta: 'Avanza hoy',
      topic: 'resilience',
      themeId: 'psychology_dark',
      content_version: 'v2',
    };

    const videoId = `long_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const outputDir = path.join('./output', videoId);

    logger.info(`[LongContent] Generating: ${videoId}`);

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2));

    logger.info(`[LongContent] Synthesizing audio...`);
    const { synthesizeVoice } = require('./src/services/voice-synthesizer');
    const audioResult = await synthesizeVoice(script, path.join(outputDir, 'voice'));
    const audioPath = audioResult?.audioPath || audioResult?.outputPath || path.join(outputDir, 'voice.wav');
    const actualAudioDuration = audioResult?.estimatedDuration || 32;

    logger.info(`[LongContent] Audio: ${actualAudioDuration.toFixed(2)}s, provider=${audioResult.provider}`);

    logger.info(`[LongContent] Rendering video...`);
    const { renderVideoWithRouter } = require('./src/services/render-engines');
    const videoPath = path.join(outputDir, 'output.mp4');
    
    try {
      await renderVideoWithRouter({
        script,
        audioPath,
        outputPath: videoPath,
        outputDir,
        audioDuration: actualAudioDuration,
        themeId: 'psychology_dark'
      });
    } catch (renderErr) {
      logger.error(`[LongContent] Render error: ${renderErr.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const { checkProductionQuality } = require('./src/services/production-quality-checker');
    const qcResult = await checkProductionQuality(outputDir, script);

    console.log(JSON.stringify({
      videoId,
      audioDuration: actualAudioDuration,
      videoDuration: qcResult.checks.publishableFile?.duration || 0,
      qcPass: qcResult.passed,
    }, null, 2));

    process.exit(0);
  } catch (err) {
    logger.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

generateLongContent();
