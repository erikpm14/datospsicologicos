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
const { getScriptSections } = require('../utils/script-segments');

/**
 * Palabras clave para jerarquía visual V3
 * Categorías: científicas, emocionales, verbos fuertes, conceptos clave
 */
const IMPACT_WORDS = {
  // Científico/cognitivo (máxima autoridad)
  scientific: [
    'cerebro', 'neurona', 'dopamina', 'cortisol', 'inconsciente', 'automáticamente',
    'involuntariamente', 'estudio', 'demostró', 'comprobado', 'prefrontal', 'amígdala',
    'efecto', 'sesgo', 'síndrome', 'paradoja', 'disonancia',
  ],
  // Emocional/interpersonal (dolor, validación, conexión)
  emotional: [
    'duele', 'duelen', 'dolor', 'sufres', 'sufre', 'sufrimiento',
    'validación', 'validado', 'importas', 'importa',
    'rechazo', 'abandono', 'solos', 'solo', 'miedo', 'ansiedad',
    'conexión', 'desconexión', 'ruptura', 'pérdida',
  ],
  // Verbos de acción/manipulación (agencia + oscuridad)
  action: [
    'manipulando', 'manipular', 'manipula', 'manipulan',
    'saboteado', 'sabotea', 'sabotean', 'saboteador',
    'falla', 'fallando', 'fallan', 'fracasa', 'fracasan',
    'atrapado', 'atrapada', 'atrapados', 'atrapadas',
    'te controla', 'controla', 'controlan', 'control',
  ],
  // Secreto/revelación (tensión narrativa)
  revelation: [
    'secreto', 'oculto', 'oculta', 'escondido', 'escondida',
    'nadie', 'nadie te dice', 'nunca', 'jamás', 'siempre',
    'verdad', 'realidad', 'lo que', 'la verdad',
  ],
  // Números de alto impacto
  numbers: ['73%', '90%', '80%', '97%', '100%', '0%'],
};

// Crear índice plano para búsquedas rápidas
const IMPACT_WORDS_FLAT = Object.values(IMPACT_WORDS).flat();

// Color por sección
const SECTION_COLORS = {
  hook:        '#F3F7FF',
  open_loop:   '#4F7BFF',
  micro_value: '#F3F7FF',
  escalation:  '#4F7BFF',
  reengage:    '#FF3B30',
  peak:        '#FF3B30',
  open_ending: '#4F7BFF',
  soft_cta:    '#4F7BFF',
  claim:       '#F3F7FF',
  revelation:  '#FF3B30',
  cta:         '#4F7BFF',
};

// Tamaño de fuente por sección
const SECTION_FONT_SIZES = {
  hook:       140,
  open_loop:  122,
  micro_value:120,
  escalation: 124,
  reengage:   128,
  peak:       126,
  open_ending:118,
  soft_cta:   115,
  claim:      120,
  revelation: 124,
  cta:        115,
};

// Opacidad de caja por sección
const SECTION_BOX_OPACITY = {
  hook:       '0.70',
  open_loop:  '0.58',
  micro_value:'0.50',
  escalation: '0.55',
  reengage:   '0.62',
  peak:       '0.58',
  open_ending:'0.48',
  soft_cta:   '0.45',
  claim:      '0.50',
  revelation: '0.55',
  cta:        '0.45',
};

// WORD TIMESTAMP MODE: Agrupación más pequeña para legibilidad en Shorts
// Target: 2-4 palabras por bloque, nunca frases completas
const WORDS_PER_BLOCK = parseInt(process.env.SUBTITLE_WORDS_PER_BLOCK || '3');
const MAX_WORDS_PER_BLOCK = parseInt(process.env.SUBTITLE_MAX_WORDS_PER_BLOCK || '3'); // REDUCIDO a 3
const MIN_WORDS_PER_BLOCK = parseInt(process.env.SUBTITLE_MIN_WORDS_PER_BLOCK || '2');

// Duración máxima de un bloque (segundos). Si excede, dividir.
const MAX_BLOCK_DURATION = parseFloat(process.env.SUBTITLE_MAX_BLOCK_DURATION || '1.2');

// Extensión positiva del final de cada bloque
const BLOCK_END_EXTENSION = parseFloat(process.env.SUBTITLE_END_EXTENSION || '0.10');

// Duración mínima visible por bloque (segundos). Bloques más cortos se extienden.
const MIN_BLOCK_DURATION = parseFloat(process.env.SUBTITLE_MIN_DURATION || '0.40');

// ─────────────────────────────────────────────
//  MODO CINEMATOGRÁFICO: Timing Emocional
// ─────────────────────────────────────────────

// Probabilidades de efectos emocionales (0-1)
const EMOTIONAL_TIMING = {
  emotionalDelay: 0.35,      // 35% de probabilidad de delay emocional
  anticipation: 0.20,         // 20% de probabilidad de anticipación
  emotionalSilence: 0.15,     // 15% de probabilidad de silencio
  emotionalDelayRange: [0.05, 0.15], // delay: 50-150ms
  anticipationRange: [-0.05, 0],     // anticipation: -50 a 0ms
  silenceRange: [0.2, 0.4],   // silencio: 200-400ms
};

