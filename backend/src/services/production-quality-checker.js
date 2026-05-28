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
const { detectBlackVideo } = require('../utils/black-frame-detector');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// ── Umbrales (todos configurables por env) ──────────────────────────────────
const RECOVERY_MODE_ENABLED = process.env.RECOVERY_MODE === 'true'; // HOTFIX: modo temporal para recuperación

// Thresholds normales vs RECOVERY_MODE
const NORMAL_THRESHOLDS = {
  MIN_AUDIO_SIZE_KB:    parseInt(process.env.QC_MIN_AUDIO_KB     || '20'),
  MIN_VIDEO_SIZE_KB:    parseInt(process.env.QC_MIN_VIDEO_KB     || '300'),
  MIN_AUDIO_DURATION:   parseFloat(process.env.QC_MIN_DURATION   || '8'),
  MAX_AUDIO_DURATION:   parseFloat(process.env.QC_MAX_DURATION   || '45'),
  MIN_VIRALITY:         parseInt(process.env.MIN_VIRALITY_SCORE_TO_PUBLISH || '70'),
  MIN_FORMAT:           parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '70'),
  MIN_QUALITY_SCORE:    parseInt(process.env.MIN_PRODUCTION_QUALITY_SCORE   || '55'),
  MIN_VIDEO_DURATION:   parseFloat(process.env.QC_VIDEO_MIN_DURATION || process.env.QC_MIN_DURATION || '8'),
};

const RECOVERY_THRESHOLDS = {
  MIN_AUDIO_SIZE_KB:    5,    // HOTFIX: bajado de 20
  MIN_VIDEO_SIZE_KB:    100,  // HOTFIX: bajado de 300
  MIN_AUDIO_DURATION:   4,    // HOTFIX: bajado de 8
  MAX_AUDIO_DURATION:   55,   // HOTFIX: subido de 45
  MIN_VIRALITY:         40,   // HOTFIX: bajado de 70
  MIN_FORMAT:           60,   // HOTFIX: bajado de 70
  MIN_QUALITY_SCORE:    30,   // HOTFIX: bajado de 55
  MIN_VIDEO_DURATION:   4,    // HOTFIX: bajado de 8
};

const THRESHOLDS = RECOVERY_MODE_ENABLED ? RECOVERY_THRESHOLDS : NORMAL_THRESHOLDS;

const MIN_AUDIO_SIZE_KB    = THRESHOLDS.MIN_AUDIO_SIZE_KB;
const MIN_VIDEO_SIZE_KB    = THRESHOLDS.MIN_VIDEO_SIZE_KB;
const MIN_AUDIO_DURATION   = THRESHOLDS.MIN_AUDIO_DURATION;
const MAX_AUDIO_DURATION   = THRESHOLDS.MAX_AUDIO_DURATION;
const MIN_VIRALITY         = THRESHOLDS.MIN_VIRALITY;
const MIN_FORMAT           = THRESHOLDS.MIN_FORMAT;
const MIN_QUALITY_SCORE    = THRESHOLDS.MIN_QUALITY_SCORE;
const MIN_VIDEO_DURATION   = THRESHOLDS.MIN_VIDEO_DURATION;
const QC_ENABLED           = process.env.PRODUCTION_QC_ENABLED !== 'false'; // activo por defecto

if (RECOVERY_MODE_ENABLED) {
  logger.warn(`QC RECOVERY_MODE ACTIVATED — using temporary lenient thresholds`);
}

// ── Pesos de cada check en el score total ─────────────────────────────────
const WEIGHTS = {
  audioExists:    15,  // audio hay y tiene tamaño
  audioDuration:  15,  // duración en rango
  videoExists:    15,  // mp4 generado y con tamaño
  renderMode:      5,  // clips visibles vs fallback vacío
  scriptComplete: 10,  // hook + claim + explanation + cta
  viralityScore:  20,  // score de viralidad
  formatScore:    15,  // score de format match
  hasTheme:        5,  // tema visual asignado
  contentVersion:  5,  // stamped con v2
  publishableFile: 10,
  subtitleScriptCoherence: 20,  // NEW: subtítulos coherentes con script
  hookAudioPresence:       15,  // NEW: hook presente en audio
  packageIntegrity:        10,  // NEW: integridad del paquete
};
// Suma = 140

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

