/**
 * hook-validator.service.js
 *
 * Valida y penaliza hooks que no son confesionales/íntimos.
 * Rechaza genéricos tipo Instagram motivacional.
 */

const logger = require('../utils/logger');

// Patrones que indican hooks GENÉRICOS (a evitar)
const GENERIC_PATTERNS = [
  /^la gente/i,
  /^algunos/i,
  /^todos/i,
  /^la mayoría/i,
  /^deberías/i,
  /^debes/i,
  /^tienes que/i,
  /^aprende/i,
  /^descubre/i,
  /aprendes (?:más|de)/i,
  /te hace/i,
  /te vuelve/i,
  /te convierte/i,
  /secreto (?:científico|de|que)/i,
  /investigación (?:revela|demuestra)/i,
  /científicos (?:descubren|demuestran)/i,
  /la verdad (?:sobre|acerca)/i,
  /¿sabías que/i,
  /¿por qué (?:siempre|nunca)/i,
  /¿conoces el truco/i,
  /truco que/i,
  /lo que nadie te dice/i,
  /nadie te cuenta/i,
];

// Patrones que indican PRIMERA PERSONA o IMPLÍCITO (a favorecer)
const FIRST_PERSON_PATTERNS = [
  /^(no sé|no entiendo|no entiendo) por qué/i,
  /^(hago|digo|creo) como que/i,
  /^no (lo digo|lo admito|me doy cuenta)/i,
  /^(hay|tengo) algo que/i,
  /^(estoy|ando) (haciendo|fingiendo)/i,
  /^(me pasa|me sucede) que/i,
  /^(me doy cuenta|me he dado cuenta) de que/i,
  /^(sabía|sé) que (hago|digo|pienso)/i,
  /^(cuando|si) (me doy cuenta|veo)/i,
  /^nunca (admito|digo|reconozco)/i,
];

// Palabras clave que indican EMOCIÓN INCÓMODA
const VULNERABILITY_INDICATORS = [
  'miedo', 'mienten', 'fingir', 'escondo', 'oculto', 'controlo',
  'pierdo', 'fallo', 'decepciono', 'traición', 'solo', 'vacío',
  'mentira', 'negación', 'pretendo', 'aparento', 'nunca digo',
  'nunca admito', 'todos creen', 'nadie sabe', 'en realidad',
  'la verdad es', 'lo que nadie ve', 'por dentro',
];

/**
 * Validar si un hook es confesional/íntimo
 * Retorna: { valid, score, reason, penalties }
 */
function validateHookConfessional(hookText) {
  if (!hookText || typeof hookText !== 'string') {
    return {
      valid: false,
      score: 0,
      reason: 'Hook inválido (no es string)',
      penalties: ['invalid_format'],
    };
  }

  let score = 100;
  const penalties = [];

  // 1. DETECTAR PATRONES GENÉRICOS
  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(hookText)) {
      score -= 30; // Penalización fuerte
      penalties.push(`generic_pattern: ${pattern}`);
      break; // Solo una penalización por patrón genérico
    }
  }

  // 2. DETECTAR PRIMERA PERSONA O IMPLÍCITO (bonus)
  let hasFirstPerson = false;
  for (const pattern of FIRST_PERSON_PATTERNS) {
    if (pattern.test(hookText)) {
      score += 15; // Bonus por confesional
      hasFirstPerson = true;
      break;
    }
  }

  // 3. DETECTAR VULNERABILIDAD/INCOMODIDAD (bonus)
  const vulnerabilityCount = VULNERABILITY_INDICATORS.filter(word =>
    new RegExp(`\\b${word}\\b`, 'i').test(hookText)
  ).length;

  if (vulnerabilityCount >= 1) {
    score += Math.min(vulnerabilityCount * 5, 20); // Bonus acumulativo (máx 20)
  }

  // 4. TEST DE INSTAGRAM (¿suena a publicación motivacional?)
  const isInstagrammable = /^(la verdad|secreto|nunca|deberías|aprendes|descubre)/i.test(hookText) &&
                          !hasFirstPerson;

  if (isInstagrammable) {
    score -= 20;
    penalties.push('instagram_motivational');
  }

  // 5. LONGITUD CORRECTA (40-120 caracteres es ideal para hooks)
  if (hookText.length < 30) {
    score -= 10;
    penalties.push('too_short');
  } else if (hookText.length > 140) {
    score -= 15;
    penalties.push('too_long');
  }

  // 6. NO DEBE TENER DEMASIADAS MAYÚSCULAS (vulgares)
  const capsCount = (hookText.match(/[A-Z]/g) || []).length;
  const capsRatio = capsCount / hookText.length;
  if (capsRatio > 0.15) {
    score -= 10;
    penalties.push('excessive_caps');
  }

  // Validez final
  const valid = score >= 65 && vulnerabilityCount >= 1;

  return {
    valid,
    score: Math.max(0, Math.min(100, score)),
    reason: valid
      ? 'Hook confesional válido'
      : 'Hook no cumple criterios confesionales',
    penalties: penalties.length > 0 ? penalties : [],
    hasFirstPerson,
    vulnerabilityScore: vulnerabilityCount,
  };
}

/**
 * Penalizar viralityScore de un hook que no sea confesional
 */
function applyHookPenalty(viralityScore, hookValidation) {
  if (!hookValidation.valid) {
    return Math.max(0, viralityScore - 25); // Penalización de -25 en virality
  }
  return viralityScore;
}

/**
 * Reporte detallado de hook
 */
function getHookReport(hookText, viralityScore = 50) {
  const validation = validateHookConfessional(hookText);
  const adjustedScore = applyHookPenalty(viralityScore, validation);

  return {
    hook: hookText,
    length: hookText.length,
    validation,
    originalVirality: viralityScore,
    adjustedVirality: adjustedScore,
    penalty: viralityScore - adjustedScore,
    status: validation.valid ? '✓ VÁLIDO' : '✗ RECHAZADO',
    notes: [
      validation.hasFirstPerson && '→ Primera persona/implícito',
      validation.vulnerabilityScore > 0 && `→ Indicadores emocionales: ${validation.vulnerabilityScore}`,
      !validation.valid && validation.penalties.length > 0 && `→ Problemas: ${validation.penalties.join(', ')}`,
    ].filter(Boolean),
  };
}

/**
 * Validar lote de hooks
 */
function validateHooks(hookTexts) {
  return hookTexts.map(text => validateHookConfessional(text));
}

module.exports = {
  validateHookConfessional,
  applyHookPenalty,
  getHookReport,
  validateHooks,
  GENERIC_PATTERNS,
  FIRST_PERSON_PATTERNS,
  VULNERABILITY_INDICATORS,
};
