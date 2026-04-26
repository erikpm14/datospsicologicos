/**
 * trend-aware-topic-selector.js
 *
 * Selecciona temas adaptados a tendencias actuales sin romper el patrón ganador.
 * - Tendencias NO mandan
 * - Solo sirven para adaptar ángulo
 * - Patrón ganador OBLIGATORIO
 */

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════
// PATRÓN GANADOR DEL CANAL
// ═══════════════════════════════════════════════════════════════

const WINNING_PATTERN = {
  emotionalTrigger: 'validation',       // Validación de emociones/experiencias
  viralTrigger: 'identificacion',       // Identificación personal
  hookStyle: 'observable_personal',     // Hook observable en la propia vida
  tone: 'experiential',                 // Tono experiencial, no académico
  allowedTopics: [
    'relationships',
    'habits',
    'social_patterns',
    'body_language',
    'emotional_patterns',
    'attention',
    'cognitive_biases',
  ],
  prohibitedPatterns: [
    'news_like',
    'trend_literal',
    'celebrity_reaction',
    'academic_explanation',
    'generic_curiosity',
  ],
};

// ═══════════════════════════════════════════════════════════════
// TENDENCIAS INTERNAS (HISTÓRICO DE RENDIMIENTO)
// ═══════════════════════════════════════════════════════════════

