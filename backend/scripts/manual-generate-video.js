#!/usr/bin/env node
/**
 * GENERACIÓN MANUAL DE VÍDEO
 *
 * Genera un vídeo nuevo para publicación manual tardía.
 * No genera en horario de slot — totalmente independiente.
 * Respeta límite LLM pero no bloquea si el scheduler está funcionando.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const logger = require('../src/utils/logger');
const { generateScript } = require('../src/services/content-generator');
const { addVideoToQueue } = require('../src/queue/video-processor');
const { selectBackground, generateBackgroundTimeline } = require('../src/services/background-diversity.service');
const { checkScriptDiversity } = require('../src/services/script-diversity-gate.service');

async function main() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║        MANUAL VIDEO GENERATION                ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  console.log('[MANUAL_GENERATION_STARTED]');
  logger.info('[MANUAL_GENERATION_STARTED] — Manual video generation triggered');

  try {
    // Step 1: Queue a new video for generation
    console.log('[STEP_1_QUEUE] Adding video to generation queue...');
    logger.info('[MANUAL_GENERATION_STEP_1] Adding video to queue');

    const queueEntry = await addVideoToQueue({
      topic: null, // Let decision engine choose
      manual: true,
      source: 'manual-generation',
    });

    console.log('[STEP_2_WAIT] Waiting for video to generate...');
    logger.info('[MANUAL_GENERATION_STEP_2] Waiting for generation to complete');

    // Wait for generation to complete (polling)
    const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './backend/output-fase1-test');
    const maxWaitSeconds = 120; // 2 minutes timeout
    const startTime = Date.now();

    let generatedVideoId = null;
    let generationComplete = false;

    // Poll for output files
    const pollInterval = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

      // Check if any recent directory has script.json and output.mp4
      // Ignore rejected/ folders
      const dirs = fs.readdirSync(OUTPUT_DIR)
        .filter(d => {
          if (d === 'rejected' || d.startsWith('.')) return false;
          return fs.statSync(path.join(OUTPUT_DIR, d)).isDirectory();
        })
        .sort((a, b) => {
          const statA = fs.statSync(path.join(OUTPUT_DIR, a));
          const statB = fs.statSync(path.join(OUTPUT_DIR, b));
          return statB.mtime - statA.mtime;
        });

      for (const videoId of dirs.slice(0, 5)) {
        const videoDir = path.join(OUTPUT_DIR, videoId);
        const scriptPath = path.join(videoDir, 'script.json');
        const mp4Path = path.join(videoDir, 'output.mp4');

        if (fs.existsSync(scriptPath) && fs.existsSync(mp4Path)) {
          try {
            const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
            const stats = fs.statSync(mp4Path);

            if (stats.size > 100 * 1024 && script.hook) {
              generatedVideoId = videoId;
              generationComplete = true;
              clearInterval(pollInterval);
              return;
            }
          } catch {}
        }
      }

      if (elapsedSeconds > maxWaitSeconds) {
        clearInterval(pollInterval);
        console.log(`[MANUAL_GENERATION_TIMEOUT] No video generated after ${maxWaitSeconds}s`);
        logger.error('[MANUAL_GENERATION_TIMEOUT] Generation did not complete in time');
        process.exit(1);
      }
    }, 2000);

    // Wait for generation
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (generationComplete) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });

    if (!generatedVideoId) {
      console.log('[MANUAL_GENERATION_FAILED] No video generated');
      logger.error('[MANUAL_GENERATION_FAILED] Generation process did not produce output');
      process.exit(1);
    }

    // Load generated video
    const videoDir = path.join(OUTPUT_DIR, generatedVideoId);
    const scriptPath = path.join(videoDir, 'script.json');
    const mp4Path = path.join(videoDir, 'output.mp4');

    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    const stats = fs.statSync(mp4Path);

    console.log('[MANUAL_GENERATION_COMPLETED]');
    console.log(`  VideoId: ${generatedVideoId}`);
    console.log(`  Hook: ${(script.hook || '').substring(0, 60)}...`);
    console.log(`  Topic: ${script.topic || 'unknown'}`);
    console.log(`  Virality: ${script.viralityScore || 0}`);
    console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);

    logger.info(`[MANUAL_GENERATION_COMPLETED] videoId=${generatedVideoId} | hook=${script.hook} | virality=${script.viralityScore}`);

    // SCRIPT DIVERSITY GATE — Verificar si el script es demasiado parecido a publicados/rechazados
    console.log('[SCRIPT_DIVERSITY_GATE_CHECK]');
    const diversityCheck = await checkScriptDiversity(script, { videoId: generatedVideoId, verbose: false });

    if (!diversityCheck.passed) {
      console.log('[SCRIPT_DIVERSITY_GATE_FAILED] Moving to rejected/scripts-too-similar');
      logger.warn(`[SCRIPT_DIVERSITY_GATE_FAILED] videoId=${generatedVideoId}`);

      // Mover vídeo a carpeta rejected
      const rejectedDir = path.join(OUTPUT_DIR, '../rejected/scripts-too-similar');
      const rejectedVideoDir = path.join(rejectedDir, generatedVideoId);

      if (!fs.existsSync(rejectedDir)) {
        fs.mkdirSync(rejectedDir, { recursive: true });
      }

      // Mover directorios
      try {
        if (fs.existsSync(rejectedVideoDir)) {
          fs.rmSync(rejectedVideoDir, { recursive: true });
        }
        fs.renameSync(videoDir, rejectedVideoDir);
        console.log('[VIDEO_REJECTED_MOVED]');
      } catch (moveErr) {
        logger.error(`[VIDEO_REJECT_MOVE_FAILED] ${moveErr.message}`);
      }

      console.log('[SCRIPT_DIVERSITY_GATE_REJECTION_COMPLETE]');
      console.log(`Reasons:\n${diversityCheck.reasons.map(r => `  - ${r}`).join('\n')}`);
      process.exit(0);
    }

    console.log('[SCRIPT_DIVERSITY_GATE_PASS] Script diversity check passed');
    logger.info(`[SCRIPT_DIVERSITY_GATE_PASS] videoId=${generatedVideoId} diversityScore=${diversityCheck.metadata.diversityScore}`);

    // Select background for diversity
    console.log('[BACKGROUND_SELECTION_STARTING]');
    const backgroundSelection = selectBackground(generatedVideoId);

    // Generate internal background rotation timeline
    console.log('[INTERNAL_ROTATION_STARTING]');
    const backgroundTimeline = generateBackgroundTimeline(generatedVideoId, 15);

    // Save generation metadata
    const metadataPath = path.join(videoDir, 'generation-metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      generationType: 'manual',
      hook: script.hook,
      topic: script.topic,
      viralityScore: script.viralityScore,
      backgroundPlan: backgroundSelection.success && backgroundTimeline.success ? {
        primaryCategory: backgroundSelection.selected.category,
        selectedAssets: backgroundTimeline.plan.selectedAssets,
        usedCategories: backgroundTimeline.plan.usedCategories,
        clipTimeline: backgroundTimeline.plan.clipTimeline,
        transitionTypes: backgroundTimeline.plan.transitionTypes,
        diversityScore: backgroundTimeline.plan.diversityScore,
        numClips: backgroundTimeline.plan.numClips,
      } : null,
    }, null, 2));

    console.log('[MANUAL_GENERATION_NO_LLM_BLOCKED] Video generated successfully\n');
    process.exit(0);

  } catch (err) {
    console.log(`[MANUAL_GENERATION_FAILED] ${err.message}`);
    logger.error(`[MANUAL_GENERATION_FAILED] ${err.message}`, err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[MANUAL_GENERATION_CRASHED] ${err.message}`);
  logger.error(`[MANUAL_GENERATION_CRASHED] ${err.message}`, err);
  process.exit(1);
});
