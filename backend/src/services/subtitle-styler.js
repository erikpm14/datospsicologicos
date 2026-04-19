/**
 * subtitle-styler.js  — Subtítulos V2
 *
 * Mejoras sobre el sistema de bloques planos:
 *   • Agrupación de 2-3 palabras (más legible en móvil)
 *   • Power words destacadas en color de acento del tema
 *   • Secciones con colores distintos:
 *       hook       → amarillo  (#FFE500) — impacto, detener scroll
 *       claim      → blanco    (#FFFFFF) — dato, tensión
 *       revelation → dorado    (#FFD700) — descubrimiento
 *       cta        → cian      (#00E5FF) — cierre emocional
 *   • isImpact: bloques con power words reciben tamaño +8px y borde más grueso
 *   • Fade ultra-rápido (snap visual, efecto viral)
 *
 * Las funciones buildStyledSubtitleBlocks + buildStyledDrawtextFilters
 * reemplazan a buildSubtitleBlocks + buildDrawtextFilters en video-renderer.js.
 */

const logger = require('../utils/logger');

// Power words de alto impacto visual — subconjunto más corto para marcado semántico
const IMPACT_WORDS = [
  'cerebro', 'neurona', 'dopamina', 'cortisol', 'inconsciente', 'automáticamente',
  'involuntariamente', 'estudio', 'demostró', 'comprobado', 'prefrontal', 'amígdala',
  'efecto', 'sesgo', 'síndrome', 'paradoja', 'disonancia', 'manipulando', 'secreto',
  'oculto', 'nunca', 'jamás', 'siempre', 'saboteado', 'falla', 'fallando',
  'sin saberlo', 'sin darte', 'sin que',
  // Números de alto impacto
  '73%', '90%', '80%', '97%',
];

// Color por sección
const SECTION_COLORS = {
  hook:        'yellow',     // #FFE500 — alto impacto, para con scroll
  claim:       'white',      // blanco — dato concreto
  revelation:  '#FFD700',    // dorado — descubrimiento
  cta:         '#00E5FF',    // cian — cierre emocional, suscriptores
};

// Tamaño de fuente por sección
const SECTION_FONT_SIZES = {
  hook:       112,
  claim:       90,
  revelation:  94,
  cta:         85,
};

// Opacidad de caja por sección
const SECTION_BOX_OPACITY = {
  hook:       '0.70',
  claim:      '0.50',
  revelation: '0.55',
  cta:        '0.45',
};

const WORDS_PER_BLOCK = parseInt(process.env.SUBTITLE_WORDS_PER_BLOCK || '3');

// Extensión positiva del final de cada bloque: el texto permanece en pantalla
// N segundos más después de que el habla termina. Esto garantiza que el texto
// NUNCA desaparezca antes de que la frase haya sido pronunciada completamente.
// Si queda por detrás del audio → subir este valor. Si adelanta → bajarlo.
const BLOCK_END_EXTENSION = parseFloat(process.env.SUBTITLE_END_EXTENSION || '0.08');

/**
 * Detecta si un bloque de texto contiene una power word de impacto.
 */
function hasImpactWord(text) {
  const lower = text.toLowerCase();
  return IMPACT_WORDS.some(w => lower.includes(w));
}

/**
 * Detecta si un bloque contiene un número con % o cifra standalone de alto impacto.
 */
function hasImpactNumber(text) {
  return /\b\d{2,}[%\s]/.test(text) || /\b[789]\d%/.test(text);
}

// ─────────────────────────────────────────────
//  GENERACIÓN DE BLOQUES ESTILIZADOS
// ─────────────────────────────────────────────

