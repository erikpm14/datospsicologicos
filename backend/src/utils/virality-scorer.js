/**
 * virality-scorer.js
 * Score 0-100.
 *
 * Calibrado para SHORT-FORM (20-30s, 50-70 palabras).
 * emotionalTrigger y relatability usan densidad (hits/palabras) para no
 * penalizar scripts cortos frente a scripts largos.
 */

const logger = require('./logger');

// Palabras de alto impacto comprobadas en psicología/divulgación científica viral
const POWER_WORDS = [
  // Neurociencia y ciencia
  'cerebro', 'neurona', 'dopamina', 'cortisol', 'inconsciente', 'inconscientemente',
  'automáticamente', 'involuntariamente', 'científicamente', 'estudio', 'estudios',
  'experimento', 'experimentos', 'investigación', 'universidad', 'demostró', 'demostrado',
  'comprobado', 'descubrió', 'prefrontal', 'corteza', 'amígdala', 'hipocampo',
  'glucosa', 'serotonina', 'noradrenalina', 'oxitocina',
  // Efectos y sesgos (nombres propios = máximo impacto)
  'efecto', 'sesgo', 'síndrome', 'paradoja', 'disonancia', 'priming', 'anclaje',
  'dunning-kruger', 'dunning', 'kruger', 'halo', 'barnum', 'pigmalión', 'mandela',
  'placebo', 'gaslighting', 'fomo', 'impostor',
  // Mecanismo de revelación
  'se llama', 'lo llaman', 'se conoce como',
  // Sin que lo notes
  'sin que lo notes', 'sin darte cuenta', 'sin que lo sepas',
  // Manipulación y persuasión
  'manipulando', 'manipulación', 'manipula', 'persuasión', 'influye', 'condiciona',
  // Revelación/secreto
  'secreto', 'oculto', 'oculta', 'desconocido', 'nadie te dice',
  // Urgencia cognitiva
  'nunca', 'jamás', 'siempre', 'cada vez', 'en milisegundos',
];

const CONTROVERSY_PATTERNS = [
  // Formato divulgación científica (el más viral)
  /se llama [A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ\s\-]+/i,
  /efecto (anclaje|halo|barnum|placebo|dunning|mandela|espectador|pigmal)/i,
  /sesgo (de|cognitivo|d)/i,
  /s[íi]ndrome del (impostor|burnout)/i,
  /disonancia cognitiva/i,
  /priming|gaslighting|negging|neuromarketing/i,
  // Pregunta con CAPS (formato ciencia visual)
  /¿por qu[eé] /i,
  /¿sab[íi]as que /i,
  /¿qu[eé] pasar[íi]a si/i,
  /la verdad sobre/i,
  // Clásicos de alto rendimiento
  /nunca (conf[íi]es?|hagas?|digas?|creas?)/i,
  /te est[áa]n? (manipulando|mintiendo|enga[ñn]ando)/i,
  /el \d+[%\s]/i,
  /\d+ (cosas|se[ñn]ales?|errores?|secretos?|formas?)/i,
  /tu (cerebro|mente|cuerpo|sistema nervioso)/i,
  /sin que (lo notes|te des cuenta|lo sepas)/i,
  /cada vez que /i,
  /^si .+(cerebro|mente|cuerpo|móvil|duermes|comes|hablas)/i,
  /^si .+, esto está (pasando|ocurriendo|sucediendo)/i,    // patrón viral real — 104% loop
  /cada vez que .+, (tu cerebro|tu cuerpo|tu mente)/i,     // patrón viral real — top views
  /hay (un|una) (razón|mecanismo|patrón|explicación)/i,
  /experimento (de|del|que)/i,
  /universidad de/i,
  // Formatos del generador viral — hooks comunes de alta retención
  /^la raz[oó]n (por la que|de)/i,
  /^el mecanismo (que|detrás)/i,
  /por qu[eé] (siempre|nunca|cada|tu|te)/i,
  /lo que (crees|piensas|sientes|no sabes)/i,
  /^hay algo que tu/i,
  /^esto (explica|causa|activa|hace|provoca)/i,
  /no es (casualidad|azar|pereza|debilidad)/i,
  /^cuando (tu|te|haces|sientes)/i,
];

const QUESTION_PATTERNS = [/\?/, /¿/, /sabes\b/i, /alguna vez/i, /por qu[eé]/i, /conoces\b/i, /has (pensado|notado)/i, /te ha pasado/i, /lo sabes\b/i];

function scoreHook(hookText) {
  let score = 0;
  const hasControversy = CONTROVERSY_PATTERNS.some((p) => p.test(hookText));
  const hasQuestion    = QUESTION_PATTERNS.some((p) => p.test(hookText));
  const hasNumber      = /\b\d+\b/.test(hookText);
  const hasPowerWord   = POWER_WORDS.some((w) => hookText.toLowerCase().includes(w));
  // Empieza con números/formato lista — muy viral
  const startsWithNum  = /^\d+/.test(hookText.trim());
  // Tiene mayúsculas enfáticas (al menos una palabra en caps)
  const hasAllCaps     = /\b[A-ZÁÉÍÓÚÑ]{3,}\b/.test(hookText);

  if (hasControversy) score += 15;
  if (hasQuestion)    score += 8;
  if (hasNumber)      score += 5;
  if (hasPowerWord)   score += 5;
  if (startsWithNum)  score += 4;
  if (hasAllCaps)     score += 3;

  // Bonus: hook largo tiene más contexto y urgencia (15-25 palabras)
  const words = hookText.split(/\s+/).length;
  if (words >= 12 && words <= 25) score += 3;

  return Math.min(score, 35);
}

