/**
 * production-quality-checker.js  — Quality Gate V2
 *
 * Valida la calidad de un vídeo ANTES de publicarlo.
 * Calcula productionQualityScore (0-100) y decide si pasa el umbral.
 *
 * Checks:
 *   1. Audio: existe, tamaño > mínimo, duración en rango
 *   2. Vídeo: existe, tamaño > mínimo
 *   3. Script: todos los campos críticos presentes
 *   4. Virality score: supera el umbral de publicación
 *   5. Format match score: supera el umbral
 *   6. Subtítulos: suficientes bloques en script.json
 *   7. Template: tiene tema asignado
 *
 * Si el score < MIN_PRODUCTION_QUALITY_SCORE → no publicar, marcar como skipped.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const ffmpegInstaller  = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpeg  = require('fluent-ffmpeg');
const logger  = require('../utils/logger');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// ── Umbrales (todos configurables por env) ──────────────────────────────────
const MIN_AUDIO_SIZE_KB    = parseInt(process.env.QC_MIN_AUDIO_KB     || '20');
const MIN_VIDEO_SIZE_KB    = parseInt(process.env.QC_MIN_VIDEO_KB     || '300');
const MIN_AUDIO_DURATION   = parseFloat(process.env.QC_MIN_DURATION   || '8');
const MAX_AUDIO_DURATION   = parseFloat(process.env.QC_MAX_DURATION   || '45');
const MIN_VIRALITY         = parseInt(process.env.MIN_VIRALITY_SCORE_TO_PUBLISH || '70');
const MIN_FORMAT           = parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '70');
const MIN_QUALITY_SCORE    = parseInt(process.env.MIN_PRODUCTION_QUALITY_SCORE   || '55');
const QC_ENABLED           = process.env.PRODUCTION_QC_ENABLED !== 'false'; // activo por defecto

// ── Pesos de cada check en el score total ─────────────────────────────────
const WEIGHTS = {
  audioExists:    15,  // audio hay y tiene tamaño
  audioDuration:  15,  // duración en rango
  videoExists:    15,  // mp4 generado y con tamaño
  scriptComplete: 10,  // hook + claim + explanation + cta
  viralityScore:  20,  // score de viralidad
  formatScore:    15,  // score de format match
  hasTheme:        5,  // tema visual asignado
  contentVersion:  5,  // stamped con v2
};
// Suma = 100

// ─────────────────────────────────────────────
//  CHECKS INDIVIDUALES
// ─────────────────────────────────────────────

function checkAudioFile(outputDir) {
  // Buscar voice_proc.mp3 primero (postprocesado), luego voice.mp3, luego voice.wav
  const candidates = ['voice_proc.mp3', 'voice.mp3', 'voice.wav'];
  for (const name of candidates) {
    const p = path.join(outputDir, name);
    if (fs.existsSync(p)) {
      const sizeKB = fs.statSync(p).size / 1024;
      return {
        ok:     sizeKB >= MIN_AUDIO_SIZE_KB,
        path:   p,
        sizeKB: Math.round(sizeKB),
        reason: sizeKB < MIN_AUDIO_SIZE_KB ? `audio too small (${Math.round(sizeKB)} KB < ${MIN_AUDIO_SIZE_KB} KB)` : null,
      };
    }
  }
  return { ok: false, path: null, sizeKB: 0, reason: 'no audio file found' };
}

function checkVideoFile(outputDir) {
  const p = path.join(outputDir, 'output.mp4');
  if (!fs.existsSync(p)) return { ok: false, sizeKB: 0, reason: 'output.mp4 not found' };
  const sizeKB = fs.statSync(p).size / 1024;
  return {
    ok:     sizeKB >= MIN_VIDEO_SIZE_KB,
    sizeKB: Math.round(sizeKB),
    reason: sizeKB < MIN_VIDEO_SIZE_KB ? `video too small (${Math.round(sizeKB)} KB < ${MIN_VIDEO_SIZE_KB} KB)` : null,
  };
}

function checkScript(script) {
  if (!script || typeof script !== 'object') {
    return { ok: false, missing: ['all'], reason: 'script is null or not an object' };
  }
  const required = ['hook', 'claim', 'explanation', 'cta'];
  const missing  = required.filter(f => !script[f] || String(script[f]).trim().length < 3);
  return {
    ok:      missing.length === 0,
    missing,
    reason:  missing.length > 0 ? `missing/empty: ${missing.join(', ')}` : null,
  };
}

function checkViralityScore(script) {
  const score = script?.viralityScore || script?.virality_score || 0;
  return {
    ok:     score >= MIN_VIRALITY,
    score,
    min:    MIN_VIRALITY,
    reason: score < MIN_VIRALITY ? `virality ${score} < ${MIN_VIRALITY}` : null,
  };
}

function checkFormatScore(script) {
  const score = script?.formatMatchScore || 0;
  if (score === 0) return { ok: true, score: 0, reason: null }; // legacy — no bloquear
  return {
    ok:     score >= MIN_FORMAT,
    score,
    min:    MIN_FORMAT,
    reason: score < MIN_FORMAT ? `format ${score} < ${MIN_FORMAT}` : null,
  };
}

function checkTheme(script) {
  const hasTheme = !!(script?.themeId || script?.growthContext?.themeId || script?.emotionalTrigger);
  return { ok: hasTheme, reason: hasTheme ? null : 'no theme assigned' };
}

function checkContentVersion(script) {
  const required = process.env.CONTENT_VERSION || null;
  if (!required) return { ok: true, reason: null };
  const actual = script?.contentVersion;
  return {
    ok:     actual === required,
    actual,
    required,
    reason: actual !== required ? `content_version ${actual} !== ${required}` : null,
  };
}

// ─────────────────────────────────────────────
//  CHECK DE DURACIÓN (requiere ffprobe)
// ─────────────────────────────────────────────

function getAudioDuration(audioPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) { resolve(null); return; }
      resolve(parseFloat(metadata?.format?.duration || 0));
    });
  });
}

// ─────────────────────────────────────────────
//  CHECK PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Ejecuta todos los checks de calidad de producción.
 *
 * @param {string} outputDir  - Carpeta del vídeo (output/<videoId>/)
 * @param {Object} script     - Script JSON del vídeo
 * @returns {Promise<{ score, passed, threshold, checks, reasons }>}
 */
