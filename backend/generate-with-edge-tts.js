#!/usr/bin/env node
/**
 * Generate video with Edge TTS fallback to avoid Kokoro render issues
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./src/utils/logger');

async function generateWithEdgeTTS() {
  try {
    // Use shorter script to ensure video renders correctly
    const script = {
      id: 'edge_tts_test',
      hook: 'Tu potencial es infinito',
      claim: 'Tienes todo lo que necesitas dentro',
      explanation: 'Tu potencial es infinito y tienes todo lo que necesitas dentro de ti. Cada día es una nueva oportunidad para avanzar y crecer. Eres más capaz de lo que crees posible. No importa cuántas veces hayas caído, siempre puedes levantarte de nuevo. Tú puedes lograrlo.',
      cta: 'Avanza hoy',
      topic: 'resilience',
      themeId: 'psychology_dark',
      content_version: 'v2',
    };

    const videoId = `edge_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const outputDir = path.join('./output', videoId);

    logger.info(`[EdgeTTSTest] Generating with Edge TTS fallback: ${videoId}`);

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(
      path.join(outputDir, 'script.json'),
      JSON.stringify(script, null, 2)
    );

    logger.info(`[EdgeTTSTest] Synthesizing audio (Edge TTS)...`);
    const { synthesizeVoice } = require('./src/services/voice-synthesizer');
    const audioResult = await synthesizeVoice(script, path.join(outputDir, 'voice'));
    const audioPath = audioResult?.audioPath || audioResult?.outputPath || path.join(outputDir, 'voice.wav');
    const actualAudioDuration = audioResult?.estimatedDuration || 26;

    logger.info(`[EdgeTTSTest] Audio synthesized: ${actualAudioDuration.toFixed(2)}s, provider=${audioResult.provider}`);

    logger.info(`[EdgeTTSTest] Rendering video...`);
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
      logger.warn(`[EdgeTTSTest] Render error (non-fatal): ${renderErr.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    logger.info(`[EdgeTTSTest] Running QC...`);
    const { checkProductionQuality } = require('./src/services/production-quality-checker');
    const qcResult = await checkProductionQuality(outputDir, script);

    const result = {
      videoId,
      audioDuration: actualAudioDuration,
      videoDuration: qcResult.checks.publishableFile?.duration || 0,
      ttsProvider: audioResult.provider,
      qcPass: qcResult.passed,
      qcScore: qcResult.score,
      issues: qcResult.reasons.slice(0, 5),
    };

    console.log('\n[RESULT]');
    console.log(JSON.stringify(result, null, 2));

    process.exit(0);
  } catch (err) {
    logger.error(`[EdgeTTSTest] Error: ${err.message}`);
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }
}

generateWithEdgeTTS();