// Secciones donde aplicar efectos emocionales con mayor agresividad
const EMOTIONAL_SECTIONS = ['reengage', 'peak', 'revelation', 'escalation'];
const SECTION_EMOTIONAL_INTENSITY = {
  reengage: 0.8,
  peak: 0.9,
  revelation: 0.7,
  escalation: 0.6,
  hook: 0.5,
  open_loop: 0.4,
  micro_value: 0.3,
  open_ending: 0.2,
  soft_cta: 0.3,
};

/**
 * Detecta si un bloque de texto contiene una power word de impacto.
 */
function hasImpactWord(text) {
  const lower = text.toLowerCase();
  return IMPACT_WORDS_FLAT.some(w => lower.includes(w));
}

/**
 * Detecta si un bloque contiene un número con % o cifra standalone de alto impacto.
 */
function hasImpactNumber(text) {
  return /\b\d{2,}[%\s]/.test(text) || /\b[789]\d%/.test(text);
}

/**
 * Encuentra la palabra MÁS impactante en un bloque.
 * Prioridad: emotional > action > revelation > scientific > numbers
 * Devuelve el índice del token más impactante, o -1 si no hay.
 */
function findMostImpactfulWordIndex(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return -1;

  // Prioridad de categorías
  const categories = ['emotional', 'action', 'revelation', 'scientific', 'numbers'];

  for (const category of categories) {
    const categoryWords = IMPACT_WORDS[category] || [];
    for (let i = 0; i < tokens.length; i++) {
      const clean = _cleanSubtitleToken(tokens[i]).toLowerCase();
      if (categoryWords.some(w => clean.includes(_cleanSubtitleToken(w).toLowerCase()))) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Detecta si una palabra es el primer elemento (alto impacto en hook).
 */
function isFirstWordOfHook(index, isHook) {
  return isHook && index === 0;
}

/**
 * Aplica timing cinematográfico emocional a un bloque.
 * Ajusta start/end para amplificar impacto emocional, no precisión.
 *
 * Estrategia:
 * - Palabras clave en secciones emocionales: delay emocional o anticipación
 * - Bloques breakpoint: máximo impacto temporal
 * - Silencios estratégicos: entre bloques en momentos clave
 * - Variación aleatoria: NO determinístico, introduce naturalidad
 */
function _applyEmotionalTiming(block, index, allBlocks) {
  const emotionalIntensity = SECTION_EMOTIONAL_INTENSITY[block.section] || 0.3;
  const isEmotionalSection = EMOTIONAL_SECTIONS.includes(block.section);
  const isKeyword = block.isImpact || block.isSingleWordBlock;

  let adjustedBlock = { ...block };
  let timingReason = [];

  // REGLA 1: Bloques breakpoint (máximo impacto)
  if (block.isSingleWordBlock && isEmotionalSection) {
    // Timing más restrictivo: más visible, menos duración
    const delayAmount = 0.08; // 80ms delay para máximo impacto
    adjustedBlock.start = block.start + delayAmount;
    adjustedBlock.start = Math.max(adjustedBlock.start, index > 0 ? allBlocks[index - 1].end : 0);
    timingReason.push('breakpoint_emotional');
  }
  // REGLA 2: Palabras clave en secciones emocionales
  else if (isKeyword && isEmotionalSection && Math.random() < emotionalIntensity) {
    // Aplicar efecto emocional
    const effectChoice = Math.random();

    if (effectChoice < EMOTIONAL_TIMING.emotionalDelay * emotionalIntensity) {
      // Delay emocional: palabra aparece después de la voz
      const delayAmount = Math.random() *
        (EMOTIONAL_TIMING.emotionalDelayRange[1] - EMOTIONAL_TIMING.emotionalDelayRange[0]) +
        EMOTIONAL_TIMING.emotionalDelayRange[0];
      adjustedBlock.start = block.start + delayAmount;
      adjustedBlock.start = Math.max(adjustedBlock.start, index > 0 ? allBlocks[index - 1].end : 0);
      timingReason.push(`delay_${(delayAmount * 1000).toFixed(0)}ms`);
    } else if (effectChoice < (EMOTIONAL_TIMING.emotionalDelay + EMOTIONAL_TIMING.anticipation) * emotionalIntensity) {
      // Anticipación: palabra aparece un poco antes
      const anticipationAmount = Math.random() *
        (EMOTIONAL_TIMING.anticipationRange[1] - EMOTIONAL_TIMING.anticipationRange[0]) +
        EMOTIONAL_TIMING.anticipationRange[0];
      adjustedBlock.start = Math.max(0, block.start + anticipationAmount);
      timingReason.push(`anticipate_${Math.abs((anticipationAmount * 1000).toFixed(0))}ms`);
    }
  }

  return {
    ...adjustedBlock,
    timingReason: timingReason.length > 0 ? timingReason.join(',') : null,
  };
}

/**
 * Aplica silencios emocionales entre bloques en secciones clave.
 * Máximo 1-2 silencios por video para no afectar fluidez.
 */
function _applyEmotionalSilences(blocks) {
  const result = [...blocks];
  const silencePositions = [];

  // Encontrar candidatos para silencios (secciones emocionales, palabras clave)
  for (let i = 0; i < result.length - 1; i++) {
    const block = result[i];
    const nextBlock = result[i + 1];

    // Solo en secciones emocionales
    if (!EMOTIONAL_SECTIONS.includes(block.section)) continue;

    // Probabilidad según intensidad
    const intensity = SECTION_EMOTIONAL_INTENSITY[block.section] || 0.3;
    if (Math.random() < EMOTIONAL_TIMING.emotionalSilence * intensity && silencePositions.length < 2) {
      // Crear silencio entre este bloque y el siguiente
      const silenceAmount = Math.random() *
        (EMOTIONAL_TIMING.silenceRange[1] - EMOTIONAL_TIMING.silenceRange[0]) +
        EMOTIONAL_TIMING.silenceRange[0];

      // Ajustar el next block para que empiece después del silencio
      result[i + 1] = {
        ...nextBlock,
        start: nextBlock.start + silenceAmount,
        end: nextBlock.end + silenceAmount,
        silenceCreated: (silenceAmount * 1000).toFixed(0),
      };

      silencePositions.push(i);
    }
  }

  return result;
}

/**
 * Limita bloques breakpoint a máximo 1-2 por video.
 * Prioriza peak > reengage > otros.
 */
function _limitBreakpoints(blocks) {
  const breakpointsBySection = {
    peak: [],
    reengage: [],
    other: [],
  };

  // Clasificar bloques breakpoint
  blocks.forEach((block, idx) => {
    if (!block.isSingleWordBlock) return;

    if (block.section === 'peak') {
      breakpointsBySection.peak.push(idx);
    } else if (block.section === 'reengage') {
      breakpointsBySection.reengage.push(idx);
    } else {
      breakpointsBySection.other.push(idx);
    }
  });

  // Mantener máximo 1-2 breakpoints totales
  const maxBreakpoints = 2;
  const selectedIndices = new Set();

  // Prioridad: peak > reengage > otros
  [breakpointsBySection.peak, breakpointsBySection.reengage, breakpointsBySection.other].forEach(indices => {
    if (selectedIndices.size < maxBreakpoints && indices.length > 0) {
      selectedIndices.add(indices[0]);
    }
  });

  // Desactivar breakpoints que no fueron seleccionados
  const result = blocks.map((block, idx) => ({
    ...block,
    isSingleWordBlock: selectedIndices.has(idx) ? block.isSingleWordBlock : false,
  }));

  if (selectedIndices.size > 0) {
    logger.debug(
      `Breakpoint limiting: selected ${selectedIndices.size}/${Array.from(selectedIndices).length} ` +
      `at indices [${Array.from(selectedIndices).join(',')}]`
    );
  }

  return result;
}

/**
 * Estiliza un bloque de subtítulo con jerarquía visual V3.
 *
 * Regla: máximo 1 palabra destacada (MAYÚSCULAS) por bloque.
 * Prioridad:
 *   1. Palabra más impactante por categoría
 *   2. Primera palabra si es hook
 *   3. Palabra única (1 word blocks son siempre impacto)
 */
function _stylizeSubtitleText(text = '', { isHook = false, isSingleWordBlock = false } = {}) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return text;

  // Single-word blocks siempre en MAYÚSCULAS
  if (isSingleWordBlock) {
    return tokens[0].toUpperCase();
  }

  // Encontrar la palabra más impactante
  const mostImpactfulIdx = findMostImpactfulWordIndex(text);

  // Si es hook, la primera palabra tiene prioridad
  let highlightIdx = isHook && mostImpactfulIdx === -1 ? 0 : mostImpactfulIdx;

  // Aplicar MAYÚSCULAS solo a la palabra destacada
  return tokens.map((token, index) => {
    if (index === highlightIdx) {
      return token.toUpperCase();
    }
    return token;
  }).join(' ');
}

function _normalizeSubtitleWord(word) {
  return String(word || '').trim();
}

function _cleanSubtitleToken(word) {
  return _normalizeSubtitleWord(word)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!?;:]/g, '');
}

