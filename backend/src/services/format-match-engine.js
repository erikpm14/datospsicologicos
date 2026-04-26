/**
 * format-match-engine.js
 * Mide cuánto se parece un guión al patrón viral objetivo.
 *
 * Patrón objetivo (short-form viral de psicología):
 * - Hook brutal en segundo 0 (1 frase, sin intro, sin contexto)
 * - Voz calmada, seria, segura, neutra
 * - Lenguaje ultra simple, frases de 8-12 palabras
 * - "Esto me pasa a mí" — identificación inmediata
 * - Micro-revelación rápida, una sola idea
 * - Estructura lineal sin rodeos
 * - 20-35 segundos idealmente (configurable)
 * - Cierre con mini insight claro
 *
 * Escala: 0-100 puntos
 * Umbral mínimo: MIN_FORMAT_MATCH_SCORE_TO_QUEUE (default 65)
 */

const WPS = 2.3; // palabras por segundo para narración calmada

const TARGET_MIN = parseInt(process.env.FORMAT_TARGET_MIN_SECONDS || '40');
const TARGET_MAX = parseInt(process.env.FORMAT_TARGET_MAX_SECONDS || '65');

// ─────────────────────────────────────────────
//  HOOK FORMAT (0-20 pts)
//  ¿El hook para el scroll en el segundo 0?
// ─────────────────────────────────────────────

function scoreHookFormat(hookText) {
  if (!hookText) return 0;
  let score = 0;

  // 1. Frase única (sin punto interno que divida ideas)
  // Primero eliminar el "..." al final (es un recurso dramático, no separador)
  const hookClean = hookText.replace(/\.{2,}$/, '').replace(/\s*\.\s*$/, '');
  const internalPeriods = (hookClean.match(/[.!?]/g) || []).length;
  if (internalPeriods === 0) score += 5;
  else if (internalPeriods === 1) score += 2;

  // 2. Apertura personal/inmediata
  const personalPatterns = [
    /\btu\b|\bte\b|\btus\b/i,
    /\besto\b/i,
    /^si\b/i,
    /\bsiempre\b|\bnunca\b/i,
    /\bhay (un|una)\b/i,
    /^¿|^por qué/i,
    /\bsin que (lo sepas|te das cuenta|te des cuenta)\b/i,
  ];
  const personalHits = personalPatterns.filter((p) => p.test(hookText)).length;
  score += Math.min(personalHits * 2, 6);

  // 3. Sin openers débiles de presenter/influencer
  const weakOpeners = [
    /^hoy (voy|les|te)/i,
    /^en este (vídeo|video)\b/i,
    /^bienvenido/i,
    /^vamos a hablar/i,
    /^hola[,\s]/i,
    /^quiero (contarte|hablar)/i,
  ];
  if (!weakOpeners.some((p) => p.test(hookText))) score += 5;

  // 4. Longitud óptima (8-15 palabras)
  const words = hookText.trim().split(/\s+/).length;
  if (words >= 8 && words <= 15) score += 4;
  else if (words >= 6 && words <= 20) score += 2;

  return Math.min(score, 20);
}

// ─────────────────────────────────────────────
//  BREVITY (0-15 pts)
//  Más corto = más viral para este formato
// ─────────────────────────────────────────────

function scoreBrevity(durationSeconds, wordCount) {
  let dur = durationSeconds;
  if (!dur && wordCount) dur = wordCount / WPS;
  if (!dur) return 5;

  // Datos reales del canal: 61-75s = 5.06% engagement (mayor)
  if (dur >= TARGET_MIN && dur <= TARGET_MAX) return 15; // 40-65s = óptimo
  if (dur > TARGET_MAX && dur <= 75)          return 12; // 65-75s = muy bueno
  if (dur > 75 && dur <= 90)                  return 7;  // demasiado largo
  if (dur < TARGET_MIN && dur >= 25)          return 8;  // corto pero válido
  if (dur < 25)                               return 3;  // demasiado corto
  return 2;
}

// ─────────────────────────────────────────────
//  CLARITY (0-15 pts)
//  Claridad extrema: frases cortas, voz directa, 1 idea
// ─────────────────────────────────────────────

