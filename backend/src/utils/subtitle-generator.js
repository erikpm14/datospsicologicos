/**
 * subtitle-generator.js
 * Genera subtítulos word-by-word con timing preciso a partir del guión + audio.
 * Keywords destacadas se marcan para render en amarillo/bold.
 */

const logger = require('./logger');

// Palabras clave que siempre se destacan visualmente
const HIGHLIGHT_KEYWORDS = new Set([
  'nunca', 'jamás', 'siempre', 'todos', 'nadie', 'secreto', 'verdad', 'mentira',
  'peligro', 'alerta', 'cuidado', 'increíble', 'impresionante', 'importante',
  'manipulando', 'engañando', 'mintiendo', 'tóxico', 'inmediatamente', 'ahora',
  '97%', '80%', '3', '4', 'dos', 'tres', 'cuatro', 'cinco',
]);

/**
 * Distribuye las palabras del guión en bloques con timing estimado.
 * En producción, esto se refina con forced alignment del audio real (e.g. gentle, Whisper).
 *
 * @param {Object} script - Guión con secciones y duraciones
 * @param {number} totalDuration - Duración total del audio en segundos
 * @returns {Array} Array de { word, start, end, highlight }
 */
function generateSubtitles(script, totalDuration) {
  const beats = Array.isArray(script?.beats) ? script.beats : null;
  if (beats && beats.length > 0) {
    const subtitles = [];
    const beatTexts = beats
      .map((b) => ({
        text: String(b?.text || '').trim(),
        emphasisWords: Array.isArray(b?.emphasisWords) ? b.emphasisWords : [],
        durationHint: Number(b?.durationHint || 0),
      }))
      .filter((b) => b.text.length > 0);

    const totalHint = beatTexts.reduce((sum, b) => sum + (Number.isFinite(b.durationHint) ? b.durationHint : 0), 0);
    const normalizedTotal = totalHint > 0 ? totalHint : beatTexts.length;

    let currentTime = 0;
    for (const beat of beatTexts) {
      const sectionDuration = totalDuration * ((beat.durationHint > 0 ? beat.durationHint : 1) / normalizedTotal);
      const words = beat.text.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      const baseWordDuration = sectionDuration / words.length;

      const emphasisSet = new Set((beat.emphasisWords || []).map((w) => String(w || '').toLowerCase()));

      for (const word of words) {
        const cleanWord = word.toLowerCase().replace(/[Â¿?Â¡!.,;:]/g, '');
        const isPunctuation = /[.!?]$/.test(word);
        const wordDuration = isPunctuation ? baseWordDuration * 1.4 : baseWordDuration;

        subtitles.push({
          word: word,
          start: parseFloat(currentTime.toFixed(3)),
          end: parseFloat((currentTime + wordDuration).toFixed(3)),
          highlight: emphasisSet.has(cleanWord) || HIGHLIGHT_KEYWORDS.has(cleanWord) || /^\d+%?$/.test(cleanWord),
        });

        currentTime += wordDuration;
      }
    }

    logger.debug(`Generated ${subtitles.length} subtitle entries for ${totalDuration}s audio`);
    return subtitles;
  }

  const fullScript = typeof script?.fullScript === 'string' ? script.fullScript.trim() : '';
  const sections = fullScript.length >= 20
    ? [{ text: fullScript, durationRatio: 1.0 }]
    : [
      { text: script.hook, durationRatio: 0.05 },
      { text: script.claim, durationRatio: 0.20 },
      { text: script.explanation, durationRatio: 0.42 },
      { text: script.cta, durationRatio: 0.33 },
    ];

  const subtitles = [];
  let currentTime = 0;

  for (const section of sections) {
    const sectionDuration = totalDuration * section.durationRatio;
    const words = section.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Tiempo por palabra (con pausa dramática tras signos de puntuación)
    const baseWordDuration = sectionDuration / words.length;

    for (const word of words) {
      const cleanWord = word.toLowerCase().replace(/[¿?¡!.,;:]/g, '');
      const isPunctuation = /[.!?]$/.test(word);

      // Pausa extra en signos fuertes (crea efecto dramático)
      const wordDuration = isPunctuation
        ? baseWordDuration * 1.4
        : baseWordDuration;

      subtitles.push({
        word: word,
        start: parseFloat(currentTime.toFixed(3)),
        end: parseFloat((currentTime + wordDuration).toFixed(3)),
        highlight: HIGHLIGHT_KEYWORDS.has(cleanWord) || /^\d+%?$/.test(cleanWord),
      });

      currentTime += wordDuration;
    }
  }

  logger.debug(`Generated ${subtitles.length} subtitle entries for ${totalDuration}s audio`);
  return subtitles;
}

/**
 * Agrupa palabras en bloques de display (máx 3 palabras por frame).
 * Evita que la pantalla se llene de texto.
 */
function groupIntoBlocks(subtitles, wordsPerBlock = 3) {
  const blocks = [];
  for (let i = 0; i < subtitles.length; i += wordsPerBlock) {
    const slice = subtitles.slice(i, i + wordsPerBlock);
    blocks.push({
      text: slice.map((s) => s.word).join(' '),
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      highlights: slice.filter((s) => s.highlight).map((s) => s.word),
    });
  }
  return blocks;
}

/**
 * Genera archivo SRT estándar a partir de los bloques.
 */
function toSRT(blocks) {
  return blocks
    .map((block, idx) => {
      const start = formatTimecode(block.start);
      const end = formatTimecode(block.end);
      return `${idx + 1}\n${start} --> ${end}\n${block.text}\n`;
    })
    .join('\n');
}

function formatTimecode(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n, size = 2) {
  return String(n).padStart(size, '0');
}

/**
 * Genera filtro drawtext de FFmpeg para subtítulos animados.
 * Cada bloque aparece en el tiempo exacto con highlight en keywords.
 */
function generateFFmpegDrawtext(blocks, videoWidth = 1080) {
  const filters = [];
  const fontPath = process.env.ASSETS_DIR
    ? `${process.env.ASSETS_DIR}/fonts/Montserrat-Bold.ttf`
    : './assets/fonts/Montserrat-Bold.ttf';

  for (const block of blocks) {
    // Texto normal (blanco con borde negro)
    filters.push(
      `drawtext=fontfile='${fontPath}':` +
      `text='${escapeFFmpeg(block.text)}':` +
      `fontcolor=white:fontsize=72:` +
      `bordercolor=black:borderw=4:` +
      `x=(w-text_w)/2:y=h*0.72:` +
      `box=1:boxcolor=black@0.45:boxborderw=12:` +
      `enable='between(t,${block.start},${block.end})'`
    );

    // Highlight en keywords (texto amarillo encima)
    for (const hw of block.highlights) {
      filters.push(
        `drawtext=fontfile='${fontPath}':` +
        `text='${escapeFFmpeg(hw)}':` +
        `fontcolor=#FFD700:fontsize=72:` +
        `bordercolor=black:borderw=4:` +
        `x=(w-text_w)/2:y=h*0.72:` +
        `enable='between(t,${block.start},${block.end})'`
      );
    }
  }

  return filters.join(',');
}

function escapeFFmpeg(text) {
  return text.replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

module.exports = {
  generateSubtitles,
  groupIntoBlocks,
  toSRT,
  generateFFmpegDrawtext,
};
