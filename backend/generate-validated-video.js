#!/usr/bin/env node
/**
 * Generate fully validated video with complete TTS fix
 * All QC gates must pass: audio duration, video duration, coherence, hook presence
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./src/utils/logger');

async function generateValidated() {
  try {
    // Extended script for 30+ seconds of video
    const baseScript = {
      id: 'validated_video',
      hook: 'Tu potencial es infinito',
      claim: 'Tienes todo lo que necesitas dentro',
      explanation: 'Tu potencial es infinito y tienes todo lo que necesitas dentro de ti. Cada día es una nueva oportunidad para avanzar y crecer. Eres más capaz de lo que crees posible. No importa cuántas veces hayas caído, siempre puedes levantarte de nuevo. Tu fuerza viene de adentro, no de afuera. Tú decides qué significa el éxito. Tú decides cuándo rendirte, y la respuesta es nunca. Cree en ti, porque el mundo necesita tu luz. Tú puedes lograrlo.',
      cta: 'Avanza hoy',
      topic: 'resilience',
      themeId: 'psychology_dark',
      viralityScore: 78,
    };

    const script = {
      ...baseScript,
      content_version: 'v2',
      duration: 32,
    };

    const videoId = `validated_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const outputDir = path.join('./output', videoId);

    logger.info(`[ValidatedVideo] Generating: ${videoId}`);
    logger.info(`[ValidatedVideo] Script duration target: ${script.duration}s`);

    // Fresh directory
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    // Save script
    fs.writeFileSync(
      path.join(outputDir, 'script.json'),
      JSON.stringify(script, null, 2)
    );
    logger.info(`[ValidatedVideo] Script saved`);

    // Synthesize audio
    logger.info(`[ValidatedVideo] Synthesizing audio...`);
    const { synthesizeVoice } = require('./src/services/voice-synthesizer');
    const audioResult = await synthesizeVoice(script, path.join(outputDir, 'voice'));
    const audioPath = audioResult?.audioPath || audioResult?.outputPath || path.join(outputDir, 'voice.wav');
    const actualAudioDuration = audioResult?.estimatedDuration || script.duration;
    logger.info(`[ValidatedVideo] Audio synthesized: ${actualAudioDuration.toFixed(2)}s, provider=${audioResult.provider}`);

    // Render video
    logger.info(`[ValidatedVideo] Rendering video...`);
    const { renderVideoWithRouter } = require('./src/services/render-engines');
    const videoPath = path.join(outputDir, 'output.mp4');
    await renderVideoWithRouter({
      script,
      audioPath,
      outputPath: videoPath,
      outputDir,
      audioDuration: actualAudioDuration,
      themeId: 'psychology_dark'
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Run QC validation
    logger.info(`[ValidatedVideo] Running comprehensive QC...`);
    const { checkProductionQuality } = require('./src/services/production-quality-checker');
    const qcResult = await checkProductionQuality(outputDir, script);

    logger.info(`[ValidatedVideo] QC Complete: score=${qcResult.score}, passed=${qcResult.passed}`);

    // Detailed validation
    console.log('\n[QC CHECKS]');
    console.log(JSON.stringify({
      audioExists: qcResult.checks.audioExists?.ok || false,
      audioDuration: {
        ok: qcResult.checks.audioDuration?.ok || false,
        duration: qcResult.checks.audioDuration?.duration,
        source: qcResult.checks.audioDuration?.source,
      },
      videoExists: qcResult.checks.videoExists?.ok || false,
      renderVisuals: qcResult.checks.renderVisuals?.ok || false,
      subtitleScriptCoherence: {
        ok: qcResult.checks.subtitleScriptCoherence?.ok || false,
        score: qcResult.checks.subtitleScriptCoherence?.score,
      },
      hookAudioPresence: {
        ok: qcResult.checks.hookAudioPresence?.ok || false,
        score: qcResult.checks.hookAudioPresence?.score,
      },
      publishableFile: {
        ok: qcResult.checks.publishableFile?.ok || false,
        duration: qcResult.checks.publishableFile?.duration,
      },
      packageIntegrity: qcResult.checks.packageIntegrity?.ok || false,
      blackdetect: qcResult.checks.blackdetect?.ok || false,
      subtitlesVisual: qcResult.checks.subtitlesVisual?.ok || false,
    }, null, 2));

    // Check all required criteria
    const criteria = {
      audioDuration_gt_10: (qcResult.checks.audioDuration?.duration || 0) > 10,
      videoDuration_gte_15: (qcResult.checks.publishableFile?.duration || 0) >= 15,
      coherence_gte_80: (qcResult.checks.subtitleScriptCoherence?.score || 0) >= 80,
      hook_presence_gte_60: (qcResult.checks.hookAudioPresence?.score || 0) >= 60,
      blackdetect_pass: qcResult.checks.blackdetect?.ok || false,
      subtitles_visual: qcResult.checks.subtitlesVisual?.ok || false,
    };

    console.log('\n[VALIDATION CRITERIA]');
    console.log(JSON.stringify(criteria, null, 2));

    const readyForPublish = Object.values(criteria).every(v => v === true) && qcResult.passed;

    if (!qcResult.passed) {
      console.log('\n[QC FAILED] Issues:');
      qcResult.reasons.forEach(r => console.log(`  - ${r}`));
    } else {
      console.log('\n✅ ALL QC GATES PASSED!');
    }

    const result = {
      videoId,
      audioDuration: qcResult.checks.audioDuration?.duration || 0,
      videoDuration: qcResult.checks.publishableFile?.duration || 0,
      qcPass: qcResult.passed,
      readyForPublish,
      criteria,
      qcScore: qcResult.score,
      issues: qcResult.reasons,
    };

    console.log('\n[FINAL RESULT]');
    console.log(JSON.stringify(result, null, 2));

    process.exit(qcResult.passed ? 0 : 1);
  } catch (err) {
    logger.error(`[ValidatedVideo] Error: ${err.message}`);
    console.error(JSON.stringify({
      success: false,
      error: err.message,
      videoId: 'unknown'
    }));
    process.exit(1);
  }
}

generateValidated();
