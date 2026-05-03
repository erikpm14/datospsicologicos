/**
 * publish-validator.service.js
 *
 * Validador DURO antes de publicar cualquier vídeo.
 * Rechaza cualquier vídeo que NO cumpla con v4.1 confessional.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const logger = require('../utils/logger');
const { validateVideoV4 } = require('../contracts/video-v4.contract');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

const DISCARDED_DIR = path.resolve('./queue/discarded-invalid-current');

function ensureDiscardedDir() {
  if (!fs.existsSync(DISCARDED_DIR)) {
    fs.mkdirSync(DISCARDED_DIR, { recursive: true });
  }
}

/**
 * QC DURO: Validar stream de video, frames, audio, subtítulos
 * BLOQUEA vídeos negros/vacíos ANTES de publicar
 */
function validateVideoQC(outputPath, assPath, videoId) {
  const checks = [];

  try {
    // 1. Verificar que archivo existe y tiene tamaño mínimo
    if (!fs.existsSync(outputPath)) {
      return {
        valid: false,
        error: 'OUTPUT_FILE_NOT_FOUND',
        details: `File not found: ${outputPath}`,
      };
    }

    const fileSize = fs.statSync(outputPath).size;
    if (fileSize < 300000) {
      checks.push({ name: 'File size > 300KB', passed: false, value: `${(fileSize/1024).toFixed(0)}KB` });
    } else {
      checks.push({ name: 'File size > 300KB', passed: true, value: `${(fileSize/1024/1024).toFixed(2)}MB` });
    }

    // 2. ffprobe validation
    try {
      const probeOutput = execFileSync(
        ffprobePath,
        ['-v', 'error', '-show_streams', outputPath],
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      );

      // Video stream
      const hasVideoStream = probeOutput.includes('codec_type=video');
      checks.push({ name: 'Video stream exists', passed: hasVideoStream });

      // Frames count
      const framesMatch = probeOutput.match(/nb_frames=(\d+)/);
      const frameCount = framesMatch ? parseInt(framesMatch[1]) : 0;
      checks.push({ name: 'Frame count > 0', passed: frameCount > 0, value: frameCount });

      // Codec h264
      const isH264 = probeOutput.includes('codec_name=h264');
      checks.push({ name: 'Codec h264', passed: isH264 });

      // Pixel format yuv420p
      const isYUV420p = probeOutput.includes('pix_fmt=yuv420p');
      checks.push({ name: 'Pixel format yuv420p', passed: isYUV420p });

      // Resolution
      const widthMatch = probeOutput.match(/width=1080/);
      const heightMatch = probeOutput.match(/height=1920/);
      const isResolution = widthMatch && heightMatch;
      checks.push({ name: 'Resolution 1080x1920', passed: isResolution });

      // Audio stream
      const hasAudioStream = probeOutput.includes('codec_type=audio');
      checks.push({ name: 'Audio stream exists', passed: hasAudioStream });

    } catch (err) {
      logger.error('FFPROBE_FAILED', { videoId, error: err.message });
      return {
        valid: false,
        error: 'FFPROBE_VALIDATION_FAILED',
        details: err.message,
      };
    }

    // 3. Subtítulos
    if (!fs.existsSync(assPath)) {
      checks.push({ name: 'Subtitles .ass exists', passed: false });
    } else {
      try {
        const assContent = fs.readFileSync(assPath, 'utf8');
        const dialogueCount = (assContent.match(/^Dialogue:/gm) || []).length;
        checks.push({ name: 'Subtitles have content', passed: dialogueCount > 0, value: `${dialogueCount} lines` });
      } catch (err) {
        checks.push({ name: 'Subtitles readable', passed: false });
      }
    }

    // Evaluar resultado
    const allPassed = checks.every(c => c.passed);
    const failures = checks.filter(c => !c.passed).map(c => c.name);

    if (!allPassed) {
      logger.warn('QC_HARD_FAIL', { videoId, failures });
      return {
        valid: false,
        error: 'QC_HARD_FAIL',
        failures,
        checks,
      };
    }

    logger.info('QC_HARD_PASS', { videoId, checks });
    return {
      valid: true,
      checks,
    };

  } catch (err) {
    logger.error('QC_VALIDATION_ERROR', { videoId, error: err.message });
    return {
      valid: false,
      error: 'QC_VALIDATION_ERROR',
      details: err.message,
    };
  }
}