/**
 * Genera bloques de subtítulo con metadatos de estilo V2.
 *
 * Prioridad de timing:
 *   1. wordBoundaries exactos de Edge TTS (sync perfecto, palabra a palabra)
 *   2. sectionDurations de Kokoro segmentado con segmentos de silencedetect
 *      → los bloques se alinean a los segmentos de habla reales, no por palabras
 *   3. Proporcional por palabras usando realDuration (fallback legacy)
 *
 * En todos los modos el END de cada bloque se extiende +BLOCK_END_EXTENSION (default
 * +80 ms) para que el texto nunca desaparezca antes de que la frase termine.
 *
 * @param {Object} script
 * @param {number} realDuration       - duración total del audio (ffprobe)
 * @param {Array}  wordBoundaries     - [{word, start, duration}] de Edge TTS
 * @param {Object} sectionDurations   - {hook:{start,duration}, claim:…} de Kokoro segmentado
 */
function buildStyledSubtitleBlocks(script, realDuration, wordBoundaries = [], sectionDurations = null) {
  const rawBlocks = _buildRawBlocks(script, realDuration, wordBoundaries, sectionDurations);

  // Anotar cada bloque con metadatos de estilo
  return rawBlocks.map(block => {
    const color    = SECTION_COLORS[block.section]     || 'white';
    const fontSize = SECTION_FONT_SIZES[block.section] || 90;
    const isImpact = hasImpactWord(block.text) || hasImpactNumber(block.text);

    return {
      ...block,
      color,
      fontSize: isImpact ? fontSize + 8 : fontSize,
      isImpact,
      boxOpacity: isImpact
        ? (parseFloat(SECTION_BOX_OPACITY[block.section] || '0.50') + 0.10).toFixed(2)
        : SECTION_BOX_OPACITY[block.section] || '0.50',
    };
  });
}

/**
 * Construye los bloques crudos con timing (sin estilo).
 *
 * MODO 1 — EXACT (Edge TTS word boundaries):
 *   Timing palabra a palabra desde los metadatos de Edge TTS.
 *
 * MODO 2 — SEGMENTED (Kokoro sectionDurations con segmentos de silencedetect):
 *   Cada sección tiene duración real (ffprobe) + segmentos de habla (silencedetect).
 *   Los bloques se distribuyen sobre los segmentos de habla reales — no por palabras.
 *   Si no hay segmentos, cae a distribución uniforme sobre la sección.
 *
 * MODO 3 — PROPORTIONAL (fallback legacy):
 *   Distribuye el total de realDuration proporcionalmente por palabras.
 *   Menos preciso — solo activo si no hay wordBoundaries ni sectionDurations.
 *
 * En todos los modos el final de cada bloque se extiende +BLOCK_END_EXTENSION
 * para que el texto nunca desaparezca antes de que termine la frase hablada.
 */
