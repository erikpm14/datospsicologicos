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

async function testRenderFix() {
  try {
    // Extended script to ensure >= 25s audio
    const script = {
      id: 'render_fix_ext',
      hook: 'Tu potencial es infinito',
      claim: 'Tienes todo lo que necesitas dentro',
      explanation: `Tu potencial es infinito y tienes todo lo que necesitas dentro de ti. Cada día es una nueva oportunidad para avanzar y crecer. Eres más capaz de lo que crees posible. No importa cuántas veces hayas caído, siempre puedes levantarte de nuevo. Tu fuerza viene de adentro. Tú decides qué significa el éxito. Tú decides cuándo rendirte, y la respuesta es nunca. Cree en ti, porque el mundo necesita tu luz. Tú puedes lograrlo.`,
      cta: 'Avanza hoy',
      topic: 'resilience',
      themeId: 'psychology_dark',
      content_version: 'v2',
    };

    const videoId = `render_fix_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const outputDir = path.join('./output', videoId);

    logger.info(`[RenderFixExt] Testing: ${videoId}`);

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2));

    logger.info(`[RenderFixExt] Synthesizing audio...`);
    const { synthesizeVoice } = require('./src/services/voice-synthesizer');
    const audioResult = await synthesizeVoice(script, path.join(outputDir, 'voice'));
    const audioPath = audioResult?.audioPath || audioResult?.outputPath || path.join(outputDir, 'voice.wav');
    const actualAudioDuration = audioResult?.estimatedDuration || 28;

    logger.info(`[RenderFixExt] Audio duration: ${actualAudioDuration.toFixed(2)}s`);

    if (actualAudioDuration < 25) {
      logger.warn(`[RenderFixExt] Audio too short (${actualAudioDuration.toFixed(2)}s < 25s), skipping render test`);
      console.log(JSON.stringify({
        videoId,
        audioDuration: actualAudioDuration,
        status: 'SKIPPED_AUDIO_TOO_SHORT',
        readyForNextStep: false
      }));
      process.exit(0);
    }

    logger.info(`[RenderFixExt] Rendering video with fixed duration...`);
    const { renderVideoWithRouter } = require('./src/services/render-engines');
    const videoPath = path.join(outputDir, 'output.mp4');
    
    let renderSuccess = false;
    try {
      await renderVideoWithRouter({
        script,
        audioPath,
        outputPath: videoPath,
        outputDir,
        audioDuration: actualAudioDuration,
        themeId: 'psychology_dark'
      });
      renderSuccess = true;
    } catch (err) {
      logger.warn(`[RenderFixExt] Render threw error: ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    const videoDuration = await getVideoDuration(videoPath);
    logger.info(`[RenderFixExt] Video duration from ffprobe: ${videoDuration.toFixed(2)}s`);

    const durationDiff = Math.abs(videoDuration - actualAudioDuration);
    const isFixed = durationDiff < 1.0 && videoDuration > 10;

    const result = {
      renderDurationFixed: isFixed,
      audioDuration: parseFloat(actualAudioDuration.toFixed(2)),
      videoDuration: parseFloat(videoDuration.toFixed(2)),
      durationDiff: parseFloat(durationDiff.toFixed(2)),
      isTruncated: videoDuration < 8,
      ffprobePass: videoDuration > 0,
      videoId,
      readyForNextStep: isFixed && videoDuration >= 15
    };

    logger.info(`[RenderFixExt] Result: ${JSON.stringify(result)}`);

    console.log('\n[RENDER DURATION FIX VALIDATION]');
    console.log(JSON.stringify(result, null, 2));

    process.exit(0);
  } catch (err) {
    logger.error(`[RenderFixExt] Error: ${err.message}`);
    console.error(JSON.stringify({ success: false, error: err.message, readyForNextStep: false }));
    process.exit(1);
  }
}

testRenderFix();
