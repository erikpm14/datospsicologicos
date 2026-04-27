/**
 * caption-sync.js
 *
 * CORRECCIÓN DE DRIFT ACUMULADO DE SUBTÍTULOS
 *
 * Problema: Los subtítulos se desincronizan progresivamente porque `sectionDurations`
 * se calculan sobre voice.wav (pre-postproceso), pero se renderizan sobre voice_proc.mp3
 * (post-silenceremove), que tiene duraciones distintas.
 *
 * Solución: Construir captions basados en el audio final REAL (voice_proc.mp3).
 * - ffprobe para duración REAL del audio final
 * - silencedetect para segmentos de habla REALES en coordenadas absolutas
 * - Distribuir texto sobre esos segmentos (fuente de verdad)
 * - Fallback: distribución uniforme sobre duración real (mejor que estimaciones)
 */

const ffmpeg = require('fluent-ffmpeg');
const { detectVoiceSegments } = require('../services/audio-postprocess');
const { getScriptSections } = require('./script-segments');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

// ═════════════════════════════════════════════════════════════════
// FINE-TUNING PARA SINCRONIZACIÓN CON VOZ HUMANA
// Objetivo: Drift < 0.3s (captions ligeramente adelantados/atrasados)
// ═════════════════════════════════════════════════════════════════

const CAPTION_START_LEAD = 0.08; // mostrar subtítulo 80ms antes de iniciar habla
const CAPTION_END_EXTENSION = 0.12; // mantener 120ms después de terminar habla
const MIN_CAPTION_DURATION = 0.75; // mínimo para legibilidad
const MAX_CAPTION_DURATION = 2.2; // máximo antes de cansar vista
const MAX_ACCEPTABLE_DRIFT = 0.35; // goal: < 0.3s, warning si > 0.35s

const MAX_CHARS_PER_LINE = 30;
const MAX_LINES_PER_BLOCK = 2;

// silencedetect ajustado para pausas reales
const SILENCE_THRESHOLD = -35; // dB (estricto: captura pausas reales, no sílabas débiles)
const MIN_SILENCE_DURATION = 0.18; // segundos (pausas mínimas significativas)
const EFFECTIVE_DURATION_RATIO = 0.88; // 12% margen para pausas (solo fallback)

// ═════════════════════════════════════════════════════════════════
// FUNCIONES INTERNAS
// ═════════════════════════════════════════════════════════════════

/**
 * Obtiene la duración real del audio con ffprobe.
 */
async function _getRealDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, meta) => {
      if (err) return reject(err);
      if (!meta || !meta.format || !meta.format.duration) {
        return reject(new Error('ffprobe: no duration found'));
      }
      resolve(parseFloat(meta.format.duration));
    });
  });
}

/**
 * Sub-segmenta texto en chunks respetando límite de caracteres.
 * - Rompe por puntuación fuerte primero
 * - Si chunk > maxChars, rompe por palabras
 * - Máximo 2 líneas por bloque
 *
 * @returns {Array} [{ text: string, wordCount: number }]
 */
function _chunkText(text, maxChars = MAX_CHARS_PER_LINE) {
  if (!text || text.trim().length === 0) return [];

  const chunks = [];
  let current = '';

  const sentences = text.split(/([.!?…,;])/); // mantiene separadores

  for (let i = 0; i < sentences.length; i++) {
    const part = sentences[i];
    if (!part) continue;

    const candidate = current ? `${current} ${part}` : part;

    if (candidate.length <= maxChars * MAX_LINES_PER_BLOCK) {
      current = candidate;
    } else {
      if (current.length > 0) {
        chunks.push({
          text: current.trim(),
          wordCount: current.trim().split(/\s+/).length,
        });
      }
      current = part;
    }
  }

  if (current.length > 0) {
    chunks.push({
      text: current.trim(),
      wordCount: current.trim().split(/\s+/).length,
    });
  }

  return chunks.filter(c => c.text.length > 0);
}