function scoreClarity(fullText) {
  if (!fullText) return 0;
  let score = 0;

  // Frases cortas — exigencia máxima: <12 palabras
  const sentences = fullText.split(/[.!?]+/).filter((s) => s.trim().length > 3);
  if (sentences.length > 0) {
    const avgWords = fullText.split(/\s+/).length / sentences.length;
    if (avgWords <= 9)       score += 8;   // ultra-short = máxima claridad
    else if (avgWords <= 12) score += 5;   // objetivo ideal
    else if (avgWords <= 15) score += 2;   // aceptable
    else                     score += 0;   // demasiado largo, no hay puntos

    // Penalización activa si alguna frase supera 14 palabras
    const tooLong = sentences.filter((s) => s.trim().split(/\s+/).length > 14).length;
    score -= tooLong * 2;
  }

  // Sin palabras académicas/complejas
  const complexWords = [
    'psicopatología', 'neuroplasticidad', 'metacognición',
    'fenomenológico', 'epistemología', 'axiomático',
    'paradigmático', 'interseccionalidad',
  ];
  if (!complexWords.some((w) => fullText.toLowerCase().includes(w))) score += 4;

  // Uso del "tú" (directo, personal)
  const tuHits = (fullText.match(/\b(tu|te|tienes|sientes|haces|notas|cuando tú)\b/gi) || []).length;
  score += Math.min(tuHits, 3);

  return Math.max(0, Math.min(score, 15));
}

// ─────────────────────────────────────────────
//  NARRATIVE RHYTHM (0-10 pts)
//  Lineal, sin rodeos, sin relleno
// ─────────────────────────────────────────────

function scoreNarrativeRhythm(script) {
  const { hook, claim, explanation, cta } = script;
  let score = 4; // base por tener estructura

  // Todas las secciones presentes
  if (hook && claim && explanation && cta) score += 2;

  // Sin frases de relleno
  const fillerPhrases = [
    /hoy (voy a|quiero|les voy)/i,
    /en este vídeo/i,
    /como ya (saben|sabes)/i,
    /antes de (empezar|continuar)/i,
    /como mencioné\b/i,
    /a continuación\b/i,
    /dicho esto\b/i,
  ];
  const fullText = [hook, claim, explanation, cta].filter(Boolean).join(' ');
  const fillerHits = fillerPhrases.filter((p) => p.test(fullText)).length;
  score -= fillerHits * 2;

  // Explanation concisa (no dispersa)
  if (explanation) {
    const expWords = explanation.trim().split(/\s+/).length;
    if (expWords <= 40) score += 4;
    else if (expWords <= 55) score += 2;
    else if (expWords > 70) score -= 2;
  }

  return Math.max(0, Math.min(score, 10));
}

// ─────────────────────────────────────────────
//  EARLY REVELATION (0-10 pts) — NUEVO
//  ¿La primera revelación llega antes del segundo 5?
//  El claim debe ser corto, concreto y dispararse inmediatamente.
// ─────────────────────────────────────────────

function scoreEarlyRevelation(script) {
  const { claim } = script;
  if (!claim) return 0;

  let score = 0;

  // El claim debe ser breve para sonar en los primeros 5 segundos
  const claimWords = claim.trim().split(/\s+/).length;
  if (claimWords <= 12) score += 5;       // rápido y contundente
  else if (claimWords <= 18) score += 3;  // aceptable
  else score += 0;                         // demasiado largo, la revelación llega tarde

  // El claim debe tener un dato concreto: número, nombre de efecto o mecanismo
  const hasConcreteData = [
    /\b\d+[%\s]/,
    /efecto\s+\w+/i,
    /\b(dopamina|cortisol|serotonina|amígdala|hipocampo|oxitocina)\b/i,
    /\bse llama\b|\bse conoce como\b/i,
    /\bestudio\b|\binvestigación\b/i,
  ].some((p) => p.test(claim));

  if (hasConcreteData) score += 5;

  return Math.min(score, 10);
}

// ─────────────────────────────────────────────
//  PSYCHOLOGICAL IMPACT (0-15 pts)
//  Revelación, dato concreto, idea única fuerte
// ─────────────────────────────────────────────

