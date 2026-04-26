/**
 * voice-synthesizer.js
 * TTS con dos motores:
 *   1. Kokoro TTS (local, open source, calidad near-ElevenLabs) — primario
 *   2. Microsoft Edge TTS (fallback automático si Kokoro falla)
 *
 * Kokoro genera WAV → FFmpeg convierte a MP3 en video-renderer.
 * Edge TTS genera MP3 directamente.
 */

require('dotenv').config();
const { MsEdgeTTS, OUTPUT_FORMAT, MetadataOptions } = require('msedge-tts');
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { ensureLegacyFields, getCombinedScriptText, getScriptSections } = require('../utils/script-segments');
const { createPerfTracker, formatDurationMs } = require('../utils/perf-tracker');
const { buildEmotionalSSML, EMOTIONAL_PROFILES } = require('../utils/emotional-ssml');
const ffmpegInstaller  = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const DEFAULT_VOICE      = process.env.EDGE_TTS_VOICE   || 'es-ES-ElviraNeural';
const KOKORO_VOICE       = process.env.KOKORO_VOICE      || 'ef_dora';
const KOKORO_SPEED       = process.env.KOKORO_SPEED      || '1.05';
const KOKORO_ENABLED     = process.env.KOKORO_ENABLED    !== 'false'; // activo por defecto
const KOKORO_SCRIPT      = path.resolve(__dirname, '../utils/kokoro_tts.py');
const PYTHON_BIN         = process.env.PYTHON_BIN        || 'python3';
const SEGMENT_KEYS       = ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'];
const STOPWORDS = new Set(['que', 'como', 'esto', 'esta', 'este', 'para', 'pero', 'porque', 'aunque', 'donde', 'cuando', 'quien', 'quienes', 'sobre', 'desde', 'hasta', 'entre', 'algo', 'alguien', 'nada', 'todo', 'siempre', 'nunca', 'solo', 'solo', 'mas', 'muy', 'con', 'sin', 'por', 'del', 'las', 'los', 'una', 'uno', 'unos', 'unas', 'esa', 'ese', 'eso', 'aqui', 'ahi', 'alli', 'tambien', 'mismo', 'misma', 'mismas', 'mismos', 'cada', 'justo', 'casi', 'tu', 'tus', 'te', 'ya']);

const SPANISH_VOICES = {
  // Kokoro (local)
  'ef_dora':             { gender: 'Female', locale: 'Español', engine: 'kokoro' },
  'em_alex':             { gender: 'Male',   locale: 'Español', engine: 'kokoro' },
  // Edge TTS (fallback)
  'es-ES-AlvaroNeural':  { gender: 'Male',   locale: 'España',    engine: 'edge' },
  'es-ES-ElviraNeural':  { gender: 'Female', locale: 'España',    engine: 'edge' },
  'es-MX-JorgeNeural':   { gender: 'Male',   locale: 'México',    engine: 'edge' },
  'es-MX-DaliaNeural':   { gender: 'Female', locale: 'México',    engine: 'edge' },
};

/**
 * Construye SSML con prosody optimizado para divulgación científica viral.
 * - Hook: ritmo más lento + pitch más bajo = más impacto
 * - Pausa larga después del hook (momento "espera, ¿qué?")
 * - Palabras en CAPS reciben énfasis automático
 * - CTA: ritmo ligeramente más lento para que quede grabado
 */
/**
 * Construye el texto con pausas dramáticas.
 * Edge TTS interpreta "..." como pausa media y ".\n" como pausa corta.
 * El hook va más lento visualmente por ser la frase de más impacto.
 */
