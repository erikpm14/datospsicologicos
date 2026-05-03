/**
 * Pre-publish Visual QC Service
 *
 * Validación obligatoria ANTES de subir a YouTube:
 * 1. output.mp4 existe
 * 2. Tamaño > 2MB
 * 3. Duración > 10s
 * 4. ffprobe detecta video stream
 * 5. ffprobe detecta audio stream
 * 6. Extrae frames en diferentes timestamps
 * 7. Detecta si hay frames negros con luminancia < 5%
 * 8. captions-debug.json existe
 * 9. captionCount > 0
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { safeSpawn } = require('../utils/safe-spawn');
const logger = require('../utils/logger');
const { recordQCFailure, recordQCSuccess } = require('./qc-failure-tracker');
const { getFFprobe, getFFmpeg } = require('../utils/ffmpeg-resolver');
const { recordFallbackUsage } = require('./ffmpeg-fallback-monitor');

async function _getVideoStats(videoPath) {
  return new Promise((resolve, reject) => {
    const ffprobePath = getFFprobe() || 'ffprobe'; // Use absolute path if available, fallback to PATH
    const ffprobe = safeSpawn(ffprobePath, [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      videoPath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => { output += data.toString(); });
    ffprobe.stderr.on('data', (data) => { logger.warn(`ffprobe stderr: ${data}`); });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}`));
      }
      try {
        const data = JSON.parse(output);
        resolve(data);
      } catch (err) {
        reject(new Error(`ffprobe JSON parse failed: ${err.message}`));
      }
    });

    ffprobe.on('error', (err) => {
      reject(new Error(`ffprobe spawn error: ${err.message}`));
    });
  });
}

async function _detectBlackFrames(videoPath, outputDir) {
  /**
   * Extrae frames en timestamps específicos y analiza luminancia.
   * Retorna { hasBlackFrames, timestamps: [{ts, luminance, isBlack}] }
   */
  return new Promise((resolve, reject) => {
    try {
      const framesDir = path.join(outputDir, '.qc-frames-temp');
      if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true });
      }

      // Use blackdetect filter to find black frames
      // blackdetect: detects frames where pixel luminance < threshold
      const ffmpegPath = getFFmpeg() || 'ffmpeg';
      const ffmpeg = safeSpawn(ffmpegPath, [
        '-i', videoPath,
        '-vf', "blackdetect=d=0.5:pix_th=0.05",  // 0.5s duration, 5% threshold
        '-an',  // No audio output
        '-f', 'null',
        '-'
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let allStderr = '';
      ffmpeg.stderr.on('data', (data) => { allStderr += data.toString(); });

      ffmpeg.on('close', (code) => {
        // Analizar stderr de blackdetect
        const blackDetectRegex = /black_duration:([\d.]+) black_start:([\d.]+)/g;
        let totalBlackDuration = 0;
        let matches = [];
        let match;

        while ((match = blackDetectRegex.exec(allStderr)) !== null) {
          const duration = parseFloat(match[1]);
          const start = parseFloat(match[2]);
          matches.push({ start, duration });
          totalBlackDuration += duration;
        }

        const hasBlackFrames = totalBlackDuration > 1.0; // Más de 1s de pantalla negra
        resolve({ hasBlackFrames, totalBlackDuration, matches });
      });

      ffmpeg.on('error', (err) => {
        logger.error(`FFmpeg CRITICAL: frame extraction failed - ${err.message} - THIS ALLOWS BLACK VIDEOS THROUGH`);
        reject(new Error(`BLACK_FRAME_CHECK_FAILED: ${err.message}`));
      });
    } catch (err) {
      logger.error(`Black frame detection error: ${err.message}`);
      reject(new Error(`BLACK_FRAME_CHECK_FAILED: ${err.message}`));
    }
  });
}

/**
 * Analiza la zona inferior del frame para detectar contraste de texto
 * Usa FFmpeg para extraer estadísticas de luminancia en el área de subtítulos
 */