function _endsSentence(word) {
  return /[.!?]$/.test(_normalizeSubtitleWord(word));
}

function _endsSoftPause(word) {
  return /[,;:]$/.test(_normalizeSubtitleWord(word));
}

function _pairMustStayTogether(left, right) {
  const pair = `${_cleanSubtitleToken(left)} ${_cleanSubtitleToken(right)}`.trim();
  return [
    'delante de',
    'de ti',
    'sin que',
    'que lo',
    'lo notes',
    'se hace',
    'hace la',
    'la victima',
    'a decir',
    'decir la',
    'la verdad',
    'a justificar',
    'justificar cada',
    'cada detalle',
    'aunque empezaste',
    'empezaste diciendo',
    'diciendo la',
    'aunque sea',
    'y entonces',
    'pero aqui',
    'pero ahi',
    'en ese',
    'ese momento',
    'de verdad',
  ].includes(pair);
}

function _shouldBreakSenseChunk(currentWords, currentText, nextWord) {
  const safeCurrent = currentWords.filter(Boolean);
  if (!safeCurrent.length) return false;
  const lastWord = safeCurrent[safeCurrent.length - 1];
  if (nextWord && _pairMustStayTogether(lastWord, nextWord)) return false;
  if (_endsSentence(lastWord)) return true;
  if (_endsSoftPause(lastWord) && safeCurrent.length >= MIN_WORDS_PER_BLOCK) return true;
  if (safeCurrent.length >= MAX_WORDS_PER_BLOCK) return true;
  if (safeCurrent.length >= WORDS_PER_BLOCK) {
    if (/\b(delante de ti|sin que lo notes|se hace la victima|a decir la verdad|a justificar cada detalle|aunque empezaste diciendo la verdad)\b/i.test(currentText)) {
      return true;
    }
    if (/\b(y entonces|pero aqui|pero ahi|en ese momento|de verdad)\b/i.test(currentText)) {
      return true;
    }
  }
  return false;
}

