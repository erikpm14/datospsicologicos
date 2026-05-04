#!/usr/bin/env node
/**
 * Generador rápido de vídeo para recuperación de slot 14:00
 * - Genera 1 vídeo válido AHORA
 * - Valida QC
 * - Publica en YouTube
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./src/utils/logger');

// Scripts de recuperación rápida (ya probados)
const RECOVERY_SCRIPTS = [
  {
    id: 'recovery_1',
    hook: 'Guardo lo que siento sin decirlo',
    claim: 'Es un patrón que reconoces en ti',
    explanation: 'Guardo lo que siento sin decirlo. Es un patrón que reconoces en ti. Esperas que alguien note tu silencio. Por eso duele cuando nadie pregunta. Eres válido aunque no hables.',
    cta: 'Reconócete',
    topic: 'emotional_suppression',
    themeId: 'psychology_dark',
    content_version: 'v2',
    viralityScore: 80,
    duration: 28
  }
];

async function generateRecovery() {
  try {
    const script = RECOVERY_SCRIPTS[0];
    const videoId = `recovery_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const outputDir = path.join('./output', videoId);

    logger.info(`[Recovery] Generating: ${videoId}`);
    logger.info(`[Recovery] Hook: "${script.hook}"`);

    // FIX #4: FORCE FRESH RENDER - Clean directory if it somehow exists
    if (fs.existsSync(outputDir)) {
      logger.warn(`[Recovery] Directory already exists (stale?), removing: ${outputDir}`);
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
    logger.info(`[Recovery] Fresh directory created: ${outputDir}`);

    // Guardar metadata
    fs.writeFileSync(
      path.join(outputDir, 'script.json'),
      JSON.stringify({
        ...script,
        id: videoId,
        createdAt: new Date().toISOString(),
        renderMode: 'video_use'
      }, null, 2)
    );

    // Síntesis de audio (pass complete script object, not just text)
    logger.info(`[Recovery] Synthesizing audio...`);
    const { synthesizeVoice } = require('./src/services/voice-synthesizer');
    const audioResult = await synthesizeVoice(script, path.join(outputDir, 'voice'));

    // synthesizeVoice returns the path with extension (could be .wav or .mp3)
    const actualAudioPath = audioResult?.outputPath || audioResult?.path || path.join(outputDir, 'voice.wav');
    logger.info(`[Recovery] Audio created: ${actualAudioPath}`);

    // Renderizar
    logger.info(`[Recovery] Rendering video...`);
    const { renderVideoWithRouter } = require('./src/services/render-engines');
    const videoPath = path.join(outputDir, 'output.mp4');
    await renderVideoWithRouter({
      script,
      audioPath: actualAudioPath,
      outputPath: videoPath,
      outputDir,
      audioDuration: script.duration || 28,
      themeId: 'psychology_dark'
    });

    // Validar QC
    logger.info(`[Recovery] Validating QC...`);
    const { checkProductionQuality } = require('./src/services/production-quality-checker');
    const qcResult = await checkProductionQuality(outputDir, script);

    logger.info(`[Recovery] QC Result: passed=${qcResult.passed}, score=${qcResult.score}`);

    if (!qcResult.passed) {
      logger.error(`[Recovery] QC FAILED - aborting`);
      console.error(JSON.stringify({
        recoveryPublishExecuted: false,
        reason: 'QC failed: ' + qcResult.reasons.join(', ')
      }));
      process.exit(1);
    }

    // Publicar en YouTube
    logger.info(`[Recovery] Publishing to YouTube...`);
    const { publishToYouTube } = require('./src/services/publisher');
    const publishResult = await publishToYouTube(videoPath, script);

    console.log(JSON.stringify({
      recoveryPublishExecuted: true,
      videoId,
      qcPass: true,
      youtubeUrl: publishResult.url,
      usedExistingVideo: false,
      fallbackGenerated: false,
      schedulerUnaffected: true,
      timestamp: new Date().toISOString()
    }, null, 2));

    process.exit(0);
  } catch (err) {
    logger.error(`[Recovery] Failed: ${err.message}`);
    console.error(JSON.stringify({
      recoveryPublishExecuted: false,
      reason: err.message
    }));
    process.exit(1);
  }
}

generateRecovery();
