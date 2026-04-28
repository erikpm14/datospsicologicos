/**
 * humanity-scorer.js
 * Calcula el humanityScore de un script (0-100)
 *
 * Basado en:
 * - Autenticidad emocional
 * - Naturalidad del lenguaje
 * - Falta de tono educativo artificial
 * - Conexión personal
 */

const logger = require('./logger');

// Palabras que indican tono artificial/educativo
const ARTIFICIAL_MARKERS = [
  'aprende',
  'descubre',
  'secreto científico',
  'investigación',
  'estudio',
  'científicamente',
  'demostrado',
  'comprobado',
  'experimento',
  'universidad',
  'profesor',
  'académico',
  'lección',
  'clase',
  'teoría',
  'fórmula',
];

// Palabras que indican autenticidad/confesión
const AUTHENTICITY_MARKERS = [
  'sentí',
  'sentía',
  'me pasó',
  'me pasa',
  'creía',
  'pensaba',
  'dudaba',
  'confusión',
  'miedo',
  'dolor',
  'tristeza',
  'angustia',
  'ansiedad',
  'nostalgia',
  'vergüenza',
  'culpa',
  'arrepentimiento',
];

// Palabras que indican tono conversacional natural
const CONVERSATIONAL_MARKERS = [
  'vos',
  'te',
  'tu',
  'mío',
  'nuestro',
  'yo',
  'nosotros',
  'realmente',
  'honestly',
  'en verdad',
  'la verdad',
  'sin filtro',
  'sin artificio',
];

function scoreHumanity(script) {
  if (!script) return 0;

  const fullText = [
    script.hook,
    script.open_loop,
    script.micro_value,
    script.escalation,
    script.reengage,
    script.peak,
    script.open_ending,
    script.soft_cta,
    script.fullScript,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let score = 50; // Base score

  // Penalidad por tono artificial
  const artificialCount = ARTIFICIAL_MARKERS.filter((m) =>
    fullText.includes(m)
  ).length;
  score -= artificialCount * 5;

  // Bonus por autenticidad
  const authenticityCount = AUTHENTICITY_MARKERS.filter((m) =>
    fullText.includes(m)
  ).length;
  score += Math.min(authenticityCount * 3, 25);

  // Bonus por conversacionalidad
  const conversationalCount = CONVERSATIONAL_MARKERS.filter((m) =>
    fullText.includes(m)
  ).length;
  score += Math.min(conversationalCount * 2, 15);

  // Penalidad si tiene estructura de "lección"
  if (
    fullText.includes('primer') &&
    fullText.includes('segundo') &&
    fullText.includes('tercero')
  ) {
    score -= 10;
  }

  // Penalidad si es demasiado "científico"
  const scientificPatterns = /efecto\s|sesgo\s|síndrome\s|estudio\s|experimento\s/gi;
  const scientificMatches = (fullText.match(scientificPatterns) || []).length;
  if (scientificMatches > 3) {
    score -= scientificMatches * 3;
  }

  // Bonus por tono confesional explícito
  if (
    fullText.includes('confesión') ||
    fullText.includes('secreto') ||
    fullText.includes('nunca te lo dije')
  ) {
    score += 10;
  }

  // Normalizar a 0-100
  score = Math.max(0, Math.min(100, score));

  return Math.round(score);
}

function validateHumanity(script, minScore = 85) {
  const score = scoreHumanity(script);
  const valid = score >= minScore;

  if (!valid) {
    logger.warn(`Humanity check failed: ${score}/${minScore}`, {
      score,
      minRequired: minScore,
    });
  }

  return { score, valid, minRequired: minScore };
}

module.exports = {
  scoreHumanity,
  validateHumanity,
};
