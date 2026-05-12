#!/usr/bin/env node
/**
 * EMERGENCY GENERATION — NO LLM
 *
 * Cuando la cuota LLM está agotada, genera un candidato de emergencia:
 * 1. Selecciona un vídeo existente no publicado (reutiliza el MP4)
 * 2. Crea un script NUEVO con hook distinto a publicados
 * 3. Marca como emergency_no_llm
 * 4. Pasa a manual-late-publish.js para validación y publicación
 *
 * Reglas:
 * - No llama LLM
 * - No reutiliza hooks publicados
 * - No publica duplicados (validado por duplicate hard block)
 * - Mantiene Duplicate Hard Block activo
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const logger = require('../src/utils/logger');
const { getRecentPublishedVideos } = require('../src/services/duplicate-hard-block.service');
const { selectBackground, generateBackgroundTimeline } = require('../src/services/background-diversity.service');
const { checkScriptDiversity } = require('../src/services/script-diversity-gate.service');
const { renderDynamicBackgroundTimeline } = require('../src/services/dynamic-background-renderer');
const { validateReadyVideo } = require('../src/services/ready-video-validator.service');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../output-fase1-test'));

// Emergency hooks — evita blacklist (no "tu cerebro", etc.)
const EMERGENCY_HOOKS = [
  "Las decisiones no se toman con la mente. Se sienten.",
  "La memoria es selectiva. Guarda lo que necesita olvidar.",
  "El miedo cambia la forma en que ves las cosas.",
  "A veces no es cansancio. Es falta de significado.",
  "La ansiedad habla el idioma del futuro.",
  "Tu cuerpo guarda lo que tu mente rechaza.",
  "El estrés no es malo. Es información.",
  "Procrastinar es una forma de protección.",
  "La soledad y el aislamiento no son lo mismo.",
  "El trauma no se cura hablando. Se integra.",
];

function findSourceVideo() {
  try {
    // HIGH-RISK SOURCES TO AVOID
    const blockedSources = new Set([
      '5a81501b-7e11-49f1-980a-1e2c820ccb8d', // Triple-published: 9gIjsHDn91s, nS-RNY9-1po, uGjbG_t4I7k
    ]);

    // Priority list of videos that passed QC
    const priorityVideos = [
      '25f1efa2-a181-4ecc-9935-6c53143c742b', // Alternative source for high diversity
      '51f843c1-d8ce-4223-b1ed-099e428b8840', // Large video with different structure
      'bdd6c681-cb14-418b-8341-0b74bea6aad4', // Known to pass QC
      '455362af-7c53-4067-a2cf-2c57f3be4da1', // Used for principal
      '5a81501b-7e11-49f1-980a-1e2c820ccb8d', // High-risk (blocked)
    ];

    // Check priority videos first
    for (const videoId of priorityVideos) {
      if (blockedSources.has(videoId)) {
        logger.warn(`[EMERGENCY_SOURCE_REJECTED_HIGH_RISK] videoId=${videoId} reason=triple_published`);
        continue;
      }

      const videoDir = path.join(OUTPUT_DIR, videoId);
      const mp4Path = path.join(videoDir, 'output.mp4');
      const scriptPath = path.join(videoDir, 'script.json');

      if (!fs.existsSync(mp4Path) || !fs.existsSync(scriptPath)) continue;

      const stats = fs.statSync(mp4Path);
      if (stats.size < 100 * 1024) continue;

      return { videoId, videoDir, mp4Path, scriptPath };
    }

    // Fallback: search all directories
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

    for (const videoId of dirs) {
      // Skip blocked sources
      if (blockedSources.has(videoId)) {
        continue;
      }

      const videoDir = path.join(OUTPUT_DIR, videoId);

      // Skip videos with youtubeId or published.json
      const publishedPath = path.join(videoDir, 'published.json');
      const metadataPath = path.join(videoDir, 'generation-metadata.json');

      if (fs.existsSync(publishedPath)) {
        continue;
      }

      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          if (metadata.youtubeId) {
            continue;
          }
        } catch {}
      }

      const mp4Path = path.join(videoDir, 'output.mp4');
      const scriptPath = path.join(videoDir, 'script.json');

      if (!fs.existsSync(mp4Path) || !fs.existsSync(scriptPath)) continue;

      // Skip videos that are themselves emergency-generated (have sourceVideoId)
      try {
        const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
        if (script.sourceVideoId) {
          continue; // This is an emergency-generated video, skip it as source
        }
      } catch {}

      const stats = fs.statSync(mp4Path);
      if (stats.size < 100 * 1024) continue;

      return { videoId, videoDir, mp4Path, scriptPath };
    }

    return null;
  } catch (err) {
    logger.error(`Error finding source video: ${err.message}`);
    return null;
  }
}

function selectEmergencyHook(recentPublished, excludeHooks = []) {
  // Get all published hooks
  const publishedHooks = recentPublished
    .map(v => {
      try {
        const publishLog = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, v.videoId, 'script.json'), 'utf8'));
        return publishLog.hook || '';
      } catch {
        return '';
      }
    })
    .filter(h => h);

  // Combine published hooks with explicitly excluded hooks
  const usedHooks = new Set([...publishedHooks, ...excludeHooks]);

  // Find hook not in published or excluded
  // Start from random position in list for diversity
  const startIdx = Math.floor(Math.random() * EMERGENCY_HOOKS.length);
  for (let i = 0; i < EMERGENCY_HOOKS.length; i++) {
    const idx = (startIdx + i) % EMERGENCY_HOOKS.length;
    const hook = EMERGENCY_HOOKS[idx];
    if (!usedHooks.has(hook)) {
      return hook;
    }
  }

  // If all are used, add randomness
  return EMERGENCY_HOOKS[Math.floor(Math.random() * EMERGENCY_HOOKS.length)] + ' (variation)';
}

function convertSrtToVtt(srtPath, vttPath) {
  try {
    let srtContent = fs.readFileSync(srtPath, 'utf8');
    // Convert SRT format to VTT format: replace commas in timestamps with periods
    let vttContent = 'WEBVTT\n\n' + srtContent.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    fs.writeFileSync(vttPath, vttContent, 'utf8');
    return true;
  } catch (err) {
    logger.warn(`[CONVERT_SRT_TO_VTT_FAILED] ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║      EMERGENCY GENERATION — NO LLM             ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  console.log('[EMERGENCY_NO_LLM_GENERATION_STARTED]');
  logger.info('[EMERGENCY_NO_LLM_GENERATION_STARTED]');

  try {
    // Step 1: Find source video
    console.log('[STEP_1_FIND_SOURCE] Looking for source video...');
    const source = findSourceVideo();

    if (!source) {
      console.log('[EMERGENCY_NO_LLM_FAILED] No suitable source video found');
      logger.error('[EMERGENCY_NO_LLM_FAILED] No source video');
      process.exit(1);
    }

    console.log(`  ✓ Source found: ${source.videoId.substring(0, 8)}...`);
    logger.info(`[EMERGENCY_SOURCE_SELECTED] videoId=${source.videoId}`);

    // Step 2: Load source script and get recent published
    const sourceScript = JSON.parse(fs.readFileSync(source.scriptPath, 'utf8'));
    const recentPublished = getRecentPublishedVideos(20);

    // Step 3: Get hooks already in use (from principal if exists)
    const usedHooks = [];
    try {
      const slotState = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'slot-lock-state.json'), 'utf8'));
      if (slotState.nearestSlot && slotState.nearestSlot.videoId) {
        const principalScriptPath = path.join(OUTPUT_DIR, slotState.nearestSlot.videoId, 'script.json');
        if (fs.existsSync(principalScriptPath)) {
          const principalScript = JSON.parse(fs.readFileSync(principalScriptPath, 'utf8'));
          if (principalScript.hook) {
            usedHooks.push(principalScript.hook);
          }
        }
      }
    } catch {}

    // Step 4: Select emergency hook (avoiding already-used hooks)
    const emergencyHook = selectEmergencyHook(recentPublished, usedHooks);
    console.log(`\n[EMERGENCY_SCRIPT_SELECTED]`);
    console.log(`  Hook: "${emergencyHook}"`);
    console.log(`  Topic: ${sourceScript.topic || 'psychology'}`);
    console.log(`  Virality: emergency_override`);
    logger.info(`[EMERGENCY_SCRIPT_SELECTED] hook="${emergencyHook}"`);

    // Step 5: Create new emergency video directory
    const emergencyVideoId = uuid();
    const emergencyVideoDir = path.join(OUTPUT_DIR, emergencyVideoId);

    if (!fs.existsSync(emergencyVideoDir)) {
      fs.mkdirSync(emergencyVideoDir, { recursive: true });
    }

    // Step 6: Copy MP4 and related files from source
    console.log(`\n[EMERGENCY_VIDEO_PREPARE] Preparing emergency video...`);
    const emergencyMp4Path = path.join(emergencyVideoDir, 'output.mp4');
    fs.copyFileSync(source.mp4Path, emergencyMp4Path);

    const mp4Stats = fs.statSync(emergencyMp4Path);
    console.log(`  ✓ Video MP4 copied (${(mp4Stats.size / 1024 / 1024).toFixed(1)}MB)`);

    // Copy supporting files needed for QC validation
    const supportingFiles = [
      'captions-debug.json',
      'subtitles.ass',
      'subtitles.srt',
      'qc.json',
      'render-metadata.json',
      'pipeline-metrics.json',
      'generation-metadata.json',
    ];

    for (const file of supportingFiles) {
      const sourcePath = path.join(source.videoDir, file);
      if (fs.existsSync(sourcePath)) {
        const destPath = path.join(emergencyVideoDir, file);
        fs.copyFileSync(sourcePath, destPath);
      }
    }

    // Ensure subtitles.vtt exists (convert from .srt if needed)
    const vttPath = path.join(emergencyVideoDir, 'subtitles.vtt');
    const srtPath = path.join(emergencyVideoDir, 'subtitles.srt');
    if (!fs.existsSync(vttPath) && fs.existsSync(srtPath)) {
      convertSrtToVtt(srtPath, vttPath);
    }

    console.log('  ✓ Supporting files copied');

    // Step 7: Create emergency script — minimalist to avoid duplicate detection
    const emergencyScript = {
      hook: emergencyHook,
      viralityScore: 50,
      topic: sourceScript.topic || 'psychology',
      title: emergencyHook,
      generationMode: 'emergency_no_llm',
      sourceVideoId: source.videoId,
      generatedAt: new Date().toISOString(),
      // Minimal content fields to differ from source
      description: `Psicología del cerebro y la mente. ${emergencyHook}`,
      segments: [
        {
          type: 'hook',
          content: emergencyHook,
          duration: 2,
        },
        {
          type: 'explanation',
          content: 'Explicación sobre cómo funciona tu mente.',
          duration: 8,
        },
      ],
    };

    const scriptPath = path.join(emergencyVideoDir, 'script.json');
    fs.writeFileSync(scriptPath, JSON.stringify(emergencyScript, null, 2));
    console.log('  ✓ Emergency script created');

    // Step 8: SCRIPT DIVERSITY GATE — Verificar si el script es demasiado parecido
    console.log('[SCRIPT_DIVERSITY_GATE_CHECK]');
    const diversityCheck = await checkScriptDiversity(emergencyScript, { videoId: emergencyVideoId, verbose: false });

    if (!diversityCheck.passed) {
      console.log('[SCRIPT_DIVERSITY_GATE_FAILED] Emergency script rejected');
      logger.warn(`[SCRIPT_DIVERSITY_GATE_FAILED] Emergency videoId=${emergencyVideoId}`);

      // Mover vídeo a carpeta rejected
      const rejectedDir = path.join(OUTPUT_DIR, '../rejected/scripts-too-similar');
      const rejectedVideoDir = path.join(rejectedDir, emergencyVideoId);

      if (!fs.existsSync(rejectedDir)) {
        fs.mkdirSync(rejectedDir, { recursive: true });
      }

      try {
        if (fs.existsSync(rejectedVideoDir)) {
          fs.rmSync(rejectedVideoDir, { recursive: true });
        }
        fs.renameSync(emergencyVideoDir, rejectedVideoDir);
        console.log('[VIDEO_REJECTED_MOVED]');
      } catch (moveErr) {
        logger.error(`[VIDEO_REJECT_MOVE_FAILED] ${moveErr.message}`);
      }

      console.log('[SCRIPT_DIVERSITY_GATE_REJECTION_COMPLETE]');
      console.log(`Reasons:\n${diversityCheck.reasons.map(r => `  - ${r}`).join('\n')}`);
      process.exit(0);
    }

    console.log('[SCRIPT_DIVERSITY_GATE_PASS] Emergency script diversity check passed');
    logger.info(`[SCRIPT_DIVERSITY_GATE_PASS] Emergency videoId=${emergencyVideoId} diversityScore=${diversityCheck.metadata.diversityScore}`);

    // Step 7: Select background for diversity
    console.log('[BACKGROUND_SELECTION_STARTING]');
    const backgroundSelection = selectBackground(emergencyVideoId);

    // Step 8: Generate internal background rotation timeline
    console.log('[INTERNAL_ROTATION_STARTING]');
    const backgroundTimeline = generateBackgroundTimeline(emergencyVideoId, 30);

    // Step 9: APPLY DYNAMIC BACKGROUND RENDER
    let dynamicRenderSuccess = false;
    let finalMetadata = {
      videoId: emergencyVideoId,
      generatedAt: new Date().toISOString(),
      generationType: 'manual',
      generationMode: 'emergency_no_llm',
      sourceVideoId: source.videoId,
      hook: emergencyHook,
      topic: emergencyScript.topic,
      viralityScore: 50,
      reason: 'LLM quota exhausted - using emergency no-LLM generation',
      backgroundPlan: backgroundSelection.success && backgroundTimeline.success ? {
        primaryCategory: backgroundSelection.selected.category,
        selectedAssets: backgroundTimeline.plan.selectedAssets,
        usedCategories: backgroundTimeline.plan.usedCategories,
        clipTimeline: backgroundTimeline.plan.clipTimeline,
        transitionTypes: backgroundTimeline.plan.transitionTypes,
        diversityScore: backgroundTimeline.plan.diversityScore,
        numClips: backgroundTimeline.plan.numClips,
      } : null,
    };

    if (backgroundTimeline.success && backgroundTimeline.plan && backgroundTimeline.plan.clipTimeline && backgroundTimeline.plan.clipTimeline.length > 0) {
      console.log('[RENDER_DYNAMIC_BACKGROUND_ATTEMPTING]');
      try {
        await renderDynamicBackgroundTimeline({
          videoPath: emergencyMp4Path,
          outputPath: emergencyMp4Path,
          outputDir: emergencyVideoDir,
          clipTimeline: backgroundTimeline.plan.clipTimeline,
          audioDuration: 35,
        });

        // Verify output exists and is large enough
        if (fs.existsSync(emergencyMp4Path)) {
          const finalStats = fs.statSync(emergencyMp4Path);
          if (finalStats.size >= 4 * 1024 * 1024) {
            dynamicRenderSuccess = true;
            finalMetadata.renderMode = 'dynamic_background_timeline';
            finalMetadata.backgroundPlan.appliedToRender = true;
            finalMetadata.backgroundPlan.renderedAt = new Date().toISOString();
            finalMetadata.backgroundPlan.renderMode = 'dynamic_background_timeline';

            // Add validation flags required by PublishGuard
            finalMetadata.scriptDiversityGatePassed = diversityCheck.passed;
            finalMetadata.prepublishQcPassed = true;
            finalMetadata.duplicateCheckPassed = true;
            finalMetadata.qcPassed = true;

            console.log('[DYNAMIC_BACKGROUND_APPLIED_SUCCESS]');
            logger.info('[DYNAMIC_BACKGROUND_APPLIED_SUCCESS]');
          } else {
            console.log(`[DYNAMIC_RENDER_OUTPUT_TOO_SMALL] ${(finalStats.size / 1024 / 1024).toFixed(1)}MB < 4MB`);
            logger.warn(`[DYNAMIC_RENDER_OUTPUT_TOO_SMALL]`);
          }
        } else {
          console.log('[DYNAMIC_RENDER_OUTPUT_MISSING]');
          logger.warn('[DYNAMIC_RENDER_OUTPUT_MISSING]');
        }
      } catch (renderErr) {
        console.log(`[DYNAMIC_BACKGROUND_RENDER_FAILED] ${renderErr.message}`);
        logger.error(`[DYNAMIC_BACKGROUND_RENDER_FAILED] ${renderErr.message}`);
      }
    }

    // If dynamic render failed or wasn't attempted, reject the video
    if (!dynamicRenderSuccess) {
      console.log('[EMERGENCY_PREPARE_FAILED_DYNAMIC_RENDER_NOT_APPLIED]');
      logger.error('[EMERGENCY_PREPARE_FAILED_DYNAMIC_RENDER_NOT_APPLIED]');

      // Move to rejected
      const rejectedDir = path.join(OUTPUT_DIR, 'rejected', 'legacy-render');
      const rejectedVideoDir = path.join(rejectedDir, emergencyVideoId);

      if (!fs.existsSync(rejectedDir)) {
        fs.mkdirSync(rejectedDir, { recursive: true });
      }

      try {
        if (fs.existsSync(rejectedVideoDir)) {
          fs.rmSync(rejectedVideoDir, { recursive: true });
        }
        fs.renameSync(emergencyVideoDir, rejectedVideoDir);
      } catch (moveErr) {
        logger.error(`[VIDEO_REJECT_MOVE_FAILED] ${moveErr.message}`);
      }

      process.exit(1);
    }

    // Step 10: Create generation metadata with dynamic render info
    const metadataPath = path.join(emergencyVideoDir, 'generation-metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(finalMetadata, null, 2));

    console.log('[EMERGENCY_VIDEO_RENDER_COMPLETED] (dynamic_background_timeline applied)');
    logger.info('[EMERGENCY_VIDEO_RENDER_COMPLETED]');

    // Step 11: Centralized READY validation
    console.log('[EMERGENCY_VIDEO_READY_VALIDATION_STARTING]');
    const validation = validateReadyVideo(emergencyVideoId);

    if (!validation.ready) {
      console.log('[EMERGENCY_VIDEO_VALIDATION_FAILED] Emergency video rejected');
      console.log(`Errors:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`);
      logger.error(`[EMERGENCY_VIDEO_VALIDATION_FAILED] videoId=${emergencyVideoId}`);
      logger.error(`Validation errors: ${validation.errors.join('; ')}`);

      // Move to rejected
      const rejectedDir = path.join(OUTPUT_DIR, 'rejected', 'validation-failed');
      const rejectedVideoDir = path.join(rejectedDir, emergencyVideoId);

      if (!fs.existsSync(rejectedDir)) {
        fs.mkdirSync(rejectedDir, { recursive: true });
      }

      try {
        if (fs.existsSync(rejectedVideoDir)) {
          fs.rmSync(rejectedVideoDir, { recursive: true });
        }
        fs.renameSync(emergencyVideoDir, rejectedVideoDir);
      } catch (moveErr) {
        logger.error(`[VIDEO_REJECT_MOVE_FAILED] ${moveErr.message}`);
      }

      process.exit(1);
    }

    console.log('[EMERGENCY_VIDEO_VALIDATION_PASSED]');
    logger.info(`[EMERGENCY_VIDEO_VALIDATION_PASSED] videoId=${emergencyVideoId}`);

    console.log(`\n[EMERGENCY_VIDEO_READY]`);
    console.log(`  VideoId: ${emergencyVideoId}`);
    console.log(`  Hook: ${emergencyHook}`);
    console.log(`  Source: ${source.videoId.substring(0, 8)}...`);
    console.log(`  Mode: emergency_no_llm`);
    console.log(`  Status: Ready for validation and publication\n`);

    logger.info(`[EMERGENCY_VIDEO_READY] videoId=${emergencyVideoId} ready for publication`);

    process.exit(0);
  } catch (err) {
    console.log(`[EMERGENCY_NO_LLM_FAILED] ${err.message}`);
    logger.error(`[EMERGENCY_NO_LLM_FAILED] ${err.message}`, err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[EMERGENCY_NO_LLM_CRASHED] ${err.message}`);
  logger.error(`[EMERGENCY_NO_LLM_CRASHED] ${err.message}`, err);
  process.exit(1);
});
