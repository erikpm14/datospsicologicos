/**
 * confessional-hook-generator.js
 *
 * Genera hooks confesionales íntimos en primera persona.
 * Patrón: alguien pensando solo, no dando consejos.
 */

const logger = require('../utils/logger');
const { validateHookConfessional } = require('./hook-validator.service');

// TEMPLATES de hooks confesionales por emoción/tema
// PRIORITARIOS: Simples, cotidianos, íntimos. NO teatrales.
const CONFESSIONAL_TEMPLATES = {
  // Negación/Fingimiento — SIMPLE Y COTIDIANO
  denial: [
    'Digo que no me importa, pero sí.',
    'Hago como que no pasa nada.',
    'Fingo estar bien cuando no lo estoy.',
    'Me callo y espero que lo noten.',
    'Pretendo que no duele, pero duele.',
  ],

  // Comportamiento oculto — LO QUE HAGO A SOLAS
  hidden_behavior: [
    'Hay algo que hago cuando nadie me ve.',
    'Hay una cosa que no le digo a nadie.',
    'Tengo un ritual que no puedo admitir.',
    'Hago cosas que nadie sabe.',
    'Hay un yo cuando estoy solo.',
  ],

  // Contradicción interna — SIMPLE
  contradiction: [
    'Sé que está mal y lo hago igual.',
    'No sé por qué vuelvo ahí.',
    'Digo que no voy a repetirlo y lo repito.',
    'Sé cómo termina y sigo comenzando.',
    'Me prometo no hacerlo y lo hago de nuevo.',
  ],

  // Incomodidad/Verdad incómoda — DIRECTA
  uncomfortable_truth: [
    'Lo pienso todos los días pero no lo digo.',
    'Es verdad aunque nadie me crea.',
    'Lo que guardo sin decirle a nadie.',
    'La verdad que no puedo confesar.',
    'Lo que pienso cuando me quedo solo.',
  ],

  // Miedo/Vulnerabilidad — ESPECÍFICO
  vulnerability: [
    'Tengo miedo de que se vayan.',
    'Me asusta lo que voy a hacer.',
    'Tengo miedo de perder el control.',
    'Me da pánico no ser suficiente.',
    'Tengo miedo de estar solo.',
  ],

  // Traición interna — RECONOCIMIENTO
  self_betrayal: [
    'Me saboteo sin saber por qué.',
    'Sé que me estoy saboteando y no paro.',
    'Me hago daño a mí mismo.',
    'Sé exactamente cómo me dejo caer.',
    'Elijo cosas que me perjudican.',
  ],

  // Patrón automático — REPETICIÓN
  automatic_pattern: [
    'Repito lo que dije que no repetiría.',
    'Hago lo mismo aunque sé que no funciona.',
    'No puedo dejar de hacerlo.',
    'Vuelvo al mismo lugar aunque sé que no debería.',
    'Hago esto sin pensar, siempre.',
  ],

  // Verdad silenciada — SIMPLE
  silenced_truth: [
    'Lo que nunca digo es que...',
    'Nadie sabe que en realidad...',
    'La verdad que guardo es que...',
    'Lo que no admito es que...',
    'Lo que realmente pienso es que...',
  ],

  // Confrontación interna — COTIDIANA (NO DRAMÁTICA)
  internal_confrontation: [
    'Una parte de mí quiere irse.',
    'Tengo dos formas de ver esto.',
    'Una parte de mí sabe que está mal.',
    'Tengo dos voces y se contradicen.',
    'No sé qué parte de mí elegir.',
  ],
};

/**
 * Seleccionar template aleatorio por categoría
 */
function getConfessionalTemplate(category = null) {
  const categories = Object.keys(CONFESSIONAL_TEMPLATES);

  if (category && CONFESSIONAL_TEMPLATES[category]) {
    const templates = CONFESSIONAL_TEMPLATES[category];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Seleccionar categoría aleatoria
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const templates = CONFESSIONAL_TEMPLATES[randomCategory];
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Generar variante personalizada (reemplazar palabra clave)
 */
function generateVariant(baseHook, topic = null) {
  // Keywords específicas por topic para personalizacion
  const topicKeywords = {
    relationships: ['relación', 'pareja', 'amor', 'confianza', 'compromiso'],
    emotions: ['emoción', 'sentimiento', 'miedo', 'dolor', 'angustia'],
    body_language: ['cuerpo', 'gesto', 'expresión', 'pose', 'movimiento'],
    social_patterns: ['gente', 'grupos', 'aceptación', 'pertenencia', 'status'],
    habits: ['hábito', 'patrón', 'repetición', 'control', 'impulso'],
    perception: ['realidad', 'verdad', 'percepción', 'ilusión', 'engaño'],
  };

  let variant = baseHook;

  if (topic && topicKeywords[topic]) {
    const keywords = topicKeywords[topic];
    const keyword = keywords[Math.floor(Math.random() * keywords.length)];

    // Reemplazar palabra genérica con keyword específica
    variant = variant.replace(/cosas|algo|esto|eso|idea/i, keyword);
  }

  return variant;
}

/**
 * Generar hook confesional con garantía de validez
 */
function generateConfessionalHook(topic = null, maxAttempts = 5) {
  let hook = null;
  let validation = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generar base
    hook = getConfessionalTemplate();

    // Personalizar si hay topic
    if (topic) {
      hook = generateVariant(hook, topic);
    }

    // Validar
    validation = validateHookConfessional(hook);

    if (validation.valid) {
      logger.debug(`Confessional hook valid on attempt ${attempt + 1}`, {
        hook,
        score: validation.score,
      });
      return {
        hook,
        validation,
        category: Object.keys(CONFESSIONAL_TEMPLATES).find(
          cat => CONFESSIONAL_TEMPLATES[cat].includes(hook)
        ),
      };
    }
  }

  // Fallback: retornar aunque no sea perfectamente válido
  logger.warn(`Confessional hook validation failed after ${maxAttempts} attempts`, {
    lastHook: hook,
    lastValidation: validation,
  });

  return {
    hook: hook || getConfessionalTemplate(),
    validation: validation || { valid: false, score: 0 },
    fallback: true,
  };
}

/**
 * Batch generation con garantía de calidad
 */
function generateBatch(count = 5, topic = null) {
  const hooks = [];

  for (let i = 0; i < count; i++) {
    const generated = generateConfessionalHook(topic);
    hooks.push({
      ...generated,
      index: i + 1,
    });
  }

  const validCount = hooks.filter(h => h.validation.valid).length;
  logger.info(`Generated ${count} confessional hooks`, {
    valid: validCount,
    invalid: count - validCount,
    topic,
  });

  return hooks;
}

module.exports = {
  getConfessionalTemplate,
  generateVariant,
  generateConfessionalHook,
  generateBatch,
  CONFESSIONAL_TEMPLATES,
};