/**
 * Distribuye chunks de texto sobre segmentos de habla reales.
 *
 * Algoritmo:
 * 1. Calcular duración de habla pura (sin silencios)
 * 2. Para cada chunk: asignar proporción del tiempo de habla
 * 3. Mapear posición de habla → timestamps globales del audio
 * 4. Validar duraciones (min 0.8s, max 2.5s)
 *
 * @param {Array} chunks - [{ text, wordCount }]
 * @param {Array} segments - [{ start, end }] de silencedetect
 * @returns {Array} [{ text, start, end }]
 */
function _distributeChunksOverSegments(chunks, segments) {
  if (!chunks || chunks.length === 0 || !segments || segments.length === 0) {
    return [];
  }

  // Pre-calcular duración pura de habla
  const totalSpeechDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
  const totalWords = chunks.reduce((sum, c) => sum + c.wordCount, 0);

  if (totalWords === 0) return [];

  const captions = [];
  let speechCursor = 0; // posición en tiempo de habla pura
  let globalCursor = 0; // mapeo a timestamps globales

  // Mapear segmento index → posición global absoluta (construir índice)
  const segmentIndex = [];
  let accumulatedSpeechTime = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    segmentIndex.push({
      segIndex: i,
      speechStart: accumulatedSpeechTime,
      speechEnd: accumulatedSpeechTime + (seg.end - seg.start),
      globalStart: seg.start,
      globalEnd: seg.end,
    });
    accumulatedSpeechTime += seg.end - seg.start;
  }

  // Distribuir chunks
  for (const chunk of chunks) {
    const chunkWeight = chunk.wordCount / totalWords;
    const chunkSpeechDuration = totalSpeechDuration * chunkWeight;

    // Encontrar segmento(s) que contienen este chunk
    const captionStart = Math.max(0, speechCursor);
    const captionEnd = Math.min(totalSpeechDuration, speechCursor + chunkSpeechDuration);

    // Mapear posición de habla → tiempo global
    let globalStart = null;
    let globalEnd = null;

    for (const idx of segmentIndex) {
      if (idx.speechEnd > captionStart && idx.speechStart < captionEnd) {
        if (globalStart === null) {
          // Primer segmento que toca: mapear captionStart (relativo a segmento)
          const relPos = Math.max(0, captionStart - idx.speechStart);
          globalStart = idx.globalStart + relPos;
        }
        // Último segmento que toca: mapear captionEnd
        const relPos = Math.min(idx.speechEnd - idx.speechStart, captionEnd - idx.speechStart);
        globalEnd = idx.globalStart + relPos;
      }
    }

    // Fallback: si no se mapea bien, usar aproximación
    if (globalStart === null || globalEnd === null) {
      const ratio = captionStart / totalSpeechDuration;
      const totalDuration = segments[segments.length - 1].end;
      globalStart = totalDuration * ratio;
      globalEnd = Math.min(totalDuration, globalStart + chunkSpeechDuration);
    }

    // Validar duraciones
    let duration = globalEnd - globalStart;
    if (duration < MIN_CAPTION_DURATION) {
      // Extender hasta siguiente segmento o hasta fin de audio
      globalEnd = Math.min(segments[segments.length - 1].end, globalStart + MIN_CAPTION_DURATION);
    } else if (duration > MAX_CAPTION_DURATION) {
      // Recortar
      globalEnd = globalStart + MAX_CAPTION_DURATION;
    }

    captions.push({
      text: chunk.text,
      start: globalStart,
      end: globalEnd,
    });

    speechCursor += chunkSpeechDuration;
  }

  return captions;
}

/**
 * Valida, aplica fine-tuning de timing, corrige overlaps y clamping.
 *
 * Fine-tuning:
 * - Adelantar start en CAPTION_START_LEAD (mostrar antes de hablar)
 * - Extender end en CAPTION_END_EXTENSION (mantener después de hablar)
 * - Anti-overlap: asegurar que start > prev.end + 0.03s
 */