/**
 * Validar vídeo antes de publicar
 */
function validateForPublish(videoData) {
  if (!videoData) {
    return { valid: false, reason: 'No video data' };
  }

  const prefabScript = videoData.data?.prefabScript || videoData.prefabScript || {};
  const metadata = videoData.data?.metadata || videoData.metadata || {};
  const videoId = videoData.id || prefabScript.videoId;

  // ═══════════════════════════════════════════════════════════════
  // QC DURO: VALIDAR STREAM DE VIDEO (FIRST GATE)
  // Detecta vídeos negros/vacíos ANTES de publicar
  // ═══════════════════════════════════════════════════════════════
  const outputPath = path.join(path.resolve('./output'), videoId, 'output.mp4');
  const assPath = path.join(path.resolve('./output'), videoId, 'subtitles.ass');
  const qcValidation = validateVideoQC(outputPath, assPath, videoId);
  if (!qcValidation.valid) {
    logger.error('QC_BLOCKED | publish', {
      videoId,
      error: qcValidation.error,
      failures: qcValidation.failures,
    });
    return {
      valid: false,
      reason: 'QC validation failed: video stream or subtitles invalid',
      qcErrors: qcValidation.failures,
      discarded: true,
    };
  }
  logger.info(`QC_PASS | publish | videoId=${videoId}`);

  // ═══════════════════════════════════════════════════════════════
  // V4.1 CONTRACT VALIDATION (SECOND GATE)
  // ═══════════════════════════════════════════════════════════════
  const v4Validation = validateVideoV4(prefabScript);
  if (!v4Validation.valid) {
    logger.warn('V4_BLOCKED | publish', {
      videoId: videoData.id,
      errors: v4Validation.errors,
    });
    return {
      valid: false,
      reason: 'V4.1 contract violation',
      v4Errors: v4Validation.errors,
    };
  }
  logger.info(`V4_PASS | publish | videoId=${videoData.id}`);

  // Criterios DUROS
  const checks = {
    // Duración
    duration: {
      value: prefabScript.durationSeconds || 0,
      required: (v) => v >= 26 && v <= 32,
      label: 'Duration must be 26-32s',
    },
    // Virality Score
    viralityScore: {
      value: prefabScript.viralityScore || 0,
      required: (v) => v >= 70,
      label: 'Virality score must be >= 70',
    },
    // Humanity Score (ESTRICTO >= 85)
    humanityScore: {
      value: prefabScript.humanityScore || prefabScript.humanity_score || metadata.humanity_score || 0,
      required: (v) => v >= 85,
      label: 'Humanity score must be >= 85 (no exceptions)',
    },
    // Structure Version (confessional)
    structureVersion: {
      value: prefabScript.structureVersion || '',
      required: (v) => v.includes('confessional') || v.includes('v4'),
      label: 'Must use confessional structure v4+',
    },
    // Retention Spike Version
    retentionSpikeVersion: {
      value: prefabScript.retentionSpikeVersion || metadata.retentionSpikeVersion || '',
      required: (v) => v === 'v4.1',
      label: 'Must use retention spike version v4.1',
    },
    // Render Mode
    renderMode: {
      value: prefabScript.renderMode || metadata.renderMode || '',
      required: (v) => v === 'video_use',
      label: 'Must use renderMode = video_use',
    },
    // Subtitle Timing
    subtitleTimingMode: {
      value: prefabScript.subtitleTimingMode || metadata.subtitleTimingMode || '',
      required: (v) => v === 'word_timestamps',
      label: 'Must use subtitleTimingMode = word_timestamps',
    },
    // Word Alignment Engine
    wordAlignmentEngine: {
      value: prefabScript.wordAlignmentEngine || metadata.wordAlignmentEngine || '',
      required: (v) => v === 'whisper',
      label: 'Must use wordAlignmentEngine = whisper',
    },
    // Topic restrictions
    topic: {
      value: prefabScript.topic || '',
      required: (v) => {
        const forbidden = ['productivity', 'cognitive_biases', 'attention', 'cerebro'];
        return !forbidden.includes(v);
      },
      label: 'Topic must not be productivity, cognitive_biases, attention, or cerebro',
    },
    // Script restrictions
    scriptContent: {
      value: (prefabScript.fullScript || '').toLowerCase(),
      required: (v) => {
        // No "cerebro" como eje central
        const hasCerebroAxis = v.includes('cerebro') && v.split('cerebro').length > 2;
        // No tono educativo ("aprende", "descubre", "secreto científico", etc)
        const isEducational = /aprende|descubre|secreto científico|ciencia|investigación|estudio/.test(v);
        return !hasCerebroAxis && !isEducational;
      },
      label: 'Script must not be brain-centric or educational tone',
    },
  };

  // Validar - RECHAZAR INMEDIATAMENTE SI FALLA
  const failures = [];
  for (const [key, check] of Object.entries(checks)) {
    if (!check.required(check.value)) {
      failures.push({
        field: key,
        value: check.value,
        reason: check.label,
      });
    }
  }

  if (failures.length > 0) {
    const failureReasons = failures.map((f) => `${f.field}=${f.value} (${f.reason})`).join(' | ');
    logger.warn('PUBLISH_REJECTED', {
      videoId: videoData.id,
      reasons: failureReasons,
      failureCount: failures.length,
      failures,
    });
    return {
      valid: false,
      reason: 'Quality standards not met',
      failureReasons,
      failures,
    };
  }

  logger.info('PUBLISH_APPROVED | V4.1 STRICT STANDARDS', {
    videoId: videoData.id,
    duration: prefabScript.durationSeconds,
    viralityScore: prefabScript.viralityScore,
    humanityScore: prefabScript.humanityScore,
  });

  return {
    valid: true,
    reason: 'All V4.1 strict quality standards met',
    videoId: videoData.id || 'unknown',
    duration: prefabScript.durationSeconds,
    viralityScore: prefabScript.viralityScore,
    humanityScore: prefabScript.humanityScore || metadata.humanity_score,
    standards: {
      duration: `${prefabScript.durationSeconds}s (26-32s required)`,
      virality: `${prefabScript.viralityScore}/100 (>=70 required)`,
      humanity: `${prefabScript.humanityScore}/100 (>=85 required)`,
    },
  };
}

/**
 * Mover vídeo a discarded si falla validación
 */
function discardInvalidVideo(videoData, doneFilePath) {
  try {
    ensureDiscardedDir();

    const filename = path.basename(doneFilePath);
    const discardPath = path.join(DISCARDED_DIR, filename);

    if (fs.existsSync(doneFilePath)) {
      fs.copyFileSync(doneFilePath, discardPath);
      fs.unlinkSync(doneFilePath); // Remove from queue/done

      logger.warn(`PublishValidator: moved to discarded: ${videoData.id}`, {
        reason: 'failed validation',
        path: discardPath,
      });

      return {
        success: true,
        discardedPath: discardPath,
      };
    }
  } catch (err) {
    logger.error('PublishValidator: failed to discard video', { error: err.message });
  }

  return { success: false };
}

module.exports = {
  validateForPublish,
  validateVideoQC,
  discardInvalidVideo,
  DISCARDED_DIR,
};
