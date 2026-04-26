/**
 * decision-engine.js
 * Decide qué producir a continuación basándose en datos reales.
 *
 * Lógica:
 *   1. Si hay un winning streak activo → continuar con variación del mismo patrón
 *   2. 80% exploit (repetir lo que funciona con variaciones)
 *   3. 20% explore (probar topics sin datos o con pocos datos)
 *   4. Bloquear topics saturados (>2 veces en 48h)
 *   5. Bloquear hooks idénticos usados recientemente (últimos 8 hooks)
 *   6. Registrar cada decisión para aprendizaje iterativo
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { getFullAnalytics } = require('./analytics-tracker');
const logger               = require('../utils/logger');

const DECISION_HISTORY_PATH = path.resolve('./data/decision-history.json');
const WINNING_STREAK_PATH   = path.resolve('./data/winning-streaks.json');
const GROWTH_LOG_PATH       = path.resolve('./data/growth-log.json');
const QUEUE_DIR             = path.resolve(process.env.QUEUE_DIR || './queue');

// ─────────────────────────────────────────────
//  CATÁLOGOS
// ─────────────────────────────────────────────

const AVAILABLE_TOPICS = [
  'habits', 'dopamine', 'procrastination', 'cognitive_biases', 'body_language',
  'emotional_patterns', 'relationships', 'decision_making', 'attention', 'memory',
  'social_patterns', 'perception', 'motivation', 'self_talk', 'emotions',
];

// Pesos calibrados con datos reales del canal:
// pattern → 104% loop ("Si relees la misma línea...") = mayor retención real
// revelation → top views ("Tu cerebro cambia de opinión sin que lo notes")
// Los demás reducidos — menos evidencia de rendimiento
const HOOK_TYPE_WEIGHTS = {
  pattern:    6,  // "Cada vez que X, tu cerebro Y" / "Si X, esto está pasando" — 104% loop real
  revelation: 4,  // "Tu cerebro hace X sin que lo notes" — top views real
  warning:    2,  // "Si haces esto, para ya."
  challenge:  1,  // "El 90% de la gente hace esto mal..."
  question:   1,  // "¿Por qué siempre haces X?"
  secret:     1,  // "Hay una razón psicológica por la que..."
};

const EMOTIONAL_TRIGGER_WEIGHTS = {
  curiosity:    4, // mayor retención documentada
  validation:   3, // identificación = retención
  relatability: 3,
  fear:         2,
  urgency:      1,
  awe:          1,
};

// Ángulos específicos por topic (múltiples para poder variar en streaks)
const TOPIC_ANGLES = {
  habits:           [
    'formación de hábitos automáticos', 'loop del hábito y recompensa',
    'rutinas sin esfuerzo consciente', 'hábitos que el cerebro automatiza',
    'señales que disparan comportamientos', 'por qué los hábitos malos persisten',
  ],
  dopamine:         [
    'dopamina y procrastinación diaria', 'ciclo dopamina-recompensa inmediata',
    'dopamina y redes sociales', 'picos de dopamina que bloquean el foco',
    'por qué buscas estimulación constantemente',
  ],
  procrastination:  [
    'procrastinación y evitación del malestar', 'inicio de tareas difíciles',
    'sistema de recompensa inmediata vs futura', 'parálisis por análisis',
    'por qué empiezas y abandonas',
  ],
  cognitive_biases: [
    'sesgo de confirmación en decisiones', 'efecto Dunning-Kruger y autoconciencia',
    'anclaje cognitivo y negociación', 'efecto halo en primeras impresiones',
    'sesgo de supervivencia', 'ilusión de control',
  ],
  body_language:    [
    'microexpresiones faciales involuntarias', 'postura y estado emocional interno',
    'señales de nerviosismo sin saberlo', 'contacto visual y jerarquía social',
    'gestos que revelan lo que piensas',
  ],
  emotional_patterns: [
    'regulación emocional automática', 'reacciones emocionales antes de pensar',
    'patrones de respuesta aprendidos en la infancia',
    'por qué las mismas situaciones te afectan igual',
    'contagio emocional inconsciente',
  ],
  relationships:    [
    'apego ansioso y comportamiento en pareja', 'patrones de atracción inconsciente',
    'comunicación no verbal en conflictos', 'por qué repites las mismas relaciones',
    'el efecto espejo en las relaciones',
  ],
  decision_making:  [
    'decisiones irracionales cotidianas', 'fatiga de decisiones y calidad mental',
    'heurísticas y atajos del cerebro', 'por qué decides peor por la tarde',
    'el efecto del estado emocional en decisiones',
  ],
  attention:        [
    'atención y distracción digital', 'por qué no puedes concentrarte más de 20 minutos',
    'multitarea y pérdida de rendimiento', 'foco profundo vs superficial',
    'por qué el aburrimiento es necesario',
  ],
  memory:           [
    'memoria emocional y recuerdos vívidos', 'efectos de la repetición en el recuerdo',
    'memoria selectiva y sesgos', 'por qué recuerdas cosas que no pasaron exactamente',
    'el efecto de la emoción en lo que recuerdas',
  ],
  social_patterns:  [
    'conformidad social sin darte cuenta', 'presión de grupo y decisiones',
    'comportamiento de manada en grupos', 'por qué cambias de opinión en grupo',
    'efecto espectador y responsabilidad diluida',
  ],
  perception:       [
    'percepción selectiva y realidad filtrada', 'ilusiones perceptivas cotidianas',
    'por qué dos personas ven lo mismo de forma distinta',
    'filtros cognitivos que distorsionan la realidad',
  ],
  motivation:       [
    'motivación intrínseca vs extrínseca', 'estado de flujo y rendimiento',
    'por qué la motivación desaparece cuando te recompensan',
    'gamificación mental y hábitos', 'motivación que dura vs motivación que se agota',
  ],
  self_talk:        [
    'diálogo interno negativo automático', 'voz crítica interior y rendimiento',
    'impacto del lenguaje interno en emociones',
    'por qué te hablas peor a ti mismo que a otros',
    'reprogramar el monólogo interno',
  ],
  emotions:         [
    'emociones físicas en el cuerpo', 'regulación emocional rápida sin supresión',
    'contagio emocional y grupos', 'por qué las emociones tienen lógica propia',
    'emociones que toman decisiones antes que tú',
  ],
};

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function readJSON(file, def = null) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return def; }
}

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function pickWeighted(weights) {
  const pool = Object.entries(weights).flatMap(([k, w]) => Array(w).fill(k));
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Topics producidos en las últimas N horas (detección de saturación)
 */