function _buildRawBlocks(script, realDuration, wordBoundaries, sectionDurations) {
  // ── MODO 1: word boundaries exactos (Edge TTS) ───────────────────────────────
  if (wordBoundaries && wordBoundaries.length >= 4) {
    logger.info(`SubtitleStyler: EXACT mode | ${wordBoundaries.length} word boundaries | endExt=+${BLOCK_END_EXTENSION}s`);
    const totalWords = wordBoundaries.length;
    const sections   = _getSectionWordRanges(script, totalWords);
    const blocks     = [];
    let idx = 0;

    for (let i = 0; i < wordBoundaries.length; i += WORDS_PER_BLOCK) {
      const slice   = wordBoundaries.slice(i, i + WORDS_PER_BLOCK);
      const first   = slice[0];
      const last    = slice[slice.length - 1];
      const section = _sectionForIndex(i, sections);
      const rawEnd  = last.start + last.duration;

      blocks.push({
        text:    slice.map(b => b.word).join(' '),
        start:   parseFloat(first.start.toFixed(3)),
        end:     parseFloat((rawEnd + BLOCK_END_EXTENSION).toFixed(3)),
        section,
        isHook:  section === 'hook' && i === 0,
        idx,
      });
      idx++;
    }
    return blocks;
  }

  // ── MODO 2: sectionDurations de Kokoro (ffprobe + silencedetect) ─────────────
  if (sectionDurations && Object.keys(sectionDurations).length >= 2) {
    const hasSegments = Object.values(sectionDurations).some(t => t.segments && t.segments.length > 0);
    logger.info(
      `SubtitleStyler: SEGMENTED mode | sections=${Object.keys(sectionDurations).join(',')} | ` +
      `speechSegs=${hasSegments ? 'yes' : 'no (uniform fallback)'} | endExt=+${BLOCK_END_EXTENSION}s`,
    );

    // Mapear 'explanation' → 'revelation' para color/estilo
    const SECTION_MAP = { hook: 'hook', claim: 'claim', explanation: 'revelation', cta: 'cta' };
    const blocks = [];
    let idx = 0;

    for (const [rawKey, timing] of Object.entries(sectionDurations)) {
      const section      = SECTION_MAP[rawKey] || rawKey;
      const text         = (rawKey === 'revelation' ? script.explanation : script[rawKey] || '').trim();
      if (!text) continue;

      const sWords       = text.split(/\s+/);
      const numBlocks    = Math.ceil(sWords.length / WORDS_PER_BLOCK);
      const sectionStart = timing.start;
      const sectionDur   = timing.duration;
      const segments     = timing.segments; // [{start, end}] relativos a la sección

      for (let i = 0; i < numBlocks; i++) {
        const chunk = sWords.slice(i * WORDS_PER_BLOCK, (i + 1) * WORDS_PER_BLOCK).join(' ');
        let rawStart, rawEnd;

        if (segments && segments.length > 0) {
          // Distribuir bloques sobre segmentos de habla reales (silencedetect)
          const t = _blockTimingFromSegments(i, numBlocks, segments, sectionStart);
          rawStart = t.start;
          rawEnd   = t.end;
        } else {
          // Fallback: distribución uniforme dentro de la sección
          const blockDur = sectionDur / numBlocks;
          rawStart = sectionStart + i * blockDur;
          rawEnd   = sectionStart + (i + 1) * blockDur;
        }

        blocks.push({
          text:   chunk,
          start:  parseFloat(rawStart.toFixed(3)),
          end:    parseFloat((rawEnd + BLOCK_END_EXTENSION).toFixed(3)),
          section,
          isHook: section === 'hook' && i === 0,
          idx,
        });
        idx++;
      }
    }

    // Ordenar por start (sectionDurations podría no estar en orden)
    blocks.sort((a, b) => a.start - b.start);
    blocks.forEach((b, i) => { b.idx = i; });
    return blocks;
  }

  // ── MODO 3: proporcional por wordcount (fallback) ────────────────────────────
  logger.info(`SubtitleStyler: PROPORTIONAL mode (fallback) | realDuration=${realDuration.toFixed(2)}s | endExt=+${BLOCK_END_EXTENSION}s`);
  const PAUSES       = { hook: 0.55, claim: 0.30, revelation: 0.30, cta: 0.0 };
  const SECTION_KEYS = ['hook', 'claim', 'revelation', 'cta'];

  const sectionData = SECTION_KEYS.map(key => {
    const text = (key === 'revelation' ? script.explanation : script[key] || '').trim();
    return { key, text, pause: PAUSES[key] };
  }).filter(s => s.text);

  const totalWords = sectionData.reduce((s, sec) => s + sec.text.split(/\s+/).length, 0);
  const speechDur  = realDuration * 0.88;

  const blocks = [];
  let cur = 0;
  let idx = 0;

  for (const s of sectionData) {
    const sWords     = s.text.split(/\s+/);
    const sectionDur = speechDur * (sWords.length / totalWords);
    const numBlocks  = Math.ceil(sWords.length / WORDS_PER_BLOCK);
    const blockDur   = sectionDur / numBlocks;

    for (let i = 0; i < numBlocks; i++) {
      const chunk = sWords.slice(i * WORDS_PER_BLOCK, (i + 1) * WORDS_PER_BLOCK).join(' ');
      blocks.push({
        text:    chunk,
        start:   parseFloat((cur + i * blockDur).toFixed(3)),
        end:     parseFloat((cur + (i + 1) * blockDur + BLOCK_END_EXTENSION).toFixed(3)),
        section: s.key,
        isHook:  s.key === 'hook' && i === 0,
        idx,
      });
      idx++;
    }
    cur += sectionDur + s.pause;
  }

  return blocks;
}