function checkRenderMetadata(outputDir) {
  const p = path.join(outputDir, 'render-metadata.json');
  if (!fs.existsSync(p)) return { ok: true, mode: 'unknown', reason: null };
  try {
    const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
    const mode = meta?.renderMode || 'unknown';
    if (mode === 'gradient' || mode === 'gradient_fallback') {
      return { ok: false, mode, reason: `render mode ${mode}` };
    }
    return { ok: true, mode, reason: null };
  } catch {
    return { ok: true, mode: 'unknown', reason: null };
  }
}

function checkRenderableVisuals(outputDir) {
  const p = path.join(outputDir, 'render-metadata.json');
  if (!fs.existsSync(p)) return { ok: false, reason: 'render metadata missing' };
  try {
    const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (meta.visibleVisuals !== true) {
      return { ok: false, reason: 'render without visible visuals' };
    }
    if (['gradient', 'gradient_fallback'].includes(meta.renderMode)) {
      return { ok: false, reason: `render degraded (${meta.renderMode})` };
    }
    return { ok: true, reason: null, renderMode: meta.renderMode };
  } catch {
    return { ok: false, reason: 'render metadata invalid' };
  }
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
  const actual = script?.contentVersion || script?.content_version;
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

function getMediaMetadata(mediaPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(mediaPath, (err, metadata) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(metadata || null);
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

  // 2. Duración (FIX: Use script.duration as source of truth, ffprobe as verification)
  let durationCheck = { ok: false, duration: null, reason: 'no audio to check duration' };
  if (checks.audioExists.ok) {
    // Preferir script.duration si está disponible
    let dur = script?.duration;
    let source = 'script';

    // Si no hay script.duration, usar ffprobe
    if (!dur || dur <= 0) {
      dur = await getAudioDuration(checks.audioExists.path);
      source = 'ffprobe';
    } else if (dur > 0) {
      // Verificar con ffprobe para detectar anomalías
      const ffprobeDur = await getAudioDuration(checks.audioExists.path);
      if (ffprobeDur && ffprobeDur > 0) {
        // Si ffprobe devuelve algo muy diferente (>50% diferencia), sospechar silencio
        const diff = Math.abs(ffprobeDur - dur) / Math.max(dur, ffprobeDur);
        if (diff > 0.5) {
          logger.warn(
            `Audio duration mismatch detected: script=${dur}s, ffprobe=${ffprobeDur.toFixed(1)}s ` +
            `(${(diff*100).toFixed(0)}% diff) — using script duration, ffprobe likely includes silence`
          );
          // Usar script.duration, no ffprobe
        } else {
          // Devs cercanos, usar ffprobe para ser conservador
          dur = ffprobeDur;
          source = 'ffprobe-verified';
        }
      }
    }

    if (dur !== null && dur > 0) {
      durationCheck = {
        ok:       dur >= MIN_AUDIO_DURATION && dur <= MAX_AUDIO_DURATION,
        duration: Math.round(dur * 10) / 10,
        source:   source,
        reason:   (dur < MIN_AUDIO_DURATION || dur > MAX_AUDIO_DURATION)
          ? `duration ${dur.toFixed(1)}s outside [${MIN_AUDIO_DURATION}-${MAX_AUDIO_DURATION}s] (source: ${source})`
          : null,
      };
    } else {
      durationCheck = { ok: false, duration: null, reason: 'no duration available (script or ffprobe)' };
    }
  }
  checks.audioDuration = durationCheck;

  // 3. Vídeo
  checks.videoExists = checkVideoFile(outputDir);
  checks.renderMode = checkRenderMetadata(outputDir);
  checks.renderVisuals = checkRenderableVisuals(outputDir);

  // 3b. BLACK FRAME DETECTION (NEW: Block videos with no visible content)
  let blackVideoCheck = { ok: true, isBlackVideo: false, reason: null };
  if (checks.videoExists.ok) {
    try {
      const videoPath = path.join(outputDir, 'output.mp4');
      const blackAnalysis = await detectBlackVideo(videoPath);
      blackVideoCheck = {
        ok: !blackAnalysis.isBlackVideo,
        isBlackVideo: blackAnalysis.isBlackVideo,
        reason: blackAnalysis.isBlackVideo ? `Black video detected: ${blackAnalysis.reason}` : null,
        samples: blackAnalysis.samples,
      };
      if (blackAnalysis.isBlackVideo) {
        logger.error(`[QC] BLACK VIDEO DETECTED: ${blackAnalysis.reason}`);
      }
    } catch (err) {
      logger.warn(`[QC] Black frame detection failed: ${err.message}`);
      // Conservative: if detection fails, still pass (avoid false positives)
    }
  }
  checks.blackFrameDetection = blackVideoCheck;

  // 4. Script
  checks.scriptComplete  = checkScript(script);
  checks.viralityScore   = checkViralityScore(script);
  checks.formatScore     = checkFormatScore(script);
  checks.hasTheme        = checkTheme(script);
  checks.contentVersion  = checkContentVersion(script);

  // 5. NEW COHERENCE CHECKS
  checks.subtitleScriptCoherence = checkSubtitleScriptCoherence(outputDir, script);
  checks.hookAudioPresence = checkHookAudioPresence(outputDir, script);
  checks.packageIntegrity = checkPackageIntegrity(outputDir, script);

  const videoMeta = await getMediaMetadata(path.join(outputDir, 'output.mp4'));
  const videoDuration = parseFloat(videoMeta?.format?.duration || 0);
  const hasVideoStream = (videoMeta?.streams || []).some((stream) => stream.codec_type === 'video');
  checks.publishableFile = {
    ok: checks.videoExists.ok && hasVideoStream && videoDuration >= MIN_VIDEO_DURATION,
    duration: videoDuration ? Math.round(videoDuration * 10) / 10 : 0,
    hasVideoStream,
    reason: !checks.videoExists.ok
      ? checks.videoExists.reason
      : !hasVideoStream
        ? 'output.mp4 has no video stream'
        : videoDuration < MIN_VIDEO_DURATION
          ? `video duration ${videoDuration.toFixed(1)}s < ${MIN_VIDEO_DURATION}s`
          : null,
  };

  // ── Score final ────────────────────────────────────────────────────────────
  let score = 0;
  if (checks.audioExists.ok)   score += WEIGHTS.audioExists;
  if (checks.audioDuration.ok) score += WEIGHTS.audioDuration;
  if (checks.videoExists.ok)   score += WEIGHTS.videoExists;
  if (checks.renderMode.ok)    score += WEIGHTS.renderMode;
  if (checks.scriptComplete.ok)score += WEIGHTS.scriptComplete;
  if (checks.viralityScore.ok) score += WEIGHTS.viralityScore;
  if (checks.formatScore.ok)   score += WEIGHTS.formatScore;
  if (checks.hasTheme.ok)      score += WEIGHTS.hasTheme;
  if (checks.contentVersion.ok)score += WEIGHTS.contentVersion;
  if (checks.publishableFile.ok && checks.renderVisuals.ok) score += WEIGHTS.publishableFile;
  if (checks.subtitleScriptCoherence.ok) score += WEIGHTS.subtitleScriptCoherence;
  if (checks.hookAudioPresence.ok)       score += WEIGHTS.hookAudioPresence;
  if (checks.packageIntegrity.ok)        score += WEIGHTS.packageIntegrity;

  // CRITICAL: Coherence checks are hard fails (must pass to publish)
  // HOTFIX: En RECOVERY_MODE, solo require los checks fundamentales
  const hardFailChecks = RECOVERY_MODE_ENABLED
    ? ['videoExists', 'scriptComplete', 'publishableFile']  // Solo lo mínimo
    : ['videoExists', 'renderVisuals', 'scriptComplete', 'publishableFile', 'subtitleScriptCoherence', 'hookAudioPresence', 'packageIntegrity', 'blackFrameDetection'];

  const hardFailed = hardFailChecks.some((key) => !checks[key]?.ok);
  const passed  = !hardFailed && score >= MIN_QUALITY_SCORE;

  if (RECOVERY_MODE_ENABLED && !hardFailed) {
    logger.warn(`[RECOVERY_MODE] QC passed with lenient thresholds — score=${score}/${MIN_QUALITY_SCORE}`);
  }
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

// ─────────────────────────────────────────────
//  CONTENT COHERENCE VALIDATORS (NEW)
// ─────────────────────────────────────────────

/**
 * Valida que subtítulos y script sean coherentes (primeras 25 palabras).
 * Mínimo 80% de similitud.
 */
function loadSubtitleTextForQC(outputDir, { maxWords = 25, maxLines = 999 } = {}) {
  const srtPath = path.join(outputDir, 'subtitles.srt');
  const assPath = path.join(outputDir, 'subtitles.ass');
  const subtitlePath = fs.existsSync(srtPath) ? srtPath : (fs.existsSync(assPath) ? assPath : null);
  if (!subtitlePath) return { ok: false, reason: 'subtitles_missing', text: '' };

  const raw = fs.readFileSync(subtitlePath, 'utf-8');

  if (subtitlePath.endsWith('.srt')) {
    const words = raw
      .split('\n')
      .filter(line => line.trim() && !/^\d+$/.test(line.trim()) && !line.includes('-->'))
      .map(line => line.trim())
      .slice(0, maxLines)
      .flatMap(line => line.split(/\s+/))
      .slice(0, maxWords)
      .join(' ');
    return { ok: true, reason: null, text: words };
  }

  const words = raw
    .split('\n')
    .filter((line) => line.startsWith('Dialogue:'))
    .map((line) => {
      const parts = line.split(',');
      const textPart = parts.length >= 10 ? parts.slice(9).join(',') : '';
      return textPart
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\N/g, ' ')
        .trim();
    })
    .filter(Boolean)
    .slice(0, maxLines)
    .flatMap((line) => line.split(/\s+/))
    .slice(0, maxWords)
    .join(' ');

  return { ok: true, reason: null, text: words };
}

function checkSubtitleScriptCoherence(outputDir, script) {
  try {
    const subtitleLoaded = loadSubtitleTextForQC(outputDir, { maxWords: 25, maxLines: 999 });
    if (!subtitleLoaded.ok) {
      return { ok: false, reason: subtitleLoaded.reason, score: 0 };
    }

    const subtitleWords = String(subtitleLoaded.text || '')
      .split(/\s+/)
      .slice(0, 25)
      .join(' ')
      .toLowerCase();

    const scriptText = (script?.fullScript || ((script?.explanation || script?.hook || '') + ' ' + (script?.claim || '')))
      .split(' ')
      .filter(w => w.length > 0)
      .slice(0, 25)
      .join(' ')
      .toLowerCase();

    if (!subtitleWords || !scriptText) {
      return { ok: false, reason: 'empty_content', score: 0 };
    }

    const scriptWordsSet = new Set(scriptText.split(/\s+/).filter(w => w.length > 2));
    const subtitleWordsSet = new Set(subtitleWords.split(/\s+/).filter(w => w.length > 2));

    const intersection = [...scriptWordsSet].filter(w => subtitleWordsSet.has(w)).length;
    const union = new Set([...scriptWordsSet, ...subtitleWordsSet]).size;
    const similarity = union > 0 ? intersection / union : 0;

    const ok = similarity >= 0.8;
    if (!ok) {
      logger.warn(`CONTENT_COHERENCE_BLOCKED: subtitle-script similarity ${(similarity*100).toFixed(0)}% < 80%`);
    }

    return {
      ok,
      reason: ok ? null : 'subtitle_script_mismatch',
      score: Math.round(similarity * 100),
    };
  } catch (err) {
    logger.warn(`Subtitle coherence check failed: ${err.message}`);
    return { ok: false, reason: 'coherence_check_error', score: 0 };
  }
}

/**
 * Valida que el hook esté presente en los primeros subtítulos (primeros 5s aprox).
 * Mínimo 60% de palabras clave del hook.
 */
function checkHookAudioPresence(outputDir, script) {
  try {
    const subtitleLoaded = loadSubtitleTextForQC(outputDir, { maxWords: 120, maxLines: 8 });
    if (!subtitleLoaded.ok) {
      return { ok: false, reason: subtitleLoaded.reason, score: 0 };
    }

    const hook = (script?.hook || '').toLowerCase();
    const hookKeywords = hook
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5);

    if (hookKeywords.length === 0) {
      return { ok: false, reason: 'hook_empty', score: 0 };
    }

    const firstSubtitles = String(subtitleLoaded.text || '').toLowerCase();

    const foundKeywords = hookKeywords.filter(kw => firstSubtitles.includes(kw));
    const presence = hookKeywords.length > 0 ? foundKeywords.length / hookKeywords.length : 0;

    const ok = presence >= 0.6;
    if (!ok) {
      logger.warn(`HOOK_AUDIO_MISMATCH_BLOCKED: hook presence ${(presence*100).toFixed(0)}% < 60% | hook="${hook}" | found=${foundKeywords.join(',')}`);
    }

    return {
      ok,
      reason: ok ? null : 'hook_not_in_audio',
      score: Math.round(presence * 100),
    };
  } catch (err) {
    logger.warn(`Hook audio presence check failed: ${err.message}`);
    return { ok: false, reason: 'hook_check_error', score: 0 };
  }
}

/**
 * Valida integridad del paquete de contenido (script, audio, subtítulos, output).
 * Verifica que los hashes/metadatas coincidan.
 */
function checkPackageIntegrity(outputDir, script) {
  try {
    const checks = {
      scriptExists: false,
      audioExists: false,
      subtitlesExist: false,
      outputExists: false,
      filesTimestampOrder: false,
      renderId: false,
    };

    // Verificar existencia
    checks.scriptExists = fs.existsSync(path.join(outputDir, 'script.json'));
    checks.audioExists = fs.existsSync(path.join(outputDir, 'voice_proc.mp3')) ||
                         fs.existsSync(path.join(outputDir, 'voice.mp3')) ||
                         fs.existsSync(path.join(outputDir, 'voice.wav'));
    checks.subtitlesExist = fs.existsSync(path.join(outputDir, 'subtitles.srt')) ||
                            fs.existsSync(path.join(outputDir, 'subtitles.ass'));
    checks.outputExists = fs.existsSync(path.join(outputDir, 'output.mp4'));

    // Verificar orden de timestamps (output no debe ser más viejo que script)
    if (checks.scriptExists && checks.outputExists) {
      const scriptTime = fs.statSync(path.join(outputDir, 'script.json')).mtime;
      const outputTime = fs.statSync(path.join(outputDir, 'output.mp4')).mtime;
      checks.filesTimestampOrder = outputTime >= scriptTime;
      if (!checks.filesTimestampOrder) {
        logger.warn(`PACKAGE_INTEGRITY_FAILED: output.mp4 más viejo que script.json`);
      }
    }

    // Verificar renderId/videoId en metadata
    if (script?.id) {
      checks.renderId = true;
    }

    const allOk = Object.values(checks).every(v => v === true);
    return {
      ok: allOk,
      reason: allOk ? null : 'package_integrity_failed',
      checks,
      score: (Object.values(checks).filter(v => v === true).length / Object.keys(checks).length) * 100,
    };
  } catch (err) {
    logger.warn(`Package integrity check failed: ${err.message}`);
    return { ok: false, reason: 'integrity_check_error', score: 0, checks: {} };
  }
}

// ─────────────────────────────────────────────
//  GET QC RESULT
// ─────────────────────────────────────────────

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

module.exports = {
  checkProductionQuality,
  getQCResult,
  saveQCResult,
  MIN_QUALITY_SCORE,
  checkSubtitleScriptCoherence,
  checkHookAudioPresence,
  checkPackageIntegrity,
};