function getRecentProducedTopics(hoursBack = 48) {
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  const topics = [];

  for (const subdir of ['done', 'pending', 'active']) {
    const dir = path.join(QUEUE_DIR, subdir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (new Date(job.createdAt || 0).getTime() > cutoff && job.data?.topic) {
          topics.push(job.data.topic);
        }
      } catch {}
    }
  }

  return topics;
}

/**
 * Cooldown de topics: devuelve topics en cooldown extendido (48h) por rendimiento bajo.
 * Si un topic tiene trend "falling" y fue producido hace menos de 48h → cooldown.
 * Configurable con TOPIC_COOLDOWN_HOURS (default: 24).
 */
function getCooldownTopics() {
  const cooldownHours = parseInt(process.env.TOPIC_COOLDOWN_HOURS || '24');
  const TOP_HOOKS_PATH = path.resolve('./data/top-hooks.json');
  const ADV_PATH       = path.resolve('./data/hook-performance-advanced.json');

  const cooldown = new Set();
  try {
    if (!fs.existsSync(ADV_PATH)) return cooldown;
    const adv = JSON.parse(fs.readFileSync(ADV_PATH, 'utf8'));
    const fallingTopics = (adv.topicStats || [])
      .filter(t => t.recentTrend === 'falling' && t.count >= 3)
      .map(t => t.topic);

    const recentFallingProduced = getRecentProducedTopics(cooldownHours);
    for (const t of fallingTopics) {
      if (recentFallingProduced.includes(t)) cooldown.add(t);
    }
  } catch { /* ADV not yet generated */ }

  return cooldown;
}

/**
 * Hooks usados recientemente (para evitar repetición)
 * Extrae los últimos N hooks del growth-log
 */
function getRecentHooks(count = 8) {
  const log = readJSON(GROWTH_LOG_PATH, []) || [];
  return log.slice(0, count).map((e) => e.hook).filter(Boolean);
}

// ─────────────────────────────────────────────
//  WINNING STREAK SYSTEM
//  Si un patrón funciona → repetirlo 3 veces con variaciones
// ─────────────────────────────────────────────