function scorePsychologicalImpact(script) {
  const { claim, explanation, psychologicalFact } = script;
  let score = 0;

  // Concepto psicológico definido
  if (psychologicalFact && psychologicalFact.length > 10) score += 4;

  // Patrones de revelación en claim/explanation
  const revelationPatterns = [
    /\bestudio\b|\binvestigación\b/i,
    /\bcerebro\b|\bmente\b/i,
    /\bpor qué\b/i,
    /\bsin que (lo sepas|te des cuenta)\b/i,
    /\binconsciente\b|\bautomático\b/i,
    /\bdopamina\b|\bserotonina\b|\bcortisol\b/i,
    /\b(genera|provoca|causa|activa)\b/i,
    /\besto (significa|indica|revela)\b/i,
  ];
  const contentText = [claim, explanation].filter(Boolean).join(' ');
  const revHits = revelationPatterns.filter((p) => p.test(contentText)).length;
  score += Math.min(revHits * 2, 8);

  // Explanation enfocada (pocas palabras = una idea)
  if (explanation) {
    const w = explanation.trim().split(/\s+/).length;
    if (w <= 35) score += 3;
    else if (w <= 50) score += 1;
  }

  return Math.min(score, 15);
}

// ─────────────────────────────────────────────
//  SCROLL STOP POTENTIAL (0-10 pts)
//  ¿Para el scroll en el segundo 0?
// ─────────────────────────────────────────────

function scoreScrollStop(hookText) {
  if (!hookText) return 0;
  let score = 0;

  const stopPatterns = [
    { pattern: /^(si|hay|tu|el|la|esto|nunca|siempre|¿|por qué)/i,   points: 3 },
    { pattern: /\.\.\./,                                               points: 2 },
    { pattern: /\bsecret[oa]\b|\boculto\b|\bnadie (sabe|te dice|te cuenta)\b/i, points: 3 },
    { pattern: /\bsin que (lo sepas|te des cuenta)\b/i,               points: 3 },
    { pattern: /\bte (está|han estado|están|miente|engaña)\b/i,       points: 3 },
    { pattern: /\btu (cerebro|mente|cuerpo)\b/i,                      points: 3 },
    { pattern: /\b\d+[%\s]/,                                           points: 2 },
    { pattern: /\bpor qué (siempre|nunca|no puedes|haces)\b/i,        points: 3 },
    { pattern: /cada vez que\b/i,                                      points: 2 },
  ];

  for (const { pattern, points } of stopPatterns) {
    if (pattern.test(hookText)) score += points;
  }

  return Math.min(score, 10);
}

// ─────────────────────────────────────────────
//  INFORMATION DENSITY (0-10 pts)
//  Datos útiles por segundo
// ─────────────────────────────────────────────

function scoreInfoDensity(script) {
  const { claim, explanation } = script;
  if (!claim && !explanation) return 0;

  const contentText = [claim, explanation].filter(Boolean).join(' ');
  const words = contentText.trim().split(/\s+/).length;

  const densePatterns = [
    /\b\d+[%\s]/,
    /\bestudio\b|\binvestigación\b/i,
    /\bcerebro\b/i,
    /\bdopamina\b|\bserotonina\b/i,
    /\bcuando\b.{5,30}\b(entonces|eso)\b/i,
    /\bporque\b/i,
    /\besto (causa|provoca|genera|activa)\b/i,
    /\bsin que\b/i,
  ];

  const denseHits = densePatterns.filter((p) => p.test(contentText)).length;
  let score = Math.min(denseHits * 2, 6);

  // Concisión = densidad alta
  if (words > 0 && words <= 50) score += 4;
  else if (words <= 70) score += 2;

  return Math.min(score, 10);
}

// ─────────────────────────────────────────────
//  SINGLE IDEA FOCUS (0-5 pts)
//  Un solo concepto central, no disperso
// ─────────────────────────────────────────────

function scoreSingleIdea(script) {
  const { hook, explanation } = script;
  if (!hook) return 1;

  // Las palabras clave del hook deben aparecer en claim o explanation
  const hookKeywords = (hook || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4 && !['siempre', 'nunca', 'cuando', 'porque', 'tienes', 'cerebro', 'mente'].includes(w));

  const contentText = [(script.claim || ''), (explanation || '')].join(' ').toLowerCase();
  const focusHits = hookKeywords.filter((w) => contentText.includes(w)).length;

  if (focusHits >= 2) return 5;
  if (focusHits >= 1) return 3;
  // Si hay un psychologicalFact definido, asumir enfoque correcto
  if (script.psychologicalFact) return 3;
  return 1;
}

// ─────────────────────────────────────────────
//  REENGAGE (0-10 pts)
//  ¿El guión tiene un reenganche en el segmento ~20s?
// ─────────────────────────────────────────────

