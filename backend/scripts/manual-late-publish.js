#!/usr/bin/env node
/**
 * MANUAL LATE PUBLICATION — Fase 2
 *
 * Publica vídeos generados manualmente con validación COMPLETA:
 * - Hard validation
 * - Prepublish QC
 * - Duplicate hard block
 *
 * Reglas:
 * - Busca SOLO vídeos con generation-metadata.json
 * - Selecciona el más reciente por generatedAt (no por virality)
 * - NO llama nunca al LLM
 * - NO genera contenido nuevo
 * - Valida TODO antes de publicar
 * - Abort si es duplicado
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const logger = require('../src/utils/logger');
const { shouldBlockDuplicate, getRecentPublishedVideos } = require('../src/services/duplicate-hard-block.service');
const { renderDynamicBackgroundTimeline } = require('../src/services/dynamic-background-renderer');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../output-fase1-test'));

async function validateHardBlocks(videoDir, videoId) {
  const mp4Path = path.join(videoDir, 'output.mp4');
  const scriptPath = path.join(videoDir, 'script.json');
  const metadataPath = path.join(videoDir, 'generation-metadata.json');

  // Existencia
  if (!fs.existsSync(mp4Path)) {
    return { valid: false, reason: 'output.mp4 not found' };
  }

  if (!fs.existsSync(scriptPath)) {
    return { valid: false, reason: 'script.json not found' };
  }

  if (!fs.existsSync(metadataPath)) {
    return { valid: false, reason: 'generation-metadata.json not found (not manually generated)' };
  }

  // Tamaño mínimo
  const stats = fs.statSync(mp4Path);
  const sizeMB = stats.size / 1024 / 1024;
  if (stats.size < 100 * 1024) {
    return { valid: false, reason: `mp4 too small: ${sizeMB.toFixed(1)}MB < 100KB` };
  }

  // Parse metadata
  let metadata, script;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  } catch (err) {
    return { valid: false, reason: `invalid JSON: ${err.message}` };
  }

  // Validar estructura de script
  if (!script.hook || typeof script.hook !== 'string') {
    return { valid: false, reason: 'script.hook missing or invalid' };
  }

  if (!script.topic || typeof script.topic !== 'string') {
    return { valid: false, reason: 'script.topic missing or invalid' };
  }

  if (typeof script.viralityScore !== 'number') {
    return { valid: false, reason: 'script.viralityScore missing or invalid' };
  }

  // VALIDACIÓN: Si existe backgroundPlan con clipTimeline, registrarlo para procesamiento posterior
  if (metadata.backgroundPlan && Array.isArray(metadata.backgroundPlan.clipTimeline) && metadata.backgroundPlan.clipTimeline.length > 0) {
    logger.info(`[BACKGROUND_TIMELINE_DETECTED] clipTimeline with ${metadata.backgroundPlan.clipTimeline.length} clips detected - will be applied during render`);
  }

  return { valid: true, script, metadata, sizeMB };
}

async function runPrepublishQC(videoPath, outputDir, videoId) {
  try {
    const { validatePrepublish } = require('../src/services/prepublish-visual-qc.service');
    const qcResult = await validatePrepublish(videoPath, outputDir, videoId);

    if (!qcResult.ok) {
      return {
        valid: false,
        reason: `prepublish QC failed: ${qcResult.blockedReasons?.join(', ') || 'unknown'}`,
      };
    }

    return { valid: true, details: qcResult };
  } catch (err) {
    logger.warn(`[MANUAL_LATE_PUBLISH_QC_ERROR] ${err.message}`);
    // If QC fails hard, abort
    return { valid: false, reason: `QC service error: ${err.message}` };
  }
}

async function applyDynamicBackgroundIfNeeded(videoDir, mp4Path, metadata) {
  // Si existe clipTimeline pero no fue aplicado, aplicarlo ahora
  if (!metadata.backgroundPlan || !Array.isArray(metadata.backgroundPlan.clipTimeline)) {
    return { needsRender: false };
  }

  if (metadata.backgroundPlan.clipTimeline.length === 0) {
    return { needsRender: false };
  }

  if (metadata.backgroundPlan.appliedToRender === true) {
    logger.info('[BACKGROUND_TIMELINE_VALIDATION_PASSED] clipTimeline already applied to render');
    return { needsRender: false };
  }

  // Necesita render dinámico
  console.log('[APPLYING_DYNAMIC_BACKGROUND_TIMELINE]');
  logger.info(`[APPLYING_DYNAMIC_BACKGROUND_TIMELINE] Applying ${metadata.backgroundPlan.clipTimeline.length} clips...`);

  try {
    // Obtener duración actual de la clipTimeline
    const currentTimelineLength = metadata.backgroundPlan.clipTimeline.reduce((max, clip) => Math.max(max, clip.end), 15);

    // Para detectar duración real, necesitamos el audio. Usar ffprobe para obtener duración del vídeo
    const { execSync } = require('child_process');
    const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

    let actualDuration = currentTimelineLength;
    try {
      const probeCmd = `"${ffprobeInstaller.path}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${mp4Path}"`;
      const durationOutput = execSync(probeCmd, { encoding: 'utf8' }).trim();
      actualDuration = parseFloat(durationOutput) || currentTimelineLength;
      if (actualDuration > 0) {
        logger.info(`[ACTUAL_VIDEO_DURATION] Detected ${actualDuration.toFixed(2)}s`);
      } else {
        logger.warn(`[DURATION_DETECTION_FAILED] Got 0 duration, using timeline duration`);
        actualDuration = currentTimelineLength;
      }
    } catch (err) {
      logger.warn(`[DURATION_DETECTION_FAILED] ${err.message} - Using timeline duration ${currentTimelineLength.toFixed(2)}s`);
    }

    // Escalar clipTimeline si la duración real es diferente
    let scaledTimeline = metadata.backgroundPlan.clipTimeline;
    if (actualDuration > currentTimelineLength * 1.1) { // Si la duración es >10% mayor
      const scale = actualDuration / currentTimelineLength;
      logger.info(`[SCALING_TIMELINE] scale=${scale.toFixed(2)}x from ${currentTimelineLength.toFixed(2)}s to ${actualDuration.toFixed(2)}s`);

      scaledTimeline = metadata.backgroundPlan.clipTimeline.map(clip => ({
        ...clip,
        start: clip.start * scale,
        end: clip.end * scale,
        duration: clip.duration * scale,
      }));
    }

    // Pasar el videoPath existente para que extraiga el audio
    const renderResult = await renderDynamicBackgroundTimeline({
      videoPath: mp4Path, // El vídeo original del cual extraeremos audio
      outputPath: mp4Path, // Sobrescribe el output con el renderizado
      clipTimeline: scaledTimeline,
      audioDuration: actualDuration,
      outputDir: videoDir,
    });

    if (!renderResult.success) {
      return {
        needsRender: true,
        success: false,
        reason: `Dynamic render failed: ${renderResult.error || 'unknown error'}`,
      };
    }

    // Marcar como aplicado
    metadata.backgroundPlan.appliedToRender = true;
    metadata.backgroundPlan.renderedAt = new Date().toISOString();
    metadata.backgroundPlan.renderMode = 'dynamic_background_timeline';
    fs.writeFileSync(path.join(videoDir, 'generation-metadata.json'), JSON.stringify(metadata, null, 2));

    console.log('[DYNAMIC_BACKGROUND_APPLIED_SUCCESS]');
    logger.info('[DYNAMIC_BACKGROUND_APPLIED_SUCCESS] clipTimeline applied to render');

    return {
      needsRender: true,
      success: true,
    };
  } catch (err) {
    logger.error(`[APPLY_DYNAMIC_BACKGROUND_ERROR] ${err.message}`);
    return {
      needsRender: true,
      success: false,
      reason: `Error applying dynamic background: ${err.message}`,
    };
  }
}

async function main() {
  console.log('[MANUAL_LATE_PUBLISH_STARTED]');
  logger.info('[MANUAL_LATE_PUBLISH_STARTED]');

  try {
    // Step 1: Find all manually generated videos (with generation-metadata.json)
    // Ignore rejected/ and blocked videos
    const dirs = fs.readdirSync(OUTPUT_DIR)
      .filter(d => {
        if (d === 'rejected' || d.startsWith('.')) return false;
        return fs.statSync(path.join(OUTPUT_DIR, d)).isDirectory();
      });

    const manualVideos = [];
    for (const videoId of dirs) {
      const videoDir = path.join(OUTPUT_DIR, videoId);
      const metadataPath = path.join(videoDir, 'generation-metadata.json');
      const blockedPath = path.join(videoDir, 'duplicate-blocked.json');

      // Skip if no generation metadata or if already blocked as duplicate
      if (!fs.existsSync(metadataPath) || fs.existsSync(blockedPath)) continue;

      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        const generatedAt = new Date(metadata.generatedAt);

        manualVideos.push({
          videoId,
          videoDir,
          generatedAt,
          metadata,
        });
      } catch {
        continue;
      }
    }

    if (manualVideos.length === 0) {
      console.log('[MANUAL_LATE_PUBLISH_ABORTED] No manually generated videos found');
      logger.error('[MANUAL_LATE_PUBLISH_ABORTED] No manually generated videos found');
      process.exit(1);
    }

    // Step 2: Select the most recent by generatedAt
    manualVideos.sort((a, b) => b.generatedAt - a.generatedAt);
    const selected = manualVideos[0];

    console.log(`[MANUAL_GENERATED_VIDEO_SELECTED] videoId=${selected.videoId.substring(0, 8)}... | generated=${selected.metadata.generatedAt}`);
    logger.info(`[MANUAL_GENERATED_VIDEO_SELECTED] videoId=${selected.videoId} | generatedAt=${selected.metadata.generatedAt}`);

    // Step 3: Hard validation
    console.log('[MANUAL_LATE_PUBLISH_VALIDATION_STARTED]');
    logger.info('[MANUAL_LATE_PUBLISH_VALIDATION_STARTED]');

    const hardValidation = await validateHardBlocks(selected.videoDir, selected.videoId);
    if (!hardValidation.valid) {
      console.log(`[MANUAL_LATE_PUBLISH_ABORTED] Hard validation failed: ${hardValidation.reason}`);
      logger.error(`[MANUAL_LATE_PUBLISH_ABORTED] Hard validation failed: ${hardValidation.reason}`);
      process.exit(1);
    }

    const { script, sizeMB } = hardValidation;
    console.log(`  ✓ Hard blocks passed (size=${sizeMB.toFixed(1)}MB)`);

    const mp4Path = path.join(selected.videoDir, 'output.mp4');

    // Step 4: Prepublish QC
    // (validatePrepublish also checks duration, format, etc.)
    const qcValidation = await runPrepublishQC(mp4Path, selected.videoDir, selected.videoId);
    if (!qcValidation.valid) {
      console.log(`[MANUAL_LATE_PUBLISH_ABORTED] Prepublish QC failed: ${qcValidation.reason}`);
      logger.error(`[MANUAL_LATE_PUBLISH_ABORTED] Prepublish QC failed: ${qcValidation.reason}`);
      process.exit(1);
    }

    console.log('  ✓ Prepublish QC passed');
    logger.info('[MANUAL_LATE_PUBLISH_QC_PASSED]');

    // Step 4.5: Apply dynamic background timeline if needed
    const dynamicRenderResult = await applyDynamicBackgroundIfNeeded(selected.videoDir, mp4Path, hardValidation.metadata);
    if (dynamicRenderResult.needsRender && !dynamicRenderResult.success) {
      console.log(`[MANUAL_LATE_PUBLISH_ABORTED] Dynamic background render failed: ${dynamicRenderResult.reason}`);
      logger.error(`[MANUAL_LATE_PUBLISH_ABORTED] Dynamic background render failed: ${dynamicRenderResult.reason}`);
      process.exit(1);
    }
    if (dynamicRenderResult.success) {
      console.log('  ✓ Dynamic background timeline applied');
    }

    // Step 5: Duplicate hard block
    const recentPublished = getRecentPublishedVideos(20);
    const duplicateCheck = shouldBlockDuplicate(script, recentPublished);

    if (duplicateCheck.blocked) {
      console.log(`[MANUAL_LATE_PUBLISH_DUPLICATE_BLOCKED] reason=${duplicateCheck.reason}`);
      logger.error(
        `[MANUAL_LATE_PUBLISH_DUPLICATE_BLOCKED] videoId=${selected.videoId} | ` +
        `match_reasons=[${duplicateCheck.matchReasons.join(', ')}]`
      );

      // Quarantine the duplicate video to prevent future re-attempts
      try {
        const rejectedDir = path.join(OUTPUT_DIR, 'rejected', 'duplicates');
        if (!fs.existsSync(rejectedDir)) {
          fs.mkdirSync(rejectedDir, { recursive: true });
        }

        const quarantinePath = path.join(rejectedDir, selected.videoId);

        // Move entire video directory to rejected/duplicates
        if (fs.existsSync(quarantinePath)) {
          // If already rejected, just mark it again
          console.log(`[DUPLICATE_VIDEO_ALREADY_QUARANTINED] videoId=${selected.videoId}`);
        } else {
          fs.renameSync(selected.videoDir, quarantinePath);
          console.log(`[DUPLICATE_VIDEO_QUARANTINED] moved to rejected/duplicates/${selected.videoId.substring(0, 8)}...`);
        }

        // Create marker file
        const markerPath = path.join(quarantinePath, 'duplicate-blocked.json');
        fs.writeFileSync(markerPath, JSON.stringify({
          videoId: selected.videoId,
          blockedAt: new Date().toISOString(),
          reason: 'duplicate_hard_block',
          matchedVideoId: duplicateCheck.matchedVideoId || 'unknown',
          matchedYouTubeId: duplicateCheck.youtubeId || 'unknown',
          hookSimilarity: duplicateCheck.similarities?.hookSimilarity || 0,
          hook: script.hook,
          originalPath: selected.videoDir,
          matchReasons: duplicateCheck.matchReasons || [],
        }, null, 2));

        console.log('[DUPLICATE_VIDEO_REMOVED_FROM_POOL] Will not be retried');
        logger.info(`[DUPLICATE_VIDEO_QUARANTINED] videoId=${selected.videoId} moved to rejected/duplicates | matched=${duplicateCheck.matchedVideoId}`);
        logger.info(`[DUPLICATE_VIDEO_REMOVED_FROM_POOL] videoId=${selected.videoId} will not be retried`);
      } catch (err) {
        logger.warn(`[DUPLICATE_QUARANTINE_FAILED] Could not quarantine: ${err.message}`);
        console.log('[MANUAL_LATE_PUBLISH_ABORTED] Duplicate hard block triggered (quarantine failed)');
        process.exit(1);
      }

      console.log('[MANUAL_LATE_PUBLISH_ABORTED] Duplicate hard block triggered');
      process.exit(1);
    }

    console.log('  ✓ Duplicate hard block passed');
    logger.info(`[MANUAL_LATE_PUBLISH_VALIDATION_PASSED] All validations passed for videoId=${selected.videoId}`);

    // Step 6: Publish
    console.log('[MANUAL_LATE_PUBLISH_PUBLISHING]');
    logger.info(`[MANUAL_LATE_PUBLISH_PUBLISHING] videoId=${selected.videoId}`);

    const { publishAll } = require('../src/services/publisher');
    const { saveVideo } = require('../src/services/analytics-tracker');

    let results, errors;
    try {
      const publishResponse = await publishAll(mp4Path, script, null, {
        source: 'manual-late-publish',
        isManual: true,
        skipPrepublishVisualQC: false,
      });
      results = publishResponse.results;
      errors = publishResponse.errors;
    } catch (err) {
      // Check if error is due to duplicate detection
      const isDuplicate = err.message && (
        err.message.includes('[DUPLICATE_BLOCKED]') ||
        err.message.includes('duplicate') ||
        err.message.includes('DUPLICATE')
      );

      if (isDuplicate) {
        console.log(`[MANUAL_LATE_PUBLISH_DUPLICATE_BLOCKED] reason=${err.message}`);
        logger.error(`[MANUAL_LATE_PUBLISH_DUPLICATE_BLOCKED] videoId=${selected.videoId} | ${err.message}`);

        // Quarantine the duplicate video
        try {
          const rejectedDir = path.join(OUTPUT_DIR, 'rejected', 'duplicates');
          if (!fs.existsSync(rejectedDir)) {
            fs.mkdirSync(rejectedDir, { recursive: true });
          }

          const quarantinePath = path.join(rejectedDir, selected.videoId);

          if (!fs.existsSync(quarantinePath)) {
            fs.renameSync(selected.videoDir, quarantinePath);
            console.log(`[DUPLICATE_VIDEO_QUARANTINED] moved to rejected/duplicates/${selected.videoId.substring(0, 8)}...`);
          }

          // Create marker file
          const markerPath = path.join(quarantinePath, 'duplicate-blocked.json');
          if (!fs.existsSync(markerPath)) {
            fs.writeFileSync(markerPath, JSON.stringify({
              videoId: selected.videoId,
              blockedAt: new Date().toISOString(),
              reason: 'duplicate_hard_block',
              hook: script.hook,
              originalPath: selected.videoDir,
              error: err.message,
            }, null, 2));
          }

          console.log('[DUPLICATE_VIDEO_REMOVED_FROM_POOL] Will not be retried');
          logger.info(`[DUPLICATE_VIDEO_QUARANTINED] videoId=${selected.videoId} moved to rejected/duplicates`);
          logger.info(`[DUPLICATE_VIDEO_REMOVED_FROM_POOL] videoId=${selected.videoId} will not be retried`);
        } catch (quarantineErr) {
          logger.warn(`[DUPLICATE_QUARANTINE_FAILED] Could not quarantine: ${quarantineErr.message}`);
        }

        console.log('[MANUAL_LATE_PUBLISH_ABORTED] Duplicate hard block triggered');
        process.exit(1);
      }

      console.log(`[MANUAL_LATE_PUBLISH_ABORTED] Publication failed: ${err.message}`);
      logger.error(`[MANUAL_LATE_PUBLISH_ABORTED] Publication failed: ${err.message}`, err);
      process.exit(1);
    }

    const publishedIds = {};

    if (Array.isArray(results)) {
      for (const r of results) {
        if (r.platform === 'tiktok') publishedIds.tiktokId = r.publishId;
        if (r.platform === 'instagram') publishedIds.instagramId = r.mediaId;
        if (r.platform === 'youtube') publishedIds.youtubeId = r.videoId;
      }
    }

    if (!publishedIds.youtubeId) {
      // Check if it was blocked due to duplicate
      const isDuplicateBlocked = errors && errors.some(e =>
        e && (
          e.includes('[DUPLICATE_BLOCKED]') ||
          e.includes('duplicate') ||
          e.message?.includes('[DUPLICATE_BLOCKED]')
        )
      );

      if (isDuplicateBlocked || !results || (Array.isArray(results) && results.length === 0)) {
        console.log('[MANUAL_LATE_PUBLISH_DUPLICATE_BLOCKED] No platforms published - duplicate detected');
        logger.error('[MANUAL_LATE_PUBLISH_DUPLICATE_BLOCKED] videoId=${selected.videoId}');

        // Quarantine the duplicate video
        try {
          const rejectedDir = path.join(OUTPUT_DIR, 'rejected', 'duplicates');
          if (!fs.existsSync(rejectedDir)) {
            fs.mkdirSync(rejectedDir, { recursive: true });
          }

          const quarantinePath = path.join(rejectedDir, selected.videoId);

          if (!fs.existsSync(quarantinePath)) {
            fs.renameSync(selected.videoDir, quarantinePath);
            console.log(`[DUPLICATE_VIDEO_QUARANTINED] moved to rejected/duplicates/${selected.videoId.substring(0, 8)}...`);
          }

          // Create marker file
          const markerPath = path.join(quarantinePath, 'duplicate-blocked.json');
          if (!fs.existsSync(markerPath)) {
            fs.writeFileSync(markerPath, JSON.stringify({
              videoId: selected.videoId,
              blockedAt: new Date().toISOString(),
              reason: 'duplicate_hard_block',
              hook: script.hook,
              originalPath: selected.videoDir,
              errors: errors || [],
            }, null, 2));
          }

          console.log('[DUPLICATE_VIDEO_REMOVED_FROM_POOL] Will not be retried');
          logger.info(`[DUPLICATE_VIDEO_QUARANTINED] videoId=${selected.videoId} moved to rejected/duplicates`);
          logger.info(`[DUPLICATE_VIDEO_REMOVED_FROM_POOL] videoId=${selected.videoId} will not be retried`);
        } catch (quarantineErr) {
          logger.warn(`[DUPLICATE_QUARANTINE_FAILED] Could not quarantine: ${quarantineErr.message}`);
        }

        console.log('[MANUAL_LATE_PUBLISH_ABORTED] Duplicate hard block triggered');
        process.exit(1);
      }

      console.log('[MANUAL_LATE_PUBLISH_ABORTED] Publication failed: no YouTube ID returned');
      logger.error('[MANUAL_LATE_PUBLISH_ABORTED] Publication failed: no YouTube ID returned');
      process.exit(1);
    }

    // Step 7: Mark as published (prevent re-publication)
    const publishedFilePath = path.join(selected.videoDir, 'published.json');
    fs.writeFileSync(publishedFilePath, JSON.stringify({
      publishedAt: new Date().toISOString(),
      manualRecovery: true,
      platforms: results.map(r => r.platform),
      errors: errors || [],
      ...publishedIds,
    }, null, 2));

    // Step 8: Save to analytics
    try {
      await saveVideo({
        id: selected.videoId,
        title: script?.title || selected.videoId,
        topic: script?.topic || 'unknown',
        hook: script?.hook || '',
        viralityScore: script?.viralityScore || 0,
        script: { ...script, manualRecovery: true },
        ...publishedIds,
      });
    } catch (err) {
      logger.warn(`[MANUAL_LATE_PUBLISH_ANALYTICS_FAILED] ${err.message}`);
    }

    // Success
    console.log('\n[MANUAL_LATE_PUBLISH_SUCCESS]');
    console.log(`  VideoId: ${selected.videoId}`);
    console.log(`  YouTubeId: ${publishedIds.youtubeId}`);
    console.log(`  TikTokId: ${publishedIds.tiktokId || 'N/A'}`);
    console.log(`  InstagramId: ${publishedIds.instagramId || 'N/A'}`);
    console.log(`  Platforms: ${results.map(r => r.platform).join(', ')}`);
    console.log('[MANUAL_LATE_PUBLISH_NO_LLM_USED]\n');

    logger.info(
      `[MANUAL_LATE_PUBLISH_SUCCESS] videoId=${selected.videoId} | ` +
      `youtubeId=${publishedIds.youtubeId} | ` +
      `platforms=${results.map(r => r.platform).join(',')}`
    );

    process.exit(0);
  } catch (err) {
    console.log(`[MANUAL_LATE_PUBLISH_ABORTED] ${err.message}`);
    logger.error(`[MANUAL_LATE_PUBLISH_ABORTED] ${err.message}`, err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[MANUAL_LATE_PUBLISH_CRASHED] ${err.message}`);
  logger.error(`[MANUAL_LATE_PUBLISH_CRASHED] ${err.message}`, err);
  process.exit(1);
});