const STREAK_SCORE_THRESHOLD   = parseInt(process.env.STREAK_SCORE_THRESHOLD || '72');
const STREAK_VARIATIONS        = parseInt(process.env.STREAK_VARIATIONS || '3');
const STREAK_EXPIRY_HOURS      = parseInt(process.env.STREAK_EXPIRY_HOURS || '72');

function getActiveStreak() {
  const streaks = readJSON(WINNING_STREAK_PATH, []) || [];
  const now = Date.now();

  // Buscar streak activo no expirado con variaciones restantes
  return streaks.find((s) =>
    s.variationsRemaining > 0 &&
    new Date(s.expiresAt).getTime() > now,
  ) || null;
}

function consumeStreakVariation(streak, angleUsed) {
  const streaks = readJSON(WINNING_STREAK_PATH, []) || [];
  const idx = streaks.findIndex((s) => s.id === streak.id);
  if (idx >= 0) {
    streaks[idx].variationsRemaining--;
    streaks[idx].anglesUsed = [...(streaks[idx].anglesUsed || []), angleUsed];
    writeJSON(WINNING_STREAK_PATH, streaks);
  }
}

/**
 * Registra un nuevo winning streak basado en un script de alta puntuación.
 * Llamar desde growth-engine cuando se aprueba un script excelente.
 */
