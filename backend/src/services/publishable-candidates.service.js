/**
 * publishable-candidates.service.js
 *
 * CENTRALIZA la validación de candidatos para publicación.
 * Esta función NUNCA toca LLM, generación, ni triggerGenerationTopUp.
 *
 * Usado por:
 * - publish-scheduler.service.js (slot de publicación)
 * - late-publish-recovery.js (recuperación manual)
 * - publish:dry-run (validación sin efectos)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const logger = require('../utils/logger');
const { shouldBlockDuplicate, getRecentPublishedVideos } = require('./duplicate-hard-block.service');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './backend/output-fase1-test');

/**
 * Obtiene lista de TODOS los vídeos en output/ con output.mp4
 * Sin filtrar por estado published — eso se valida después
 */
function listAllVideoDirs() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];

  return fs.readdirSync(OUTPUT_DIR)
    .filter(d => {
      const stat = fs.statSync(path.join(OUTPUT_DIR, d));
      return stat.isDirectory();
    });
}

/**
 * Validación HARD BLOCK — criterios que impiden publicación
 * @returns { ok: boolean, blockReasons: string[] }
 */
function validateHardBlocks(videoPath, videoId) {
  const blockReasons = [];

  // 1. MP4 existe
  if (!videoPath || !fs.existsSync(videoPath)) {
    blockReasons.push('output.mp4 missing');
    return { ok: false, blockReasons };
  }

  // 2. Tamaño > 100KB (no corrupto)
  try {
    const stats = fs.statSync(videoPath);
    if (stats.size < 100 * 1024) {
      blockReasons.push(`MP4 too small: ${(stats.size / 1024).toFixed(0)}KB < 100KB`);
      return { ok: false, blockReasons };
    }
  } catch (err) {
    blockReasons.push(`Cannot stat MP4: ${err.message}`);
    return { ok: false, blockReasons };
  }

  // 3. Ya publicado
  const publishedPath = path.join(path.dirname(videoPath), 'published.json');
  if (fs.existsSync(publishedPath)) {
    blockReasons.push('already published (published.json exists)');
    return { ok: false, blockReasons };
  }

  // 4. Script válido
  const scriptPath = path.join(path.dirname(videoPath), 'script.json');
  if (!fs.existsSync(scriptPath)) {
    blockReasons.push('script.json missing');
    return { ok: false, blockReasons };
  }

  let script;
  try {
    script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  } catch (err) {
    blockReasons.push(`script.json invalid: ${err.message}`);
    return { ok: false, blockReasons };
  }

  // 5. ffprobe validation (duration, streams)
  let duration = 0;
  let hasVideo = false;
  let hasAudio = false;

  try {
    const probeOutput = execFileSync(
      ffprobePath,
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', videoPath],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );
    const probe = JSON.parse(probeOutput);
    duration = parseFloat(probe.format?.duration || 0);

    if (probe.streams) {
      hasVideo = probe.streams.some(s => s.codec_type === 'video');
      hasAudio = probe.streams.some(s => s.codec_type === 'audio');
    }
  } catch (err) {
    blockReasons.push(`ffprobe failed: ${err.message}`);
    return { ok: false, blockReasons };
  }

  // 6. Duración 8-60s
  if (duration < 8 || duration > 60) {
    blockReasons.push(`duration ${duration.toFixed(1)}s outside valid range 8-60s`);
    return { ok: false, blockReasons };
  }

  // 7. Video + Audio streams exist
  if (!hasVideo) {
    blockReasons.push('no video stream detected');
    return { ok: false, blockReasons };
  }

  if (!hasAudio) {
    blockReasons.push('no audio stream detected');
    return { ok: false, blockReasons };
  }

  return { ok: true, blockReasons: [], duration, script };
}

/**
 * Validar metadata secundaria (warnings, no bloqueantes)
 */
function validateMetadata(videoId, outputDir) {
  const warnings = [];

  // captions-debug.json
  const captionsDebugPath = path.join(outputDir, 'captions-debug.json');
  if (!fs.existsSync(captionsDebugPath)) {
    warnings.push('captions-debug.json missing');
  } else {
    try {
      const capDebug = JSON.parse(fs.readFileSync(captionsDebugPath, 'utf8'));
      if (!capDebug.captionCount || capDebug.captionCount <= 0) {
        warnings.push('caption count is 0');
      }
    } catch {
      warnings.push('captions-debug.json invalid');
    }
  }

  // subtitles.ass
  const subsPath = path.join(outputDir, 'subtitles.ass');
  if (!fs.existsSync(subsPath)) {
    warnings.push('subtitles.ass missing');
  }

  // render-metadata.json
  const metaPath = path.join(outputDir, 'render-metadata.json');
  if (!fs.existsSync(metaPath)) {
    warnings.push('render-metadata.json missing');
  }

  return { warnings };
}

// Duplicate check is now centralized in duplicate-hard-block.service.js
// Do not re-implement here

/**
 * FUNCIÓN CENTRAL: getPublishableCandidates()
 *
 * Busca todos los vídeos que se pueden publicar AHORA mismo sin:
 * - generar nada nuevo
 * - tocar LLM
 * - crear jobs
 * - llamar triggerGenerationTopUp
 *
 * @param {object} options - { maxResults: 10, allowWarnings: true }
 * @returns { candidates: array, rejected: array }
 */
function getPublishableCandidates(options = {}) {
  const { maxResults = 10, allowWarnings = true } = options;
  const candidates = [];
  const rejected = [];

  const allDirs = listAllVideoDirs();

  for (const videoId of allDirs) {
    const videoDir = path.join(OUTPUT_DIR, videoId);
    const videoPath = path.join(videoDir, 'output.mp4');

    // Hard block validation
    const hardValidation = validateHardBlocks(videoPath, videoId);

    if (!hardValidation.ok) {
      rejected.push({
        videoId,
        reason: hardValidation.blockReasons[0],
        allReasons: hardValidation.blockReasons,
        blocking: true,
      });
      continue;
    }

    // Metadata validation (non-blocking)
    const metaValidation = validateMetadata(videoId, videoDir);

    // CENTRALIZED DUPLICATE CHECK — compares against last 20 published videos
    const script = hardValidation.script;
    const recentPublished = getRecentPublishedVideos(20);
    const duplicateCheck = shouldBlockDuplicate(script, recentPublished);

    if (duplicateCheck.blocked) {
      rejected.push({
        videoId,
        reason: duplicateCheck.reason,
        blocking: true,
        duplicateOf: {
          videoId: duplicateCheck.matchedVideoId,
          youtubeId: duplicateCheck.youtubeIdMatched,
          matchReasons: duplicateCheck.matchReasons,
          similarities: duplicateCheck.similarities,
        },
      });
      continue;
    }

    // Passed all validations — eligible to publish
    candidates.push({
      videoId,
      videoPath,
      videoDir,
      script,
      duration: hardValidation.duration,
      viralityScore: script.viralityScore || 0,
      topic: script.topic || 'unknown',
      hook: script.hook || '',
      warnings: metaValidation.warnings,
      canPublish: true,
    });

    if (candidates.length >= maxResults) break;
  }

  // Sort by virality
  candidates.sort((a, b) => (b.viralityScore || 0) - (a.viralityScore || 0));

  return { candidates, rejected };
}

/**
 * Log validation result
 */
function logCandidateValidation(result, context = 'publish') {
  if (result.canPublish) {
    logger.info(
      `[${context.toUpperCase()}_CANDIDATE_OK] ${result.videoId.substring(0, 8)}... ` +
      `| virality=${result.viralityScore} | duration=${result.duration.toFixed(1)}s ` +
      `| warnings=${result.warnings.length}`
    );
    result.warnings.forEach(w => logger.debug(`  → ${w}`));
  } else {
    logger.warn(
      `[${context.toUpperCase()}_CANDIDATE_REJECTED] ${result.videoId.substring(0, 8)}... ` +
      `| reason=${result.reason}`
    );
  }
}

module.exports = {
  getPublishableCandidates,
  validateHardBlocks,
  validateMetadata,
  logCandidateValidation,
};
