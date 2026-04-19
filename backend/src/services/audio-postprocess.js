/**
 * audio-postprocess.js  — Pipeline V2
 *
 * Postprocesa el audio crudo de TTS con FFmpeg:
 *   1. highpass=f=80        → elimina rumble por debajo de 80 Hz
 *   2. acompressor          → compresión ligera: rango dinámico más consistente
 *   3. loudnorm I=-16:TP=-1.5:LRA=11 → normalización a -16 LUFS (estándar social media)
 *   4. aformat              → 44.1 kHz / mono / 16-bit (optimizado para móvil)
 *
 * Resultado: todos los vídeos tienen el mismo loudness percibido.
 * Sin este paso, Kokoro WAV y Edge TTS MP3 pueden variar ±6 LUFS.
 */

require('dotenv').config();
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');
const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Parámetros de la cadena de filtros — todos configurables por env
const HIGHPASS_FREQ      = parseInt(process.env.AUDIO_HIGHPASS_HZ   || '80');
const COMP_THRESHOLD     = process.env.AUDIO_COMP_THRESHOLD || '-18dB';
const COMP_RATIO         = parseFloat(process.env.AUDIO_COMP_RATIO   || '2.5');
const COMP_ATTACK        = parseInt(process.env.AUDIO_COMP_ATTACK    || '20');  // ms
const COMP_RELEASE       = parseInt(process.env.AUDIO_COMP_RELEASE   || '80');  // ms
const COMP_MAKEUP        = parseFloat(process.env.AUDIO_COMP_MAKEUP  || '1.5'); // dB
const LOUD_TARGET        = parseFloat(process.env.AUDIO_LUFS_TARGET  || '-16'); // LUFS
const LOUD_TP            = parseFloat(process.env.AUDIO_LUFS_TP      || '-1.5'); // dBTP
const LOUD_LRA           = parseFloat(process.env.AUDIO_LUFS_LRA     || '11');  // LU
const OUTPUT_BITRATE     = process.env.AUDIO_BITRATE                 || '192k';
const POSTPROCESS_ENABLED = process.env.AUDIO_POSTPROCESS_ENABLED !== 'false'; // activo por defecto

/**
 * Postprocesa un archivo de audio (WAV o MP3) y devuelve un MP3 limpio y normalizado.
 *
 * @param {string} inputPath   - Ruta al archivo de audio crudo
 * @param {string} outputPath  - Ruta de salida del MP3 procesado
 * @param {{ timeoutMs?: number }} options
 * @returns {Promise<{ audioPath: string, appliedFilters: string[] }>}
 */
async function postprocessAudio(inputPath, outputPath, { timeoutMs = 60_000 } = {}) {
  if (!POSTPROCESS_ENABLED) {
    logger.info('AudioPostprocess: desactivado (AUDIO_POSTPROCESS_ENABLED=false)');
    // Copiar sin procesar
    fs.copyFileSync(inputPath, outputPath);
    return { audioPath: outputPath, appliedFilters: [] };
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`AudioPostprocess: archivo de entrada no encontrado: ${inputPath}`);
  }

  const inputSize = fs.statSync(inputPath).size;
  if (inputSize < 1000) {
    throw new Error(`AudioPostprocess: archivo de entrada vacío o corrupto (${inputSize} bytes)`);
  }

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Cadena de filtros
  const audioFilters = [
    `highpass=f=${HIGHPASS_FREQ}`,
    `acompressor=threshold=${COMP_THRESHOLD}:ratio=${COMP_RATIO}:attack=${COMP_ATTACK}:release=${COMP_RELEASE}:makeup=${COMP_MAKEUP}`,
    `loudnorm=I=${LOUD_TARGET}:TP=${LOUD_TP}:LRA=${LOUD_LRA}:linear=true`,
    'aformat=sample_rates=44100:channel_layouts=mono',
  ];

  logger.info(`AudioPostprocess: ${path.basename(inputPath)} → ${path.basename(outputPath)} | filters: ${audioFilters.length}`);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`AudioPostprocess timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    ffmpeg(inputPath)
      .audioFilters(audioFilters.join(','))
      .audioCodec('libmp3lame')
      .audioBitrate(OUTPUT_BITRATE)
      .output(outputPath)
      .on('end', () => {
        clearTimeout(timer);
        const outSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
        if (outSize < 1000) {
          reject(new Error(`AudioPostprocess: output vacío (${outSize} bytes)`));
          return;
        }
        logger.info(`AudioPostprocess: OK — ${(outSize / 1024).toFixed(0)} KB | ${audioFilters[2]}`);
        resolve({ audioPath: outputPath, appliedFilters: audioFilters });
      })
      .on('error', (err) => {
        clearTimeout(timer);
        logger.error(`AudioPostprocess error: ${err.message}`);
        reject(err);
      })
      .run();
  });
}

/**
 * Wrapper seguro: si falla el postproceso, devuelve el audio original.
 * Garantiza que el pipeline nunca se rompa por el postproceso.
 */
async function postprocessAudioSafe(inputPath, outputPath) {
  try {
    return await postprocessAudio(inputPath, outputPath);
  } catch (err) {
    logger.warn(`AudioPostprocess failed (${err.message}) — using raw audio`);
    // Devolver el input sin procesar (ya existe en disco)
    return { audioPath: inputPath, appliedFilters: [], fallback: true };
  }
}

/**
 * Genera la ruta del archivo procesado.
 * Kokoro → voice.wav → voice_proc.mp3
 * Edge  → voice.mp3 → voice_proc.mp3
 */
function getProcessedAudioPath(rawAudioPath) {
  const dir  = path.dirname(rawAudioPath);
  const base = path.basename(rawAudioPath, path.extname(rawAudioPath));
  return path.join(dir, `${base}_proc.mp3`);
}

// ── Test directo ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const input  = process.argv[2] || './output/test_tts.mp3';
  const output = process.argv[3] || getProcessedAudioPath(input);

  if (!fs.existsSync(input)) {
    console.error(`Archivo no encontrado: ${input}`);
    process.exit(1);
  }

  postprocessAudio(input, output)
    .then(r => {
      console.log('AudioPostprocess OK:', r.audioPath);
      console.log('Filtros aplicados:', r.appliedFilters.join('\n  '));
    })
    .catch(e => {
      console.error('Error:', e.message);
      process.exit(1);
    });
}

module.exports = { postprocessAudio, postprocessAudioSafe, getProcessedAudioPath };
