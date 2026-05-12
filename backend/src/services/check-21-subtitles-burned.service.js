/**
 * check-21-subtitles-burned.service.js
 * CHECK 21: Verifica que los subtítulos están realmente quemados en el vídeo MP4.
 * No basta con que exista subtitles.vtt; debe haber evidencia de que fueron renderizados.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Comprueba si hay subtitle streams embebidos en el MP4
 */
function hasEmbeddedSubtitleStreams(videoPath) {
  try {
    const output = execSync(
      `ffprobe -v error -select_streams s "${videoPath}" -show_entries stream=index,codec_type -of default=noprint_wrappers=1 2>&1`,
      { encoding: 'utf8' }
    );

    const hasStreams = output.trim().length > 0;
    return hasStreams;
  } catch (err) {
    logger.error('[CHECK_21] ffprobe subtitle check failed:', err.message);
    return false;
  }
}

/**
 * Extrae frames en puntos críticos donde deberían haber subtítulos
 */
function extractFramesForSubtitleValidation(videoPath, outputDir) {
  const criticalTimestamps = [3, 8, 15, 25, 33]; // segundos

  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const frames = [];
    criticalTimestamps.forEach(ts => {
      const framePath = path.join(outputDir, `frame-${ts}s.png`);

      try {
        execSync(
          `ffmpeg -y -i "${videoPath}" -ss ${ts} -vframes 1 "${framePath}" 2>/dev/null`,
          { encoding: 'utf8', stdio: 'pipe' }
        );
        frames.push({ timestamp: ts, path: framePath, exists: true });
      } catch (err) {
        logger.warn(`[CHECK_21] Failed to extract frame at ${ts}s:`, err.message);
        frames.push({ timestamp: ts, path: framePath, exists: false });
      }
    });

    return frames;
  } catch (err) {
    logger.error('[CHECK_21] Frame extraction failed:', err.message);
    return [];
  }
}

/**
 * Comprueba si los archivos de subtítulos existen y tienen contenido
 */