/**
 * Calcula el timing global de un bloque distribuyéndolo sobre los segmentos
 * de habla detectados por silencedetect.
 *
 * Los bloques se asignan a segmentos proporcional al índice:
 *   segIdx = floor(blockIdx * numSegments / numBlocks)
 * Dentro de cada segmento los bloques asignados se distribuyen uniformemente.
 *
 * @param {number} blockIdx     - índice del bloque dentro de la sección (0-based)
 * @param {number} numBlocks    - total de bloques de la sección
 * @param {Array}  segments     - [{start, end}] relativos a la sección (de silencedetect)
 * @param {number} sectionStart - tiempo de inicio de la sección en el timeline global
 * @returns {{ start: number, end: number }}  tiempos GLOBALES sin extensión
 */
function _blockTimingFromSegments(blockIdx, numBlocks, segments, sectionStart) {
  const m = segments.length;

  // Asignar cada bloque a un segmento
  const segIdx = Math.min(Math.floor(blockIdx * m / numBlocks), m - 1);
  const seg    = segments[segIdx];

  // Contar cuántos bloques caen en este segmento
  const blocksInSeg = [];
  for (let j = 0; j < numBlocks; j++) {
    if (Math.min(Math.floor(j * m / numBlocks), m - 1) === segIdx) {
      blocksInSeg.push(j);
    }
  }

  const posInSeg  = blocksInSeg.indexOf(blockIdx);
  const numInSeg  = blocksInSeg.length;
  const segDur    = seg.end - seg.start;
  const blockDur  = segDur / numInSeg;

  return {
    start: sectionStart + seg.start + posInSeg * blockDur,
    end:   sectionStart + seg.start + (posInSeg + 1) * blockDur,
  };
}

/**
 * Calcula los rangos de words (por índice) que corresponden a cada sección.
 * Devuelve [{ section, from, to }] para mapeo index → section.
 */
function _getSectionWordRanges(script, totalWords) {
  const sections = [
    { key: 'hook',       text: script.hook        || '' },
    { key: 'claim',      text: script.claim       || '' },
    { key: 'revelation', text: script.explanation || '' },
    { key: 'cta',        text: script.cta         || '' },
  ].filter(s => s.text.trim());

  const wordCounts = sections.map(s => s.text.trim().split(/\s+/).length);
  const ranges = [];
  let from = 0;

  for (let i = 0; i < sections.length; i++) {
    ranges.push({ section: sections[i].key, from, to: from + wordCounts[i] });
    from += wordCounts[i];
  }
  return ranges;
}

function _sectionForIndex(wordIdx, ranges) {
  for (const r of ranges) {
    if (wordIdx >= r.from && wordIdx < r.to) return r.section;
  }
  return 'claim';
}

// ─────────────────────────────────────────────
//  GENERACIÓN DE FILTROS DRAWTEXT (V2)
// ─────────────────────────────────────────────

/**
 * Escapa texto para FFmpeg drawtext.
 */
function escapeDrawtext(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\u2019')     // curly apostrophe — no requiere escape
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/ /g, '\\ ');
}

/**
 * Encuentra la fuente del sistema con prioridad: Impact > Arial Bold > Arial > fallback.
 */
function findSystemFont() {
  const candidates = [
    'C:/Windows/Fonts/impact.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
  ];
  for (const f of candidates) {
    const fs2 = require('fs');
    if (fs2.existsSync(f)) return f;
  }
  return null;
}