function scoreEmotionalTrigger(fullText) {
  const lower = fullText.toLowerCase();
  const hits  = POWER_WORDS.filter((w) => lower.includes(w)).length;
  const words = lower.split(/\s+/).length;
  // Normalizar por densidad: equipara scripts cortos (50w) y largos (130w)
  // Referencia: 3 hits en 50w = misma densidad que 8 hits en 130w
  const normalized = Math.round((hits / Math.max(words, 1)) * 60);
  return Math.min(normalized * 3 + 2, 25);
}

function scoreRelatability(fullText) {
  const lower = fullText.toLowerCase();
  const terms = [
    'tú', 'te ', 'tu ', 'todos', 'la gente', 'las personas',
    'la mayoría', 'nosotros', 'tus', 'cuando', 'si alguna vez',
    'tu cerebro', 'tu mente', 'tu cuerpo', 'en tu vida', 'te ha pasado',
  ];
  const hits  = terms.filter((t) => lower.includes(t)).length;
  const words = lower.split(/\s+/).length;
  // Normalizar igual que emotionalTrigger
  const normalized = Math.round((hits / Math.max(words, 1)) * 60);
  return Math.min(normalized * 3 + 4, 20);
}

function scoreLoopPotential(ctaText) {
  let score = 5; // base

  // Preguntas directas al espectador (patrón clásico)
  if (QUESTION_PATTERNS.some((p) => p.test(ctaText))) score += 8;

  // Call-to-action explícito (clásico — sigue siendo válido)
  if (/comenta|dime|cu[eé]ntame|qu[eé] opinas|lo conoc[íi]as|te ha pasado|escribe/i.test(ctaText)) score += 5;

  // Micro-conexión emocional v2 — frases que generan rewatch e identificación
  // sin pedir explícitamente ("y no eres el único", "probablemente te pasa", etc.)
  if (/probablemente te pasa|m[áa]s de lo que crees/i.test(ctaText)) score += 8;
  if (/no eres el [úu]nico|le pasa a todos|no est[áa]s solo/i.test(ctaText)) score += 7;
  if (/lo has notado|te ha ocurrido|lo reconoces|esto explica/i.test(ctaText)) score += 6;
  if (/seguro que te ha|cada vez que|siempre que/i.test(ctaText)) score += 5;
  // Loop que conecta con el inicio (cierra el arco del vídeo = rewatch)
  if (/vuelve al inicio|empieza de nuevo|primera vez que|al principio/i.test(ctaText)) score += 4;

  // CTA implícito — promesa de valor sin pedir nada (más efectivo que "sígueme")
  if (/solo es el principio|iremos descubriendo|todos los d[íi]as uno nuevo|ma[ñn]ana.+otro/i.test(ctaText)) score += 8;
  if (/(m[áa]s mecanismos|m[áa]s patrones|m[áa]s secretos).+(cerebro|mente|sin avisarte|sin permiso)/i.test(ctaText)) score += 7;
  if (/sin (avisarte|pedirte permiso|que lo sepas|que lo notes)/i.test(ctaText)) score += 5;
  // CTA explícito clásico (penalizado vs implícito pero sigue siendo válido)
  if (/s[íi]gueme|sigue el canal|más datos (así|psicológicos)/i.test(ctaText)) score += 3;
  return Math.min(score, 15);
}

function scoreDuration(durationSeconds) {
  // Calibrado con datos reales del canal:
  // 10-11s → top views (1.300-1.900), 21s → 104% loop
  // Objetivo nuevo: 12-18s sweet spot
  if (durationSeconds >= 10 && durationSeconds <= 18) return 10; // óptimo — datos reales
  if (durationSeconds >= 19 && durationSeconds <= 25) return 8;  // aceptable
  if (durationSeconds >= 26 && durationSeconds <= 35) return 5;  // largo — retención cae
  if (durationSeconds > 35)                           return 2;  // demasiado largo
  return 1;
}

function scoreScript(script) {
  const { hook = '', claim = '', explanation = '', cta = '', durationSeconds } = script;
  const fullText = [hook, claim, explanation, cta].filter(Boolean).join(' ');

  const breakdown = {
    hookStrength:     scoreHook(hook),
    emotionalTrigger: scoreEmotionalTrigger(fullText),
    relatability:     scoreRelatability(fullText),
    loopPotential:    scoreLoopPotential(cta),
    durationBonus:    scoreDuration(durationSeconds || 58),
  };

  const totalScore = Math.min(Object.values(breakdown).reduce((s, v) => s + v, 0), 100);
  const threshold  = parseInt(process.env.MIN_VIRALITY_SCORE || '75');
  const approved   = totalScore >= threshold;

  logger.info(`Virality score: ${totalScore}/100 | ${Object.entries(breakdown).map(([k,v]) => `${k}=${v}`).join(' | ')}`);

  return { score: totalScore, breakdown, approved };
}

/**
 * Calcula solo el hookStrength para filtrado rápido antes de scoring completo.
 * Útil para detectar hooks planos antes de encolar.
 */
function getHookStrength(hookText) {
  return scoreHook(hookText || '');
}

module.exports = { scoreScript, getHookStrength };
