/**
 * publish-validator.service.js
 *
 * Validador DURO antes de publicar cualquier vídeo.
 * Rechaza cualquier vídeo que NO cumpla con v4.1 confessional.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DISCARDED_DIR = path.resolve('./queue/discarded-invalid-current');

function ensureDiscardedDir() {
  if (!fs.existsSync(DISCARDED_DIR)) {
    fs.mkdirSync(DISCARDED_DIR, { recursive: true });
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
    // Humanity Score
    humanityScore: {
      value: prefabScript.humanity_score || metadata.humanity_score || 0,
      required: (v) => v >= 70,
      label: 'Humanity score must be >= 70',
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

  // Validar
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
    return {
      valid: false,
      reason: 'Validation failed',
      failures,
    };
  }

  return {
    valid: true,
    reason: 'All criteria met',
    videoId: videoData.id || 'unknown',
    duration: prefabScript.durationSeconds,
    viralityScore: prefabScript.viralityScore,
    humanityScore: prefabScript.humanity_score || metadata.humanity_score,
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
  discardInvalidVideo,
  DISCARDED_DIR,
};