/**
 * Construye los filtros drawtext para los bloques estilizados.
 *
 * @param {Array}  blocks    - Salida de buildStyledSubtitleBlocks
 * @param {string} yPos      - Expresión Y para posicionamiento (default: h*0.43)
 * @param {Object} theme     - Tema visual (para color de acento)
 * @returns {string}         - filtergraph de drawtext para FFmpeg
 */
function buildStyledDrawtextFilters(blocks, yPos = 'h*0.43', theme = null) {
  const fontFile = findSystemFont();
  const FADE = 0.07; // snap rápido (0.07s) — más viral que 0.10s

  const fontPath = fontFile
    ? fontFile.replace(/\\/g, '/').replace(/^([A-Z]):/, '$1\\:')
    : null;

  // Color de acento del tema (para bloques de revelación si el tema lo tiene)
  const themeAccent = theme?.accent || '#FFD700';

  return blocks.map((block) => {
    const t        = `between(t,${block.start},${block.end})`;
    const fontSize = block.fontSize || 90;

    // Color: el tema puede sobreescribir la revelación con su color de acento
    let color = block.color || 'white';
    if (block.section === 'revelation' && theme?.highlightColor) {
      color = theme.highlightColor;
    }

    // Encode color para drawtext (hex → 0xRRGGBBAA o nombre)
    const colorStr = color.startsWith('#')
      ? color.replace('#', '0x') + 'FF'
      : color;

    const fontPart = fontPath
      ? `fontfile='${fontPath}':fontsize=${fontSize}`
      : `fontsize=${fontSize}`;

    // Alpha: aparece de golpe, desaparece rápido (snap viral)
    const alphaExpr =
      `if(lt(t-${block.start},${FADE}),(t-${block.start})/${FADE},` +
      `if(gt(t,${block.end}-${FADE}),(${block.end}-t)/${FADE},1))`;

    // Borde más grueso si es impacto o hook
    const borderW   = block.isImpact || block.isHook ? 11 : 7;
    const boxPad    = block.isImpact || block.isHook ? 24 : 16;
    const boxOpac   = block.boxOpacity || '0.50';

    return (
      `drawtext=${fontPart}:` +
      `text=${escapeDrawtext(block.text)}:` +
      `fontcolor=${colorStr}:` +
      `alpha='${alphaExpr}':` +
      `shadowcolor=black@1.0:shadowx=4:shadowy=4:` +
      `bordercolor=black:borderw=${borderW}:` +
      `x=(w-text_w)/2:y=${yPos}:` +
      `box=1:boxcolor=black@${boxOpac}:boxborderw=${boxPad}:` +
      `enable='${t}'`
    );
  }).join(',');
}

// ─────────────────────────────────────────────
//  GENERADOR SRT
// ─────────────────────────────────────────────

/**
 * Convierte segundos al formato de tiempo SRT: HH:MM:SS,mmm
 */
function formatSRTTime(seconds) {
  const h   = Math.floor(seconds / 3600);
  const m   = Math.floor((seconds % 3600) / 60);
  const s   = Math.floor(seconds % 60);
  const ms  = Math.round((seconds % 1) * 1000);
  return (
    String(h).padStart(2, '0') + ':' +
    String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + ',' +
    String(ms).padStart(3, '0')
  );
}

/**
 * Genera el contenido de un archivo SRT a partir de los bloques de subtítulo.
 * Compatible con reproductores de vídeo, YouTube, DaVinci, Premiere, etc.
 */
function buildSRTContent(blocks) {
  return blocks.map((block, i) => (
    `${i + 1}\n` +
    `${formatSRTTime(block.start)} --> ${formatSRTTime(block.end)}\n` +
    `${block.text}\n`
  )).join('\n') + '\n';
}

module.exports = {
  buildStyledSubtitleBlocks,
  buildStyledDrawtextFilters,
  buildSRTContent,
  hasImpactWord,
  SECTION_COLORS,
  SECTION_FONT_SIZES,
};