function _groupTextIntoSenseChunks(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = [];

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const currentText = current.join(' ');
    const nextWord = words[i + 1] || '';
    if (_shouldBreakSenseChunk(current, currentText, nextWord)) {
      chunks.push(currentText);
      current = [];
    }
  }

  if (current.length) chunks.push(current.join(' '));
  return chunks;
}

// ─────────────────────────────────────────────
//  CONSTRUCCIÓN DESDE WORD TIMESTAMPS (PRO)
// ─────────────────────────────────────────────

const MAX_BLOCKS_PER_SECOND = 1.5;
const BREAK_PAUSE_THRESHOLD = 0.25; // silencio > 0.25s = nuevo bloque

/**
 * Agrupa palabras en bloques respetando pausas y coherencia de frase
 * Genera subtítulos naturales y legibles desde word-level timestamps
 */
/**
 * Detecta si una palabra debe ir sola (bloque de 1 palabra para máximo impacto).
 * Ejemplos: "DUELE", "MUERE", "PIERDE"
 */
function isBreakpointWord(word) {
  const clean = _cleanSubtitleToken(word).toLowerCase();
  const breakpointWords = [
    'duele', 'duelen', 'muere', 'mueren', 'pierde', 'pierden',
    'falla', 'fallan', 'rompe', 'rompen', 'quiebra', 'quiebran',
    'sufres', 'sufre', 'herida', 'heridas', 'cicatriz', 'cicatrices',
    'sola', 'solo', 'solos', 'solas', 'abandonada', 'abandonado',
  ];
  return breakpointWords.some(w => clean.includes(_cleanSubtitleToken(w)));
}

/**
 * Agrupa palabras con Whisper timestamps en bloques para legibilidad en Shorts.
 * V3: Permite bloques de 1 palabra para máximo impacto emocional.
 * Target: 1-4 palabras por bloque (flexible, respeta puntos de quiebre).
 */
function _groupWordsIntoSubtitleBlocks(wordTimestamps) {
  if (!wordTimestamps || wordTimestamps.length === 0) return [];

  const blocks = [];
  let currentBlock = [];

  for (let i = 0; i < wordTimestamps.length; i++) {
    const word = wordTimestamps[i];

    // REGLA 1: Si palabra actual es breakpoint Y hay bloque actual → finalizar bloque primero
    if (isBreakpointWord(word.word) && currentBlock.length > 0) {
      const blockStart = currentBlock[0].start;
      const blockEnd = currentBlock[currentBlock.length - 1].end;
      blocks.push({
        words: [...currentBlock],
        start: blockStart,
        end: blockEnd,
        text: currentBlock.map(w => w.word).join(' '),
        duration: blockEnd - blockStart,
      });
      currentBlock = [];
    }

    // Calcular pausa y duración
    const pause = currentBlock.length > 0
      ? word.start - currentBlock[currentBlock.length - 1].end
      : 0;
    const wouldBeStart = currentBlock.length > 0 ? currentBlock[0].start : word.start;
    const wouldBeDuration = word.end - wouldBeStart;

    let shouldBreakBefore = false;

    if (currentBlock.length > 0) {
      if (currentBlock.length >= MAX_WORDS_PER_BLOCK) {
        shouldBreakBefore = true;
      }
      else if ((currentBlock[currentBlock.length - 1].end - currentBlock[0].start) >= MAX_BLOCK_DURATION) {
        shouldBreakBefore = true;
      }
      else if (wouldBeDuration > MAX_BLOCK_DURATION) {
        shouldBreakBefore = true;
      }
      else if (pause > BREAK_PAUSE_THRESHOLD && currentBlock.length >= MIN_WORDS_PER_BLOCK) {
        shouldBreakBefore = true;
      }
      else if (_endsSentence(currentBlock[currentBlock.length - 1].word)) {
        shouldBreakBefore = true;
      }
    }

    if (shouldBreakBefore && currentBlock.length > 0) {
      const blockStart = currentBlock[0].start;
      const blockEnd = currentBlock[currentBlock.length - 1].end;
      blocks.push({
        words: [...currentBlock],
        start: blockStart,
        end: blockEnd,
        text: currentBlock.map(w => w.word).join(' '),
        duration: blockEnd - blockStart,
      });
      currentBlock = [];
    }

    currentBlock.push(word);

    // Si palabra actual es breakpoint → finalizar bloque con esta palabra sola
    if (isBreakpointWord(word.word)) {
      blocks.push({
        words: [word],
        start: word.start,
        end: word.end,
        text: word.word,
        duration: word.end - word.start,
        isBreakpoint: true,
      });
      currentBlock = [];
    }
  }

  // Finalizar último bloque
  if (currentBlock.length > 0) {
    const blockStart = currentBlock[0].start;
    const blockEnd = currentBlock[currentBlock.length - 1].end;
    blocks.push({
      words: currentBlock,
      start: blockStart,
      end: blockEnd,
      text: currentBlock.map(w => w.word).join(' '),
      duration: blockEnd - blockStart,
    });
  }

  // Log de validación
  if (blocks.length > 0) {
    const avgDuration = blocks.reduce((sum, b) => sum + (b.duration || 0), 0) / blocks.length;
    const breakpointCount = blocks.filter(b => b.isBreakpoint).length;
    logger.debug(
      `Grouped ${wordTimestamps.length} words → ${blocks.length} blocks | ` +
      `avg_duration=${avgDuration.toFixed(2)}s | words_per_block=${(wordTimestamps.length / blocks.length).toFixed(1)} | breakpoint=${breakpointCount}`
    );
  }

  return blocks;
}

