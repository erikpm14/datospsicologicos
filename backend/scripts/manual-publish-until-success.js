#!/usr/bin/env node
/**
 * MANUAL PUBLISH UNTIL SUCCESS
 *
 * Orquesta todo el flujo:
 * 1. Intenta generar nuevo vídeo
 * 2. Si es duplicado, lo mueve a rejected/ e intenta siguiente
 * 3. Si no se puede generar, busca candidatos existentes
 * 4. Publica el primer candidato válido no duplicado
 * 5. Si no hay candidatos, reporta estadísticas
 *
 * Reglas:
 * - No llama LLM en publicación
 * - No publica duplicados
 * - Mantiene Duplicate Hard Block activo
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const logger = require('../src/utils/logger');
const { shouldBlockDuplicate, getRecentPublishedVideos } = require('../src/services/duplicate-hard-block.service');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../output-fase1-test'));

async function publishVideo(videoPath, outputDir, videoId, script) {
  try {
    const { publishAll } = require('../src/services/publisher');
    const { saveVideo } = require('../src/services/analytics-tracker');
    const { validatePrepublish } = require('../src/services/prepublish-visual-qc.service');

    // Validate QC
    const qcResult = await validatePrepublish(videoPath, outputDir, videoId);
    if (!qcResult.ok) {
      return { success: false, reason: `QC failed: ${qcResult.blockedReasons?.join(', ')}` };
    }

    // Duplicate check
    const recentPublished = getRecentPublishedVideos(20);
    const duplicateCheck = shouldBlockDuplicate(script, recentPublished);
    if (duplicateCheck.blocked) {
      return { success: false, reason: 'duplicate_hard_block', isDuplicate: true };
    }

    // Publish
    const publishResponse = await publishAll(videoPath, script, null, {
      source: 'manual-publish-until-success',
      isManual: true,
      skipPrepublishVisualQC: false,
    });
    const results = publishResponse.results || [];
    const errors = publishResponse.errors || [];

    if (!Array.isArray(results) || results.length === 0) {
      return { success: false, reason: 'publication_failed' };
    }

    const publishedIds = {};
    for (const r of results) {
      if (r.platform === 'tiktok') publishedIds.tiktokId = r.publishId;
      if (r.platform === 'instagram') publishedIds.instagramId = r.mediaId;
      if (r.platform === 'youtube') publishedIds.youtubeId = r.videoId;
    }

    if (!publishedIds.youtubeId) {
      return { success: false, reason: 'no_youtube_id' };
    }

    // Mark as published
    const publishedFilePath = path.join(outputDir, 'published.json');
    fs.writeFileSync(publishedFilePath, JSON.stringify({
      publishedAt: new Date().toISOString(),
      manualRecovery: true,
      platforms: results.map(r => r.platform),
      errors,
      ...publishedIds,
    }, null, 2));

    // Save to analytics
    try {
      await saveVideo({
        id: videoId,
        title: script?.title || videoId,
        topic: script?.topic || 'unknown',
        hook: script?.hook || '',
        viralityScore: script?.viralityScore || 0,
        script: { ...script, manualRecovery: true },
        ...publishedIds,
      });
    } catch (err) {
      logger.warn(`Analytics failed: ${err.message}`);
    }

    return { success: true, publishedIds, results };
  } catch (err) {
    const isDuplicate = err.message && (
      err.message.includes('[DUPLICATE_BLOCKED]') ||
      err.message.includes('duplicate') ||
      err.message.includes('DUPLICATE')
    );

    if (isDuplicate) {
      return { success: false, reason: 'duplicate_hard_block', isDuplicate: true, error: err.message };
    }

    return { success: false, reason: 'exception', error: err.message };
  }
}

function quarantineVideo(videoDir, videoId, script, reason = 'unknown') {
  try {
    const rejectedDir = path.join(OUTPUT_DIR, 'rejected', 'duplicates');
    if (!fs.existsSync(rejectedDir)) {
      fs.mkdirSync(rejectedDir, { recursive: true });
    }

    const quarantinePath = path.join(rejectedDir, videoId);
    if (!fs.existsSync(quarantinePath)) {
      fs.renameSync(videoDir, quarantinePath);
    }

    const markerPath = path.join(quarantinePath, 'duplicate-blocked.json');
    if (!fs.existsSync(markerPath)) {
      fs.writeFileSync(markerPath, JSON.stringify({
        videoId,
        blockedAt: new Date().toISOString(),
        reason: 'duplicate_hard_block',
        hook: script.hook,
        originalPath: videoDir,
      }, null, 2));
    }

    return true;
  } catch (err) {
    logger.warn(`Quarantine failed: ${err.message}`);
    return false;
  }
}

function findCandidateVideos() {
  const candidates = [];
  const stats = {
    total: 0,
    scanned: 0,
    rejected: { duplicate: 0, published: 0, qc: 0, invalid: 0 },
  };

  try {
    const dirs = fs.readdirSync(OUTPUT_DIR)
      .filter(d => {
        if (d === 'rejected' || d.startsWith('.')) return false;
        return fs.statSync(path.join(OUTPUT_DIR, d)).isDirectory();
      });

    stats.total = dirs.length;

    for (const videoId of dirs) {
      const videoDir = path.join(OUTPUT_DIR, videoId);
      const mp4Path = path.join(videoDir, 'output.mp4');
      const scriptPath = path.join(videoDir, 'script.json');
      const publishedPath = path.join(videoDir, 'published.json');
      const blockedPath = path.join(videoDir, 'duplicate-blocked.json');

      // Skip already processed
      if (fs.existsSync(publishedPath)) {
        stats.rejected.published++;
        continue;
      }

      if (fs.existsSync(blockedPath)) {
        stats.rejected.duplicate++;
        continue;
      }

      // Check files exist
      if (!fs.existsSync(mp4Path) || !fs.existsSync(scriptPath)) {
        stats.rejected.invalid++;
        continue;
      }

      // Parse script
      let script;
      try {
        script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
      } catch {
        stats.rejected.invalid++;
        continue;
      }

      // Check size
      const stats_file = fs.statSync(mp4Path);
      if (stats_file.size < 100 * 1024) {
        stats.rejected.invalid++;
        continue;
      }

      stats.scanned++;
      candidates.push({ videoId, videoDir, mp4Path, script });
    }

    return { candidates, stats };
  } catch (err) {
    logger.error(`Error scanning candidates: ${err.message}`);
    return { candidates: [], stats };
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║    MANUAL PUBLISH UNTIL SUCCESS — Fase Final   ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  console.log('[MANUAL_PUBLISH_UNTIL_SUCCESS_STARTED]');
  logger.info('[MANUAL_PUBLISH_UNTIL_SUCCESS_STARTED]');

  let successCount = 0;
  let duplicateCount = 0;
  let qcFailureCount = 0;

  try {
    // Step 1: Try to generate new video
    console.log('[MANUAL_ATTEMPT_STARTED] Attempting to generate new video...');
    logger.info('[MANUAL_ATTEMPT_STARTED] Attempting generation');

    try {
      execSync('npm run manual:generate-and-publish', {
        stdio: 'inherit',
        cwd: __dirname + '/..',
      });
      console.log('[MANUAL_LATE_PUBLISH_SUCCESS] Generation and publication succeeded');
      logger.info('[MANUAL_LATE_PUBLISH_SUCCESS] New video published successfully');
      process.exit(0);
    } catch (err) {
      // Generation failed or video was duplicate
      // Continue to search existing candidates
      console.log('[GENERATION_FAILED_OR_DUPLICATE] Will search existing candidates');
      logger.warn('[GENERATION_FAILED_OR_DUPLICATE] Continuing with existing videos');
    }

    // Step 2: Search existing candidates
    console.log('\n[SEARCHING_CANDIDATES] Scanning output directory for valid videos...');
    logger.info('[SEARCHING_CANDIDATES] Looking for non-published, non-duplicate videos');

    const { candidates, stats: scanStats } = findCandidateVideos();

    console.log(`[CANDIDATES_FOUND] total=${scanStats.total} scanned=${scanStats.scanned}`);
    console.log(`  Published: ${scanStats.rejected.published}`);
    console.log(`  Duplicates: ${scanStats.rejected.duplicate}`);
    console.log(`  Invalid/QC: ${scanStats.rejected.invalid}`);

    if (candidates.length === 0) {
      console.log('\n[NO_VALID_VIDEO_AVAILABLE_TODAY]');
      console.log('  Vídeos totales: ' + scanStats.total);
      console.log('  Ya publicados: ' + scanStats.rejected.published);
      console.log('  Bloqueados como duplicados: ' + scanStats.rejected.duplicate);
      console.log('  Inválidos/QC rechazados: ' + scanStats.rejected.invalid);
      console.log('  Candidatos válidos: 0');
      logger.error('[NO_VALID_VIDEO_AVAILABLE_TODAY] No valid videos found');
      process.exit(1);
    }

    // Step 3: Try each candidate
    const recentPublished = getRecentPublishedVideos(20);

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      console.log(`\n[NEXT_CANDIDATE_ATTEMPT] ${i + 1}/${candidates.length} | ${candidate.videoId.substring(0, 8)}...`);
      logger.info(`[NEXT_CANDIDATE_ATTEMPT] Trying candidate ${i + 1}/${candidates.length}`);

      // Quick duplicate check before attempting
      const duplicateCheck = shouldBlockDuplicate(candidate.script, recentPublished);
      if (duplicateCheck.blocked) {
        console.log(`  ❌ Duplicate detected (hook similarity ${duplicateCheck.similarities?.hookSimilarity || 0}%)`);
        console.log('[DUPLICATE_VIDEO_QUARANTINED] Moving to rejected/duplicates/');
        quarantineVideo(candidate.videoDir, candidate.videoId, candidate.script);
        duplicateCount++;
        logger.warn(`[DUPLICATE_VIDEO_QUARANTINED] Moved ${candidate.videoId}`);
        continue;
      }

      // Try to publish
      console.log('  ✓ Not duplicate, attempting publication...');
      const publishResult = await publishVideo(
        candidate.mp4Path,
        candidate.videoDir,
        candidate.videoId,
        candidate.script
      );

      if (publishResult.success) {
        console.log(`  ✅ PUBLISHED!`);
        console.log(`     VideoId: ${candidate.videoId}`);
        console.log(`     YouTubeId: ${publishResult.publishedIds.youtubeId}`);
        console.log(`     Platforms: ${publishResult.results.map(r => r.platform).join(', ')}`);

        console.log('\n[MANUAL_LATE_PUBLISH_SUCCESS] Video published successfully');
        logger.info(`[MANUAL_LATE_PUBLISH_SUCCESS] videoId=${candidate.videoId} youtubeId=${publishResult.publishedIds.youtubeId}`);

        successCount++;
        process.exit(0);
      } else if (publishResult.isDuplicate) {
        console.log(`  ❌ Duplicate detected in publication phase`);
        console.log('[DUPLICATE_VIDEO_QUARANTINED] Moving to rejected/duplicates/');
        quarantineVideo(candidate.videoDir, candidate.videoId, candidate.script);
        duplicateCount++;
        logger.warn(`[DUPLICATE_VIDEO_QUARANTINED] ${candidate.videoId}`);
      } else {
        console.log(`  ❌ Publication failed: ${publishResult.reason}`);
        qcFailureCount++;
        logger.warn(`[CANDIDATE_REJECTED] ${publishResult.reason}`);
      }
    }

    // If we get here, no valid video was found
    console.log('\n[NO_VALID_VIDEO_AVAILABLE_TODAY]');
    console.log('  Vídeos totales revisados: ' + candidates.length);
    console.log('  Descartados por duplicado: ' + duplicateCount);
    console.log('  Descartados por validación/QC: ' + qcFailureCount);
    console.log('  Publicados exitosamente: 0');

    logger.error('[NO_VALID_VIDEO_AVAILABLE_TODAY] Reviewed ' + candidates.length + ' candidates, none valid');
    process.exit(1);
  } catch (err) {
    console.error(`[CRASHED] ${err.message}`);
    logger.error(`[CRASHED] ${err.message}`, err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[CRASHED] ${err.message}`);
  logger.error(`[CRASHED] ${err.message}`, err);
  process.exit(1);
});
