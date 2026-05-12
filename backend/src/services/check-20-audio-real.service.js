/**
 * check-20-audio-real.service.js
 * CHECK 20: Verifica que el audio tenga contenido real (voz/sonido audible).
 * No basta con que exista un stream AAC; debe tener volumen y contenido audible.
 */

const { execSync } = require('child_process');
const logger = require('../utils/logger');

// Umbrales iniciales (ajustables según necesidad)
const THRESHOLDS = {
  maxVolume: -25, // dB, must be > this
  meanVolume: -35, // dB, must be > this
  silenceRatio: 0.65, // max % of silence allowed
};

/**
 * Ejecuta ffmpeg volumedetect
 * Retorna { meanVolume, maxVolume }
 */
function analyzeVolumeDetect(videoPath) {
  try {
    const output = execSync(
      `ffmpeg -i "${videoPath}" -af volumedetect -f null - 2>&1`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const meanMatch = output.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    const maxMatch = output.match(/max_volume:\s*([-\d.]+)\s*dB/);

    return {
      meanVolume: meanMatch ? parseFloat(meanMatch[1]) : null,
      maxVolume: maxMatch ? parseFloat(maxMatch[1]) : null,
    };
  } catch (err) {
    logger.error('[CHECK_20] volumedetect failed:', err.message);
    throw new Error(`volumedetect analysis failed: ${err.message}`);
  }
}

/**
 * Ejecuta ffmpeg silencedetect
 * Retorna { totalSilence, silenceRatio }
 */
function analyzeSilenceDetect(videoPath) {
  try {
    const output = execSync(
      `ffmpeg -i "${videoPath}" -af silencedetect=noise=-35dB:d=0.5 -f null - 2>&1`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Buscar líneas de silence_start/silence_end
    const silenceStarts = (output.match(/\[silencedetect[^\n]*silence_start/g) || []).length;
    const silenceEnds = (output.match(/\[silencedetect[^\n]*silence_end/g) || []).length;

    // Si hay muchos silencios reportados, es alto
    const silenceCount = Math.max(silenceStarts, silenceEnds);

    // Heurística: si hay 10+ eventos de silencio/sonido alternando, es muy fragmentado
    return {
      silenceEvents: silenceCount,
      likelyHighSilenceRatio: silenceCount > 10,
    };
  } catch (err) {
    logger.error('[CHECK_20] silencedetect failed:', err.message);
    // No es fatal, continuamos con volumedetect
    return {
      silenceEvents: 0,
      likelyHighSilenceRatio: false,
    };
  }
}

/**
 * Obtiene info de audio con ffprobe
 */
function getAudioStreamInfo(videoPath) {
  try {
    const output = execSync(
      `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,duration,bit_rate,sample_rate -of default=noprint_wrappers=1 "${videoPath}" 2>&1`,
      { encoding: 'utf8' }
    );

    const lines = output.trim().split('\n');
    const info = {};
    lines.forEach(line => {
      const [key, value] = line.split('=');
      info[key] = value;
    });

    return {
      audioCodec: info.codec_name || null,
      duration: info.duration ? parseFloat(info.duration) : null,
      bitRate: info.bit_rate ? parseInt(info.bit_rate) : null,
      sampleRate: info.sample_rate ? parseInt(info.sample_rate) : null,
    };
  } catch (err) {
    logger.error('[CHECK_20] ffprobe failed:', err.message);
    return null;
  }
}

/**
 * Ejecuta CHECK 20 completo
 * Retorna { ready: boolean, reason?: string, details: {...} }
 */
function checkAudioRealNotSilent(videoPath) {
  const details = {
    videoPath,
    audioStreamExists: false,
    audioCodec: null,
    duration: null,
    bitRate: null,
    sampleRate: null,
    meanVolume: null,
    maxVolume: null,
    silenceEvents: null,
    thresholds: THRESHOLDS,
    issues: [],
  };

  // 1. Verificar que existe stream de audio
  const streamInfo = getAudioStreamInfo(videoPath);
  if (!streamInfo || !streamInfo.audioCodec) {
    logger.error('[CHECK_20] No audio stream found');
    return {
      ready: false,
      reason: 'CHECK_20_NO_AUDIO_STREAM',
      details: { ...details, issue: 'No audio stream in video' },
    };
  }

  details.audioStreamExists = true;
  details.audioCodec = streamInfo.audioCodec;
  details.duration = streamInfo.duration;
  details.bitRate = streamInfo.bitRate;
  details.sampleRate = streamInfo.sampleRate;

  // 2. Analizar volumen
  let volumeData;
  try {
    volumeData = analyzeVolumeDetect(videoPath);
    details.meanVolume = volumeData.meanVolume;
    details.maxVolume = volumeData.maxVolume;
  } catch (err) {
    logger.error('[CHECK_20] volumedetect error:', err.message);
    return {
      ready: false,
      reason: 'CHECK_20_VOLUME_ANALYSIS_FAILED',
      details: { ...details, error: err.message },
    };
  }

  // 3. Validar umbrales de volumen
  if (volumeData.maxVolume !== null && volumeData.maxVolume < THRESHOLDS.maxVolume) {
    details.issues.push(`maxVolume ${volumeData.maxVolume} dB is too low (threshold: > ${THRESHOLDS.maxVolume} dB)`);
  }

  if (volumeData.meanVolume !== null && volumeData.meanVolume < THRESHOLDS.meanVolume) {
    details.issues.push(`meanVolume ${volumeData.meanVolume} dB is too low (threshold: > ${THRESHOLDS.meanVolume} dB)`);
  }

  // 4. Analizar silencios
  const silenceData = analyzeSilenceDetect(videoPath);
  details.silenceEvents = silenceData.silenceEvents;

  if (silenceData.likelyHighSilenceRatio) {
    details.issues.push(`High number of silence events detected (${silenceData.silenceEvents}), likely poor audio content`);
  }

  // 5. Decisión final
  if (details.issues.length > 0) {
    logger.error('[CHECK_20] FAIL', {
      videoPath,
      issues: details.issues,
    });
    return {
      ready: false,
      reason: 'CHECK_20_AUDIO_NOT_REAL_OR_SILENT',
      details,
    };
  }

  logger.info('[CHECK_20] PASS', {
    videoPath,
    meanVolume: volumeData.meanVolume,
    maxVolume: volumeData.maxVolume,
  });

  return {
    ready: true,
    details,
  };
}

module.exports = {
  checkAudioRealNotSilent,
  THRESHOLDS,
};