function scoreReengage(script) {
  // Estructura v1: campo reengage explícito
  if (script.reengage && script.reengage.trim().length > 5) {
    const text = script.reengage.toLowerCase();
    let score = 5; // base: tiene segmento reengage
    if (/y (aquí|ahora|esto|lo que)|pero (hay|lo que|esto)|espera|lo más importante/i.test(text)) score += 3;
    if (/cuántas veces|te ha pasado|¿(sabes|sabías)|reconoces/i.test(text)) score += 2;
    return Math.min(10, score);
  }
  // Fallback: detectar en explanation frases de reenganche
  const expl = (script.explanation || '').toLowerCase();
  if (/y (aquí|ahora|esto)|pero (hay|lo que)|lo más importante|espera/i.test(expl)) return 4;
  if (/¿(cuántas|sabes|te ha)|¿lo (reconoces|sabías)/i.test(expl)) return 3;
  return 0;
}

// ─────────────────────────────────────────────
//  SCORE TOTAL
// ─────────────────────────────────────────────

/**
 * Calcula el format_match_score completo (0-100).
 * @param {Object} script - Objeto guión con hook, claim, explanation, cta, durationSeconds, estimatedWords
 * @returns {{ score, breakdown, approved, threshold, gaps }}
 */
function scoreFormatMatch(script) {
  const {
    hook = '',
    claim = '',
    explanation = '',
    cta = '',
    durationSeconds,
    estimatedWords,
  } = script;

  const fullText = [hook, claim, explanation, cta].filter(Boolean).join(' ');

  const breakdown = {
    hookFormat:          scoreHookFormat(hook),                           // 0-20
    brevity:             scoreBrevity(durationSeconds, estimatedWords),   // 0-15
    clarity:             scoreClarity(fullText),                          // 0-15
    narrativeRhythm:     scoreNarrativeRhythm(script),                   // 0-10
    psychologicalImpact: scorePsychologicalImpact(script),               // 0-15
    scrollStop:          scoreScrollStop(hook),                           // 0-10
    infoDensity:         scoreInfoDensity(script),                        // 0-10
    earlyRevelation:     scoreEarlyRevelation(script),                   // 0-10
    singleIdea:          scoreSingleIdea(script),                         // 0-5
    reengage:            scoreReengage(script),                           // 0-10 ← estructura v1
  };
  // Máximo teórico: 110. Normalizamos a 100.
  const rawScore = Object.values(breakdown).reduce((s, v) => s + v, 0);
  const score    = Math.round(Math.min(rawScore, 100));
  const threshold = parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '70');
  const gaps = analyzeFormatGaps(breakdown);

  return { score, breakdown, approved: score >= threshold, threshold, gaps };
}

/**
 * Genera lista de gaps de formato detectados.
 * @param {Object} breakdown
 * @returns {string[]}
 */
function analyzeFormatGaps(breakdown) {
  const gaps = [];
  if (breakdown.hookFormat < 12)          gaps.push('Hook demasiado suave — necesita impacto brutal en el segundo 0, sin intro');
  if (breakdown.brevity < 8)              gaps.push('Demasiado largo — objetivo estricto 20-30s, máxima retención');
  if (breakdown.clarity < 8)             gaps.push('Frases demasiado largas — máximo 12 palabras por frase, sin excepciones');
  if (breakdown.narrativeRhythm < 6)     gaps.push('Hay relleno o rodeos — elimina intro, empieza con el dato');
  if (breakdown.psychologicalImpact < 8) gaps.push('Revelación psicológica débil — añade nombre de efecto o cifra concreta');
  if (breakdown.scrollStop < 5)          gaps.push('Hook no para el scroll — falta tensión, shock o reconocimiento inmediato');
  if (breakdown.infoDensity < 5)         gaps.push('Baja densidad — más información útil en menos palabras');
  if (breakdown.earlyRevelation < 5)     gaps.push('Revelación tardía — el claim debe ser breve y concreto, no llegar al segundo 8');
  if (breakdown.singleIdea < 3)          gaps.push('Idea dispersa — una sola idea de principio a fin');
  return gaps;
}

// ─────────────────────────────────────────────
//  EMOTIONAL IMPACT SCORE (0-100)
//  Mide el impacto emocional del guión.
//  Dimensiones: power words, identificación personal,
//  factor sorpresa, lenguaje visceral, tensión-resolución.
// ─────────────────────────────────────────────