function registerWinningStreak({ topic, hookType, jobId, viralityScore, formatMatchScore, hook }) {
  const combinedScore = (viralityScore + formatMatchScore) / 2;
  // Requiere virality ≥ umbral de publicación Y combined alto — evita streaks donde
  // format alto infla combined aunque virality sea insuficiente para publicar
  const minPublish = parseInt(process.env.MIN_VIRALITY_SCORE_TO_PUBLISH || '80');
  if (viralityScore < minPublish) return;
  if (combinedScore < STREAK_SCORE_THRESHOLD) return;

  const streaks = readJSON(WINNING_STREAK_PATH, []) || [];

  // No duplicar streaks activos del mismo topic+hookType
  const existingActive = streaks.find(
    (s) => s.topic === topic && s.hookType === hookType && s.variationsRemaining > 0,
  );
  if (existingActive) return;

  const expiry = new Date(Date.now() + STREAK_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  const newStreak = {
    id:                  `${Date.now()}_${topic}`,
    topic,
    hookType,
    triggerHook:         hook,
    basedOn:             { jobId, viralityScore, formatMatchScore, combinedScore: Math.round(combinedScore) },
    variationsRemaining: STREAK_VARIATIONS,
    anglesUsed:          [],
    startedAt:           new Date().toISOString(),
    expiresAt:           expiry,
  };

  streaks.unshift(newStreak);
  writeJSON(WINNING_STREAK_PATH, streaks.slice(0, 20)); // máx 20 streaks en historial

  logger.info(`Winning streak registered: topic=${topic} hookType=${hookType} score=${Math.round(combinedScore)} variations=${STREAK_VARIATIONS}`);
}

// ─────────────────────────────────────────────
//  DECISIÓN PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Decide qué producir a continuación.
 *
 * Prioridad:
 *   1. Winning streak activo
 *   2. Exploit (80%) — top topics por performance real
 *   3. Explore (20%) — topics sin probar
 *
 * @param {{ forceExplore?: boolean }} options
 */
function makeDecision(options = {}) {
  const { forceExplore = false, trendBias = null } = options;

  const analytics    = getFullAnalytics();
  const history      = readJSON(DECISION_HISTORY_PATH, []) || [];
  const recentTopics = getRecentProducedTopics(48);
  const recentHooks  = getRecentHooks(8);

  // ── Saturación de topics ──
  const topicCount = {};
  for (const t of recentTopics) topicCount[t] = (topicCount[t] || 0) + 1;
  const saturatedTopics = [
    ...Object.entries(topicCount).filter(([, n]) => n >= 2).map(([t]) => t),
    ...getCooldownTopics(), // topics en cooldown por rendimiento bajo
  ].filter((t, i, arr) => arr.indexOf(t) === i); // dedup

  // ── Performance real por topic ──
  const topicPerfMap = {};
  for (const tp of (analytics.topicPerformance || [])) {
    topicPerfMap[tp.topic] = tp;
  }

  // ═══════════════════════════════════════
  //  PRIORIDAD 1: WINNING STREAK
  // ═══════════════════════════════════════
  const activeStreak = getActiveStreak();
  if (activeStreak && !saturatedTopics.includes(activeStreak.topic)) {
    const topicAngles = TOPIC_ANGLES[activeStreak.topic] || ['comportamiento humano'];
    // Elegir un ángulo no usado en este streak
    const unusedAngles = topicAngles.filter((a) => !(activeStreak.anglesUsed || []).includes(a));
    const angle = unusedAngles.length > 0
      ? unusedAngles[Math.floor(Math.random() * unusedAngles.length)]
      : topicAngles[Math.floor(Math.random() * topicAngles.length)];

    consumeStreakVariation(activeStreak, angle);

    const decision = buildDecision({
      nextTopic:    activeStreak.topic,
      hookType:     activeStreak.hookType,
      angle,
      strategy:     'streak',
      confidence:   0.9,
      analytics,
      history,
      recentTopics,
      recentHooks,
      saturatedTopics,
      reasoning:    `Winning streak activo (${activeStreak.variationsRemaining - 1} variaciones restantes). Score base: ${activeStreak.basedOn.combinedScore}.`,
    });

    logger.info(`Decision Engine: STREAK | topic=${decision.nextTopic} hook=${decision.hookType} angle=${angle} remaining=${activeStreak.variationsRemaining - 1}`);
    saveDecision(decision, history);
    return decision;
  }

  // ═══════════════════════════════════════
  //  PERCENTIL 80: topics con patrones en el top 20% de scores
  //  → reciben boost directo, se explotan con variaciones automáticas
  // ═══════════════════════════════════════
  const allScores = (analytics.allVideos || [])
    .map((v) => v.virality_score || v.viralityScore || 0)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);

  const p80Threshold = allScores.length >= 5
    ? allScores[Math.floor(allScores.length * 0.8)]
    : 75; // sin datos suficientes usar el umbral de publicación como referencia

  // Set de topics con al menos un vídeo por encima del P80
  const p80Topics = new Set(
    (analytics.allVideos || [])
      .filter((v) => (v.virality_score || v.viralityScore || 0) >= p80Threshold)
      .map((v) => v.topic)
      .filter(Boolean),
  );

  // ═══════════════════════════════════════
  //  PRIORIDAD 2/3: EXPLOIT (80%) / EXPLORE (20%)
  // ═══════════════════════════════════════
  // Boost de tendencias: si trendBias contiene topics que coinciden con los disponibles
  const trendBoostSet = new Set(
    (trendBias || []).filter((t) => AVAILABLE_TOPICS.includes(t)),
  );

  const { getTopicWeight } = require('./context-learner');

  const candidates = AVAILABLE_TOPICS
    .filter((t) => !saturatedTopics.includes(t))
    .map((t) => {
      const perf           = topicPerfMap[t];
      const recencyPenalty = recentTopics.includes(t) ? -3 : 0;
      const p80Boost       = p80Topics.has(t) ? 5 : 0; // boost a topics con patrones ganadores reales
      const trendBoost     = trendBoostSet.has(t) ? 3 : 0; // boost a topics trending ahora
      // Boost/penalty basado en tasa de aceptación real del learning engine
      // ×1.3 → +6, ×1.0 → 0, ×0.7 → -6
      const learningBoost  = Math.round((getTopicWeight(t) - 1.0) * 20);
      const perfScore      = perf
        ? (perf.avgViews / 500 + perf.avgEngagement * 4 + (perf.avgScore || 0) * 0.1)
        : 2; // neutral sin datos
      return {
        topic:        t,
        score:        perfScore + recencyPenalty + p80Boost + trendBoost + learningBoost,
        perf,
        tested:       !!(perf && perf.count >= 2),
        isP80Winner:  p80Topics.has(t),
        isTrending:   trendBoostSet.has(t),
      };
    })
    .sort((a, b) => b.score - a.score);

  const tested   = candidates.filter((c) => c.tested);
  const untested = candidates.filter((c) => !c.tested);

  // 80/20: solo 20% de probabilidad de explorar si hay datos suficientes
  const shouldExplore = forceExplore || (untested.length > 1 && Math.random() < 0.20);

  let strategy = 'exploit';
  let chosen;

  if (shouldExplore && untested.length > 0) {
    strategy = 'explore';
    chosen = untested[Math.floor(Math.random() * Math.min(3, untested.length))];
  } else if (tested.length > 0) {
    // Preferir P80 winners; si no hay, top-3 con algo de aleatoriedad controlada
    const p80Winners = tested.filter((c) => c.isP80Winner);
    const pool = p80Winners.length > 0 ? p80Winners : tested.slice(0, 3);
    chosen = pool[Math.floor(Math.random() * pool.length)];
    if (chosen?.isP80Winner) strategy = 'exploit_p80';
  } else {
    strategy = 'explore';
    chosen = candidates[0] || { topic: AVAILABLE_TOPICS[0] };
  }

  const nextTopic = chosen?.topic || 'habits';

  // ── Hook type: top-hooks.json primero, luego context-learner, luego historial, luego pesos ──
  let hookType;

  // PRIORIDAD 0: top-hooks — si hay datos reales de rendimiento para este topic
  try {
    const TOP_HOOKS_PATH = path.resolve('./data/top-hooks.json');
    if (fs.existsSync(TOP_HOOKS_PATH)) {
      const topHooksData = JSON.parse(fs.readFileSync(TOP_HOOKS_PATH, 'utf8'));
      const topicHooks   = (topHooksData.hooks || []).filter(h => h.topic === nextTopic);
      if (topicHooks.length >= 2) {
        // Usar el hookType más frecuente en el top de este topic
        const htCount = {};
        for (const h of topicHooks) htCount[h.hookType] = (htCount[h.hookType] || 0) + 1;
        hookType = Object.entries(htCount).sort(([,a],[,b]) => b - a)[0][0];
        logger.info(`Decision Engine: hookType from top-hooks → ${hookType} (${topicHooks.length} top hooks for ${nextTopic})`);
      } else if (topHooksData.hookTypeSummary?.length > 0) {
        // Sin datos por topic, usar el mejor hookType global
        hookType = topHooksData.hookTypeSummary[0].hookType;
        logger.info(`Decision Engine: hookType from global top-hooks → ${hookType}`);
      }
    }
  } catch { /* top-hooks aún no generado */ }

  if (!hookType) {
    try {
      const { getBestHookTypeForTopic } = require('./context-learner');
      const learned = getBestHookTypeForTopic(nextTopic);
      if (learned && learned.confidence === 'high') {
        hookType = learned.hookType;
      }
    } catch { /* context-learner aún sin datos */ }

    if (!hookType) {
      const topicHistory = history.filter((d) => d.nextTopic === nextTopic && d.result?.avgViews > 0);
      if (topicHistory.length >= 2) {
        hookType = topicHistory.sort((a, b) => (b.result.avgViews || 0) - (a.result.avgViews || 0))[0].hookType;
      } else {
        hookType = pickWeighted(_abAdjustedHookWeights());
      }
    }
  } // end if (!hookType)

  // ── Ángulo: evita repetir los últimos en este topic ──
  const recentAnglesForTopic = history
    .filter((d) => d.nextTopic === nextTopic)
    .slice(0, 4)
    .map((d) => d.angle);
  const topicAngles    = TOPIC_ANGLES[nextTopic] || ['comportamiento humano'];
  const freshAngles    = topicAngles.filter((a) => !recentAnglesForTopic.includes(a));
  const angle          = freshAngles.length > 0
    ? freshAngles[Math.floor(Math.random() * freshAngles.length)]
    : topicAngles[Math.floor(Math.random() * topicAngles.length)];

  let reasoning = `Topic '${nextTopic}' por estrategia ${strategy}.`;
  if ((strategy === 'exploit' || strategy === 'exploit_p80') && chosen?.perf) {
    reasoning += ` Views promedio: ${Math.round(chosen.perf.avgViews || 0)}, engagement: ${chosen.perf.avgEngagement || 0}%.`;
  }
  if (strategy === 'exploit_p80') {
    reasoning += ` [PATRÓN P80 — score por encima del percentil 80, explotando variaciones]`;
  }
  if (chosen?.isTrending) {
    reasoning += ` [TRENDING — boosteado por señal de tendencia actual]`;
  }
  if (saturatedTopics.length > 0) {
    reasoning += ` Saturados evitados: ${saturatedTopics.join(', ')}.`;
  }

  const confidence = strategy === 'exploit_p80' ? 0.95
    : (strategy === 'exploit' && chosen?.tested ? 0.80 : 0.50);

  const decision = buildDecision({
    nextTopic, hookType, angle, strategy,
    confidence,
    analytics, history, recentTopics, recentHooks, saturatedTopics, reasoning,
    chosen,
  });

  logger.info(`Decision Engine: ${strategy} | topic=${nextTopic} | hook=${hookType} | trigger=${decision.emotionalTrigger} | conf=${decision.confidence}${chosen?.isP80Winner ? ' | P80✓' : ''}`);
  saveDecision(decision, history);
  return decision;
}

