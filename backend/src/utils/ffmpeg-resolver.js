/**
 * ffmpeg-resolver.js
 * Resuelve la ubicación de ffmpeg y ffprobe con fallback inteligente
 *
 * Búsqueda en este orden:
 * 1. PATH (ffmpeg/ffprobe global)
 * 2. Streamlabs OBS (si está instalado)
 * 3. Fallback: marca como no disponible pero permite publicación
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STREAMLABS_FFMPEG = 'C:\\Program Files\\Streamlabs OBS\\resources\\app.asar.unpacked\\node_modules\\obs-studio-node\\ffmpeg.exe';
const STREAMLABS_FFPROBE = 'C:\\Program Files\\Streamlabs OBS\\resources\\app.asar.unpacked\\node_modules\\obs-studio-node\\ffprobe.exe';

let ffmpegPath = null;
let ffprobePath = null;
let resolved = false;

function resolveFFmpeg() {
  if (resolved) {
    return { ffmpeg: ffmpegPath, ffprobe: ffprobePath };
  }

  // 1. Try PATH
  try {
    const result = execSync('where ffmpeg', { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (result && fs.existsSync(result)) {
      ffmpegPath = result;
    }
  } catch (err) {
    // Not in PATH
  }

  try {
    const result = execSync('where ffprobe', { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (result && fs.existsSync(result)) {
      ffprobePath = result;
    }
  } catch (err) {
    // Not in PATH
  }

  // 2. Try Streamlabs OBS
  if (!ffmpegPath && fs.existsSync(STREAMLABS_FFMPEG)) {
    ffmpegPath = STREAMLABS_FFMPEG;
  }

  if (!ffprobePath && fs.existsSync(STREAMLABS_FFPROBE)) {
    ffprobePath = STREAMLABS_FFPROBE;
  }

  resolved = true;
  return { ffmpeg: ffmpegPath, ffprobe: ffprobePath };
}

module.exports = {
  resolveFFmpeg,

  getFFmpeg() {
    const { ffmpeg } = resolveFFmpeg();
    return ffmpeg;
  },

  getFFprobe() {
    const { ffprobe } = resolveFFmpeg();
    return ffprobe;
  },

  isAvailable() {
    const { ffmpeg, ffprobe } = resolveFFmpeg();
    return !!(ffmpeg && ffprobe);
  },

  isPartiallyAvailable() {
    const { ffmpeg, ffprobe } = resolveFFmpeg();
    return !!(ffmpeg || ffprobe);
  },

  getStatus() {
    const { ffmpeg, ffprobe } = resolveFFmpeg();
    return {
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      available: !!(ffmpeg && ffprobe),
      partiallyAvailable: !!(ffmpeg || ffprobe),
    };
  },
};
