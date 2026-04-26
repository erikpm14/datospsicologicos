/**
 * word-timestamp-aligner.js
 *
 * Proporciona sincronización PRO de subtítulos a nivel de palabra.
 * Usa faster-whisper para obtener timestamps precisos.
 * Fallback: detectVoiceSegments (menos preciso pero rápido)
 */

require('dotenv').config();
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { createPerfTracker } = require('../utils/perf-tracker');

const WHISPER_ENABLED = process.env.WHISPER_WORD_TIMESTAMPS_ENABLED !== 'false';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || 'es';
const WHISPER_TIMEOUT_MS = parseInt(process.env.WHISPER_TIMEOUT_MS || '120000');

/**
 * Detecta si faster-whisper está disponible
 */
function isWhisperAvailable() {
  try {
    execSync('python -c "from faster_whisper import WhisperModel"', { stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch (err) {
    logger.debug(`Whisper availability check failed: ${err.message.slice(0, 100)}`);
    return false;
  }
}

/**
 * Normaliza timestamps de Whisper (pueden tener valores sucios)
 */
function normalizeWordTimestamps(words = []) {
  if (!Array.isArray(words)) return [];

  return words
    .filter(w => {
      if (!w || !w.word) return false;
      if (typeof w.start !== 'number' || typeof w.end !== 'number') return false;
      if (w.start < 0 || w.end <= w.start) return false;
      return true;
    })
    .map(w => ({
      word: String(w.word || '').trim(),
      start: Math.max(0, w.start),
      end: w.end,
      conf: w.conf || 0.9, // confidence de Whisper
    }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Obtiene word-level timestamps usando faster-whisper (Python)
 *
 * @param {string} audioPath - ruta al audio
 * @param {string} language - código idioma (es, en, etc.)
 * @returns {Promise<Array<{word, start, end}>>}
 */
async function getWordTimestampsFromWhisper(audioPath, language = 'es') {
  const perf = createPerfTracker('whisper-align');

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // Usar script Python en lugar de inline para mejor manejo de salida
  const scriptPath = path.join(__dirname, '../../scripts/whisper-transcribe.py');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Whisper script not found: ${scriptPath}`);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Whisper timeout (${WHISPER_TIMEOUT_MS}ms)`));
    }, WHISPER_TIMEOUT_MS);

    perf.start('whisper_process');

    const pythonProcess = spawn('python', [
      scriptPath,
      audioPath,
      language,
      WHISPER_MODEL,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...require('process').env, PYTHONUNBUFFERED: '1' },
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = perf.end();

      // Intentar parsear JSON de stdout
      if (stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim());

          // Checar si es un error JSON
          if (parsed.error) {
            throw new Error(parsed.error);
          }

          // Validar que es un array
          if (!Array.isArray(parsed)) {
            throw new Error('Expected array of words');
          }

          const normalized = normalizeWordTimestamps(parsed);
          logger.info(`Whisper: ${normalized.length} words | model=${WHISPER_MODEL} | ${elapsed.durationMs}ms`);
          resolve(normalized);
          return;
        } catch (parseErr) {
          logger.debug(`Whisper JSON parse error: ${parseErr.message}`);
        }
      }

      // Si no hay salida JSON válida
      const errorMsg = stderr ? stderr.slice(0, 150) : 'No output from Whisper';
      logger.warn(`Whisper failed: ${errorMsg}`);
      reject(new Error(`Whisper failed: ${errorMsg.slice(0, 100)}`));
    });

    pythonProcess.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Fallback: construye timestamps basado en segmentos de voz
 * Distribución proporcional por palabras
 */
function buildWordTimestampsFromFallback(segments, scriptText) {
  if (!segments || !scriptText) return [];

  const words = scriptText
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => w.replace(/[,.!?:;…—]/g, ''));

  if (words.length === 0 || segments.length === 0) return [];

  const totalDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  if (totalDuration <= 0) return [];

  const timePerWord = totalDuration / words.length;
  let currentTime = segments[0].start;

  return words.map((word, idx) => ({
    word,
    start: currentTime,
    end: currentTime + timePerWord,
    conf: 0.5, // Low confidence para fallback
  })).map((w, idx, arr) => {
    if (idx < arr.length - 1) {
      return w;
    }
    // Última palabra: ajustar al final del último segmento
    return {
      ...w,
      end: segments[segments.length - 1].end,
    };
  });
}