// ─────────────────────────────────────────────
//  HELPERS DE DECISIÓN
// ─────────────────────────────────────────────

function buildDecision({ nextTopic, hookType, angle, strategy, confidence, analytics, history, recentTopics, recentHooks, saturatedTopics, reasoning, chosen }) {
  // Emotional trigger: replica el más exitoso si hay datos, si no usa pesos
  const topicVideos = (analytics.allVideos || []).filter((v) => v.topic === nextTopic && v.max_views > 50);
  let emotionalTrigger;
  if (topicVideos.length > 0) {
    const best = topicVideos.sort((a, b) => b.max_views - a.max_views)[0];
    emotionalTrigger = best.emotionalTrigger || pickWeighted(EMOTIONAL_TRIGGER_WEIGHTS);
  } else {
    emotionalTrigger = pickWeighted(EMOTIONAL_TRIGGER_WEIGHTS);
  }

  return {
    nextTopic,
    hookType,
    emotionalTrigger,
    angle,
    avoidTopics:   saturatedTopics,
    avoidRecentHooks: recentHooks, // para que content-optimizer evite repetir hooks
    reasoning:     reasoning || '',
    confidence,
    strategy,
    decisionAt:    new Date().toISOString(),
  };
}

function saveDecision(decision, existingHistory) {
  const updated = [decision, ...(existingHistory || [])].slice(0, 150);
  writeJSON(DECISION_HISTORY_PATH, updated);
}