function validateSubtitleFiles(videoPath) {
  const videoDir = path.dirname(videoPath);
  const vttPath = path.join(videoDir, 'subtitles.vtt');
  const assPath = path.join(videoDir, 'subtitles.ass');

  const issues = [];

  // Debe existir al menos uno
  const vttExists = fs.existsSync(vttPath);
  const assExists = fs.existsSync(assPath);

  if (!vttExists && !assExists) {
    issues.push('No subtitles.vtt or subtitles.ass found');
    return { valid: false, issues };
  }

  // Si existe, debe tener contenido
  if (vttExists) {
    const vttContent = fs.readFileSync(vttPath, 'utf8');
    const vttLines = vttContent.trim().split('\n').filter(l => l.trim().length > 0);

    if (vttLines.length < 5) {
      issues.push(`subtitles.vtt has very few lines (${vttLines.length}), might be empty or minimal`);
    }

    // Buscar timestamps
    const hasTimestamps = /\d{2}:\d{2}:\d{2}/.test(vttContent);
    if (!hasTimestamps) {
      issues.push('subtitles.vtt missing timestamp format');
    }
  }

  if (assExists) {
    const assContent = fs.readFileSync(assPath, 'utf8');
    if (!assContent.includes('[Events]')) {
      issues.push('subtitles.ass missing [Events] section');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    vttExists,
    assExists,
  };
}

/**
 * Busca evidencia de que se usó filter de subtítulos en render
 * Busca en render-metadata.json o logs
 */
function findRenderSubtitleFilterEvidence(videoPath) {
  const videoDir = path.dirname(videoPath);
  const renderMetadataPath = path.join(videoDir, 'render-metadata.json');
  const genMetadataPath = path.join(videoDir, 'generation-metadata.json');
  const renderCommandPath = path.join(videoDir, 'render-command.log');

  const evidence = {
    found: false,
    sources: [],
  };

  // 1. Buscar en generation-metadata
  if (fs.existsSync(genMetadataPath)) {
    try {
      const genMetadata = JSON.parse(fs.readFileSync(genMetadataPath, 'utf8'));
      if (genMetadata.subtitlesBurnedIn === true) {
        evidence.found = true;
        evidence.sources.push({
          file: 'generation-metadata.json',
          claim: 'subtitlesBurnedIn: true',
          weight: 'low', // metadata can lie
        });
      }
    } catch (err) {
      logger.warn('[CHECK_21] Error reading generation-metadata:', err.message);
    }
  }

  // 2. Buscar en render-metadata
  if (fs.existsSync(renderMetadataPath)) {
    try {
      const renderMetadata = JSON.parse(fs.readFileSync(renderMetadataPath, 'utf8'));
      if (renderMetadata.subtitleTimingMode || renderMetadata.wordAlignmentEngine) {
        evidence.sources.push({
          file: 'render-metadata.json',
          claim: `subtitleTimingMode=${renderMetadata.subtitleTimingMode}`,
          weight: 'medium',
        });
      }
    } catch (err) {
      logger.warn('[CHECK_21] Error reading render-metadata:', err.message);
    }
  }

  // 3. Buscar en render-command.log si existe
  if (fs.existsSync(renderCommandPath)) {
    try {
      const cmdLog = fs.readFileSync(renderCommandPath, 'utf8');
      if (cmdLog.includes('subtitles=') || cmdLog.includes('ass=') || cmdLog.includes('drawtext')) {
        evidence.found = true;
        evidence.sources.push({
          file: 'render-command.log',
          claim: 'contains subtitles/ass/drawtext filter',
          weight: 'high',
        });
      }
    } catch (err) {
      logger.warn('[CHECK_21] Error reading render-command.log:', err.message);
    }
  }

  return evidence;
}

/**
 * Ejecuta CHECK 21 completo
 * Retorna { ready: boolean, reason?: string, details: {...} }
 */
function checkSubtitlesBurned(videoPath, framesOutputDir = null) {
  const details = {
    videoPath,
    embeddedSubtitleStreams: false,
    subtitleFilesValid: false,
    renderFilterEvidence: false,
    framesExtracted: [],
    issues: [],
  };

  logger.info('[CHECK_21] Starting subtitle burn validation');

  // 1. Comprobar subtitle streams embebidos
  const hasEmbedded = hasEmbeddedSubtitleStreams(videoPath);
  details.embeddedSubtitleStreams = hasEmbedded;

  if (hasEmbedded) {
    logger.info('[CHECK_21] Found embedded subtitle streams ✓');
  } else {
    details.issues.push('No embedded subtitle streams in MP4 (subtitles.vtt alone is not enough)');
  }

  // 2. Validar que archivos de subtítulos existen
  const filesValid = validateSubtitleFiles(videoPath);
  details.subtitleFilesValid = filesValid.valid;

  if (!filesValid.valid) {
    details.issues.push(...filesValid.issues);
  }

  // 3. Buscar evidencia de filter en render
  const evidence = findRenderSubtitleFilterEvidence(videoPath);
  details.renderFilterEvidence = evidence.found;
  details.renderEvidenceSources = evidence.sources;

  if (evidence.found) {
    logger.info('[CHECK_21] Found render filter evidence ✓');
  } else {
    details.issues.push('No evidence found that subtitles filter was used in render command');
  }

  // 4. Extraer frames si se solicita (para revisión manual)
  if (framesOutputDir) {
    const frames = extractFramesForSubtitleValidation(videoPath, framesOutputDir);
    details.framesExtracted = frames;

    if (frames.length > 0) {
      logger.info(`[CHECK_21] Extracted ${frames.length} frames for visual inspection`);
    }
  }

  // 5. CRÍTICO: mov_text stream NO es suficiente
  // INCIDENT PREVENTION: El incidente anterior tuvo mov_text pero sin texto visible
  // REQUERIMIENTO ESTRICTO:
  // Debe haber RENDER-COMMAND.LOG explícito que demuestre que se aplicó subtitles/ass/drawtext filter
  // mov_text stream SOLO no es prueba de que hay texto quemado visualmente

  const hasRenderCommandLog = fs.existsSync(path.join(path.dirname(videoPath), 'render-command.log'));
  const hasHighWeightEvidence = evidence.sources.some(s => s.weight === 'high');

  // MUST have render-command.log with high-weight evidence OR equivalent proof
  const hasValidBurnedSubtitles = hasRenderCommandLog && hasHighWeightEvidence;

  if (!hasValidBurnedSubtitles) {
    if (!hasRenderCommandLog) {
      details.issues.push('CRITICAL: No render-command.log found - cannot verify subtitles were burned with ffmpeg filter');
    }
    if (!hasHighWeightEvidence) {
      details.issues.push('No high-weight evidence of render filter (subtitles=, ass=, drawtext)');
    }

    logger.error('[CHECK_21] FAIL - STRICT MODE', {
      videoPath,
      hasRenderCommandLog,
      hasRenderFilter: hasHighWeightEvidence,
      issues: details.issues,
    });

    return {
      ready: false,
      reason: 'CHECK_21_SUBTITLES_NOT_BURNED_OR_NOT_VISIBLE',
      details,
    };
  }

  if (details.issues.length > 0) {
    // Problemas detectados pero tal vez se pueden ignorar
    logger.warn('[CHECK_21] Issues but passing:', {
      videoPath,
      issues: details.issues,
    });
  }

  logger.info('[CHECK_21] PASS', {
    videoPath,
    hasEmbedded,
    hasEvidence: evidence.found,
  });

  return {
    ready: true,
    details,
  };
}

module.exports = {
  checkSubtitlesBurned,
  hasEmbeddedSubtitleStreams,
  validateSubtitleFiles,
  findRenderSubtitleFilterEvidence,
  extractFramesForSubtitleValidation,
};
