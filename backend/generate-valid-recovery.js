#!/usr/bin/env node
/**
 * Generate valid recovery video with all fixes applied
 * FIX #1-5: All content coherence validators enabled
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./src/utils/logger');

async function generateValid() {
  try {
    // Use proven working script
    const script = {
      id: 'valid_recovery',
      hook: 'Somos más fuertes de lo que creemos',
      claim: 'Tu mente es capaz de superar cualquier obstáculo',
      explanation: 'Somos más fuertes de lo que creemos. Tu mente es capaz de superar cualquier obstáculo. Cada desafío que enfrentas te construye. No estás solo en esto. Tu fuerza está dentro de ti.',
      cta: 'Descúbrete',
      topic: 'resilience',
      themeId: 'psychology_dark',
      content_version: 'v2',
      viralityScore: 78,
      duration: 26
    };

    const videoId = `valid_recovery_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const outputDir = path.join('./output', videoId);

    logger.info(`[ValidRecovery] Generating: ${videoId}`);

    // Clean and create fresh directory
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
    logger.info(`[ValidRecovery] Fresh directory: ${outputDir}`);

    // Save script
    fs.writeFileSync(
      path.join(outputDir, 'script.json'),
      JSON.stringify(script, null, 2)
    );

    // Synthesize audio
    logger.info(`[ValidRecovery] Synthesizing audio...`);
    const { synthesizeVoice } = require('./src/services/voice-synthesizer');
    const audioResult = await synthesizeVoice(script, path.join(outputDir, 'voice'));
    const audioPath = audioResult?.outputPath || path.join(outputDir, 'voice.wav');
    logger.info(`[ValidRecovery] Audio: ${audioPath}`);

    // Render video
    logger.info(`[ValidRecovery] Rendering video...`);
    const { renderVideoWithRouter } = require('./src/services/render-engines');
    const videoPath = path.join(outputDir, 'output.mp4');
    await renderVideoWithRouter({
      script,
      audioPath,
      outputPath: videoPath,
      outputDir,
      audioDuration: script.duration || 26,
      themeId: 'psychology_dark'
    });

    // Validate QC
    logger.info(`[ValidRecovery] Running QC validation...`);
    const { checkProductionQuality } = require('./src/services/production-quality-checker');
    const qcResult = await checkProductionQuality(outputDir, script);

    logger.info(`[ValidRecovery] QC: score=${qcResult.score}, passed=${qcResult.passed}`);

    if (!qcResult.passed) {
      console.error(JSON.stringify({
        status: 'FAILED',
        videoId,
        reason: 'QC failed',
        issues: qcResult.reasons,
        score: qcResult.score
      }));
      process.exit(1);
    }

    // Publish
    logger.info(`[ValidRecovery] Publishing to YouTube...`);
    const { publishToYouTube } = require('./src/services/publisher');
    const publishResult = await publishToYouTube(videoPath, script);

    const youtubeUrl = publishResult?.url || publishResult?.youtubeUrl || 'unknown';

    console.log(JSON.stringify({
      status: 'SUCCESS',
      videoId,
      youtubeUrl,
      qcScore: qcResult.score,
      qcPassed: true,
      timestamp: new Date().toISOString()
    }, null, 2));

    process.exit(0);
  } catch (err) {
    logger.error(`[ValidRecovery] Error: ${err.message}`);
    console.error(JSON.stringify({
      status: 'ERROR',
      reason: err.message
    }));
    process.exit(1);
  }
}

generateValid();