/**
 * Construye bloques de subtítulo desde word-level timestamps (Whisper)
 * Máxima precisión: cada palabra tiene timing exacto start/end
 *
 * IMPORTANTE: Mantiene TODOS los bloques generados (2-4 palabras cada uno).
 * No combina bloques - eso reduciría la legibilidad en Shorts.
 */
function _buildRawBlocksFromWordTimestamps(script, wordTimestamps) {
  const wordBlocks = _groupWordsIntoSubtitleBlocks(wordTimestamps);
  if (wordBlocks.length === 0) return [];

  // Obtener secciones del script para asignar a bloques
  const scriptSections = getScriptSections(script);
  const sectionData = scriptSections
    .map((section) => ({
      key: section.key === 'explanation' ? 'revelation' : section.key,
      text: section.text,
      words: section.text.split(/\s+/).filter(Boolean),
    }))
    .filter(s => s.text);

  // Mapear qué sección corresponde a cada palabra
  const wordToSection = new Map();
  let wordCount = 0;
  for (const section of sectionData) {
    for (let i = 0; i < section.words.length; i++) {
      wordToSection.set(wordCount, section.key);
      wordCount++;
    }
  }

  // Construir bloques manteniendo todos (no combinar)
  const blocks = [];
  let idx = 0;

  for (const block of wordBlocks) {
    if (!block || !block.words || block.words.length === 0) continue;

    // Determinar sección: usar la primera palabra del bloque
    const blockWordIndex = wordTimestamps.findIndex(w =>
      w.word === block.words[0].word &&
      Math.abs(w.start - block.words[0].start) < 0.01
    );

    const section = blockWordIndex >= 0
      ? wordToSection.get(blockWordIndex) || 'revelation'
      : 'revelation';

    blocks.push({
      text: block.text,
      start: parseFloat(block.start.toFixed(3)),
      end: parseFloat((block.end + BLOCK_END_EXTENSION).toFixed(3)),
      section,
      isHook: section === 'hook' && idx === 0,
      isBreakpoint: block.isBreakpoint || false,
      idx,
    });

    idx++;
  }

  // Validar cantidad de bloques
  if (blocks.length < 10) {
    logger.warn(
      `SubtitleStyler: Solo ${blocks.length} bloques generados (target >= 10). ` +
      `Esto puede afectar legibilidad en Shorts.`
    );
  }

  // Anti-overlap y duraciones mínimas
  _fixBlockTimings(blocks);
  return blocks;
}

// ─────────────────────────────────────────────
//  GENERACIÓN DE BLOQUES ESTILIZADOS
// ─────────────────────────────────────────────

/**
 * Genera bloques de subtítulo con metadatos de estilo V2.
 *
 * Prioridad de timing:
 *   1. wordTimestamps de Whisper (word-level precision PRO)
 *   2. wordBoundaries exactos de Edge TTS (sync perfecto, palabra a palabra)
 *   3. sectionDurations de Kokoro segmentado con segmentos de silencedetect
 *      → los bloques se alinean a los segmentos de habla reales, no por palabras
 *   4. Proporcional por palabras usando realDuration (fallback legacy)
 *
 * En todos los modos el END de cada bloque se extiende +BLOCK_END_EXTENSION (default
 * +80 ms) para que el texto nunca desaparezca antes de que la frase termine.
 *
 * @param {Object} script
 * @param {number} realDuration       - duración total del audio (ffprobe)
 * @param {Array}  wordBoundaries     - [{word, start, duration}] de Edge TTS
 * @param {Object} sectionDurations   - {hook:{start,duration}, claim:…} de Kokoro segmentado
 * @param {Array}  wordTimestamps     - [{word, start, end}] de Whisper (word-level)
 */
