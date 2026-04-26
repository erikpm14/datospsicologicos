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
  'la verdad es', 'por dentro',
];

// Palabras que indican DRAMATISMO EXCESIVO (a penalizar)
const DRAMATIC_PATTERNS = [
  /nadie quiere escuchar/i,
  /descubran quién soy/i,
  /lucho contra una parte/i,
  /guerra dentro de mí/i,
  /me paraliza/i,
  /aterroriza/i,
  /me deshago/i,
  /colapso/i,
  /oscuridad/i,
  /abismo/i,
  /parte de mí que no quiero/i,
];

/**
 * TEST DE REALIDAD: ¿Alguien real lo diría pensando solo?
 */
function passRealityTest(hookText) {
  // Frases que nadie diría realmente:
  const unrealistic = [
    /nadie quiere escuchar/i,
    /descubran quién soy realmente/i,
    /me aterroriza/i,
    /me paraliza/i,
    /me debate conmigo mismo/i,
    /me deshago/i,
    /oscuridad/i,
    /abismo/i,
  ];

  return !unrealistic.some(pattern => pattern.test(hookText));
}

/**
 * Validar si un hook es confesional/íntimo
 * Threshold: >= 70 obligatorio, >= 80 prioridad alta, < 70 rechazado
 */
function validateHookConfessional(hookText) {
  if (!hookText || typeof hookText !== 'string') {
    return {
      valid: false,
      score: 0,
      reason: 'Hook inválido (no es string)',
      penalties: ['invalid_format'],
      priority: 'low',
    };
  }

  let score = 100;
  const penalties = [];

  // 1. TEST DE REALIDAD (crítico)
  const passesReality = passRealityTest(hookText);
  if (!passesReality) {
    score -= 35; // Penalización muy fuerte
    penalties.push('fails_reality_test');
  }

  // 2. DETECTAR PATRONES GENÉRICOS
  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(hookText)) {
      score -= 30; // Penalización fuerte
      penalties.push(`generic_pattern`);
      break;
    }
  }

  // 3. DETECTAR DRAMATISMO EXCESIVO
  for (const pattern of DRAMATIC_PATTERNS) {
    if (pattern.test(hookText)) {
      score -= 20; // Penalización por exceso de drama
      penalties.push('too_dramatic');
      break;
    }
  }

  // 4. DETECTAR PRIMERA PERSONA O IMPLÍCITO (bonus)
  let hasFirstPerson = false;
  for (const pattern of FIRST_PERSON_PATTERNS) {
    if (pattern.test(hookText)) {
      score += 15; // Bonus por confesional
      hasFirstPerson = true;
      break;
    }
  }

  // 5. DETECTAR VULNERABILIDAD/INCOMODIDAD (bonus moderado)
  const vulnerabilityCount = VULNERABILITY_INDICATORS.filter(word =>
    new RegExp(`\\b${word}\\b`, 'i').test(hookText)
  ).length;

  if (vulnerabilityCount >= 1) {
    score += Math.min(vulnerabilityCount * 3, 12); // Bonus más moderado (máx 12)
  }

  // 6. TEST DE INSTAGRAM (¿suena a publicación motivacional?)
  const isInstagrammable = /^(la verdad|secreto|nunca|deberías|aprendes|descubre)/i.test(hookText) &&
                          !hasFirstPerson;

  if (isInstagrammable) {
    score -= 20;
    penalties.push('instagram_motivational');
  }

  // 7. LONGITUD CORRECTA (35-120 caracteres es ideal)
  if (hookText.length < 30) {
    score -= 10;
    penalties.push('too_short');
  } else if (hookText.length > 140) {
    score -= 15;
    penalties.push('too_long');
  }

  // 8. NO DEBE TENER DEMASIADAS MAYÚSCULAS
  const capsCount = (hookText.match(/[A-Z]/g) || []).length;
  const capsRatio = capsCount / hookText.length;
  if (capsRatio > 0.15) {
    score -= 10;
    penalties.push('excessive_caps');
  }

  // 9. SIMPLICIDAD: Preferir hooks simples y cotidianos
  const wordCount = hookText.split(/\s+/).length;
  if (wordCount >= 20) {
    score -= 8; // Penalizar demasiadas palabras
    penalties.push('too_complex');
  }

  // Normalizar score
  const finalScore = Math.max(0, Math.min(100, score));

  // Validez final (threshold >= 70)
  // Requiere: score >= 70, pasa reality test, Y ADEMÁS (primera persona O vulnerabilidad)
  const valid = finalScore >= 70 && passesReality && (hasFirstPerson || vulnerabilityCount > 0);

  // Determinar prioridad
  let priority = 'low';
  if (finalScore >= 80) priority = 'high';
  else if (finalScore >= 70) priority = 'medium';

  return {
    valid,
    score: finalScore,
    reason: valid
      ? 'Hook confesional válido (cotidiano e íntimo)'
      : finalScore < 70
        ? `Score bajo (${finalScore} < 70, requiere >= 70)`
        : !passesReality
          ? 'No pasa reality test - suena demasiado dramático'
          : 'No tiene suficiente primera persona',
    penalties: penalties.length > 0 ? penalties : [],
    hasFirstPerson,
    vulnerabilityScore: vulnerabilityCount,
    priority,
    passesReality,
  };
}

/**
 * Aplicar penalización a viralityScore basado en validación de hook
 * Score < 70: rechazado
 * Score 70-79: penalización -20
 * Score >= 80: sin penalización
 */
function applyHookPenalty(viralityScore, hookValidation) {
  const hookScore = hookValidation.score || 0;

  if (hookScore < 70) {
    // RECHAZADO: penalización severa
    return Math.max(0, viralityScore - 30);
  } else if (hookScore < 80) {
    // ACEPTABLE pero no óptimo: penalización leve
    return Math.max(0, viralityScore - 10);
  } else {
    // PRIORIDAD ALTA: sin penalización
    return viralityScore;
  }
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
  passRealityTest,
  GENERIC_PATTERNS,
  FIRST_PERSON_PATTERNS,
  VULNERABILITY_INDICATORS,
  DRAMATIC_PATTERNS,
};
