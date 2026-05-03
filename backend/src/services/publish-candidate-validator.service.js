/**
 * publish-candidate-validator.service.js
 *
 * Validación centralizada y unificada de candidatos para publicación.
 * Define CLARAMENTE qué es un hard block vs warning.
 *
 * Hard blocks: Imposible publicar (MP4 falta, corrupto, audio/video ausente)
 * Warnings: Metadata secundaria falta, pero vídeo es publicable
 *
 * Scheduler, late-publish, dry-run todos usan ESTA función.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const logger = require('../utils/logger');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

/**
 * HARD BLOCKS: Validar criterios que impiden publicación
 * @returns { ok: boolean, reasons: string[] }
 */
function validateHardBlocks(videoPath, videoId) {
  const reasons = [];

  // 1. MP4 existe
  if (!videoPath || !fs.existsSync(videoPath)) {
    reasons.push('HARD_BLOCK: output.mp4 no existe');
    return { ok: false, reasons };
  }

  // 2. Tamaño > 1MB (no corrupto)
  try {
    const stats = fs.statSync(videoPath);
    if (stats.size < 1024 * 1024) {
      reasons.push(`HARD_BLOCK: MP4 demasiado pequeño (${(stats.size/1024/1024).toFixed(2)}MB < 1MB)`);
      return { ok: false, reasons };
    }
  } catch (err) {
    reasons.push(`HARD_BLOCK: Cannot stat MP4: ${err.message}`);
    return { ok: false, reasons };
  }

  // 3. ffprobe funciona y detecta streams
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
    reasons.push(`HARD_BLOCK: ffprobe failed: ${err.message}`);
    return { ok: false, reasons };
  }

  // 4. Duración 8-60s (no truncado, no demasiado largo)
  if (duration < 8 || duration > 60) {
    reasons.push(`HARD_BLOCK: duración ${duration.toFixed(1)}s fuera de rango 8-60s`);
    return { ok: false, reasons };
  }

  // 5. Video stream existe
  if (!hasVideo) {
    reasons.push('HARD_BLOCK: no video stream found');
    return { ok: false, reasons };
  }

  // 6. Audio stream existe
  if (!hasAudio) {
    reasons.push('HARD_BLOCK: no audio stream found');
    return { ok: false, reasons };
  }

  // 7. No ya publicado
  const publishedPath = path.join(path.dirname(videoPath), 'published.json');
  if (fs.existsSync(publishedPath)) {
    reasons.push('HARD_BLOCK: ya está publicado (published.json existe)');
    return { ok: false, reasons };
  }

  // Si pasó todos los hard blocks
  return { ok: true, reasons, duration };
}

/**
 * Validar metadata secundaria (warnings, no bloqueantes)
 * @returns { warnings: string[], normalizedScore: number }
 */
function validateMetadata(videoId, outputDir) {
  const warnings = [];
  let normalizedScore = 100; // Comienza en 100, resta por warnings

  // 1. captions-debug.json
  const captionsDebugPath = path.join(outputDir, 'captions-debug.json');
  if (!fs.existsSync(captionsDebugPath)) {
    warnings.push('WARNING: captions-debug.json missing');
    normalizedScore -= 5;
  } else {
    try {
      const capDebug = JSON.parse(fs.readFileSync(captionsDebugPath, 'utf8'));
      if (!capDebug.captionCount || capDebug.captionCount <= 0) {
        warnings.push('WARNING: captionCount is 0');
        normalizedScore -= 3;
      }
    } catch (err) {
      warnings.push(`WARNING: captions-debug.json invalid: ${err.message}`);
      normalizedScore -= 5;
    }
  }

  // 2. subtitles.ass
  const subsPath = path.join(outputDir, 'subtitles.ass');
  if (!fs.existsSync(subsPath)) {
    warnings.push('WARNING: subtitles.ass missing');
    normalizedScore -= 3;
  }

  // 3. render-metadata.json
  const metaPath = path.join(outputDir, 'render-metadata.json');
  if (!fs.existsSync(metaPath)) {
    warnings.push('WARNING: render-metadata.json missing');
    normalizedScore -= 3;
  }

  // 4. queue entry flags (no bloqueantes)
  // publishable, qcPassed, importedFromExistingOutput son opcionales
  // Si faltan, es un warning pero no impide publicación

  return { warnings, normalizedScore: Math.max(0, normalizedScore) };
}

/**
 * Validación CENTRALIZADA: unifica todos los criterios
 *
 * @param {object} candidate - { videoId, script?, prefabScript? }
 * @param {boolean} allowWarnings - si false, cualquier warning es hard block (backward compat)
 *
 * @returns {object} {
 *   hardPassed: boolean,
 *   hardBlocks: string[],
 *   warnings: string[],
 *   quality: number (0-100),
 *   duration: number,
 *   canPublish: boolean (hardPassed && YouTube oauth OK)
 * }
 */
function validatePublishCandidate(candidate, allowWarnings = true) {
  const videoId = candidate.videoId || candidate.id;
  const outputDir = path.join(OUTPUT_DIR, videoId);
  const videoPath = path.join(outputDir, 'output.mp4');

  // PASO 1: Hard blocks
  const hardValidation = validateHardBlocks(videoPath, videoId);

  if (!hardValidation.ok) {
    return {
      hardPassed: false,
      hardBlocks: hardValidation.reasons,
      warnings: [],
      quality: 0,
      duration: 0,
      canPublish: false,
      videoId,
      reason: hardValidation.reasons[0]
    };
  }

  // PASO 2: Metadata warnings
  const metaValidation = validateMetadata(videoId, outputDir);

  // PASO 3: YouTube OAuth check
  const youtubeToken = process.env.YOUTUBE_REFRESH_TOKEN;
  const hasYouTube = youtubeToken && youtubeToken !== 'RELLENAR';

  // RESULTADO FINAL
  return {
    hardPassed: true,
    hardBlocks: [],
    warnings: metaValidation.warnings,
    quality: metaValidation.normalizedScore,
    duration: hardValidation.duration,
    canPublish: hasYouTube, // Solo si YouTube está configurado
    videoId,
    outputDir,
    videoPath,
    reason: metaValidation.warnings.length > 0
      ? `PASS (with ${metaValidation.warnings.length} warnings)`
      : 'PASS (clean)'
  };
}

/**
 * Registrar decisión de validación en logs
 */
function logValidationDecision(result, context = 'publish') {
  if (result.hardPassed) {
    if (result.warnings.length > 0) {
      logger.info(
        `[${context.toUpperCase()}_CANDIDATE_PASS_WITH_WARNINGS] ${result.videoId} ` +
        `| quality=${result.quality} | warnings=${result.warnings.length}`
      );
      result.warnings.forEach(w => logger.debug(`  → ${w}`));
    } else {
      logger.info(
        `[${context.toUpperCase()}_CANDIDATE_PASS_CLEAN] ${result.videoId} ` +
        `| quality=${result.quality} | duration=${result.duration.toFixed(1)}s`
      );
    }
  } else {
    logger.info(
      `[${context.toUpperCase()}_CANDIDATE_REJECTED] ${result.videoId} ` +
      `| hard_blocks=${result.hardBlocks.length}`
    );
    result.hardBlocks.forEach(b => logger.warn(`  → ${b}`));
  }
}

module.exports = {
  validatePublishCandidate,
  validateHardBlocks,
  validateMetadata,
  logValidationDecision
};