// ─────────────────────────────────────────────
//  API PÚBLICA
// ─────────────────────────────────────────────

function recordDecisionResult(decisionAt, result) {
  const history = readJSON(DECISION_HISTORY_PATH, []) || [];
  const idx = history.findIndex((d) => d.decisionAt === decisionAt);
  if (idx >= 0) {
    history[idx].result = result;
    writeJSON(DECISION_HISTORY_PATH, history);
    logger.info(`Decision Engine: result recorded for ${decisionAt}`);
  }
}

function getDecisionHistory(limit = 20) {
  return (readJSON(DECISION_HISTORY_PATH, []) || []).slice(0, limit);
}

function getActiveStreaks() {
  const streaks = readJSON(WINNING_STREAK_PATH, []) || [];
  const now = Date.now();
  return streaks.filter((s) => s.variationsRemaining > 0 && new Date(s.expiresAt).getTime() > now);
}

// ─────────────────────────────────────────────
//  ANÁLISIS DE PATRONES GANADORES
// ─────────────────────────────────────────────

function detectWinningPatterns() {
  const analytics = getFullAnalytics();
  const allVideos = analytics.allVideos || [];

  if (allVideos.length < 3) {
    return {
      patterns: [],
      gaps: AVAILABLE_TOPICS.slice(0, 5),
      topTopics: [],
      topTriggers: [],
      topHookTypes: [],
      topAvgDuration: 28,
      scoreCorrelation: 'SIN_DATOS',
      activeStreaks: getActiveStreaks(),
      insights: 'Datos insuficientes. Publica al menos 3 vídeos para activar el aprendizaje.',
    };
  }

  const published = allVideos.filter((v) => v.max_views >= 0);
  const half      = Math.ceil(published.length / 2);
  const sorted    = [...published].sort((a, b) => b.max_views - a.max_views);
  const topHalf   = sorted.slice(0, half);
  const bottomHalf = sorted.slice(half);

  const topTopics = [...new Set(topHalf.map((v) => v.topic))].slice(0, 3);

  const triggerMap = {};
  for (const v of topHalf) {
    if (v.emotionalTrigger) triggerMap[v.emotionalTrigger] = (triggerMap[v.emotionalTrigger] || 0) + 1;
  }
  const topTriggers = Object.entries(triggerMap).sort(([, a], [, b]) => b - a).slice(0, 3).map(([t]) => t);

  const topAvgDuration = Math.round(
    topHalf.reduce((s, v) => s + (v.durationSeconds || 28), 0) / (topHalf.length || 1),
  );

  const topAvgScore    = topHalf.reduce((s, v) => s + (v.virality_score || 0), 0) / (topHalf.length || 1);
  const bottomAvgScore = bottomHalf.length
    ? bottomHalf.reduce((s, v) => s + (v.virality_score || 0), 0) / bottomHalf.length : 0;
  const scoreCorrelation = topAvgScore > bottomAvgScore + 10 ? 'ALTA' : 'MEDIA';

  const topicTried = {};
  for (const v of published) topicTried[v.topic] = (topicTried[v.topic] || 0) + 1;
  const gaps = AVAILABLE_TOPICS.filter((t) => !topicTried[t] || topicTried[t] < 2);

  // Percentil 80 de scores para detectar patrones premium
  const allScoresSorted = published
    .map((v) => v.virality_score || v.viralityScore || 0)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  const p80Idx   = Math.floor(allScoresSorted.length * 0.8);
  const p80Score = allScoresSorted[p80Idx] || 0;
  const p80TopicsArr = [...new Set(
    published
      .filter((v) => (v.virality_score || v.viralityScore || 0) >= p80Score && p80Score > 0)
      .map((v) => v.topic).filter(Boolean),
  )];

  return {
    patterns: [
      `Top temas: ${topTopics.join(', ') || 'sin datos'}`,
      `Triggers que funcionan: ${topTriggers.join(', ') || 'sin datos'}`,
      `Duración promedio top vídeos: ${topAvgDuration}s`,
      `Score promedio top: ${Math.round(topAvgScore)} vs bottom: ${Math.round(bottomAvgScore)}`,
      `Correlación score → views: ${scoreCorrelation}`,
      `Patrones P80 (top 20%): ${p80TopicsArr.join(', ') || 'sin datos'}`,
    ],
    gaps,
    topTopics,
    topTriggers,
    topAvgDuration,
    scoreCorrelation,
    p80Score,
    p80Topics: p80TopicsArr,
    activeStreaks: getActiveStreaks(),
    insights: `${published.length} vídeos analizados. ${topTopics.length > 0 ? `Mejor categoría: ${topTopics[0]}` : 'Sin datos por tema todavía'}. ${p80TopicsArr.length > 0 ? `Patrones P80 activos: ${p80TopicsArr.join(', ')}.` : ''}`,
  };
}