function buildText(script) {
  const plan = script.narrationPlan || prepareNarrationForTTS(script);
  return plan.blocks
    .map((block) => block.text)
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Construye texto limpio para Kokoro (sin marcadores de pausa SSML).
 * Kokoro interpreta la puntuación natural — punto y coma = pausa corta, punto = pausa media.
 */
function buildKokoroText(script) {
  return buildText(script);
}

/**
 * Normaliza el texto para Kokoro TTS:
 * - Convierte palabras en MAYÚSCULAS a Título (Kokoro las deletrea si van en caps)
 * - Elimina emojis (Kokoro no los soporta y puede cortarse)
 * - Elimina ¿ (causa problemas de encoding en Windows CLI)
 * - Limpia marcadores de pausa ... ... residuales
 */
function normalizeForKokoro(text) {
  return text
    // Convierte palabras todo-mayúsculas de 2+ letras a Title Case
    .replace(/\b([A-ZÁÉÍÓÚÜÑ]{2,})\b/g, (word) =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    // Elimina emojis
    .replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[\u{1F300}-\u{1F9FF}]/gu, '')
    // Elimina ¿ y ¡ (encoding Windows puede romper args del proceso)
    .replace(/[¿¡]/g, '')
    // Limpia marcadores de pausa residuales (... ...)
    .replace(/\.{2,}\s*\.*/g, '.')
    // Espacios múltiples
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Construye el contenido SSML interno para Edge TTS.
 * toStream() ya envuelve esto en <speak><voice><prosody> — solo pasamos el contenido.
 * El hook, si es pregunta (termina en ?), recibe prosody con pitch ascendente.
 */
function buildSSMLContent(script) {
  const plan = script.narrationPlan || prepareNarrationForTTS(script);
  return plan.blocks.map((block, blockIndex) => {
    const content = block.parts.map((part, partIndex) => {
      const profile = part.profile || {};
      const raw = sanitizeText(part.text || '');
      if (!raw) return '';
      const wrapped = `<prosody rate="${profile.ssmlRate || '0%'}" pitch="${profile.ssmlPitch || '0%'}" volume="${profile.ssmlVolume || '0%'}">${raw}</prosody>`;
      const prefix = partIndex === 0 && blockIndex === 0 ? '' : `<break time="${Math.round((part.pauseBefore || 0) * 1000)}ms"/>`;
      const suffix = partIndex === block.parts.length - 1 ? '' : (part.joiner || '');
      return `${prefix}${wrapped}${suffix}`;
    }).filter(Boolean).join(' ');
    return block.pauseAfter > 0 ? `${content}<break time="${Math.round(block.pauseAfter * 1000)}ms"/>` : content;
  }).join(' ').trim();
}

function buildAudioBlocks(script) {
  const plan = script.narrationPlan || prepareNarrationForTTS(script);
  return plan.blocks;
}

function _cleanNarrationText(text = '') {
  return String(text || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

function _ensureNarrationEnding(text = '', key = '') {
  const clean = _cleanNarrationText(text);
  if (!clean) return '';
  if (/[.!?…]$/.test(clean)) return clean;
  if (key === 'hook' || key === 'open_loop' || key === 'reengage') return `${clean}...`;
  if (key === 'soft_cta') return clean.endsWith('?') ? clean : `${clean}?`;
  return `${clean}.`;
}

function _appendJoiner(text = '', joiner = '') {
  const clean = _cleanNarrationText(text).replace(/[.?!…]+$/g, '');
  if (!clean) return '';
  return joiner ? `${clean}${joiner}` : clean;
}

function _collectEmphasisWords(text = '') {
  const caps = (String(text || '').match(/\b([A-ZÁÉÍÓÚÜÑ]{3,})\b/g) || []).map((w) => w.toLowerCase());
  const tokens = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-zñ]{4,}/g) || [];
  const content = tokens.filter((token) => !STOPWORDS.has(token));
  return [...new Set([...caps, ...content.slice(-2)])].slice(0, 3);
}

function _getSegmentDelivery(key = '') {
  const map = {
    hook: { deliveryStyle: 'directo', narrationEnergy: 'alta', pauseStrength: 'fuerte', pacing: 'corto', pauseBefore: 0, pauseAfter: 0.46, joiner: '...', ssmlRate: '-8%', ssmlPitch: '+2%', ssmlVolume: '0%' },
    open_loop: { deliveryStyle: 'susurrado-tenso', narrationEnergy: 'media-alta', pauseStrength: 'media', pacing: 'tenso', pauseBefore: 0.06, pauseAfter: 0.12, joiner: '.', ssmlRate: '-7%', ssmlPitch: '0%', ssmlVolume: '0%' },
    micro_value: { deliveryStyle: 'claro', narrationEnergy: 'media', pauseStrength: 'corta', pacing: 'estable', pauseBefore: 0.04, pauseAfter: 0.08, joiner: '.', ssmlRate: '-8%', ssmlPitch: '0%', ssmlVolume: '0%' },
    escalation: { deliveryStyle: 'creciente', narrationEnergy: 'media-alta', pauseStrength: 'corta', pacing: 'agil', pauseBefore: 0.04, pauseAfter: 0.18, joiner: '.', ssmlRate: '-6%', ssmlPitch: '0%', ssmlVolume: '0%' },
    reengage: { deliveryStyle: 'remate', narrationEnergy: 'alta', pauseStrength: 'fuerte', pacing: 'marcado', pauseBefore: 0.26, pauseAfter: 0.12, joiner: '...', ssmlRate: '-8%', ssmlPitch: '0%', ssmlVolume: '0%' },
    peak: { deliveryStyle: 'impacto', narrationEnergy: 'muy alta', pauseStrength: 'media', pacing: 'enfatico', pauseBefore: 0.18, pauseAfter: 0.16, joiner: '.', ssmlRate: '-7%', ssmlPitch: '0%', ssmlVolume: '0%' },
    open_ending: { deliveryStyle: 'eco', narrationEnergy: 'media', pauseStrength: 'corta', pacing: 'controlado', pauseBefore: 0.08, pauseAfter: 0.06, joiner: '.', ssmlRate: '-7%', ssmlPitch: '0%', ssmlVolume: '0%' },
    soft_cta: { deliveryStyle: 'conversacional', narrationEnergy: 'media', pauseStrength: 'ninguna', pacing: 'natural', pauseBefore: 0.05, pauseAfter: 0, joiner: '', ssmlRate: '-8%', ssmlPitch: '0%', ssmlVolume: '0%' },
  };
  return map[key] || { deliveryStyle: 'natural', narrationEnergy: 'media', pauseStrength: 'corta', pacing: 'estable', pauseBefore: 0.04, pauseAfter: 0.08, joiner: '.', ssmlRate: '-8%', ssmlPitch: '0%', ssmlVolume: '0%' };
}

function _adaptSegmentText(text = '', key = '') {
  let adapted = _cleanNarrationText(text);
  adapted = adapted
    .replace(/\s+y en ese momento\b/gi, ', y en ese momento')
    .replace(/\s+y ahi\b/gi, ', y ahi')
    .replace(/\s+y aqui\b/gi, ', y aqui')
    .replace(/\s+sin que lo notes\b/gi, ', sin que lo notes')
    .replace(/\s+aunque\b/gi, ', aunque')
    .replace(/\s+de verdad\b/gi, ', de verdad');
  return _ensureNarrationEnding(adapted, key);
}

function prepareNarrationForTTS(script = {}) {
  const normalized = ensureLegacyFields(script);
  const sectionMap = Object.fromEntries(getScriptSections(normalized).map((section) => [section.key, section.text]));
  const segments = {};

  for (const key of SEGMENT_KEYS) {
    const rawText = sectionMap[key] || '';
    if (!rawText) continue;
    const profile = _getSegmentDelivery(key);
    segments[key] = {
      key,
      text: _adaptSegmentText(rawText, key),
      deliveryStyle: profile.deliveryStyle,
      narrationEnergy: profile.narrationEnergy,
      pauseStrength: profile.pauseStrength,
      emphasisWords: _collectEmphasisWords(rawText),
      pacing: profile.pacing,
      pauseBefore: profile.pauseBefore,
      pauseAfter: profile.pauseAfter,
      joiner: profile.joiner,
      ssmlRate: profile.ssmlRate,
      ssmlPitch: profile.ssmlPitch,
      ssmlVolume: profile.ssmlVolume,
    };
  }

  const blockDefinitions = [
    { key: 'block_1', segments: ['hook', 'open_loop'], pauseAfter: 0.46, blockPacing: 'controlado con gancho' },
    { key: 'block_2', segments: ['micro_value', 'escalation'], pauseAfter: 0.22, blockPacing: 'creciente' },
    { key: 'block_3', segments: ['reengage', 'peak'], pauseAfter: 0.18, blockPacing: 'impacto' },
    { key: 'block_4', segments: ['open_ending', 'soft_cta'], pauseAfter: 0, blockPacing: 'cierre conversacional' },
  ];

  const blocks = blockDefinitions
    .map((block) => {
      const parts = block.segments
        .map((key) => segments[key])
        .filter(Boolean)
        .map((segment) => ({
          key: segment.key,
          text: segment.text,
          joiner: segment.joiner,
          pauseBefore: segment.pauseBefore,
          profile: segment,
        }));
      if (!parts.length) return null;
      return {
        key: block.key,
        pauseAfter: parts[parts.length - 1]?.key === 'hook' ? 0.46 : block.pauseAfter,
        blockPacing: block.blockPacing,
        parts,
        text: parts.map((part, index) => {
          const clean = String(part.text || '').trim();
          if (!clean) return '';
          if (index === parts.length - 1 || !part.joiner) return clean;
          return _appendJoiner(clean, part.joiner);
        }).filter(Boolean).join(' '),
      };
    })
    .filter(Boolean);

  return {
    mode: 'natural_short_v1',
    segments,
    blocks,
  };
}

function buildSectionDurationsFromBlocks(blockResults) {
  const sectionDurations = {};
  let cursor = 0;

  for (const block of blockResults) {
    const totalWords = block.parts.reduce((sum, part) => sum + String(part.text || '').trim().split(/\s+/).filter(Boolean).length, 0) || 1;
    let localCursor = 0;

    for (const part of block.parts) {
      const words = String(part.text || '').trim().split(/\s+/).filter(Boolean).length;
      const duration = block.duration * (words / totalWords);
      sectionDurations[part.key] = {
        start: parseFloat((cursor + localCursor).toFixed(3)),
        duration: parseFloat(duration.toFixed(3)),
        segments: [{ start: parseFloat(localCursor.toFixed(3)), end: parseFloat((localCursor + duration).toFixed(3)) }],
      };
      localCursor += duration;
    }

    cursor += block.duration + block.pauseAfter;
  }

  return sectionDurations;
}

/**
 * Mapea los word boundaries de TTS a tiempos de inicio/fin por sección.
 * Usa conteo de palabras para asignar cada boundary a su sección.
 */
function mapSectionTimings(script, wordBoundaries) {
  const sections = getScriptSections(script);

  const timings = {};
  let idx = 0;

  for (const section of sections) {
    const wordCount = section.text.trim().split(/\s+/).length;
    const slice = wordBoundaries.slice(idx, idx + wordCount);
    if (slice.length > 0) {
      const first = slice[0];
      const last  = slice[slice.length - 1];
      timings[section.key] = {
        start: parseFloat(first.start.toFixed(3)),
        end:   parseFloat((last.start + last.duration).toFixed(3)),
      };
    }
    idx += wordCount;
  }

  return timings;
}

/**
 * Fallback: calcula tiempos proporcionales al número de palabras por sección.
 * Mucho mejor que los ratios fijos anteriores.
 */
function proportionalSectionTimings(script, realDuration) {
  const sections = getScriptSections(script).map((section, index, all) => ({
    key: section.key,
    text: section.text,
    pauseSecs: index === 0 ? 0.5 : index === all.length - 1 ? 0.0 : 0.22,
  }));

  // Peso total = palabras + equivalente en palabras de las pausas (~2.5 pal/s)
  const WPS = 2.5;
  const totalWeight = sections.reduce((sum, s) => {
    return sum + s.text.trim().split(/\s+/).length + s.pauseSecs * WPS;
  }, 0);

  const timings = {};
  let currentTime = 0;

  for (const s of sections) {
    const words = s.text.trim().split(/\s+/).length;
    const speechDuration = realDuration * (words / totalWeight);
    timings[s.key] = {
      start: parseFloat(currentTime.toFixed(3)),
      end:   parseFloat((currentTime + speechDuration).toFixed(3)),
    };
    currentTime += speechDuration + s.pauseSecs;
  }

  return timings;
}

// ─────────────────────────────────────────────
//  UTILIDADES DE AUDIO
// ─────────────────────────────────────────────

/**
 * Mide la duración real de un archivo de audio con ffprobe.
 */
function getSegmentDuration(audioPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(audioPath, (err, meta) => {
      if (err || !meta?.format?.duration) return resolve(0);
      resolve(parseFloat(meta.format.duration));
    });
  });
}

