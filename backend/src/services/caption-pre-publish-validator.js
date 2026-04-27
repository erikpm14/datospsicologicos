/**
 * caption-pre-publish-validator.js
 *
 * Valida que TODOS los vídeos tengan captions-debug.json válido
 * ANTES de permitir publicación.
 *
 * Requisitos para publicación:
 * 1. captions-debug.json DEBE existir
 * 2. driftStatus != "warning"
 * 3. captionSource != "caption_sync_fallback" (solo en slots críticos)
 * 4. captionCount > 0
 * 5. lastCaption.end <= audioDuration
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

/**
 * Valida que captions-debug.json exista y cumpla requisitos pre-publish
 *
 * @param {string} videoId
 * @param {string} debugJsonPath
 * @param {object} options - { allowFallbackForEmergency: boolean }
 * @returns {object} { ok: boolean, reason: string, debugData: object|null }
 */
function validateCaptionsForPublish(videoId, debugJsonPath = null, options = {}) {
  const { allowFallbackForEmergency = false } = options;
  const debugPath =
    debugJsonPath ||
    path.join(OUTPUT_DIR, videoId, 'captions-debug.json');

  // 1. Archivo DEBE existir
  if (!fs.existsSync(debugPath)) {
    return {
      ok: false,
      reason: 'CAPTIONS_MISSING | captions-debug.json no existe',
      debugData: null,
    };
  }

  let debugData;
  try {
    debugData = JSON.parse(fs.readFileSync(debugPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      reason: `CAPTIONS_INVALID_JSON | ${err.message}`,
      debugData: null,
    };
  }

  const checks = [];

  // 2. Caption count > 0
  if (!debugData.captionsCount || debugData.captionsCount <= 0) {
    checks.push('ZERO_CAPTIONS | captionCount=' + (debugData.captionsCount || 0));
  }

  // 3. Drift status: en emergencia, permitir drift mayor
  const maxDriftAllowed = allowFallbackForEmergency ? 1.5 : debugData.drift?.maxAcceptable || 0.35;
  if (debugData.drift?.value > maxDriftAllowed) {
    checks.push(`DRIFT_CRITICAL | drift=${debugData.drift.value?.toFixed(3)}s > ${maxDriftAllowed}s`);
  } else if (debugData.drift?.status === 'warning' && !allowFallbackForEmergency) {
    checks.push(`DRIFT_WARNING | drift=${debugData.drift.value?.toFixed(3)}s > ${debugData.drift.maxAcceptable}s`);
  }

  // 4. Caption source: bloquear fallback EXCEPTO en emergencia
  const source = debugData.source || debugData.captionSource || 'unknown';
  if (source === 'caption_sync_fallback') {
    if (!allowFallbackForEmergency) {
      checks.push(`CAPTION_SOURCE_FALLBACK | usar fallback no es óptimo para este slot`);
    } else {
      // Permitir en emergencia pero con advertencia
      checks.push(`CAPTION_SOURCE_FALLBACK_EMERGENCY | captions VÁLIDOS pero DEGRADADOS`);
    }
  }

  // 5. Last caption end <= audio duration
  if (debugData.lastCaption) {
    const { end } = debugData.lastCaption;
    const { audioDuration } = debugData;
    if (end > audioDuration + 0.05) {
      checks.push(`CAPTION_OVERFLOW | lastCaption.end=${end.toFixed(3)}s > duration=${audioDuration.toFixed(3)}s`);
    }
  }

  // En emergencia: permitir fallback pero devolver "ok" con advertencia
  // En producción: bloquear fallback
  const hasEmergencyFallback = checks.some(c => c.includes('FALLBACK_EMERGENCY'));
  const hasBlockingIssues = checks.filter(c => !c.includes('FALLBACK_EMERGENCY')).length > 0;

  if (hasBlockingIssues || (hasEmergencyFallback && !allowFallbackForEmergency)) {
    return {
      ok: false,
      reason: checks.join(' | '),
      debugData,
    };
  }

  if (hasEmergencyFallback && allowFallbackForEmergency) {
    // ADVERTENCIA: devolver ok pero marcar como degradado
    return {
      ok: true,
      reason: checks.join(' | ') + ' [EMERGENCY_FALLBACK_ACCEPTED]',
      debugData,
      degraded: true,
    };
  }

  // ✅ VÁLIDO
  return {
    ok: true,
    reason: `CAPTIONS_VALID | source=${source} | drift=${debugData.drift?.status || 'unknown'} | count=${debugData.captionsCount}`,
    debugData,
  };
}

/**
 * Obtiene información de captions del próximo vídeo a publicar
 */
function getCaptionsInfoForNextVideo(videoId) {
  const debugPath = path.join(OUTPUT_DIR, videoId, 'captions-debug.json');
  const validation = validateCaptionsForPublish(videoId, debugPath);

  return {
    videoId,
    validation,
    debugPath,
    exists: fs.existsSync(debugPath),
  };
}

/**
 * Log estructurado de validación de captions
 */
function logCaptionValidation(videoId, validation, action = 'CHECK') {
  const status = validation.ok ? 'PASS' : 'BLOCKED';
  const source = validation.debugData?.source || 'unknown';
  const drift = validation.debugData?.drift?.status || 'unknown';

  logger.info(
    `NEXT_SLOT_CAPTION_${action}_${status} | videoId=${videoId} | source=${source} | drift=${drift} | ${validation.reason}`
  );

  return {
    videoId,
    status,
    source,
    drift,
    reason: validation.reason,
  };
}

module.exports = {
  validateCaptionsForPublish,
  getCaptionsInfoForNextVideo,
  logCaptionValidation,
};