const POWER_WORDS_EMOTIONAL = [
  'nunca', 'siempre', 'jamás', 'todos', 'nadie', 'secreto', 'oculto',
  'increíble', 'peligro', 'alerta', 'sin que lo sepas', 'sin darte cuenta',
  'automático', 'inconsciente', 'te miente', 'te engaña', 'te controla',
  'sin querer', 'no lo sabes', 'antes de que pienses',
];

const PHYSICAL_LANGUAGE = [
  'corazón', 'estómago', 'cuerpo', 'músculos', 'piel', 'manos', 'voz',
  'respiración', 'sudor', 'tensión', 'adrenalina', 'cortisol',
];

const TENSION_MARKERS = [
  /\bpor qué\b/i,
  /\bsin que\b/i,
  /\baunque quieras\b/i,
  /\baunque no quieras\b/i,
  /\bsin poder evitarlo\b/i,
  /\bcuando intentas\b/i,
  /\ba pesar de\b/i,
];

const RESOLUTION_MARKERS = [
  /\bpor eso\b/i,
  /\bahora (ya\s+)?sabes\b/i,
  /\beso (significa|explica|revela)\b/i,
  /\bla (razón|respuesta|clave) es\b/i,
  /\bse llama\b/i,
];

/**
 * Calcula el emotional_impact_score (0-100).
 * Mide si el guión genera una respuesta emocional fuerte.
 *
 * @param {Object} script
 * @returns {{ score, breakdown }}
 */
function scoreEmotionalImpact(script) {
  const { hook = '', claim = '', explanation = '', cta = '' } = script;
  const fullText   = [hook, claim, explanation, cta].filter(Boolean).join(' ');
  const lowerText  = fullText.toLowerCase();

  // 1. Power words (0-25 pts)
  const powerHits = POWER_WORDS_EMOTIONAL.filter((w) => lowerText.includes(w.toLowerCase())).length;
  const powerScore = Math.min(powerHits * 6, 25);

  // 2. Identificación personal (0-20 pts)
  // Cuánto habla DIRECTAMENTE al espectador
  const tuCount  = (fullText.match(/\b(tu\b|te\b|tus\b|tienes\b|sientes\b|haces\b|notas\b|cuando tú)/gi) || []).length;
  const identScore = Math.min(tuCount * 3 + 4, 20);

  // 3. Factor sorpresa (0-20 pts)
  // Datos concretos, cifras, nombres de efectos, revelaciones
  const surprisePatterns = [
    /\b\d+[%\s]/,                              // cifras/porcentajes
    /\bestudio\b|\binvestigación\b/i,           // referencia a ciencia
    /\bse llama\b|\bse conoce como\b/i,        // nombre del efecto
    /\bno es (pereza|flojera|falta de)\b/i,   // reencuadre
    /\b(amígdala|cortex|hipocampo|dopamina|cortisol|serotonina)\b/i, // neurociencia
    /\bsorprendente\b|\bincreíble\b|\bimpactante\b/i,
  ];
  const surpriseHits  = surprisePatterns.filter((p) => p.test(fullText)).length;
  const surpriseScore = Math.min(surpriseHits * 5, 20);

  // 4. Lenguaje visceral/físico (0-15 pts)
  const physicalHits  = PHYSICAL_LANGUAGE.filter((w) => lowerText.includes(w)).length;
  const physicalScore = Math.min(physicalHits * 5, 15);

  // 5. Estructura tensión-resolución (0-20 pts)
  const hasTension   = TENSION_MARKERS.some((p) => p.test(fullText));
  const hasResolution = RESOLUTION_MARKERS.some((p) => p.test(fullText));
  const tensionScore = (hasTension ? 10 : 0) + (hasResolution ? 10 : 0);

  const breakdown = {
    powerWords:   powerScore,    // 0-25
    personalId:   identScore,    // 0-20
    surpriseFactor: surpriseScore, // 0-20
    visceral:     physicalScore, // 0-15
    tensionResolution: tensionScore, // 0-20
  };

  const score = Object.values(breakdown).reduce((s, v) => s + v, 0);

  return { score, breakdown };
}

module.exports = { scoreFormatMatch, analyzeFormatGaps, scoreEmotionalImpact };