/**
 * Detecta segmentos de habla en un WAV usando silencedetect de FFmpeg.
 * Devuelve [{start, end}] en segundos RELATIVOS al inicio del archivo.
 * Noise threshold: -35 dB, duración mínima de silencio: 0.08s.
 *
 * Si no se detectan silencios (habla continua), devuelve un solo segmento
 * que cubre toda la duración.
 *
 * @param {string} wavPath        - ruta al WAV de la sección
 * @param {number} sectionDuration - duración total medida con ffprobe
 * @returns {Promise<Array<{start: number, end: number}>>}
 */
function detectSpeechSegments(wavPath, sectionDuration) {
  return new Promise((resolve) => {
    const ffmpegPath = ffmpegInstaller.path;
    const args = [
      '-i', wavPath,
      '-af', 'silencedetect=noise=-35dB:d=0.08',
      '-f', 'null',
      '-',
    ];

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    proc.stderr.on('data', c => { output += c.toString(); });
    proc.stdout.on('data', c => { output += c.toString(); });

    const fallback = [{ start: 0, end: sectionDuration }];

    proc.on('close', () => {
      try {
        const silenceStarts = [];
        const silenceEnds   = [];

        for (const line of output.split('\n')) {
          const startM = line.match(/silence_start:\s*([\d.]+)/);
          const endM   = line.match(/silence_end:\s*([\d.]+)/);
          if (startM) silenceStarts.push(parseFloat(startM[1]));
          if (endM)   silenceEnds.push(parseFloat(endM[1]));
        }

        if (silenceStarts.length === 0) return resolve(fallback);

        // Construir lista de silencios completos (ignorar silencios sin end)
        const silences = [];
        for (let i = 0; i < silenceStarts.length; i++) {
          silences.push({
            start: silenceStarts[i],
            end:   silenceEnds[i] !== undefined ? silenceEnds[i] : sectionDuration,
          });
        }
        silences.sort((a, b) => a.start - b.start);

        // Derivar segmentos de habla entre silencios
        const segments = [];
        let speechStart = 0;

        for (const sil of silences) {
          if (sil.start > speechStart + 0.04) {
            segments.push({ start: parseFloat(speechStart.toFixed(3)), end: parseFloat(sil.start.toFixed(3)) });
          }
          speechStart = sil.end;
        }
        if (speechStart < sectionDuration - 0.04) {
          segments.push({ start: parseFloat(speechStart.toFixed(3)), end: parseFloat(sectionDuration.toFixed(3)) });
        }

        if (segments.length === 0) return resolve(fallback);

        logger.debug(`silencedetect [${path.basename(wavPath)}]: ${segments.length} speech segs | ${JSON.stringify(segments)}`);
        resolve(segments);
      } catch (e) {
        logger.warn(`detectSpeechSegments error: ${e.message}`);
        resolve(fallback);
      }
    });

    proc.on('error', () => resolve(fallback));
  });
}