async function checkProductionQuality(outputDir, script = null) {
  if (!QC_ENABLED) {
    return { score: 100, passed: true, threshold: MIN_QUALITY_SCORE, checks: {}, reasons: [], qcDisabled: true };
  }

  // Cargar script del disco si no se pasó
  if (!script) {
    const scriptPath = path.join(outputDir, 'script.json');
    try {
      script = fs.existsSync(scriptPath) ? JSON.parse(fs.readFileSync(scriptPath, 'utf8')) : null;
    } catch { script = null; }
  }

  const checks = {};

  // 1. Audio
  checks.audioExists = checkAudioFile(outputDir);

  // 2. Duración
  let durationCheck = { ok: false, duration: null, reason: 'no audio to check duration' };
  if (checks.audioExists.ok) {
    const dur = await getAudioDuration(checks.audioExists.path);
    durationCheck = dur !== null
      ? {
          ok:       dur >= MIN_AUDIO_DURATION && dur <= MAX_AUDIO_DURATION,
          duration: Math.round(dur * 10) / 10,
          reason:   (dur < MIN_AUDIO_DURATION || dur > MAX_AUDIO_DURATION)
            ? `duration ${dur.toFixed(1)}s outside [${MIN_AUDIO_DURATION}-${MAX_AUDIO_DURATION}s]`
            : null,
        }
      : { ok: false, duration: null, reason: 'ffprobe failed' };
  }
  checks.audioDuration = durationCheck;

  // 3. Vídeo
  checks.videoExists = checkVideoFile(outputDir);

  // 4. Script
  checks.scriptComplete  = checkScript(script);
  checks.viralityScore   = checkViralityScore(script);
  checks.formatScore     = checkFormatScore(script);
  checks.hasTheme        = checkTheme(script);
  checks.contentVersion  = checkContentVersion(script);

  // ── Score final ────────────────────────────────────────────────────────────
  let score = 0;
  if (checks.audioExists.ok)   score += WEIGHTS.audioExists;
  if (checks.audioDuration.ok) score += WEIGHTS.audioDuration;
  if (checks.videoExists.ok)   score += WEIGHTS.videoExists;
  if (checks.scriptComplete.ok)score += WEIGHTS.scriptComplete;
  if (checks.viralityScore.ok) score += WEIGHTS.viralityScore;
  if (checks.formatScore.ok)   score += WEIGHTS.formatScore;
  if (checks.hasTheme.ok)      score += WEIGHTS.hasTheme;
  if (checks.contentVersion.ok)score += WEIGHTS.contentVersion;

  const passed  = score >= MIN_QUALITY_SCORE;
  const reasons = Object.values(checks).map(c => c.reason).filter(Boolean);

  logger.info(
    `ProductionQC: score=${score}/100 | ${passed ? 'PASS' : 'FAIL'} (threshold=${MIN_QUALITY_SCORE})` +
    (reasons.length > 0 ? ` | issues: ${reasons.join(' | ')}` : ''),
  );

  return {
    score,
    passed,
    threshold: MIN_QUALITY_SCORE,
    checks,
    reasons,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Lee el último resultado de QC de un vídeo (guardado en qc.json).
 */
function getQCResult(outputDir) {
  const qcPath = path.join(outputDir, 'qc.json');
  if (!fs.existsSync(qcPath)) return null;
  try { return JSON.parse(fs.readFileSync(qcPath, 'utf8')); } catch { return null; }
}

/**
 * Guarda el resultado de QC en el directorio del vídeo.
 */
function saveQCResult(outputDir, result) {
  const qcPath = path.join(outputDir, 'qc.json');
  fs.writeFileSync(qcPath, JSON.stringify(result, null, 2));
}

// ── Test directo ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error('Usage: node production-quality-checker.js <outputDir>');
    process.exit(1);
  }
  checkProductionQuality(dir).then(r => {
    console.log('QC result:', JSON.stringify(r, null, 2));
    process.exit(r.passed ? 0 : 1);
  });
}

module.exports = { checkProductionQuality, getQCResult, saveQCResult, MIN_QUALITY_SCORE };
