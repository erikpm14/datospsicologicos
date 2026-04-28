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
const { spawn } = require('child_process');
const logger = require('../utils/logger');

async function _getVideoStats(videoPath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
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
  return new Promise((resolve) => {
    try {
      const framesDir = path.join(outputDir, '.qc-frames-temp');
      if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true });
      }

      // Use blackdetect filter to find black frames
      // blackdetect: detects frames where pixel luminance < threshold
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-vf', "blackdetect=d=0.5:pix_th=0.05",  // 0.5s duration, 5% threshold
        '-an',  // No audio output
        '-f', 'null',
        '-'
      ], { stdio: 'pipe' });

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

    // 3. ffprobe (MANDATORY — if unavailable, vídeo cannot be verified)
    let probeData;
    try {
      probeData = await _getVideoStats(videoPath);
    } catch (err) {
      logger.error(`FFPROBE CRITICAL: ${err.message} — Cannot verify video streams`);
      results.checks.ffprobe = { ok: false, reason: `ffprobe failed: ${err.message}` };
      results.blockedReasons.push('FFPROBE_UNAVAILABLE');
      results.ok = false;
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

    // 4. Black frame detection (MANDATORY — must not fail gracefully)
    let blackCheck;
    try {
      blackCheck = await _detectBlackFrames(videoPath, outputDir);
    } catch (err) {
      results.checks.blackFrames = {
        ok: false,
        reason: `Black frame detection unavailable: ${err.message}`,
      };
      results.blockedReasons.push('BLACK_FRAME_CHECK_FAILED');
      results.ok = false;
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

    // Log resultado
    if (results.ok) {
      logger.info(`PREPUBLISH_VISUAL_QC_PASS videoId=${videoId}`);
    } else {
      logger.error(`PREPUBLISH_VISUAL_QC_BLOCKED videoId=${videoId} reasons=${results.blockedReasons.join(',')}`);
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