/**
 * Concatena segmentos WAV con pausas de silencio entre ellos usando FFmpeg.
 * Genera el silencio como fuente lavfi (anullsrc) — compatible con todas las
 * versiones de FFmpeg sin depender de apad=pad_dur.
 *
 * segments = [{ path, pauseAfter }]  pauseAfter en segundos (0 para el último)
 */
function concatenateSegmentsWithPauses(segments, outputPath) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg();
    const inputLabels = [];
    let idx = 0;

    for (const seg of segments) {
      // Segmento de audio
      cmd = cmd.input(seg.path);
      inputLabels.push(`[${idx}:a]`);
      idx++;

      // Silencio entre secciones como fuente lavfi
      const pause = seg.pauseAfter || 0;
      if (pause > 0) {
        cmd = cmd
          .input('anullsrc=r=44100:cl=mono')
          .inputFormat('lavfi')
          .inputOptions([`-t ${pause}`]);
        inputLabels.push(`[${idx}:a]`);
        idx++;
      }
    }

    const concatExpr = `${inputLabels.join('')}concat=n=${inputLabels.length}:v=0:a=1[out]`;

    cmd
      .complexFilter(concatExpr)
      .outputOptions(['-map [out]'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`concat error: ${err.message}`)))
      .run();
  });
}

