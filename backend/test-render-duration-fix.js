#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./src/utils/logger');
const { spawn } = require('child_process');

async function getVideoDuration(videoPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(videoPath)) {
      resolve(0);
      return;
    }
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1:nokey=1',
      videoPath
    ], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    ffprobe.stdout.on('data', (data) => { output += data.toString(); });
    ffprobe.on('close', () => {
      const duration = parseFloat(output.trim()) || 0;
      resolve(duration);
    });
  });
}

async function testRenderDurationFix() {
  try {
    const script = {
      id: 'render_test',
      hook: 'Tu potencial es infinito',
      claim: 'Tienes todo lo que necesitas dentro',
      explanation: 'Tu potencial es infinito y tienes todo lo que necesitas dentro de ti. Cada día es una nueva oportunidad para avanzar y crecer. Eres más capaz de lo que crees posible. No importa cuántas veces hayas caído, siempre puedes levantarte de nuevo. Tú puedes lograrlo.',
      cta: 'Avanza hoy',
      topic: 'resilience',
      themeId: 'psychology_dark',
      content_version: 'v2',
    };

    const videoId = `render_fix_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const outputDir = path.join('./output', videoId);

    logger.info(`[RenderDurationFix] Testing: ${videoId}`);

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2));

    logger.info(`[RenderDurationFix] Synthesizing audio...`);
    const { synthesizeVoice } = require('./src/services/voice-synthesizer');
    const audioResult = await synthesizeVoice(script, path.join(outputDir, 'voice'));
    const audioPath = audioResult?.audioPath || audioResult?.outputPath || path.join(outputDir, 'voice.wav');
    const actualAudioDuration = audioResult?.estimatedDuration || 24;

    logger.info(`[RenderDurationFix] Audio: ${actualAudioDuration.toFixed(2)}s`);

    logger.info(`[RenderDurationFix] Rendering video with fixed -t parameter...`);
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
    } catch (err) {
      logger.warn(`[RenderDurationFix] Render error (may be expected): ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check video duration
    const videoDuration = await getVideoDuration(videoPath);
    logger.info(`[RenderDurationFix] Video duration: ${videoDuration.toFixed(2)}s`);

    const result = {
      videoId,
      audioDuration: actualAudioDuration,
      videoDuration,
      renderDurationFixed: Math.abs(videoDuration - actualAudioDuration) < 1.0,
      isTruncated: videoDuration < 5,
      ffprobePass: videoDuration > 0,
    };

    logger.info(`[RenderDurationFix] Result: ${JSON.stringify(result)}`);

    console.log('\n[RENDER DURATION FIX TEST]');
    console.log(JSON.stringify(result, null, 2));

    process.exit(0);
  } catch (err) {
    logger.error(`[RenderDurationFix] Error: ${err.message}`);
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }
}

testRenderDurationFix();
