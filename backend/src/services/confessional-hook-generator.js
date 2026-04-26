/**
 * confessional-hook-generator.js
 *
 * Genera hooks confesionales íntimos en primera persona.
 * Patrón: alguien pensando solo, no dando consejos.
 */

const logger = require('../utils/logger');
const { validateHookConfessional } = require('./hook-validator.service');

// TEMPLATES de hooks confesionales por emoción/tema
const CONFESSIONAL_TEMPLATES = {
  // Negación/Fingimiento
  denial: [
    'No sé por qué hago como que no pasa nada.',
    'Hago como que no me duele, pero me duele.',
    'Pretendo que no importa, pero importa.',
    'Fingo que estoy bien cuando no lo estoy.',
    'Digo que no me importa cuando en realidad sí.',
  ],

  // Comportamiento oculto
  hidden_behavior: [
    'Hay algo que hago cuando nadie me ve.',
    'Hay un lado de mí que nadie conoce.',
    'Tengo un hábito que no puedo admitir.',
    'Hay cosas que hago a espaldas de todos.',
    'Hay un yo que solo existe cuando estoy solo.',
  ],

  // Contradicción interna
  contradiction: [
    'Digo que no me importa lo que piensan, pero me importa.',
    'Sé que está mal y lo hago igual.',
    'Sé la verdad pero sigo creyendo la mentira.',
    'Me digo que tengo control, pero no lo tengo.',
    'Sé exactamente qué está pasando y sigo permitiéndolo.',
  ],

  // Incomodidad/Verdad incómoda
  uncomfortable_truth: [
    'No lo digo en voz alta, pero lo pienso todos los días.',
    'Nunca lo admitiría, pero es verdad.',
    'Sé que nadie quiere escuchar esto, pero es lo que pasa.',
    'La verdad que no puedo decir en voz alta.',
    'Lo que nadie ve cuando me voy a dormir.',
  ],

  // Miedo/Vulnerabilidad
  vulnerability: [
    'Tengo miedo de que alguien descubra quién soy realmente.',
    'Me asusta que se den cuenta de que estoy perdido.',
    'Lo que más me aterroriza es que vean mi verdadero yo.',
    'Tengo miedo de terminar solo por ser como soy.',
    'Me aterroriza que descubran lo que realmente pienso.',
  ],

  // Traición interna
  self_betrayal: [
    'Me traiciono todos los días sin admitirlo.',
    'Sé exactamente en qué momentos me vendo a mí mismo.',
    'Cada día elijo cosas que me traicionan.',
    'Tengo mil formas de traicionarme sin que nadie lo note.',
    'Sé exactamente cuándo y cómo me dejo caer.',
  ],

  // Patrón automático
  automatic_pattern: [
    'Hago esto sin ni siquiera pensar por qué lo hago.',
    'Repito un patrón que odio y no sé cómo pararlo.',
    'Hago lo mismo una y otra vez esperando otro resultado.',
    'Es como si alguien más controlara mis acciones.',
    'Actúo en automático y después me pregunto por qué lo hice.',
  ],

  // Verdad silenciada
  silenced_truth: [
    'Lo que nunca digo es que...',
    'La verdad que cargo silenciosamente es que...',
    'Nadie sabe que en realidad yo...',
    'Lo que guardo sin decir a nadie es que...',
    'La parte de mí que nadie ve piensa que...',
  ],

  // Confrontación interna
  internal_confrontation: [
    'Lucho contra una parte de mí que no quiero admitir.',
    'Hay una guerra dentro de mí que nadie ve.',
    'Una parte de mí quiere ser diferente, pero no puedo.',
    'Me debate conmigo mismo todos los días.',
    'Hay un conflicto dentro de mí que me paraliza.',
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