/**
 * Ajusta HOOK_TYPE_WEIGHTS con aprendizaje de A/B winners.
 * Por cada hookType con businessWins/total > 0.5 sube el peso +2.
 * Por cada hookType con businessWins/total < 0.2 baja el peso -1 (mín 1).
 */
function _abAdjustedHookWeights() {
  const weights = { ...HOOK_TYPE_WEIGHTS };
  try {
    const AB_WINNERS_PATH = path.resolve('./data/tracking/ab-winners.json');
    if (!fs.existsSync(AB_WINNERS_PATH)) return weights;
    const { abWinners } = JSON.parse(fs.readFileSync(AB_WINNERS_PATH, 'utf8'));
    const insights = {};
    for (const w of (abWinners || [])) {
      if (!w.shouldTransferLearning || !w.winnerHookType) continue;
      if (!insights[w.winnerHookType]) insights[w.winnerHookType] = { biz: 0, total: 0 };
      insights[w.winnerHookType].total++;
      if (w.winnerType === 'business_priority' || w.winnerType === 'views_and_business') {
        insights[w.winnerHookType].biz++;
      }
    }
    for (const [ht, data] of Object.entries(insights)) {
      if (!data.total) continue;
      const ratio = data.biz / data.total;
      if (ratio >= 0.5) weights[ht] = (weights[ht] || 1) + 2;
      else if (ratio < 0.2) weights[ht] = Math.max(1, (weights[ht] || 1) - 1);
    }
    const adjusted = Object.entries(insights).map(([ht, d]) => `${ht}:${d.biz}/${d.total}`).join(' ');
    if (adjusted) logger.info(`Decision Engine: A/B hookType adjustment | ${adjusted}`);
  } catch { /* sin datos A/B aún */ }
  return weights;
}

module.exports = {
  makeDecision,
  recordDecisionResult,
  getDecisionHistory,
  detectWinningPatterns,
  registerWinningStreak,
  getActiveStreaks,
};