// ─────────────────────────────────────────────
//  KOKORO TTS
// ─────────────────────────────────────────────

/**
 * Sanitiza texto para TTS: elimina caracteres que rompen los motores.
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // Emojis y símbolos especiales
    .replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[\u{1F300}-\u{1F9FF}]/gu, '')
    // XML/HTML entities que rompen SSML
    .replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
    // Caracteres de control
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Espacios múltiples
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Llama al proceso Kokoro con texto crudo (vía stdin).
 * Función base — usada tanto para síntesis completa como por sección.
 * Si falla con "bad allocation" (OOM transitorio), reintenta 1 vez tras 2s.
 */
async function synthesizeRawTextWithKokoro(text, outputWavPath, timeoutMs = 90_000) {
  try {
    return await _synthesizeRawTextWithKokoroOnce(text, outputWavPath, timeoutMs);
  } catch (err) {
    if (err.message.includes('bad allocation') || err.message.includes('FAIL')) {
      logger.warn(`Kokoro: bad allocation — retrying in 2s`);
      await new Promise(r => setTimeout(r, 2000));
      return _synthesizeRawTextWithKokoroOnce(text, outputWavPath, timeoutMs);
    }
    throw err;
  }
}

function _synthesizeRawTextWithKokoroOnce(text, outputWavPath, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(KOKORO_SCRIPT)) {
      return reject(new Error(`kokoro_tts.py no encontrado: ${KOKORO_SCRIPT}`));
    }

    const normalizedText = normalizeForKokoro(sanitizeText(text));
    if (!normalizedText || normalizedText.length < 3) {
      return reject(new Error('Kokoro: texto normalizado demasiado corto'));
    }

    const pythonDir = path.dirname(PYTHON_BIN);
    const augmentedPath = pythonDir
      ? `${pythonDir}${path.delimiter}${process.env.PATH || ''}`
      : (process.env.PATH || '');

    const proc = spawn(
      PYTHON_BIN,
      [KOKORO_SCRIPT, '-', outputWavPath, KOKORO_VOICE, KOKORO_SPEED],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: augmentedPath, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      },
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(new Error(`Kokoro process timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    proc.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    proc.stderr.on('data', (c) => { stderr += c.toString('utf8'); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      const rawOut = stdout.trim();
      if (code !== 0) {
        return reject(new Error(
          `Kokoro exit ${code}: ${(stderr || rawOut).slice(0, 300).replace(/\n/g, ' ')}`
        ));
      }
      if (!rawOut) return reject(new Error('Kokoro: stdout vacío'));
      try {
        const result = JSON.parse(rawOut);
        if (!result.ok) return reject(new Error(`Kokoro error: ${result.error}`));
        if (!fs.existsSync(outputWavPath) || fs.statSync(outputWavPath).size < 1000) {
          return reject(new Error('Kokoro: WAV no creado o vacío'));
        }
        resolve({ wavPath: outputWavPath, duration: result.duration });
      } catch (e) {
        reject(new Error(`Kokoro bad output: ${rawOut.slice(0, 80)}`));
      }
    });

    proc.on('error', (err) => { clearTimeout(timer); reject(new Error(`Kokoro spawn: ${err.message}`)); });

    try { proc.stdin.write(normalizedText, 'utf8'); proc.stdin.end(); }
    catch (e) { clearTimeout(timer); reject(new Error(`Kokoro stdin write: ${e.message}`)); }
  });
}

/**
 * Síntesis segmentada con Kokoro:
 * Genera un WAV por sección (hook / claim / explanation / cta),
 * mide la duración real de cada uno con ffprobe,
 * y concatena con pausas explícitas.
 *
 * @returns {{ audioPath, estimatedDuration, wordBoundaries, sectionDurations }}
 *   sectionDurations = { hook, claim, explanation, cta }  (segundos medidos, sin pausa)
 */
/**
 * Sintetiza un segmento con emocionalidad Y humanización:
 * - Configuración emocional por perfil
 * - Humanización: micro-pausas irregulares, respiraciones, variación controlada
 */
async function _synthesizeEmotionalSegment(text, sectionKey, outputDir) {
  const profile = EMOTIONAL_PROFILES[sectionKey] || EMOTIONAL_PROFILES.hook;

  // Construir SSML con emocionalidad + humanización
  const emotionalSSML = buildEmotionalSSML(text, sectionKey, true, true);  // humanize=true

  // Para Kokoro (que usa texto plano), extraer el texto limpio del SSML
  const cleanText = emotionalSSML
    .replace(/<[^>]+>/g, '')  // Remover tags SSML
    .replace(/\s+/g, ' ')     // Normalizar espacios
    .trim();

  if (cleanText.length < 3) {
    throw new Error(`Segmento ${sectionKey} después de limpieza: texto vacío`);
  }

  // Sintetizar el texto (Kokoro maneja el texto plano)
  const segPath = path.join(outputDir, `seg_${sectionKey}.wav`);
  const result = await synthesizeRawTextWithKokoro(cleanText, segPath);
  const realDur = await getSegmentDuration(result.wavPath);
  const dur = realDur > 0 ? realDur : result.duration;

  return {
    wavPath: result.wavPath,
    duration: dur,
    profile,
    emotionalConfig: {
      rate: profile.rate,
      pitch: profile.pitch,
      breakBefore: profile.breakBefore,
      breakAfter: profile.breakAfter,
    },
    humanized: true,  // Flag para logging
  };
}

async function synthesizeWithKokoroSegmented(script, outputDir) {
  const perf = createPerfTracker('tts-kokoro-segmented');
  const sections = buildAudioBlocks(script)
    .map((block) => ({ key: block.key, text: block.text, pauseAfter: block.pauseAfter, parts: block.parts }))
    .filter(s => s.text.length >= 3);

  if (sections.length === 0) throw new Error('Kokoro segmented: script sin secciones válidas');

  // Sintetizar cada sección SECUENCIALMENTE — evita cargar el modelo ONNX
  // 4 veces en paralelo (~1.2 GB RAM simultáneos → bad allocation en sistemas con <4 GB libres)
  const segmentResults = [];
  for (const s of sections) {
    perf.start(`segment_${s.key}`);

    try {
      // Usar síntesis emocional si está habilitada
      const emotionalResult = await _synthesizeEmotionalSegment(s.text, s.key, outputDir);
      const segments = await detectSpeechSegments(emotionalResult.wavPath, emotionalResult.duration);

      const phase = perf.end({ duration: emotionalResult.duration, speechSegments: segments.length });
      logger.info(
        `Kokoro segment [${s.key}]: ${emotionalResult.duration.toFixed(3)}s | ${segments.length} speech seg(s) | ` +
        `synth=${formatDurationMs(phase.durationMs)} | emotional=yes | humanized=yes | ` +
        `rate=${emotionalResult.profile.rate}% | breakAfter=${emotionalResult.profile.breakAfter}ms | ` +
        `"${s.text.slice(0, 40)}..."`
      );

      segmentResults.push({
        ...s,
        wavPath: emotionalResult.wavPath,
        duration: emotionalResult.duration,
        segments,
        emotionalConfig: emotionalResult.emotionalConfig,
      });
    } catch (err) {
      // Fallback: sintetizar sin emocionalidad si falla
      logger.warn(`Emotional synthesis failed for ${s.key}, using standard synthesis: ${err.message}`);
      const segPath = path.join(outputDir, `seg_${s.key}.wav`);
      const result = await synthesizeRawTextWithKokoro(s.text, segPath);
      const realDur = await getSegmentDuration(result.wavPath);
      const dur = realDur > 0 ? realDur : result.duration;
      const segments = await detectSpeechSegments(result.wavPath, dur);
      const phase = perf.end({ duration: dur, speechSegments: segments.length });

      logger.info(
        `Kokoro segment [${s.key}]: ${dur.toFixed(3)}s | ${segments.length} speech seg(s) | synth=${formatDurationMs(phase.durationMs)} | "${s.text.slice(0, 40)}..."`
      );

      segmentResults.push({ ...s, wavPath: result.wavPath, duration: dur, segments });
    }
  }

  // Concatenar con pausas emocionales
  const combinedWav = path.join(outputDir, 'voice.wav');
  const concatSegments = segmentResults.map(s => ({
    path: s.wavPath,
    pauseAfter: s.emotionalConfig?.breakAfter || s.pauseAfter || 0,
    emotional: !!s.emotionalConfig,
  }));
  await concatenateSegmentsWithPauses(concatSegments, combinedWav);

  // Log de pausas emocionales
  const emotionalCount = concatSegments.filter(s => s.emotional).length;
  if (emotionalCount > 0) {
    logger.info(
      `Emotional timing applied: ${emotionalCount} segments with emotional pauses and rate variations`
    );
  }

  // Duración total: sumas de secciones + pausas
  const totalDuration = segmentResults.reduce(
    (sum, s) => sum + s.duration + s.pauseAfter, 0
  );

  // sectionDurations: duración de HABLA de cada sección (sin incluir la pausa)
  // segments: [{start, end}] relativos al inicio de la sección (de silencedetect)
  const sectionDurations = {};
  let cursor = 0;
  for (const s of segmentResults) {
    sectionDurations[s.key] = {
      start:    parseFloat(cursor.toFixed(3)),
      duration: parseFloat(s.duration.toFixed(3)),
      segments: s.segments,   // [{start, end}] relativos — fuente de verdad para sync
    };
    cursor += s.duration + s.pauseAfter;
  }

  const fileSize = fs.statSync(combinedWav).size;
  logger.info(
    `Kokoro segmented: ${(fileSize / 1024).toFixed(0)} KB WAV | ${totalDuration.toFixed(2)}s | ` +
    `${segmentResults.map(s => `${s.key}=${s.duration.toFixed(2)}s`).join(' ')} | total=${formatDurationMs(perf.snapshot().totalMs)}`
  );

  // Limpiar archivos de segmento (ya concatenados)
  for (const s of segmentResults) {
    try { fs.unlinkSync(s.wavPath); } catch {}
  }

  const finalSectionDurations = buildSectionDurationsFromBlocks(segmentResults);

  return {
    audioPath:         combinedWav,
    estimatedDuration: totalDuration,
    wordBoundaries:    [],
    sectionDurations: finalSectionDurations,
  };
}

/**
 * Genera audio con Kokoro TTS local.
 * Usa síntesis segmentada para timing exacto por sección.
 */
async function synthesizeWithKokoro(script, outputPath) {
  const outputDir = path.dirname(outputPath);
  const result = await synthesizeWithKokoroSegmented(script, outputDir);
  return result;
}

// ─────────────────────────────────────────────
//  ENTRY POINT PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Sintetiza el guión y devuelve audio + word boundaries crudos.
 * Orden: Kokoro → Edge TTS. Solo falla si AMBOS fallan.
 *
 * @param {Object} script     - Guión generado por content-generator
 * @param {string} outputPath - Ruta donde guardar el audio (.mp3)
 * @returns {{ audioPath, estimatedDuration, wordCount, wordBoundaries, provider }}
 */
async function synthesizeVoice(script, outputPath) {
  const normalizedScript = ensureLegacyFields(script);
  const narrationPlan = prepareNarrationForTTS(normalizedScript);
  normalizedScript.narrationPlan = narrationPlan;
  const requiredFields = ['hook', 'claim', 'explanation', 'cta'];
  const missing = requiredFields.filter(f => !normalizedScript[f] || String(normalizedScript[f]).trim().length < 3);
  if (missing.length > 0) {
    throw new Error(`TTS: campos de script vacíos o inválidos: ${missing.join(', ')}`);
  }

  const text = buildText(normalizedScript);
  if (!text || text.trim().length < 10) {
    throw new Error('TTS: texto combinado demasiado corto para sintetizar');
  }

  const wordCount = text.split(/\s+/).length;

  // ── Intento 1: Kokoro (segmentado — duración real por sección) ───────────
  if (KOKORO_ENABLED) {
    try {
      const result = await synthesizeWithKokoro(normalizedScript, outputPath);
      return { ...result, wordCount, provider: 'kokoro', narrationPlan };
    } catch (kokoroErr) {
      logger.warn(`Kokoro TTS failed: ${kokoroErr.message.slice(0, 300)} — falling back to Edge TTS`);
    }
  }

  // ── Intento 2: Edge TTS (word boundaries → sync exacto) ──────────────────
  try {
    const result = await synthesizeWithEdgeTTS(normalizedScript, text, outputPath);
    // Edge TTS tiene word boundaries → sectionDurations no es necesario
    return { ...result, wordCount, provider: 'edge', sectionDurations: null, narrationPlan };
  } catch (edgeErr) {
    throw new Error(`TTS: ambos proveedores fallaron. Edge error: ${edgeErr.message}`);
  }
}

async function synthesizeWithEdgeTTS(script, text, outputPath) {
  const perf = createPerfTracker('tts-edge');
  if (!text || text.trim().length < 10) {
    throw new Error('Edge TTS: texto vacío o demasiado corto');
  }

  const voice = DEFAULT_VOICE;

  // Sanitizar cada campo del script antes de construir SSML
  const sanitizedScript = {
    hook:        sanitizeText(script.hook        || ''),
    claim:       sanitizeText(script.claim       || ''),
    explanation: sanitizeText(script.explanation || ''),
    cta:         sanitizeText(script.cta         || ''),
    open_loop:   sanitizeText(script.open_loop   || ''),
    micro_value: sanitizeText(script.micro_value || ''),
    escalation:  sanitizeText(script.escalation  || ''),
    reengage:    sanitizeText(script.reengage    || ''),
    peak:        sanitizeText(script.peak        || ''),
    open_ending: sanitizeText(script.open_ending || ''),
    soft_cta:    sanitizeText(script.soft_cta    || ''),
    structureVersion: script.structureVersion,
    hasReengage: script.hasReengage,
  };

  // Construir contenido SSML con entonación de pregunta y pausas entre secciones
  const ssmlContent = buildSSMLContent(sanitizedScript);

  logger.info(`Edge TTS | Voice: ${voice} | chars: ${ssmlContent.length} (SSML)`);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tts = new MsEdgeTTS();

  // Activar word boundary metadata para sync exacto
  let metaOpts;
  try {
    metaOpts = new MetadataOptions();
    metaOpts.wordBoundaryEnabled = true;
  } catch {
    metaOpts = undefined;
  }

  // 96kbps = 2x calidad de audio vs 48kbps, mismo coste (gratis)
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, metaOpts);

  const { audioStream, metadataStream } = await tts.toStream(ssmlContent);

  // Recoger word boundaries mientras se escribe el audio
  const wordBoundaries = [];
  if (metadataStream) {
    metadataStream.on('data', (chunk) => {
      try {
        const raw = chunk.toString().trim();
        // msedge-tts puede emitir un objeto por chunk o un array
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed
                    : parsed.Metadata        ? parsed.Metadata
                    : [parsed];
        for (const item of items) {
          if (item.Type === 'WordBoundary') {
            wordBoundaries.push({
              word:     item.Data?.text?.Text || '',
              start:    (item.Data?.Offset   || 0) / 10_000_000, // ticks → segundos
              duration: (item.Data?.Duration || 0) / 10_000_000,
            });
          }
        }
      } catch { /* chunk no parseable, ignorar */ }
    });
    // Drenar la stream para que no bloquee; ignoramos si cierra o no
    metadataStream.on('error', () => {});
    metadataStream.resume();
  }

  // Esperar solo a que el audio se escriba a disco
  await new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(outputPath);
    audioStream.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    audioStream.on('error', reject);
  });

  let fileSize = fs.statSync(outputPath).size;
  if (fileSize < 1000) {
    // Retry hasta 2 veces — Edge TTS a veces cierra la stream antes de enviar datos
    for (let attempt = 1; attempt <= 2 && fileSize < 1000; attempt++) {
      logger.warn(`Edge TTS: empty audio (${fileSize}B) — retry ${attempt}/2`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
      const tts2 = new MsEdgeTTS();
      await tts2.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream: as2 } = await tts2.toStream(ssmlContent);
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(outputPath);
        as2.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        as2.on('error', reject);
      });
      fileSize = fs.statSync(outputPath).size;
    }
    if (fileSize < 1000) {
      throw new Error(`Edge TTS returned empty audio (${fileSize} bytes)`);
    }
  }

  const wordCount = text.split(/\s+/).length;
  const estimatedDuration = parseFloat(((wordCount / 140) * 60).toFixed(2));

  if (wordBoundaries.length >= 4) {
    logger.info(`Edge TTS: ${wordBoundaries.length} word boundaries capturados (sync EXACTO en render)`);
  } else {
    logger.info(`Edge TTS: sin word boundaries (${wordBoundaries.length}) — sync proporcional en render`);
  }

  logger.info(`Edge TTS: saved ${(fileSize / 1024).toFixed(0)} KB, ~${estimatedDuration}s`);
  logger.info(`Edge TTS timing | total=${formatDurationMs(perf.snapshot().totalMs)}`);

  return { audioPath: outputPath, estimatedDuration, wordCount, wordBoundaries };
}

function getSpanishVoices() {
  return Object.entries(SPANISH_VOICES).map(([name, info]) => ({ name, ...info, free: true }));
}

// ── Test directo ─────────────────────────────────────────────────────────────
if (require.main === module) {
  const testScript = {
    hook: 'El 97% de las personas hace esto cuando miente.',
    claim: 'Un estudio de Harvard reveló 3 señales físicas que el cerebro emite de forma involuntaria.',
    explanation: 'La primera: tus ojos se mueven hacia arriba y a la derecha. Tu cerebro construye una imagen que no existe. La segunda: tocas tu cara, especialmente la nariz. El estrés dilata los capilares y crea picor. La tercera: tus expresiones aparecen un segundo tarde porque son forzadas.',
    cta: '¿Conocías estas señales? Comenta si has pillado a alguien con este truco.',
  };

  synthesizeVoice(testScript, './output/test_tts.mp3')
    .then((r) => console.log('✅ Audio generado:', JSON.stringify(r, null, 2)))
    .catch((e) => console.error('❌ Error:', e.message));
}

module.exports = { synthesizeVoice, getSpanishVoices, SPANISH_VOICES, getSegmentDuration, detectSpeechSegments, prepareNarrationForTTS };