function buildStyledSubtitleBlocks(script, realDuration, wordBoundaries = [], sectionDurations = null, wordTimestamps = []) {
  let rawBlocks = _buildRawBlocks(script, realDuration, wordBoundaries, sectionDurations, wordTimestamps);

  // FASE 1: Limitar breakpoints a máximo 1-2 por video
  rawBlocks = _limitBreakpoints(rawBlocks);

  // FASE 2: Anotar cada bloque con metadatos de estilo V3 (jerarquía visual)
  let styledBlocks = rawBlocks.map(block => {
    const isSingleWordBlock = block.isSingleWordBlock || block.text.split(/\s+/).length === 1;
    const text = _stylizeSubtitleText(block.text, {
      isHook: block.isHook,
      isSingleWordBlock,
    });

    const color    = SECTION_COLORS[block.section]     || 'white';
    const fontSize = SECTION_FONT_SIZES[block.section] || 90;
    const isImpact = hasImpactWord(text) || hasImpactNumber(text) || isSingleWordBlock;

    const fontSizeAdjustment = isSingleWordBlock ? 12 : (isImpact ? 8 : 0);

    return {
      ...block,
      text,
      color,
      fontSize: fontSize + fontSizeAdjustment,
      isImpact,
      isSingleWordBlock,
      boxOpacity: isImpact || isSingleWordBlock
        ? (parseFloat(SECTION_BOX_OPACITY[block.section] || '0.50') + 0.15).toFixed(2)
        : SECTION_BOX_OPACITY[block.section] || '0.50',
    };
  });

  // FASE 3: Aplicar timing cinematográfico emocional
  styledBlocks = styledBlocks.map((block, idx) =>
    _applyEmotionalTiming(block, idx, styledBlocks)
  );

  // FASE 4: Aplicar silencios emocionales
  styledBlocks = _applyEmotionalSilences(styledBlocks);

  return styledBlocks;
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
function _buildRawBlocks(script, realDuration, wordBoundaries, sectionDurations, wordTimestamps) {
  // ── MODO 0: word timestamps (Whisper — máxima precisión PRO) ─────────────────
  if (wordTimestamps && wordTimestamps.length >= 10) {
    logger.info(`SubtitleStyler: WORD_TIMESTAMPS mode | ${wordTimestamps.length} words | endExt=+${BLOCK_END_EXTENSION}s`);
    return _buildRawBlocksFromWordTimestamps(script, wordTimestamps);
  }

  // ── MODO 1: word boundaries exactos (Edge TTS) ───────────────────────────────
  if (wordBoundaries && wordBoundaries.length >= 4) {
    logger.info(`SubtitleStyler: EXACT mode | ${wordBoundaries.length} word boundaries | endExt=+${BLOCK_END_EXTENSION}s | minDur=${MIN_BLOCK_DURATION}s`);
    const totalWords = wordBoundaries.length;
    const sections   = _getSectionWordRanges(script, totalWords);
    const groups     = _groupByPunctuation(wordBoundaries, WORDS_PER_BLOCK);
    const blocks     = [];
    let idx      = 0;
    let wordBase = 0;

    for (const slice of groups) {
      const first   = slice[0];
      const last    = slice[slice.length - 1];
      const section = _sectionForIndex(wordBase, sections);
      const rawEnd  = last.start + last.duration;

      blocks.push({
        text:    slice.map(b => b.word).join(' '),
        start:   parseFloat(first.start.toFixed(3)),
        end:     parseFloat((rawEnd + BLOCK_END_EXTENSION).toFixed(3)),
        section,
        isHook:  section === 'hook' && idx === 0,
        idx,
      });
      idx++;
      wordBase += slice.length;
    }

    // Anti-overlap + duración mínima
    _fixBlockTimings(blocks);
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
    const blocks = [];
    let idx = 0;

    for (const [rawKey, timing] of Object.entries(sectionDurations)) {
      const section      = rawKey === 'explanation' ? 'revelation' : rawKey;
      const text         = (script[rawKey] || '').trim();
      if (!text) continue;

      const chunks       = _groupTextIntoSenseChunks(text);
      const numBlocks    = chunks.length;
      const sectionStart = timing.start;
      const sectionDur   = timing.duration;
      const segments     = timing.segments; // [{start, end}] relativos a la sección

      for (let i = 0; i < numBlocks; i++) {
        const chunk = chunks[i];
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
    _fixBlockTimings(blocks);
    return blocks;
  }

  // ── MODO 3: proporcional por wordcount (fallback) ────────────────────────────
  logger.info(`SubtitleStyler: PROPORTIONAL mode (fallback) | realDuration=${realDuration.toFixed(2)}s | endExt=+${BLOCK_END_EXTENSION}s`);
  const scriptSections = getScriptSections(script);
  const sectionData = scriptSections.map((section, index) => ({
    key: section.key === 'explanation' ? 'revelation' : section.key,
    text: section.text,
    pause: index === 0 ? 0.55 : index === scriptSections.length - 1 ? 0.0 : 0.2,
  })).filter((section) => section.text);

  const totalWords = sectionData.reduce((s, sec) => s + sec.text.split(/\s+/).length, 0);
  const speechDur  = realDuration * 0.88;

  const blocks = [];
  let cur = 0;
  let idx = 0;

  for (const s of sectionData) {
    const sWords     = s.text.split(/\s+/);
    const chunks     = _groupTextIntoSenseChunks(s.text);
    const sectionDur = speechDur * (sWords.length / totalWords);
    const numBlocks  = Math.max(chunks.length, 1);
    const blockDur   = sectionDur / numBlocks;

    for (let i = 0; i < numBlocks; i++) {
      const chunk = chunks[i] || s.text;
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
  const sections = getScriptSections(script).map((section) => ({
    key: section.key === 'explanation' ? 'revelation' : section.key,
    text: section.text,
  }));

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

/**
 * Agrupa word boundaries respetando puntuación natural.
 * Rompe el bloque al encontrar puntuación fuerte (.!?) o al llegar a maxWords.
 * Comas y dos puntos son "pausas suaves" — solo rompen si ya hay ≥2 palabras.
 */
function _groupByPunctuation(wordBoundaries, maxWords) {
  const groups  = [];
  let current   = [];

  for (let i = 0; i < wordBoundaries.length; i++) {
    const wb        = wordBoundaries[i];
    current.push(wb);
    const currentText = current.map(item => item.word).join(' ');
    const nextWord = wordBoundaries[i + 1]?.word || '';
    const hardBreak = _shouldBreakSenseChunk(current.map(item => item.word), currentText, nextWord);
    const atMax     = current.length >= Math.max(maxWords, MAX_WORDS_PER_BLOCK);

    if (hardBreak || atMax) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Elimina solapamientos entre bloques consecutivos y aplica duración mínima.
 * Modifica el array in-place.
 */
function _fixBlockTimings(blocks) {
  for (let i = 0; i < blocks.length - 1; i++) {
    const next = blocks[i + 1];
    // Clamp: el bloque actual no puede terminar después de que empiece el siguiente
    if (blocks[i].end > next.start - 0.02) {
      blocks[i].end = parseFloat((next.start - 0.02).toFixed(3));
    }
    // Mínimo visible: al menos MIN_BLOCK_DURATION, pero sin pasarse del siguiente
    const minEnd = parseFloat((blocks[i].start + MIN_BLOCK_DURATION).toFixed(3));
    if (blocks[i].end < minEnd) {
      blocks[i].end = Math.min(minEnd, next.start - 0.02);
    }
  }
  // Último bloque: solo mínimo
  if (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    const minEnd = parseFloat((last.start + MIN_BLOCK_DURATION).toFixed(3));
    if (last.end < minEnd) last.end = minEnd;
  }
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
 * @param {string} yPos      - Expresión Y para posicionamiento (default: h*0.78)
 * @param {Object} theme     - Tema visual (para color de acento)
 * @returns {string}         - filtergraph de drawtext para FFmpeg
 */
function buildStyledDrawtextFilters(blocks, yPos = 'h*0.78', theme = null) {
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

// ─────────────────────────────────────────────
//  KARAOKE ASS — efecto palabra-a-palabra amarilla
// ─────────────────────────────────────────────

/**
 * Convierte segundos al formato de tiempo ASS: H:MM:SS.cc
 */
function formatASSTime(seconds) {
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const s  = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

/**
 * Genera un archivo .ass con efecto karaoke:
 * - Palabras no pronunciadas: blanco
 * - Palabra activa: se rellena de amarillo de izquierda a derecha (\kf)
 * - Palabras ya pronunciadas: amarillo
 *
 * @param {Array}  wordBoundaries - [{word, start, duration}] de Edge TTS
 * @param {string} outputPath     - ruta donde guardar el .ass
 * @param {number} yPos           - posición Y en píxeles (default: 1460)
 */
function buildKaraokeASSFile(wordBoundaries, outputPath, yPos = 1460) {
  const LINE_WORDS = 4;  // palabras por línea visible simultáneamente
  const xPos = 540;      // centro horizontal (PlayResX/2)

  // ASS color format: &HAABBGGRR
  // Amarillo (255,255,0) → A=00,B=00,G=FF,R=FF → &H0000FFFF
  // Blanco   (255,255,255) → &H00FFFFFF
  const header =
`[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Impact,128,&H0000FFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,1,0,1,6,4,5,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = [];
  for (let i = 0; i < wordBoundaries.length; i += LINE_WORDS) {
    lines.push(wordBoundaries.slice(i, i + LINE_WORDS));
  }

  const dialogues = lines.map(lineWords => {
    const lineStart = lineWords[0].start;
    const lastWord  = lineWords[lineWords.length - 1];
    const lineEnd   = lastWord.start + lastWord.duration + 0.18;

    // \kf<cs> → rellena la palabra de amarillo en cs centésimas de segundo
    const karaokeText = lineWords.map(w => {
      const cs = Math.max(1, Math.round(w.duration * 100));
      return `{\\kf${cs}}${w.word}`;
    }).join(' ');

    return `Dialogue: 0,${formatASSTime(lineStart)},${formatASSTime(lineEnd)},Default,,0,0,0,,{\\pos(${xPos},${yPos})}${karaokeText}`;
  }).join('\n');

  require('fs').writeFileSync(outputPath, header + dialogues + '\n', 'utf8');
  return outputPath;
}

/**
 * Genera un archivo ASS a partir de los styled blocks (todos los modos).
 * Usa Impact, colores por sección, sin karaoke pero con posicionamiento exacto.
 * Alternativa a drawtext — mejor tipografía, sin escaping manual.
 *
 * @param {Array}  blocks     - salida de buildStyledSubtitleBlocks
 * @param {string} outputPath - ruta .ass de salida
 * @param {number} yPos       - posición Y en píxeles (default: 1460)
 */
function buildStyledASSFile(blocks, outputPath, yPos = 1460) {
  // ASS color: &HAABBGGRR
  const CSS_TO_ASS = {
    yellow:    '&H0000FFFF',
    white:     '&H00FFFFFF',
    '#FFD700': '&H0000D7FF',
    '#00E5FF': '&H00FFE500',
    '#F3F7FF': '&H00FFF7F3',  // cold white (hook, micro_value)
    '#4F7BFF': '&H00FF7B4F',  // electric blue (open_loop, escalation, cta)
    '#FF3B30': '&H00303BFF',  // danger red (reengage, peak, revelation)
  };

  const header =
`[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Impact,100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,6,4,8,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogues = blocks.map(block => {
    const color   = CSS_TO_ASS[block.color] || '&H00FFFFFF';
    const fs2     = block.fontSize ? Math.round(block.fontSize * 0.78) : 78; // escala 1080→ASS
    const bold    = block.isImpact || block.isHook ? -1 : 0;
    const outline = block.isImpact || block.isHook ? 8 : 6;
    const tags    = `{\\c${color}\\fs${fs2}\\b${bold}\\bord${outline}\\pos(540,${yPos})}`;
    return `Dialogue: 0,${formatASSTime(block.start)},${formatASSTime(block.end)},Default,,0,0,0,,${tags}${block.text}`;
  }).join('\n');

  require('fs').writeFileSync(outputPath, header + dialogues + '\n', 'utf8');
  return outputPath;
}

/**
 * optimizeSubtitlesForVirality - Aplica restricciones de viralidad a subtítulos
 *
 * Asegura:
 * 1. Máximo 8 palabras por línea (mobile readability)
 * 2. Keywords resaltadas en RED (#FF3B30) en primeros 2 segundos
 * 3. Cambios visuales cada 2-3 segundos
 * 4. Énfasis en power words
 */
function optimizeSubtitlesForVirality(blocks) {
  if (!blocks || !Array.isArray(blocks)) return blocks;

  const VIRAL_MAX_WORDS = 8;
  const VIRAL_KEYWORD_COLOR = '#FF3B30'; // RED para máximo impacto
  const VIRAL_HIGHLIGHT_COLOR = '#FFE500'; // YELLOW para hook
  const VIRAL_HOOK_DURATION = 2000; // 0-2s = hook critical

  return blocks.map((block, idx) => {
    let optimized = { ...block };

    // 1. Limitar palabras por línea
    const words = (block.text || '').split(/\s+/).filter(Boolean);
    if (words.length > VIRAL_MAX_WORDS) {
      // Partidor inteligente: mantener sense chunks
      optimized.text = words.slice(0, VIRAL_MAX_WORDS).join(' ');
    }

    // 2. Resaltar keywords en primeros 2s
    if (block.start < VIRAL_HOOK_DURATION && block.section === 'hook') {
      // Hook section: máximo impacto visual
      optimized.color = VIRAL_HIGHLIGHT_COLOR; // YELLOW
      optimized.fontSizeModifier = optimized.fontSizeModifier || 1.2;
      optimized.isBold = true;
    } else if (block.start < VIRAL_HOOK_DURATION && hasImpactWord(block.text)) {
      // Keywords en primeros 2s: RED
      optimized.color = VIRAL_KEYWORD_COLOR;
      optimized.fontSizeModifier = optimized.fontSizeModifier || 1.15;
    }

    // 3. Asegurar cambios visuales cada 2-3s
    const changeInterval = 2500; // 2.5 segundos
    optimized.changeIntervalMs = changeInterval;

    return optimized;
  });
}

module.exports = {
  buildStyledSubtitleBlocks,
  buildStyledDrawtextFilters,
  buildSRTContent,
  buildKaraokeASSFile,
  buildStyledASSFile,
  hasImpactWord,
  optimizeSubtitlesForVirality,
  SECTION_COLORS,
  SECTION_FONT_SIZES,
};