function _validateAndClamp(captions, audioDuration) {
  if (!captions || captions.length === 0) return [];

  // 1. Filtrar inválidos
  let valid = captions.filter(c => c.end > c.start && c.start < audioDuration);

  // 2. Aplicar fine-tuning de timing
  valid = valid.map(c => ({
    ...c,
    // Adelantar start (mostrar caption antes de empezar a hablar)
    start: Math.max(0, c.start - CAPTION_START_LEAD),
    // Extender end (mantener caption después de terminar)
    end: c.end + CAPTION_END_EXTENSION,
  }));

  // 3. Clamp al audio
  valid = valid.map(c => ({
    ...c,
    end: Math.min(c.end, audioDuration - 0.02), // asegurar que no excede
  }));

  // 4. Anti-overlap con siguiente caption
  valid = valid.reduce((acc, cap, idx) => {
    if (acc.length > 0) {
      const prev = acc[acc.length - 1];
      if (cap.start < prev.end + 0.03) {
        // Overlap: mover start hacia después del anterior
        cap = { ...cap, start: prev.end + 0.03 };
      }
    }

    // Si hay siguiente caption, asegurar no overlap
    if (idx + 1 < valid.length) {
      const next = valid[idx + 1];
      if (cap.end > next.start - 0.03) {
        // Recortar end para no solapar
        cap = { ...cap, end: Math.max(cap.start + MIN_CAPTION_DURATION, next.start - 0.03) };
      }
    }

    // Descartar si inválido tras ajuste
    if (cap.end <= cap.start + 0.05) return acc;
    return [...acc, cap];
  }, []);

  return valid;
}

/**
 * Fallback cuando silencedetect no encuentra segmentos.
 * Distribuye uniformemente sobre la duración real del audio.
 */
function _uniformFallback(sections, audioDuration) {
  const effectiveDuration = audioDuration * EFFECTIVE_DURATION_RATIO;
  const totalWords = sections.reduce((sum, s) => sum + (s.text.split(/\s+/).length), 0);

  const captions = [];
  let currentTime = 0;

  for (const section of sections) {
    const words = section.text.split(/\s+/).length;
    const weight = words / totalWords;
    const sectionDuration = effectiveDuration * weight;

    const chunks = _chunkText(section.text);
    const chunkDuration = sectionDuration / (chunks.length || 1);

    for (const chunk of chunks) {
      const start = currentTime;
      const end = Math.min(audioDuration - 0.05, currentTime + Math.max(MIN_CAPTION_DURATION, chunkDuration));

      captions.push({
        text: chunk.text,
        start,
        end,
      });

      currentTime = end + 0.02; // pequeña pausa entre bloques
    }
  }

  return captions;
}

// ═════════════════════════════════════════════════════════════════
// FUNCIÓN PÚBLICA PRINCIPAL
// ═════════════════════════════════════════════════════════════════

/**
 * Construye captions sincronizados con el audio final real.
 *
 * @param {string} finalAudioPath - Ruta a voice_proc.mp3 (audio postprocesado)
 * @param {Array} scriptSegments - Resultado de getScriptSections(script)
 * @param {string} videoId - ID del vídeo (para logging)
 * @param {string} outputDir - Directorio de output para debug JSON
 *
 * @returns {Array} [{ text, start, end, section, source }]
 *   source: "final-audio-speech-segment" o "fallback-estimated"
 */
