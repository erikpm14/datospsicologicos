/**
 * video-v4.contract.js
 * Fuente de verdad para V4.1
 * ESTÁNDARES ESTRICTOS - NO EXCEPCIONES
 */

const VideoV4Schema = {
  required: [
    'hook',
    'structureVersion',
    'retentionSpikeVersion',
    'renderMode',
    'subtitleTimingMode',
    'wordAlignmentEngine',
    'segments',
    'fullScript',
    'viralityScore',
    'humanityScore',
  ],

  constants: {
    structureVersion: 'confessional',
    retentionSpikeVersion: 'v4.1',
    renderMode: 'video_use',
    subtitleTimingMode: 'word_timestamps',
    wordAlignmentEngine: 'whisper',
  },

  validation: {
    // ESTRICTOS - sin excepciones
    minViralityScore: 70,
    maxViralityScore: 100,
    minHumanityScore: 85,
    maxHumanityScore: 100,
    minDuration: 26,
    maxDuration: 32,
  },
};

function validateVideoV4(script) {
  const errors = [];

  // Campos requeridos
  for (const field of VideoV4Schema.required) {
    if (!script[field]) {
      errors.push(`REJECT: Missing required field: ${field}`);
    }
  }

  // Constantes exactas
  for (const [key, value] of Object.entries(VideoV4Schema.constants)) {
    if (script[key] !== value) {
      errors.push(`REJECT: Invalid ${key}: expected '${value}', got '${script[key]}'`);
    }
  }

  // Estructura de segmentos
  if (!script.segments || !Array.isArray(script.segments) || script.segments.length === 0) {
    errors.push('REJECT: Invalid segments: must be non-empty array');
  }

  // Duración ESTRICTA: 26-32s (RECHAZAR si fuera)
  const duration = script.duration || script.durationSeconds;
  if (!duration || duration < VideoV4Schema.validation.minDuration || duration > VideoV4Schema.validation.maxDuration) {
    errors.push(
      `REJECT: Invalid duration: ${duration}s (required: ${VideoV4Schema.validation.minDuration}-${VideoV4Schema.validation.maxDuration}s)`
    );
  }

  // Virality ESTRICTA: >= 70 (RECHAZAR si < 70)
  if (!script.viralityScore || script.viralityScore < VideoV4Schema.validation.minViralityScore) {
    errors.push(
      `REJECT: Invalid viralityScore: ${script.viralityScore} (required: >= ${VideoV4Schema.validation.minViralityScore})`
    );
  }

  // Humanity ESTRICTA: >= 85 (RECHAZAR si < 85) — NO EXCEPCIONES
  if (!script.humanityScore || script.humanityScore < VideoV4Schema.validation.minHumanityScore) {
    errors.push(
      `REJECT: Invalid humanityScore: ${script.humanityScore} (required: >= ${VideoV4Schema.validation.minHumanityScore})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    scores: {
      virality: script.viralityScore || 0,
      humanity: script.humanityScore || 0,
      duration: duration || 0,
    },
  };
}

module.exports = {
  VideoV4Schema,
  validateVideoV4,
};