const INTERNAL_WINNING_TRENDS = {
  'emotional_patterns': {
    weight: 95,
    examples: [
      'Tu amígdala controla tus emociones antes que tu consciencia',
      'El 68% de personas regula sus emociones sin saberlo nunca',
      'Si alguien está triste cerca tuyo, tu cerebro ya está copiando su tristeza',
    ],
  },
  'habits': {
    weight: 92,
    examples: [
      'Tu cerebro repite hábitos sin que hayas decidido',
      'El 81% repite hábitos porque una señal los dispara sin notarlo',
      'Mira esto justo antes de volver a hacerlo',
    ],
  },
  'attention': {
    weight: 88,
    examples: [
      'Tu cerebro pierde 20 minutos de concentración con cada notificación',
      'El 87% de personas pierden concentración sin notar cuándo exactamente',
    ],
  },
  'body_language': {
    weight: 85,
    examples: [
      'Cada vez que mientes, tu cuerpo ya te delató',
      'El 73% sostiene la mirada para dominar sin saber que lo hace',
    ],
  },
  'relationships': {
    weight: 80,
    examples: [
      'Cada vez que te enamoras, eliges a la misma persona con otra cara',
      'Crees que sabes psicología pero no tienes ni idea',
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
// MAPEO: TENDENCIA EXTERNA → TEMA COMPATIBLE
// ═══════════════════════════════════════════════════════════════

const TREND_ADAPTATION_RULES = {
  anxiety: {
    theme: 'emotional_patterns',
    angle: 'Fíjate en esto cuando algo pequeño te cambia el cuerpo.',
    emotionalTrigger: 'validation',
    viralTrigger: 'identificacion',
  },
  relationships: {
    theme: 'relationships',
    angle: 'Mira esto cuando alguien responde distinto y tú haces como que no pasa nada.',
    emotionalTrigger: 'validation',
    viralTrigger: 'identificacion',
  },
  productivity: {
    theme: 'habits',
    angle: 'Mira esto cuando usas estar ocupado para no sentirte solo.',
    emotionalTrigger: 'validation',
    viralTrigger: 'identificacion',
  },
  focus: {
    theme: 'attention',
    angle: 'Tu cerebro se apaga cada 20 minutos. Neurología pura.',
    emotionalTrigger: 'validation',
    viralTrigger: 'identificacion',
  },
  confidence: {
    theme: 'body_language',
    angle: 'Fíjate en esto cuando intentas convencerte de que tienes razón.',
    emotionalTrigger: 'validation',
    viralTrigger: 'identificacion',
  },
  memory: {
    theme: 'cognitive_biases',
    angle: '¿Por qué SIEMPRE recuerdas el primer precio que ves?',
    emotionalTrigger: 'validation',
    viralTrigger: 'identificacion',
  },
  decision_making: {
    theme: 'habits',
    angle: '¿Por qué tomas PEORES decisiones cuando tienes hambre?',
    emotionalTrigger: 'validation',
    viralTrigger: 'identificacion',
  },
  manipulation: {
    theme: 'social_patterns',
    angle: 'El SECRETO que usan para manipularte y que cedas sin darte cuenta jamás.',
    emotionalTrigger: 'validation',
    viralTrigger: 'identificacion',
  },
};

// ═══════════════════════════════════════════════════════════════
// OBTENER SEÑALES DE TENDENCIAS
// ═══════════════════════════════════════════════════════════════

/**
 * Obtiene señales de tendencias (simulado — fallback a histórico)
 * En producción, conectaría a:
 * - Google Trends API (si disponible)
 * - YouTube Popular API (si disponible)
 * - Twitter/X Trending (si disponible)
 */
function getTrendSignals() {
  // TODO: Implementar Google Trends API
  // Por ahora, devolver tendencias simuladas basadas en patrones estacionales
  const now = new Date();
  const month = now.getMonth();

  // Simulación: tendencias por estación
  const seasonalTrends = {
    // Enero-Marzo: resoluciones, ansiedad, productividad
    0: ['productivity', 'confidence', 'anxiety'],
    1: ['relationships', 'productivity', 'focus'],
    2: ['anxiety', 'focus', 'relationships'],
    // Abril-Junio: relaciones, decisiones
    3: ['relationships', 'decision_making'],
    4: ['relationships', 'confidence'],
    5: ['anxiety', 'focus'],
    // Julio-Septiembre: hábitos, memória
    6: ['habits', 'memory'],
    7: ['memory', 'manipulation'],
    8: ['focus', 'confidence'],
    // Octubre-Diciembre: relaciones, confianza
    9: ['relationships', 'confidence'],
    10: ['anxiety', 'relationships'],
    11: ['manipulation', 'confidence'],
  };

  return {
    seasonal: seasonalTrends[month] || ['relationships', 'habits'],
    confidence: 0.6, // Baja confianza en simulación
    source: 'seasonal_simulation',
  };
}

/**
 * Adapta una tendencia externa al patrón ganador del canal
 */
function adaptTrendToPattern(externalTrend) {
  const adaptation = TREND_ADAPTATION_RULES[externalTrend.toLowerCase()];

  if (!adaptation) {
    // Fallback: usar tema ganador interno
    return null;
  }

  return {
    originalTrend: externalTrend,
    adaptedTheme: adaptation.theme,
    angle: adaptation.angle,
    emotionalTrigger: adaptation.emotionalTrigger,
    viralTrigger: adaptation.viralTrigger,
    compatibility: 'adapted',
  };
}

/**
 * Selecciona un tema respetando patrón ganador pero adaptado a tendencias
 */
function selectTrendAwareTopic(recentTopics = [], excludeThemes = []) {
  const trends = getTrendSignals();
  const candidates = [];
  const allExcluded = new Set([...recentTopics, ...excludeThemes]);

  // 1. Intentar adaptar tendencias externas
  for (const externalTrend of trends.seasonal) {
    const adaptation = adaptTrendToPattern(externalTrend);
    if (adaptation && !allExcluded.has(adaptation.adaptedTheme)) {
      candidates.push({
        ...adaptation,
        priority: 1, // Más alta prioridad
        source: 'trend_adapted',
      });
    }
  }

  // 2. Fallback: usar temas ganadores internos
  for (const [theme, data] of Object.entries(INTERNAL_WINNING_TRENDS)) {
    if (!allExcluded.has(theme)) {
      candidates.push({
        adaptedTheme: theme,
        angle: data.examples[Math.floor(Math.random() * data.examples.length)],
        emotionalTrigger: WINNING_PATTERN.emotionalTrigger,
        viralTrigger: WINNING_PATTERN.viralTrigger,
        compatibility: 'internal_winning',
        priority: 0,
        source: 'internal_trend',
        weight: data.weight,
      });
    }
  }

  // 3. Ordenar por prioridad y weight
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (b.weight || 0) - (a.weight || 0);
  });

  return candidates[0] || null;
}

/**
 * Genera una idea de contenido trend-aware completa
 */
function generateTrendAwareIdea(recentTopics = [], excludeThemes = []) {
  const selection = selectTrendAwareTopic(recentTopics, excludeThemes);

  if (!selection) {
    logger.warn('TrendAwareSelector: no candidates found, returning null');
    return null;
  }

  return {
    topic: selection.adaptedTheme,
    hook: selection.angle,
    emotionalTrigger: selection.emotionalTrigger,
    viralTrigger: selection.viralTrigger,
    trendSource: selection.source,
    trendAdapted: selection.originalTrend || null,
    compatibility: selection.compatibility,
    score: calculateIdeaScore(selection, recentTopics),
  };
}

/**
 * Puntúa una idea (0-100)
 */
function calculateIdeaScore(idea, recentTopics = []) {
  let score = 70; // Base

  // Bonificación por ser tema ganador interno
  if (idea.source === 'internal_trend' && INTERNAL_WINNING_TRENDS[idea.adaptedTheme]) {
    score += INTERNAL_WINNING_TRENDS[idea.adaptedTheme].weight - 70;
  }

  // Bonificación por ser adaptación de tendencia
  if (idea.source === 'trend_adapted') {
    score += 15;
  }

  // Penalización por repetición reciente
  if (recentTopics.includes(idea.adaptedTheme)) {
    score -= 20;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Genera N ideas trend-aware para validación
 */
function generateTrendAwareIdeas(count = 3, recentTopics = []) {
  const ideas = [];
  const usedThemes = new Set(recentTopics);

  for (let i = 0; i < count; i++) {
    const idea = generateTrendAwareIdea(recentTopics, Array.from(usedThemes));
    if (idea) {
      ideas.push(idea);
      usedThemes.add(idea.topic);
    } else {
      logger.warn(`TrendAwareSelector: could not generate idea ${i + 1} — no more candidates`);
    }
  }

  return ideas;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  selectTrendAwareTopic,
  generateTrendAwareIdea,
  generateTrendAwareIdeas,
  calculateIdeaScore,
  getTrendSignals,
  adaptTrendToPattern,
  WINNING_PATTERN,
  INTERNAL_WINNING_TRENDS,
};