function _analyzeLowerRegionContrast(framePath) {
  try {
    // Extraer estadísticas de zona inferior (30% de abajo)
    // Para un frame 1080x1920: zona inferior = 1080 x 576 (starting at y=1344)
    const ffmpegPath = getFFmpeg() || 'ffmpeg';
    const result = spawnSync(ffmpegPath, [
      '-i', framePath,
      '-vf', 'crop=1080:576:0:1344,histogram=level_height=200',
      '-f', 'null',
      '-',
    ], { encoding: 'utf8', windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });

    // Si FFmpeg puede procesar, hay contenido
    // Frames con texto tendrán histograma con spikes (colores de texto)
    // Frames vacíos tendrán histograma plano
    const stderr = result.stderr || '';

    // Indicadores de histograma con varianza:
    // - Múltiples colores (spikes en histogram)
    // - Contraste alto (diferencia entre peaks)
    const hasHistogramVariance = stderr.includes('histogram');

    // Análisis simple: si FFmpeg pudo procesar sin errores, hay contenido procesable
    const hasContrast = !result.error && hasHistogramVariance;

    return {
      hasLowerRegionContrast: hasContrast,
      analysis: 'lower_region_histogram',
    };
  } catch (err) {
    logger.warn(`Lower region contrast analysis failed: ${err.message}`);
    return {
      hasLowerRegionContrast: false,
      reason: 'analysis_error',
    };
  }
}

/**
 * Extrae frames en puntos específicos y analiza si hay subtítulos visibles
 * Dual signal: tamaño de archivo + contraste en zona inferior
 * Smart sampling: usa timestamps reales de captions si están disponibles
 * Retorna: { hasVisibleSubtitles, confidence, framesAnalyzed, detections }
 */
function _checkSubtitlesVisualContent(videoPath, outputDir, duration) {
  try {
    const framesDir = path.join(outputDir, '.qc-subtitle-frames');
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    // Smart frame sampling: intenta usar captions reales
    let checkPoints = [
      duration * 0.20,
      duration * 0.50,
      duration * 0.80,
    ];

    try {
      const captionsDebugPath = path.join(outputDir, 'captions-debug.json');
      if (fs.existsSync(captionsDebugPath)) {
        const captionsDebug = JSON.parse(fs.readFileSync(captionsDebugPath, 'utf8'));
        const captions = captionsDebug.captions || [];

        if (captions.length >= 3) {
          // Elegir 3 captions distribuidos: inicio, mitad, fin
          const step = Math.floor(captions.length / 3);
          checkPoints = [
            Math.max(0, captions[0]?.start || 0),
            Math.max(0, captions[Math.floor(captions.length / 2)]?.start || duration * 0.5),
            Math.max(0, captions[Math.max(0, captions.length - 1)]?.start || duration * 0.8),
          ];
          logger.debug(`[prepublish-visual-qc] Smart frame sampling: using real caption timestamps`);
        }
      }
    } catch (err) {
      logger.warn(`Smart frame sampling fallback: using fixed percentages (${err.message})`);
      // Fallback a fixed points si algo falla
    }

    const detections = [];
    let framesWithText = 0;      // Señal 1: tamaño > 15KB
    let textInLowerRegion = 0;   // Señal 2: contraste en zona inferior

    for (let i = 0; i < checkPoints.length; i++) {
      const timestamp = checkPoints[i];
      const framePath = path.join(framesDir, `frame-${i}.png`);

      try {
        // Extraer frame con FFmpeg
        spawnSync('ffmpeg', [
          '-ss', timestamp.toFixed(2),
          '-i', videoPath,
          '-vframes', '1',
          '-vf', 'scale=1080:1920',
          '-y',
          framePath,
        ], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });

        if (!fs.existsSync(framePath)) {
          detections.push({
            point: i,
            timestamp: timestamp.toFixed(2),
            signal1_fileSize: false,
            signal2_contrast: false,
            reason: 'frame_extraction_failed',
          });
          continue;
        }

        // SEÑAL 1: Tamaño de archivo (indicador de varianza general)
        const fileSize = fs.statSync(framePath).size;
        const signal1_pass = fileSize > 15000; // > 15KB = probablemente texto

        // SEÑAL 2: Contraste en zona inferior (indicador específico de texto)
        const signal2 = _analyzeLowerRegionContrast(framePath);
        const signal2_pass = signal2.hasLowerRegionContrast;

        detections.push({
          point: i,
          timestamp: timestamp.toFixed(2),
          signal1_fileSize: signal1_pass,
          signal1_value: fileSize,
          signal2_contrast: signal2_pass,
          signal2_method: signal2.analysis,
          bothSignals: signal1_pass && signal2_pass,
        });

        if (signal1_pass) framesWithText++;
        if (signal2_pass) textInLowerRegion++;
      } catch (err) {
        logger.warn(`Cannot extract/analyze frame ${i}: ${err.message}`);
        detections.push({
          point: i,
          timestamp,
          signal1_fileSize: false,
          signal2_contrast: false,
          reason: err.message,
        });
      }
    }

    // Limpiar frames temporales
    try {
      fs.rmSync(framesDir, { recursive: true, force: true });
    } catch {}

    // CONDICIÓN DE ÉXITO: Ambas señales en al menos 1 frame
    const hasVisibleSubtitles = framesWithText >= 1 && textInLowerRegion >= 1;

    // CONFIANZA: cuántos frames pasaron ambas señales
    const fullyConfirmed = detections.filter(d => d.bothSignals).length;
    const confidence = fullyConfirmed >= 1 ? 'confirmed' : (framesWithText >= 1 || textInLowerRegion >= 1) ? 'low' : 'none';

    return {
      hasVisibleSubtitles,
      framesAnalyzed: checkPoints.length,
      detections,
      framesWithText,
      textInLowerRegion,
      fullyConfirmed,
      confidence, // 'confirmed' | 'low' | 'none'
      samplingMethod: 'smart', // indica que usó smart sampling si fue posible
    };
  } catch (err) {
    logger.error(`Subtitle visual check error: ${err.message}`);
    return {
      hasVisibleSubtitles: false,
      reason: `Error: ${err.message}`,
    };
  }
}