async function buildCaptionsFromFinalAudio({ finalAudioPath, scriptSegments, videoId, outputDir }) {
  try {
    // 1. Obtener duración real del audio
    const audioDuration = await _getRealDuration(finalAudioPath);
    logger.info(`CaptionSync: audio duration = ${audioDuration.toFixed(2)}s`);

    // 2. Detectar segmentos de habla en el audio final
    let voiceSegments = [];
    let detectionMethod = 'initial-attempt';

    try {
      voiceSegments = await detectVoiceSegments(finalAudioPath, outputDir, {
        noiseThreshold: SILENCE_THRESHOLD,
        minDuration: MIN_SILENCE_DURATION,
      });
      logger.info(`CaptionSync: detected ${voiceSegments.length} voice segments`);
    } catch (err) {
      logger.warn(`CaptionSync: silencedetect failed (${err.message}) — using fallback`);
      voiceSegments = [];
      detectionMethod = 'fallback-no-segments';
    }

    // 3. Construir captions
    let captions = [];
    let source = 'fallback-estimated';

    if (voiceSegments.length > 0) {
      // Usar segmentos de habla reales
      const allChunks = scriptSegments.flatMap(s =>
        _chunkText(s.text).map(c => ({ ...c, section: s.key }))
      );

      captions = _distributeChunksOverSegments(allChunks, voiceSegments);
      source = 'final-audio-speech-segment';

      logger.info(`CaptionSync: distributed ${allChunks.length} chunks over ${voiceSegments.length} segments`);
    } else {
      // Fallback: distribución uniforme
      captions = _uniformFallback(scriptSegments, audioDuration);
      source = 'fallback-estimated';

      logger.warn(`CaptionSync: using fallback distribution (${captions.length} captions)`);
    }

    // 4. Validar y limpiar
    captions = _validateAndClamp(captions, audioDuration);

    // 5. Agregar metadata
    captions = captions.map((c, idx) => ({
      ...c,
      section: c.section || 'unknown',
      source,
      idx,
    }));

    // 6. Medir drift y aplicar evaluación de calidad
    let driftStatus = 'excellent';
    let driftValue = 0;
    if (captions.length > 0) {
      const lastEnd = captions[captions.length - 1].end;
      driftValue = Math.abs(lastEnd - audioDuration);

      if (driftValue > MAX_ACCEPTABLE_DRIFT) {
        driftStatus = 'warning';
        logger.warn(
          `CaptionSync: DRIFT ALERT | drift=${driftValue.toFixed(3)}s > max=${MAX_ACCEPTABLE_DRIFT}s`
        );
      } else if (driftValue > 0.2) {
        driftStatus = 'acceptable';
      }
    }

    // 7. Guardar debug JSON con sync tuning metadata
    const debugPath = path.join(outputDir, 'captions-debug.json');
    fs.writeFileSync(
      debugPath,
      JSON.stringify(
        {
          videoId,
          method: 'caption-sync',
          source,
          detectionMethod,
          audioDuration: parseFloat(audioDuration.toFixed(3)),
          voiceSegmentsCount: voiceSegments.length,
          voiceSegments: voiceSegments.slice(0, 10), // primeros 10 para debug
          captionsCount: captions.length,
          firstCaption: captions[0] || null,
          middleCaption: captions[Math.floor(captions.length / 2)] || null,
          lastCaption: captions[captions.length - 1] || null,
          captions, // todos los captions
          syncTuning: {
            captionStartLead: CAPTION_START_LEAD,
            captionEndExtension: CAPTION_END_EXTENSION,
            minDuration: MIN_CAPTION_DURATION,
            maxDuration: MAX_CAPTION_DURATION,
            silenceThreshold: SILENCE_THRESHOLD,
            minSilenceDuration: MIN_SILENCE_DURATION,
          },
          drift: {
            value: parseFloat(driftValue.toFixed(3)),
            status: driftStatus,
            maxAcceptable: MAX_ACCEPTABLE_DRIFT,
          },
          generatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    logger.info(`CaptionSync: generated ${captions.length} captions | source=${source} | debug=${debugPath}`);

    return captions;
  } catch (err) {
    logger.error(`CaptionSync: fatal error: ${err.message}`);
    throw err;
  }
}

module.exports = {
  buildCaptionsFromFinalAudio,
};
