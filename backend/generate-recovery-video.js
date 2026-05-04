require('dotenv').config();
const { generateBestScript } = require('../content-engine/decision-engine');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { renderVideoWithRouter } = require('./src/services/render-engines');
const { checkProductionQuality } = require('./src/services/production-quality-checker');
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');

async function generateRecovery() {
  try {
    logger.info('[Recovery] Iniciando generación de vídeo de recuperación');

    // 1. Generar script
    const script = await generateBestScript();
    const videoId = 'recovery_' + Date.now();
    const dir = path.join('./output', videoId);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    script.id = videoId;
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(script, null, 2));

    // 2. Audio
    const audioPath = path.join(dir, 'voice.mp3');
    logger.info('[Recovery] Sintetizando audio...');
    await synthesizeVoice({
      text: script.explanation || script.hook || 'Video de recuperación',
      outputPath: audioPath
    });

    // 3. Render
    const videoPath = path.join(dir, 'output.mp4');
    logger.info('[Recovery] Renderizando vídeo...');
    await renderVideoWithRouter({
      script,
      audioPath,
      outputPath: videoPath,
      audioDuration: 30,
      themeId: 'psychology_dark',
      wordBoundaries: [],
      sectionDurations: []
    });

    // 4. QC
    logger.info('[Recovery] Validando QC...');
    const qc = await checkProductionQuality(dir, script);

    const result = {
      videoId,
      videoPath,
      passed: qc.passed,
      score: qc.score,
      threshold: qc.threshold,
      dir,
      script: { hook: script.hook, topic: script.topic }
    };

    console.log(JSON.stringify(result, null, 2));
    process.exit(qc.passed ? 0 : 1);
  } catch(err) {
    logger.error('[Recovery] Error: ' + err.message);
    console.error(JSON.stringify({ error: err.message }, null, 2));
    process.exit(1);
  }
}

generateRecovery();