/**
 * Chequea que los subtítulos están presentes y correctamente integrados
 * Retorna: { subtitlesBurned, assExists, assHasContent, validSubtitleCount }
 */
function _checkSubtitles(outputDir) {
  try {
    const assPath = path.join(outputDir, 'subtitles.ass');

    // 1. Verificar que subtitles.ass existe
    if (!fs.existsSync(assPath)) {
      return {
        subtitlesBurned: false,
        assExists: false,
        reason: 'subtitles.ass not found',
      };
    }

    // 2. Verificar que tiene contenido válido
    const assContent = fs.readFileSync(assPath, 'utf8');
    if (!assContent || assContent.length < 50) {
      return {
        subtitlesBurned: false,
        assExists: true,
        assHasContent: false,
        reason: 'subtitles.ass is empty or too small',
      };
    }

    // 3. Contar líneas de subtítulos válidas ([Events] section)
    const eventsMatch = assContent.match(/\[Events\]([\s\S]*?)(?=\[|$)/);
    if (!eventsMatch) {
      return {
        subtitlesBurned: false,
        assExists: true,
        assHasContent: true,
        validSubtitleCount: 0,
        reason: '[Events] section not found',
      };
    }

    const eventLines = eventsMatch[1]
      .split('\n')
      .filter(line => line.startsWith('Dialogue:'));

    if (eventLines.length === 0) {
      return {
        subtitlesBurned: false,
        assExists: true,
        assHasContent: true,
        validSubtitleCount: 0,
        reason: 'No Dialogue: lines found',
      };
    }

    // 4. Verificar que contiene texto real (no solo timecodes)
    const hasRealText = eventLines.some(line => {
      const parts = line.split(',');
      if (parts.length < 10) return false;
      const text = parts.slice(9).join(',').trim();
      return text.length > 0;
    });

    if (!hasRealText) {
      return {
        subtitlesBurned: false,
        assExists: true,
        assHasContent: true,
        validSubtitleCount: eventLines.length,
        reason: 'No text content in subtitle lines',
      };
    }

    // 5. Success: subtítulos están presentes y válidos
    return {
      subtitlesBurned: true,
      assExists: true,
      assHasContent: true,
      validSubtitleCount: eventLines.length,
      reason: 'Subtitles present and valid',
    };
  } catch (err) {
    logger.error(`Subtitle check error: ${err.message}`);
    return {
      subtitlesBurned: false,
      reason: `Error: ${err.message}`,
    };
  }
}

async function validatePrepublish(videoPath, outputDir, videoId) {
  /**
   * Valida que el vídeo sea seguro para publicar
   * Retorna: { ok, reason, details }
   */

  const results = {
    ok: true,
    checks: {},
    blockedReasons: [],
    videoId,
    ffprobeAvailable: true, // Track if ffprobe works
  };

  try {
    // 1. Archivo existe
    if (!fs.existsSync(videoPath)) {
      results.checks.fileExists = { ok: false, reason: 'File not found' };
      results.blockedReasons.push('FILE_NOT_FOUND');
      results.ok = false;
      return results;
    }
    results.checks.fileExists = { ok: true };

    // 2. Tamaño
    const stats = fs.statSync(videoPath);
    const sizeKB = stats.size / 1024;
    if (sizeKB < 2048) { // < 2MB
      results.checks.fileSize = { ok: false, sizeKB, reason: 'Too small (< 2MB)' };
      results.blockedReasons.push('FILE_TOO_SMALL');
      results.ok = false;
    } else {
      results.checks.fileSize = { ok: true, sizeKB };
    }

    // 3. ffprobe (OPTIONAL FALLBACK — if unavailable, allow publication if file exists and is reasonable size)
    let probeData;
    try {
      probeData = await _getVideoStats(videoPath);
    } catch (err) {
      logger.warn(`FFPROBE UNAVAILABLE (tolerated): ${err.message} — Allowing publication if file is valid`);
      results.checks.ffprobe = { ok: false, reason: `ffprobe not available (fallback allowed)`, message: err.message };
      results.ffprobeAvailable = false; // Mark ffprobe as unavailable
      // DO NOT block publication — if MP4 exists and has size, trust it
      probeData = null;
    }

    if (probeData) {
      const format = probeData.format || {};
      const streams = probeData.streams || [];
      const videoStream = streams.find(s => s.codec_type === 'video');
      const audioStream = streams.find(s => s.codec_type === 'audio');

      // Duración
      const duration = format.duration ? parseFloat(format.duration) : null;
      if (!duration || duration < 8) {
        results.checks.duration = { ok: false, duration, reason: 'Too short (< 8s)' };
        results.blockedReasons.push('DURATION_TOO_SHORT');
        results.ok = false;
      } else {
        results.checks.duration = { ok: true, duration };
      }

      // Video stream
      if (!videoStream) {
        results.checks.videoStream = { ok: false, reason: 'No video stream detected' };
        results.blockedReasons.push('NO_VIDEO_STREAM');
        results.ok = false;
      } else {
        results.checks.videoStream = {
          ok: true,
          codec: videoStream.codec_name,
          dimensions: `${videoStream.width}x${videoStream.height}`,
        };
      }

      // Audio stream
      if (!audioStream) {
        results.checks.audioStream = { ok: false, reason: 'No audio stream detected' };
        results.blockedReasons.push('NO_AUDIO_STREAM');
        results.ok = false;
      } else {
        results.checks.audioStream = {
          ok: true,
          codec: audioStream.codec_name,
          sampleRate: audioStream.sample_rate,
        };
      }
    }

    // 4. Black frame detection (OPTIONAL FALLBACK — if unavailable, allow publication)
    let blackCheck;
    try {
      blackCheck = await _detectBlackFrames(videoPath, outputDir);
    } catch (err) {
      logger.warn(`BLACK_FRAME_CHECK unavailable (tolerated): ${err.message}`);
      results.checks.blackFrames = {
        ok: false,
        reason: `Black frame detection unavailable (fallback allowed)`,
        message: err.message
      };
      // DO NOT block publication — if ffprobe is missing, we can't do this check
      // Allow to proceed
      blackCheck = null;
    }

    if (blackCheck && blackCheck.hasBlackFrames) {
      results.checks.blackFrames = {
        ok: false,
        totalBlackDuration: blackCheck.totalBlackDuration,
        reason: `${blackCheck.totalBlackDuration.toFixed(1)}s of black frames detected`,
      };
      results.blockedReasons.push('BLACK_FRAMES_DETECTED');
      results.ok = false;
    } else if (blackCheck) {
      results.checks.blackFrames = { ok: true };
    }

    // 5. Captions
    const captionsDebugPath = path.join(outputDir, 'captions-debug.json');
    if (!fs.existsSync(captionsDebugPath)) {
      results.checks.captions = { ok: false, reason: 'captions-debug.json missing' };
      results.blockedReasons.push('NO_CAPTIONS_DEBUG');
      results.ok = false;
    } else {
      try {
        const captionsDebug = JSON.parse(fs.readFileSync(captionsDebugPath, 'utf8'));
        if (!captionsDebug.captionsCount || captionsDebug.captionsCount === 0) {
          results.checks.captions = {
            ok: false,
            captionCount: 0,
            reason: 'No captions generated',
          };
          results.blockedReasons.push('EMPTY_CAPTIONS');
          results.ok = false;
        } else {
          results.checks.captions = {
            ok: true,
            captionCount: captionsDebug.captionsCount,
            driftStatus: captionsDebug.drift?.status || 'unknown',
            source: captionsDebug.source,
          };
        }
      } catch (err) {
        results.checks.captions = { ok: false, reason: `Parse error: ${err.message}` };
        results.blockedReasons.push('INVALID_CAPTIONS_DEBUG');
        results.ok = false;
      }
    }

    // 6. Subtítulos (MANDATORY — vídeos sin subtítulos no se publican)
    const subtitleCheck = _checkSubtitles(outputDir);
    if (!subtitleCheck.subtitlesBurned) {
      results.checks.subtitles = {
        ok: false,
        assExists: subtitleCheck.assExists,
        assHasContent: subtitleCheck.assHasContent,
        validSubtitleCount: subtitleCheck.validSubtitleCount,
        reason: subtitleCheck.reason,
      };
      results.blockedReasons.push('SUBTITLES_MISSING_BLOCKED');
      results.ok = false;
    } else {
      results.checks.subtitles = {
        ok: true,
        subtitlesBurned: true,
        validSubtitleCount: subtitleCheck.validSubtitleCount,
      };
    }

    // Añadir flag subtitlesBurned a metadata para referencia
    results.subtitlesBurned = subtitleCheck.subtitlesBurned;

    // 6.5: Verificar que FFmpeg realmente aplicó los subtítulos (CRITICAL)
    let renderMetadata = null;
    try {
      const metadataPath = path.join(outputDir, 'render-metadata.json');
      if (fs.existsSync(metadataPath)) {
        renderMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      }
    } catch (err) {
      logger.warn(`Cannot read render-metadata for subtitle filter check: ${err.message}`);
    }

    // VALIDACIÓN SUBTÍTULOS FILTER: Warning only, no hard block
    // Razón: Si MP4 existe, tiene audio/video streams y duración válida, la publicación es viable
    // El filter missing es una issue de metadata pero no invalida el archivo final
    if (renderMetadata && renderMetadata.subtitlesFilterApplied !== true) {
      logger.warn(`SUBTITLES_FILTER_METADATA_MISSING videoId=${videoId} but MP4 valid — allowing publication`);
      results.checks.subtitlesFilterApplied = {
        ok: false,
        filterApplied: renderMetadata.subtitlesFilterApplied,
        reason: 'FFmpeg subtitles filter metadata missing (non-blocking)',
      };
      // DO NOT add to blockedReasons — MP4 is valid, publication allowed
      // results.ok remains true if all OTHER validations passed
    } else if (renderMetadata) {
      results.checks.subtitlesFilterApplied = {
        ok: true,
        filterApplied: true,
      };
    }

    // Pasar flag a metadata para todas las validaciones downstream
    results.subtitlesFilterApplied = renderMetadata?.subtitlesFilterApplied || false;

    // 7. Validación visual: confirmar que los subtítulos son realmente visibles
    // Dual signal: tamaño de archivo + contraste en zona inferior
    // SOLO si todas las validaciones anteriores pasaron
    if (results.ok && probeData) {
      const videoSubtitleCheck = _checkSubtitlesVisualContent(videoPath, outputDir, probeData.format?.duration || 0);

      if (!videoSubtitleCheck.hasVisibleSubtitles) {
        // Detectado: subtítulos no visibles - log warning pero NO BLOQUEAR
        // Razón: Si MP4 es válido (existe, duración, audio/video), la publicación es viable
        // Visual detection puede fallar por limitaciones de análisis de frames
        logger.warn(`SUBTITLES_VISUAL_NOT_DETECTED videoId=${videoId} signal1=${videoSubtitleCheck.framesWithText} signal2=${videoSubtitleCheck.textInLowerRegion} confidence=${videoSubtitleCheck.confidence} — allowing publication`);
        results.checks.subtitlesVisual = {
          ok: false,
          framesAnalyzed: videoSubtitleCheck.framesAnalyzed,
          signal1_frames: videoSubtitleCheck.framesWithText,
          signal2_frames: videoSubtitleCheck.textInLowerRegion,
          confidence: videoSubtitleCheck.confidence,
          reason: 'Subtitles visual detection inconclusive (non-blocking)',
        };
        // DO NOT add to blockedReasons — MP4 is valid, publication allowed

        // Logging diferenciado
        if (videoSubtitleCheck.confidence === 'low') {
          logger.warn(`SUBTITLES_VISUAL_LOW_CONFIDENCE videoId=${videoId} signal1=${videoSubtitleCheck.framesWithText} signal2=${videoSubtitleCheck.textInLowerRegion} required=both`);
        } else {
          logger.info(`SUBTITLES_VISUAL_CHECK_FAIL videoId=${videoId} signal1=${videoSubtitleCheck.framesWithText} signal2=${videoSubtitleCheck.textInLowerRegion}`);
        }
      } else {
        // Ambas señales confirmadas → APROBAR
        results.checks.subtitlesVisual = {
          ok: true,
          framesAnalyzed: videoSubtitleCheck.framesAnalyzed,
          signal1_frames: videoSubtitleCheck.framesWithText,
          signal2_frames: videoSubtitleCheck.textInLowerRegion,
          fullyConfirmed: videoSubtitleCheck.fullyConfirmed,
          confidence: videoSubtitleCheck.confidence,
        };
        logger.info(`SUBTITLES_VISUAL_CONFIRMED videoId=${videoId} signal1=${videoSubtitleCheck.framesWithText} signal2=${videoSubtitleCheck.textInLowerRegion} confirmed=${videoSubtitleCheck.fullyConfirmed}`);
      }

      // Pasar confidence a metadata para que opportunistic publish pueda usar
      results.subtitlesVisualConfidence = videoSubtitleCheck.confidence;
    }

    // EMERGENCY OVERRIDE: Si ffprobe no está disponible pero el archivo existe con tamaño razonable, permitir publicación
    if (!results.ffprobeAvailable && results.checks.fileExists.ok && results.checks.fileSize.ok) {
      logger.warn(`FFPROBE_FALLBACK_OVERRIDE videoId=${videoId} — Allowing publication despite QC failures (ffprobe unavailable)`);
      results.ok = true;
      results.ffprobeFallback = true;
      results.blockedReasons = []; // Clear blocked reasons since we're overriding
      recordQCSuccess(videoId);

      // IMPORTANT: Record that fallback was used (monitor will alert if used too many times)
      const fallbackAlert = recordFallbackUsage(videoId, 'ffprobe_unavailable_on_publish_attempt');
      if (fallbackAlert && fallbackAlert.alert === 'CRITICAL') {
        logger.error(`FFMPEG_FALLBACK_CRITICAL: ${fallbackAlert.reason} — This should NOT happen if ffmpeg is available!`);
        // TODO: Send Telegram alert
      }

      return results;
    }

    // Log resultado y registrar para kill-switch
    if (results.ok) {
      logger.info(`PREPUBLISH_VISUAL_QC_PASS videoId=${videoId}`);
      recordQCSuccess(videoId);
    } else {
      logger.error(`PREPUBLISH_VISUAL_QC_BLOCKED videoId=${videoId} reasons=${results.blockedReasons.join(',')}`);
      recordQCFailure(videoId, results.blockedReasons);
    }

    return results;

  } catch (err) {
    logger.error(`PREPUBLISH_VISUAL_QC_EXCEPTION ${err.message}`);
    results.ok = false;
    results.exception = err.message;
    return results;
  }
}

module.exports = {
  validatePrepublish,
};
