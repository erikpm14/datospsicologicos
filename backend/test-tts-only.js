require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('./src/utils/logger');

async function testTTSOnly() {
  try {
    const script = {
      id: 'tts_test',
      hook: 'Tu potencial es infinito',
      claim: 'Tienes todo lo que necesitas dentro',
      explanation: 'Tu potencial es infinito y tienes todo lo que necesitas dentro de ti. Cada día es una nueva oportunidad para avanzar y crecer. Eres más capaz de lo que crees posible. No importa cuántas veces hayas caído, siempre puedes levantarte de nuevo. Tú puedes lograrlo.',
      cta: 'Avanza hoy',
      topic: 'resilience',
      themeId: 'psychology_dark',
      content_version: 'v2',
    };

    const videoId = `tts_test_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const outputDir = path.join('./output', videoId);

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    logger.info(`[TTSTest] Testing Kokoro TTS: ${videoId}`);

    const { synthesizeVoice } = require('./src/services/voice-synthesizer');
    const audioResult = await synthesizeVoice(script, path.join(outputDir, 'voice'));

    console.log(JSON.stringify({
      success: true,
      videoId,
      audioPath: audioResult.audioPath,
      estimatedDuration: audioResult.estimatedDuration,
      wordCount: audioResult.wordCount,
      provider: audioResult.provider,
      narrationPlanBlocks: audioResult.narrationPlan?.blocks?.length,
      sectionDurations: Object.keys(audioResult.sectionDurations || {}).length
    }, null, 2));

    process.exit(0);
  } catch (err) {
    logger.error(`[TTSTest] Error: ${err.message}`);
    console.error(JSON.stringify({
      success: false,
      error: err.message
    }));
    process.exit(1);
  }
}

testTTSOnly();