/**
 * FUNCIÓN PRINCIPAL: Obtiene timestamps de palabras
 * PRIORIDAD: Fuerza Whisper si está disponible (máxima precisión)
 *
 * @param {string} audioPath - ruta al audio procesado
 * @param {string} scriptText - texto completo del guión
 * @param {Object} voiceSegments - segmentos de voz detectados (fallback)
 * @returns {Promise<{words, engine, confidence}>}
 */
async function alignWordTimestamps(audioPath, scriptText, voiceSegments = []) {
  const perf = createPerfTracker('word-alignment');
  const result = {
    words: [],
    engine: 'none',
    confidence: 0,
    warnings: [],
  };

  if (!WHISPER_ENABLED) {
    logger.info('Word timestamps: disabled (WHISPER_WORD_TIMESTAMPS_ENABLED=false)');
    return result;
  }

  if (!scriptText || scriptText.trim().length < 5) {
    result.warnings.push('script_too_short');
    return result;
  }

  // Check disponibilidad
  const whisperAvailable = isWhisperAvailable();
  if (!whisperAvailable) {
    logger.warn('WHISPER NOT AVAILABLE: Falling back to proportional distribution (non-PRO)');
    result.warnings.push('whisper_not_installed');
  }

  // Intento 1: Whisper (FORZADO si disponible)
  if (whisperAvailable) {
    try {
      perf.start('whisper');
      logger.debug(`Whisper: initiating word-level transcription | model=${WHISPER_MODEL} | lang=${WHISPER_LANGUAGE}`);
      const words = await getWordTimestampsFromWhisper(audioPath, WHISPER_LANGUAGE);
      const phase = perf.end();

      if (words.length >= 10) {
        result.words = words;
        result.engine = 'whisper';  // SIEMPRE "whisper" si Whisper funciona
        result.confidence = 0.95;

        // Validar que los timestamps son REALES (no uniformes)
        const timeDiffs = [];
        for (let i = 1; i < Math.min(words.length, 20); i++) {
          timeDiffs.push(words[i].start - words[i-1].end);
        }
        const avgDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
        const uniformity = Math.max(...timeDiffs) / Math.min(...timeDiffs);

        logger.info(
          `Word alignment: WHISPER OK | engine=whisper | words=${words.length} | ` +
          `avg_gap=${avgDiff.toFixed(3)}s | uniformity=${uniformity.toFixed(2)}x | ` +
          `time=${phase.durationMs}ms`
        );
        logger.debug(`Whisper timestamps: first 3 words: ${words.slice(0, 3).map(w => `${w.word}[${w.start.toFixed(2)}-${w.end.toFixed(2)}]`).join(' ')}`);

        return result;
      } else {
        result.warnings.push(`whisper_low_word_count_${words.length}`);
        logger.error(`Whisper returned too few words (${words.length}), CANNOT use PRO mode`);
      }
    } catch (err) {
      result.warnings.push(`whisper_error_${err.message.split(':')[0]}`);
      logger.error(`Whisper execution failed: ${err.message.slice(0, 150)}`);
    }
  }

  // Intento 2: Fallback proporcional (NO PRO)
  if (voiceSegments && voiceSegments.length > 0) {
    try {
      const words = buildWordTimestampsFromFallback(voiceSegments, scriptText);
      if (words.length >= 10) {
        result.words = words;
        result.engine = 'fallback_proportional';  // Marca claramente como fallback
        result.confidence = 0.6;
        logger.warn(
          `Word alignment: FALLBACK (non-PRO) | engine=fallback_proportional | words=${words.length} | ` +
          `reason=whisper_unavailable`
        );
        return result;
      }
    } catch (err) {
      result.warnings.push(`fallback_error_${err.message.split(':')[0]}`);
      logger.warn(`Fallback failed: ${err.message}`);
    }
  }

  // Si todo falla
  result.confidence = 0;
  result.warnings.push('all_engines_failed');
  logger.error('Word alignment: FAILED - all engines failed, timestamps disabled');
  return result;
}

module.exports = {
  isWhisperAvailable,
  normalizeWordTimestamps,
  getWordTimestampsFromWhisper,
  buildWordTimestampsFromFallback,
  alignWordTimestamps,
};
