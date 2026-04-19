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
  const { hook, claim, explanation, cta } = script;
  // Pausa larga post-hook (doble puntos suspensivos = pausa más perceptible en TTS)
  return `${hook}... ... ${claim}. ${explanation} ${cta}`;
}

/**
 * Construye texto limpio para Kokoro (sin marcadores de pausa SSML).
 * Kokoro interpreta la puntuación natural — punto y coma = pausa corta, punto = pausa media.
 */
function buildKokoroText(script) {
  const { hook, claim, explanation, cta } = script;
  // Kokoro infiere pausas desde la puntuación natural — sin markers ... ...
  return [hook, claim, explanation, cta].filter(Boolean).join(' ');
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
  const { hook, claim, explanation, cta } = script;
  const isQuestion = hook.trim().endsWith('?');

  // Edge TTS acepta SSML anidado: nuestro <prosody> va dentro del suyo
  const hookSSML = isQuestion
    ? `<prosody pitch="+10%" rate="-8%">${hook}</prosody>`
    : hook;

  // Eliminar emojis del CTA (Edge TTS los lee o los ignora de forma rara)
  const ctaClean = cta.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();

  // Nota: <break> tags rompen Edge TTS (devuelve 0 bytes). Pausas via puntuación natural.
  return `${hookSSML}... ${claim}. ${explanation}. ${ctaClean}`;
}

/**
 * Mapea los word boundaries de TTS a tiempos de inicio/fin por sección.
 * Usa conteo de palabras para asignar cada boundary a su sección.
 */
function mapSectionTimings({ hook, claim, explanation, cta }, wordBoundaries) {
  const sections = [
    { key: 'hook',        text: hook        },
    { key: 'claim',       text: claim       },
    { key: 'explanation', text: explanation },
    { key: 'cta',         text: cta         },
  ].filter(s => s.text && s.text.trim());

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
function proportionalSectionTimings({ hook, claim, explanation, cta }, realDuration) {
  const sections = [
    { key: 'hook',        text: hook,        pauseSecs: 0.5 }, // pausa después de "..."
    { key: 'claim',       text: claim,       pauseSecs: 0.3 },
    { key: 'explanation', text: explanation, pauseSecs: 0.3 },
    { key: 'cta',         text: cta,         pauseSecs: 0.0 },
  ].filter(s => s.text && s.text.trim());

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
async function synthesizeWithKokoroSegmented(script, outputDir) {
  // Pausas entre secciones — equivalentes a las del SSML de Edge TTS
  const PAUSES = { hook: 0.65, claim: 0.40, explanation: 0.40, cta: 0.0 };

  const sectionOrder = ['hook', 'claim', 'explanation', 'cta'];
  const sections = sectionOrder
    .map(key => ({ key, text: (script[key] || '').trim(), pauseAfter: PAUSES[key] }))
    .filter(s => s.text.length >= 3);

  if (sections.length === 0) throw new Error('Kokoro segmented: script sin secciones válidas');

  // Sintetizar cada sección SECUENCIALMENTE — evita cargar el modelo ONNX
  // 4 veces en paralelo (~1.2 GB RAM simultáneos → bad allocation en sistemas con <4 GB libres)
  const segmentResults = [];
  for (const s of sections) {
    const segPath = path.join(outputDir, `seg_${s.key}.wav`);
    const result  = await synthesizeRawTextWithKokoro(s.text, segPath);
    const realDur = await getSegmentDuration(result.wavPath);
    const dur     = realDur > 0 ? realDur : result.duration;
    const segments = await detectSpeechSegments(result.wavPath, dur);
    logger.info(
      `Kokoro segment [${s.key}]: ${dur.toFixed(3)}s | ${segments.length} speech seg(s) | "${s.text.slice(0, 40)}..."`
    );
    segmentResults.push({ ...s, wavPath: result.wavPath, duration: dur, segments });
  }

  // Concatenar con pausas
  const combinedWav = path.join(outputDir, 'voice.wav');
  const concatSegments = segmentResults.map(s => ({ path: s.wavPath, pauseAfter: s.pauseAfter }));
  await concatenateSegmentsWithPauses(concatSegments, combinedWav);

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
    segmentResults.map(s => `${s.key}=${s.duration.toFixed(2)}s`).join(' ')
  );

  // Limpiar archivos de segmento (ya concatenados)
  for (const s of segmentResults) {
    try { fs.unlinkSync(s.wavPath); } catch {}
  }

  return {
    audioPath:         combinedWav,
    estimatedDuration: totalDuration,
    wordBoundaries:    [],
    sectionDurations,
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
  // Validar que el script tenga contenido
  const requiredFields = ['hook', 'claim', 'explanation', 'cta'];
  const missing = requiredFields.filter(f => !script[f] || String(script[f]).trim().length < 3);
  if (missing.length > 0) {
    throw new Error(`TTS: campos de script vacíos o inválidos: ${missing.join(', ')}`);
  }

  const text = buildText(script);
  if (!text || text.trim().length < 10) {
    throw new Error('TTS: texto combinado demasiado corto para sintetizar');
  }

  const wordCount = text.split(/\s+/).length;

  // ── Intento 1: Kokoro (segmentado — duración real por sección) ───────────
  if (KOKORO_ENABLED) {
    try {
      const result = await synthesizeWithKokoro(script, outputPath);
      return { ...result, wordCount, provider: 'kokoro' };
    } catch (kokoroErr) {
      logger.warn(`Kokoro TTS failed: ${kokoroErr.message.slice(0, 300)} — falling back to Edge TTS`);
    }
  }

  // ── Intento 2: Edge TTS (word boundaries → sync exacto) ──────────────────
  try {
    const result = await synthesizeWithEdgeTTS(script, text, outputPath);
    // Edge TTS tiene word boundaries → sectionDurations no es necesario
    return { ...result, wordCount, provider: 'edge', sectionDurations: null };
  } catch (edgeErr) {
    throw new Error(`TTS: ambos proveedores fallaron. Edge error: ${edgeErr.message}`);
  }
}

async function synthesizeWithEdgeTTS(script, text, outputPath) {
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

module.exports = { synthesizeVoice, getSpanishVoices, SPANISH_VOICES, getSegmentDuration, detectSpeechSegments };
