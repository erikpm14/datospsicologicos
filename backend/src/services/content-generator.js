/**
 * content-generator.js
 * Genera guiones virales con Claude.
 * Proceso interno en una sola llamada:
 *   1. Analiza y selecciona los datos psicológicos con mayor potencial viral
 *   2. Construye el guión optimizado sobre el dato elegido
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { scoreScript } = require('../utils/virality-scorer');
const hooksData = require('../templates/psychology-hooks.json');
const { parseModelJsonWithRecovery } = require('../utils/llm-json');
const { callAnthropicWithTimeout, createLlmMetrics, mergeLlmMetrics, markLlmHardFail, attachLlmMetrics } = require('../utils/llm-call');
const { validateGeneratedScriptSchema, saveLastValidScript } = require('../utils/script-fallback');
const { buildSceneVisualPrompt, buildUnifiedVideoStyle, normalizeVideoInstructions } = require('../utils/visual-style-system');
const logger = require('../utils/logger');
const { createPerfTracker, formatDurationMs } = require('../utils/perf-tracker');
// HOOK QUALITY SYSTEM
const { selectTopHooks, improveHook } = require('./hook-quality-filter');
const { validateHookConfessional, applyHookPenalty } = require('./hook-validator.service');
const { validateVideoV4 } = require('../contracts/video-v4.contract');
const { scoreHumanity } = require('../utils/humanity-scorer');
const { getOptimizationContext } = require('./insights-optimizer.service');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const COMPACT_SCRIPT_SCHEMA = `{
  "title": "slug_corto",
  "topic": "topic_preferiblemente_relationships_o_habits",
  "hook": "max 10 palabras - OBSERVABLE + TEMPORAL + MICRO-CAMBIO",
  "open_loop": "10-15 palabras - hace pensar 'esto me pasa'",
  "micro_value": "12-18 palabras - nombre el patron",
  "escalation": "20-30 palabras - ejemplos concretos",
  "reengage": "8-14 palabras - golpe emocional",
  "peak": "20-32 palabras - validacion + revelacion",
  "open_ending": "8-14 palabras - reflexion",
  "soft_cta": "7-12 palabras - invitacion suave",
  "effectName": "NOMBRE DEL PATRON O EFECTO",
  "psychologicalFact": "1 frase breve",
  "viralTrigger": "identificacion (PREFERIDO) | sorpresa | utilidad",
  "emotionalTrigger": "validation (OBLIGATORIO - NO curiosity NI urgency)",
  "keywords": ["keyword1", "keyword2"]
}`;
const SEGMENT_KEYS = ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'];
const REENGAGE_TEMPLATE_PATTERN = /\b(aqu[ií]\s+viene\s+lo\s+importante|esto\s+cambia\s+todo|aqu[ií]\s+viene\s+lo\s+que\s+nadie\s+te\s+dice|esto\s+es\s+lo\s+m[aá]s\s+importante)\b/i;

// Hook variety system: track last 10 to avoid repetition
let recentHooks = [];
const MAX_RECENT_HOOKS = 10;

/**
 * Registra un hook en el historial para evitar repetición
 */
function addRecentHook(hook) {
  const normalized = String(hook || '').toLowerCase().trim();
  recentHooks.push(normalized);
  if (recentHooks.length > MAX_RECENT_HOOKS) {
    recentHooks.shift();
  }
}

/**
 * Chequea si un hook ya fue generado recientemente
 */
function isHookRecent(hook) {
  const normalized = String(hook || '').toLowerCase().trim();
  return recentHooks.includes(normalized);
}

/**
 * Genera challenge/confrontation hooks (preguntas retóricas con validación)
 * 40% probabilidad de estos; 60% observable
 * Patrón: pregunta íntima + validación sutil + identificación personal
 *
 * REGLAS:
 * - Íntimo, NO dramático
 * - Dudas internas, NO amenazas
 * - Cambios sutiles, NO juicios morales
 * - Validación, NO manipulación
 */
function generateChallengeHooks(topic = 'relationships') {
  const questions = [
    '¿Cuándo empezaste a dudar de',
    '¿Por qué haces como que',
    '¿Y si no era',
    '¿Por qué buscas',
    '¿Qué sucede cuando te permites',
    '¿Cuándo fue la última vez que',
    '¿Y si ese miedo es',
    '¿Por qué eliges',
  ];

  const validationClauses = [
    'lo que realmente sentías?',
    'no pasa nada?',
    'intuición sino costumbre?',
    'calma en quien te altera?',
    'sentir sin explicar por qué?',
    'te escuchaste a ti mismo?',
    'en realidad protección?',
    'quedarte donde duele?',
  ];

  const hooks = [];
  for (let i = 0; i < 3; i++) {
    const question = questions[i % questions.length];
    const clause = validationClauses[i % validationClauses.length];
    const hook = `${question} ${clause}`;

    if (!isHookRecent(hook) && !hooks.some(h => h.hook === hook)) {
      hooks.push({
        hook,
        type: 'challenge_confrontation',
        question,
        clause,
      });
    }
  }

  return hooks;
}

/**
 * Genera 5 variantes del patrón ganador de hook
 * 40% challenge_confrontation, 60% observable
 */
function generateHookVariants(topic = 'relationships') {
  const verbs = ['Mira', 'Fíjate', 'Nota', 'Observa', 'Ve', 'Escucha'];

  const microSignals = [
    'algo pequeño te cambie el cuerpo',
    'alguien tarda distinto en responderte',
    'una frase te deja incómodo sin saber por qué',
    'alguien te da paz y luego te la quita',
    'algo sutil en su tono cambia todo',
    'alguien elige sus palabras diferente',
    'necesitas buscar confirmación sin darte cuenta',
    'algo te hace dudar de ti mismo',
    'alguien te valida justo para romper',
    'la forma de una frase te duele diferente',
    'una persona cambia cuando comparte algo',
    'alguien guarda silencio cuando debería hablar',
    'tu cuerpo se tensa con una pregunta específica',
    'alguien cuenta su verdad de distinto modo',
    'una pausa significa todo',
  ];

  const connectors = ['cuando', 'justo antes de', 'justo después de'];

  // Determinar mix: 40% challenge, 60% observable
  const challengeCount = Math.ceil(5 * 0.4);  // 2 de 5
  const observableCount = 5 - challengeCount; // 3 de 5

  const variants = [];

  // 1. Agregar challenge hooks
  if (Math.random() < 0.4 || challengeCount > 0) {
    const challengeHooks = generateChallengeHooks(topic);
    for (let i = 0; i < Math.min(challengeCount, challengeHooks.length); i++) {
      const ch = challengeHooks[i];
      if (!isHookRecent(ch.hook) && !variants.some(v => v.hook === ch.hook)) {
        variants.push({
          ...ch,
          variety: variants.length,
        });
      }
    }
  }

  // 2. Agregar observable hooks para completar 5
  for (let i = 0; i < observableCount && variants.length < 5; i++) {
    const verb = verbs[i % verbs.length];
    const signal = microSignals[(i * 3) % microSignals.length];
    const connector = connectors[i % connectors.length];

    const hook = `${verb} esto ${connector} ${signal}.`;

    if (!isHookRecent(hook) && !variants.some(v => v.hook === hook)) {
      variants.push({
        hook,
        type: 'observable',
        verb,
        signal,
        connector,
        variety: variants.length,
      });
    }
  }

  // 3. Si aún faltan variantes, generar más aleatorias
  while (variants.length < 5) {
    // 50% chance de challenge o observable para llenar
    if (Math.random() < 0.5) {
      const challengeHooks = generateChallengeHooks(topic);
      const ch = challengeHooks[Math.floor(Math.random() * challengeHooks.length)];
      if (!isHookRecent(ch.hook) && !variants.some(v => v.hook === ch.hook)) {
        variants.push({
          ...ch,
          variety: variants.length,
        });
      }
    } else {
      const randomVerb = verbs[Math.floor(Math.random() * verbs.length)];
      const randomSignal = microSignals[Math.floor(Math.random() * microSignals.length)];
      const randomConnector = connectors[Math.floor(Math.random() * connectors.length)];
      const hook = `${randomVerb} esto ${randomConnector} ${randomSignal}.`;

      if (!isHookRecent(hook) && !variants.some(v => v.hook === hook)) {
        variants.push({
          hook,
          type: 'observable',
          verb: randomVerb,
          signal: randomSignal,
          connector: randomConnector,
          variety: variants.length,
        });
      }
    }
  }

  return variants.slice(0, 5);
}

/**
 * Puntúa cada variante de hook por: brevedad, conversacionalidad, especificidad, identificabilidad
 * Valida que challenge hooks tengan contenido real (no clickbait)
 */
function scoreHookVariant(variant = {}) {
  let score = 50; // Base score
  const hook = variant.hook || '';
  const type = variant.type || 'observable';

  // Brevedad óptima (8-12 palabras)
  const wordCount = hook.split(/\s+/).length;
  if (wordCount >= 8 && wordCount <= 12) score += 20;
  else if (wordCount >= 7 && wordCount <= 13) score += 10;
  else score -= 10;

  if (type === 'observable') {
    // Observable hook scoring
    // Tiene "cuando" o "justo" = temporal
    if (/cuando|justo/.test(hook.toLowerCase())) score += 15;

    // Tiene micro-signal keywords
    if (/pequeño|tarda|frase|paz|tono|palabras|validación|dudar|rompe/.test(hook.toLowerCase())) score += 15;

    // Conversacionalidad: empieza con verbo observable
    if (/^(mira|fíjate|nota|observa|ve)\s/i.test(hook)) score += 10;

    // VARIEDAD: bonus para verbos menos comunes
    const verb = (variant.verb || '').toLowerCase();
    if (verb === 'fíjate' || verb === 'nota') score += 5;
  } else if (type === 'challenge_confrontation') {
    // Challenge hook scoring — íntimo, NO dramático
    // Debe tener identificación personal
    if (/\b(tu|tú|ti|mi|me|nos|nos|vos|tuyos)\b/i.test(hook)) score += 15;

    // Debe tener palabras de validación/duda interna (no judgement)
    if (/dudar|intuición|costumbre|sientes|permites|escuchaste|miedo|protección|sentir/i.test(hook)) score += 15;

    // Debe ser pregunta genuina (no sensacionalismo)
    if (/^¿/i.test(hook) && /\?$/.test(hook)) score += 10;

    // PENALIZAR: tono dramático/manipulador
    if (/mentira|verdad|amenaza|peligro|secreto|jamás|nunca|siempre|explotar|revelaci[óo]n/i.test(hook)) score -= 20;

    // PENALIZAR: tono de gurú/moralista
    if (/deberías|tienes que|necesitas|obligado|culpa|pecado|malo|bueno|correcto|incorrecto/i.test(hook)) score -= 15;

    // BONUS: tono íntimo/vulnerable
    if (/por qué|y si|qué sucede|cuándo|última vez|dudar|como que|haces como/i.test(hook)) score += 10;

    // BONUS: cambios sutiles/contradicciones personales
    if (/costumbre|cambio|diferente|otra forma|sin notarlo|sin darte cuenta/i.test(hook)) score += 5;
  }

  // Nunca tiene palabras artificiales/académicas
  if (!/deliberadamente|conscientemente|automáticamente|emocionalmente|según[\s]*la[\s]*ciencia/.test(hook.toLowerCase())) score += 5;

  return Math.min(100, Math.max(0, score));
}

async function requestJsonRecovery(prompt, rawText, label, llmMetrics, maxTokens = 450) {
  logger.warn(`${label}: requesting clean JSON recovery from model`);
  llmMetrics.llm_total_calls += 1;
  const recovery = await callAnthropicWithTimeout(client, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: `${prompt}\n\nLa respuesta anterior no era JSON valido y puede estar truncada. Reconstruye una version MAS CORTA.\nDevuelve SOLO JSON VALIDO. Sin markdown. Sin fences. Sin comentarios. Sin texto antes ni despues.\nUsa SOLO este esquema minimo:\n${COMPACT_SCRIPT_SCHEMA}\nLimites duros: hook<=9, open_loop<=15, micro_value<=18, escalation<=30, reengage<=14, peak<=32, open_ending<=14, soft_cta<=12, psychologicalFact<=16, keywords=2, hashtags=3.\n\nRESPUESTA ANTERIOR:\n${String(rawText || '').slice(0, 3000)}`,
    }],
  }, { label: `${label}.recovery` });
  return recovery.content?.[0]?.text?.trim() || '';
}

function soundsSpoken(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  if (/^\s*\d+[.)-]/.test(normalized)) return false;
  if (/[;()[\]{}]/.test(normalized)) return false;
  if (/\bprimero\b|\bsegundo\b|\btercero\b|\ben primer lugar\b|\ben segundo lugar\b/i.test(normalized)) return false;
  if (/\bpor ejemplo:\b|\besto significa:\b|\bla raz[oó]n es:\b/i.test(normalized)) return false;
  return true;
}

function buildFullScriptText(script = {}) {
  return SEGMENT_KEYS.map((key) => script[key]).filter(Boolean).join(' ').trim();
}

function buildVideoInstructions(script = {}) {
  const style = buildUnifiedVideoStyle(script);
  return {
    singleFocus: true,
    visualStyle: [
      'estetica cinematografica oscura',
      'fondo negro o casi negro',
      'alto contraste con azul electrico dominante',
      'acento rojo oscuro solo para tension',
      'single focus constante sin overlays complejos',
      'cambio de plano cada 2-3 segundos',
      'zoom progresivo y movimiento suave',
    ],
    subtitleStyle: 'tipografia condensada bold, blanco frio con acentos azul electrico y rojo oscuro, subtitulos grandes y sincronizados',
    audioStyle: {
      voice: 'voz clara y con ritmo',
      pauses: ['hook', 'reengage', 'peak'],
    },
    scenes: [
      { segment: 'hook', timing: '0-2s', visual: buildSceneVisualPrompt('hook', script), cut: 'corte rapido con push-in' },
      { segment: 'open_loop', timing: '2-5s', visual: buildSceneVisualPrompt('open_loop', script), cut: 'zoom corto continuo' },
      { segment: 'micro_value', timing: '5-10s', visual: buildSceneVisualPrompt('micro_value', script), cut: 'cambio de plano limpio' },
      { segment: 'escalation', timing: '10-20s', visual: buildSceneVisualPrompt('escalation', script), cut: 'cortes cada 2-3s' },
      { segment: 'reengage', timing: '20-25s', visual: buildSceneVisualPrompt('reengage', script), cut: 'cambio brusco + zoom agresivo' },
      { segment: 'peak', timing: '25-40s', visual: buildSceneVisualPrompt('peak', script), cut: 'alternancia de planos cerrados' },
      { segment: 'open_ending', timing: '40-50s', visual: buildSceneVisualPrompt('open_ending', script), cut: 'desaceleracion ligera' },
      { segment: 'soft_cta', timing: '50-60s', visual: buildSceneVisualPrompt('soft_cta', script), cut: 'ultimo corte limpio' },
    ],
    style,
    clipKeywords: style.clipKeywords,
  };
}

function enrichScriptOutput(script = {}) {
  script.fullScript = script.fullScript || buildFullScriptText(script);
  script.videoInstructions = normalizeVideoInstructions(script, script.videoInstructions || buildVideoInstructions(script));
  return script;
}

const SYSTEM_PROMPT = `ERES UN ESCRITOR DE EXPERIENCIAS PERSONALES, NO UN PROFESOR.

Tu trabajo: hacer que alguien vea el video y piense "esto me pasa a mí",
no "esto es interesante".

MENTALIDAD CORRECTA:
Estás DESCRIBIENDO qué le pasa a la gente.
NO ESTÁS EXPLICANDO cómo funciona algo.

❌ PROHIBIDO (enfoque explicativo/educativo):
- Definiciones ("se llama...", "es un patrón...")
- Mecanismos ("tu cerebro...", "esto funciona porque...")
- Conceptos técnicos ("procesamiento", "amígdala", "neurociencia")
- Tono de enseñanza ("debes saber que...", "la verdad es que...")
- Frases tipo blog/artículo

✅ OBLIGATORIO (enfoque experiencial):
- Comportamientos que la gente vive ("por eso haces esto")
- Situaciones reconocibles ("cuando alguien...")
- Sentimientos sin explicarlos ("te duele sin entender por qué")
- Tono como hablando a un amigo ("fíjate en esto")

ESTRUCTURA (8 partes):
1. HOOK: observación personal observable ("mira esto cuando...")
2. OPEN_LOOP: "esto me pasa" — reconocimiento inmediato
3. MICRO_VALUE: nombra qué pasa (NO cómo funciona) — "buscas confirmación sin darte cuenta"
4. ESCALATION: más ejemplos reales de comportamiento personal (sin teoría)
5. REENGAGE: golpe emocional — incomodidad que reconoce
6. PEAK: validación FUERTE — "por eso reaccionas así" (causas personales, no neurocencia)
7. OPEN_ENDING: reflexión que resuena
8. SOFT_CTA: invitación suave a reconocerse

EJEMPLOS CORRECTOS vs INCORRECTOS:

❌ "Tu cerebro tiene una región llamada amígdala que procesa el miedo"
✅ "Por eso reaccionas antes de pensar en eso"

❌ "Se llama síndrome de hipervigilancia emocional"
✅ "Necesitas buscar confirmación sin darte cuenta"

❌ "Estudios demuestran que el 78% de personas..."
✅ "Casi todos hacen esto cuando se sienten ignorados"

❌ "Tu corteza prefrontal llega tarde al juego"
✅ "Reaccionas y luego piensas"

REQUISITO FINAL:
- Cada frase DEBE poder reconocerla el espectador en sí mismo
- Si algo explica un concepto, REESCRIBE como comportamiento personal
- Suena como alguien describiendo qué hace la gente, no un TED Talk

Devuelve SOLO JSON valido. Sin markdown. Sin fences.`;

/**
 * Valida que el script sea identificable por 80% de audiencia
 * Penaliza hooks genéricos, teóricos o muy específicos
 */
function validateIdentificationScore(script = {}, topic = null) {
  const hook = String(script.hook || '').toLowerCase();

  // Patrones de identificación GANADORES
  const goodPatterns = [
    /fíjate|mira|nota|observa|ves|cuando/,
    /algo pequeño|cambio|pausa|gesto|tono/,
    /te|tu|cuando|justo/,
  ];

  // Patrones MALOS (teóricos, neurociencia, abstractos)
  const badPatterns = [
    /tu cerebro|tu mente|el \d+%|estudios demuestran|la verdad sobre/,
    /no puedes|nunca|siempre|imposible/,
    /conscientemente|deliberadamente|automáticamente|emocionalmente/,
    /patrón|mecanismo|teoría|científicamente/,
    /cerebro|neurona|amígdala|corteza|prefrontal|neurociencia|dopamina|sinapsis/,
    /procesamiento|señal|circuito|activación|investig/,
  ];

  let identificationScore = 50; // Base score

  // Revisar patrones buenos
  const goodMatches = goodPatterns.filter(p => p.test(hook)).length;
  identificationScore += goodMatches * 15; // +15 por cada patrón bueno

  // Revisar patrones malos
  const badMatches = badPatterns.filter(p => p.test(hook)).length;
  identificationScore -= badMatches * 20; // -20 por cada patrón malo

  // Longitud del hook (más corto es mejor para identificación)
  const hookWords = hook.split(/\s+/).length;
  if (hookWords <= 8) identificationScore += 10;
  else if (hookWords > 12) identificationScore -= 15;

  // Asignar score
  script.identificationScore = Math.max(0, Math.min(100, identificationScore));

  // Si score es muy bajo, loguear warning
  if (identificationScore < 50) {
    logger.warn(`LOW IDENTIFICATION SCORE: ${identificationScore} | hook="${script.hook}"`);
    script.generationWarnings = script.generationWarnings || [];
    script.generationWarnings.push(`identification_low: ${identificationScore}`);
  }

  return script;
}

function selectHook(topic = null) {
  // Prioridad ALTA: topics ganadores en tu canal
  const PRIORITY_TOPICS = ['relationships', 'habits', 'social_patterns', 'body_language', 'emotional_patterns'];

  // Penalizar: topics que no escalan
  const AVOID_TOPICS = ['cognitive_biases', 'decision_making', 'attention', 'productivity', 'memory'];

  let hooks = topic
    ? hooksData.hooks.filter((h) => h.topic === topic)
    : hooksData.hooks;

  // Si no hay topic especificado, prioriza PRIORITY_TOPICS
  if (!topic) {
    const priorityHooks = hooks.filter((h) => PRIORITY_TOPICS.includes(h.topic));
    // 70% de chance de usar topic prioritario
    if (priorityHooks.length > 0 && Math.random() < 0.7) {
      hooks = priorityHooks;
    }
  }

  // Penalizar AVOID_TOPICS: baja probabilidad
  const nonAvoidHooks = hooks.filter((h) => !AVOID_TOPICS.includes(h.topic));
  if (nonAvoidHooks.length > 0 && Math.random() < 0.6) {
    hooks = nonAvoidHooks;
  }

  return hooks[Math.floor(Math.random() * hooks.length)];
}

/**
 * ═════════════════════════════════════════════════════════════
 * WINNERS EXPLOITATION: 70/30 Strategy
 * ═════════════════════════════════════════════════════════════
 */

/**
 * Decide entre EXPLOIT (70%) o EXPLORE (30%)
 */
function decideExploitationStrategy() {
  const exploit = Math.random() < 0.7;
  return exploit ? 'EXPLOIT' : 'EXPLORE';
}

/**
 * Seleccionar topic usando contexto de optimización
 */
function selectTopicWithInsights(strategy, optContext) {
  if (strategy === 'EXPLORE' || !optContext.available || !optContext.recommendations.useTopics) {
    return null; // Usar flujo normal
  }

  // EXPLOIT: usar preferredTopics
  if (optContext.preferredTopics.length > 0) {
    const topic = optContext.preferredTopics[Math.floor(Math.random() * optContext.preferredTopics.length)];
    return topic;
  }

  return null; // Fallback a flujo normal
}

/**
 * Validar que topic no está en avoidTopics
 */
function isTopicAllowed(topic, optContext) {
  if (!optContext.available || !optContext.recommendations.avoidTopics) {
    return true;
  }

  if (optContext.avoidTopics.includes(topic)) {
    logger.debug(`Topic "${topic}" filtered (AVOID)`);
    return false;
  }

  return true;
}

/**
 * Obtener inspiración de bestHooks
 */
function getHookInspirationFromWinners(optContext) {
  if (!optContext.available || !optContext.recommendations.useHooks || optContext.bestHooks.length === 0) {
    return null;
  }

  // Retornar uno de los hooks ganadores como inspiración
  const winnerHook = optContext.bestHooks[Math.floor(Math.random() * optContext.bestHooks.length)];
  return winnerHook?.hook || null;
}

async function generateScript(options = {}) {
  const { topic, hookId } = options;
  const perf = createPerfTracker('content-generator');
  const llmMetrics = createLlmMetrics();

  // ═════════════════════════════════════════════════════════════
  // WINNERS EXPLOITATION: 70/30 Strategy
  // ═════════════════════════════════════════════════════════════
  const strategy = decideExploitationStrategy();
  const optContext = getOptimizationContext();

  // Intentar seleccionar topic desde WINNERS si EXPLOIT
  let finalTopic = topic;
  let exploitedTopic = null;

  if (!finalTopic && strategy === 'EXPLOIT') {
    const insightTopic = selectTopicWithInsights(strategy, optContext);
    if (insightTopic && isTopicAllowed(insightTopic, optContext)) {
      finalTopic = insightTopic;
      exploitedTopic = insightTopic;
    }
  }

  // Fallback a 'relationships' si no se especifica (patrón ganador)
  finalTopic = finalTopic || 'relationships';

  const baseHook = hookId
    ? hooksData.hooks.find((h) => h.id === hookId)
    : selectHook(finalTopic);

  // VARIEDAD CONTROLADA: Generar 5 variantes de hook y elegir una NO-RECIENTE
  let selectedHookText = '';
  let hookVariety = 'template';

  // SIEMPRE generar variantes para relationships/habits/social_patterns/body_language
  if (!hookId && ['relationships', 'habits', 'social_patterns', 'body_language'].includes(finalTopic)) {
    // Generar 5 variantes del patrón ganador
    const variants = generateHookVariants(finalTopic);
    const scoredVariants = variants
      .map((v) => ({ ...v, score: scoreHookVariant(v) }))
      .sort((a, b) => b.score - a.score);

    // ═══════════════════════════════════════════════════════════════
    // HOOK QUALITY VALIDATION — Filtrar por criterios confesionales
    // ═══════════════════════════════════════════════════════════════
    const confessionalVariants = scoredVariants.map(v => {
      const validation = validateHookConfessional(v.hook);
      return { ...v, validation, confessionalScore: validation.score };
    });

    // PRIORIDAD: hooks confesionales válidos (score >= 70)
    const validConfessional = confessionalVariants.filter(v => v.validation.score >= 70);
    const allValid = confessionalVariants.filter(v => v.validation.valid);

    let selectedVariant = null;

    // Estrategia 1: Seleccionar mejor hook confesional no-reciente
    if (validConfessional.length > 0) {
      const nonRecent = validConfessional.filter(v => !isHookRecent(v.hook));
      selectedVariant = nonRecent.length > 0 ? nonRecent[0] : validConfessional[0];
      logger.info(`✓ Hook confesional válido selected | confScore=${selectedVariant.confessionalScore} | priority=${selectedVariant.validation.priority}`);
    }
    // Estrategia 2: Si no hay válidos, intentar mejorar el mejor
    else if (allValid.length > 0) {
      const best = allValid[0];
      const improved = improveHook(best.hook, finalTopic, best.score);
      if (improved.improved) {
        selectedVariant = {
          ...best,
          hook: improved.hook,
          validation: improved.validation,
          confessionalScore: improved.validation.score,
        };
        logger.warn(`Hook mejorado (genérico → confesional) | original="${best.hook.substring(0, 40)}" | new="${selectedVariant.hook.substring(0, 40)}"`);
      }
    }
    // Estrategia 3: Si nada válido, rechazar y usar fallback
    else if (scoredVariants.length > 0) {
      logger.error(`❌ No valid confessional hooks | all scores < 70 | using fallback`);
      selectedVariant = null; // Forzar fallback
    }

    // Usar selectedVariant si es válido
    if (selectedVariant && selectedVariant.validation.score >= 70 && !isHookRecent(selectedVariant.hook)) {
      selectedHookText = selectedVariant.hook;
      hookVariety = `variant_${selectedVariant.variety}_confessional`;
      logger.info(`Hook variety selected | hook="${selectedHookText.substring(0, 50)}" | confScore=${selectedVariant.confessionalScore} | variety=${hookVariety}`);
    }
  }

  // Fallback: usar hook del template si no se generó variante
  if (!selectedHookText) {
    selectedHookText = baseHook?.text || 'Mira esto cuando algo pequeño te cambie el cuerpo.';
    hookVariety = 'template_fallback';
  }

  // Registrar el hook para evitar repetición
  addRecentHook(selectedHookText);

  // Log de estrategia 70/30
  logger.info(`GEN_STRATEGY | ${strategy} | topic=${exploitedTopic ? 'from-winners' : 'fallback'} | confidence=${optContext.confidence}%`);

  logger.info(`Generating script | Topic: ${finalTopic} | Hook variety: ${hookVariety}`);

  const userPrompt = `Tema: ${baseHook?.topic || topic || 'relationships'}

**HOOK OBLIGATORIO (NO GENERES OTRO)**: "${selectedHookText}"

Este hook DEBE usarse exactamente como está escrito.

CRITICO - MENTALIDAD:
Este video NO es educativo. NO enseña conceptos.
Estás DESCRIBIENDO qué le pasa a la gente. Punto.

Cada frase debe sonar como alguien diciendo:
"Fíjate, tú haces esto" o "Por eso reaccionas así"

NO COMO:
"Aquí te explico cómo funciona algo"
"Tu cerebro hace esto"
"Se llama tal cosa"
"Esto es importante porque..."

ESTRUCTURA - EXPERIENCIA PERSONAL:
1. HOOK: observación de comportamiento personal pequeño
2. OPEN_LOOP: "esto me pasa" — deben reconocerse AHORA
3. MICRO_VALUE: nombra lo que PASA, no cómo funciona
   ✅ "Buscas confirmación sin darte cuenta"
   ❌ "Es una necesidad psicológica de validación"
4. ESCALATION: más situaciones REALES donde pasa esto (sin explicar)
5. REENGAGE: golpe emocional reconocible
6. PEAK: validación fuerte
   ✅ "Por eso haces eso cuando..."
   ❌ "Tu cerebro está programado para..."
7. OPEN_ENDING: reflexión que resuena
8. SOFT_CTA: invitación suave

PROHIBICIONES (NO INCLUYAS):
❌ Definiciones ("se llama...", "es un...")
❌ Explicaciones de mecanismos ("tu cerebro...", "esto funciona...")
❌ Conceptos técnicos ("procesamiento", "circuito", "amígdala")
❌ Tono de enseñanza ("debes saber", "la verdad es")
❌ Porcentajes o "estudios demuestran"
❌ Frases que expliquen EN LUGAR DE DESCRIBIR

Objetivo:
- 40-55 segundos
- Suena como alguien hablándote de qué haces
- El espectador piensa "esto me pasa a mí"
- NO piensa "esto es interesante/informativo"
- emotionalTrigger DEBE ser: validation

Devuelve EXACTAMENTE este JSON (usa el hook proporcionado arriba):
${COMPACT_SCRIPT_SCHEMA}`;

  try {
    logger.debug('Claude API call');

    perf.start('model_call');
    llmMetrics.llm_total_calls += 1;
    const message = await callAnthropicWithTimeout(client, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }, { label: 'content-generator.generateScript' });
    const modelPhase = perf.end({ model: 'claude-haiku-4-5-20251001' });

    const rawText = message.content[0].text.trim();
    perf.start('json_parse');
    const { data: script, meta: parseMeta } = await parseModelJsonWithRecovery(rawText, {
      label: 'content-generator.generateScript',
      recover: (failedRaw) => requestJsonRecovery(userPrompt, failedRaw, 'content-generator.generateScript', llmMetrics),
      validate: (data) => validateGeneratedScriptSchema(data, { label: 'content-generator.generateScript', requireExpanded: true }),
    });
    mergeLlmMetrics(llmMetrics, parseMeta);
    const parsePhase = perf.end(parseMeta);

    // CRITICO: FORZAR el hook seleccionado (no permitir que Claude lo cambie)
    if (selectedHookText && selectedHookText !== script.hook) {
      logger.warn(`Hook mismatch | expected="${selectedHookText}" | got="${script.hook}" | FORCING selected hook`);
      script.hook = selectedHookText;
    } else if (selectedHookText) {
      logger.info(`Hook match | "${selectedHookText}"`);
    }

    // ═══════════════════════════════════════════════════════════════
    // HOOK QUALITY VALIDATION — Validar confesionalidad final
    // ═══════════════════════════════════════════════════════════════
    const finalHookValidation = validateHookConfessional(script.hook);

    // HARD REJECTION: Si hook < 70, RECHAZAR completamente
    if (finalHookValidation.score < 70) {
      throw new Error(
        `Hook rejected: confessional_score=${finalHookValidation.score} < 70. ` +
        `Failures: ${finalHookValidation.penalties.join(', ')}. ` +
        `Hook: "${script.hook}". Regenerate with valid confessional hook.`
      );
    }

    // Log validación
    logger.info(`✓ Hook validated | confScore=${finalHookValidation.score} | priority=${finalHookValidation.priority}`, {
      hook: script.hook.substring(0, 50),
      passesReality: finalHookValidation.passesReality,
      hasFirstPerson: finalHookValidation.hasFirstPerson,
      vulnerabilityScore: finalHookValidation.vulnerabilityScore,
    });

    // Construir campos legacy desde los 8 segmentos (compatibilidad con renderer/TTS)
    script.claim       = [script.micro_value].filter(Boolean).join(' ').trim() || script.claim || '';
    script.explanation = [script.escalation, script.reengage, script.peak].filter(Boolean).join(' ').trim() || script.explanation || '';
    script.cta         = [script.open_ending, script.soft_cta].filter(Boolean).join(' ').trim() || script.cta || '';

    // Flags de estructura para analytics y subtitle-styler
    script.structureVersion = 'open_loop_escalation_v1';
    script.hasReengage      = Boolean(script.reengage);
    script.hookConfessionalScore = finalHookValidation.score; // Guardar para analytics
    enrichScriptOutput(script);

    validateScriptFields(script);

    // VALIDACION CRÍTICA: ¿Le pasa al 80% de la gente?
    validateIdentificationScore(script, baseHook?.topic);

    const viralityResult = scoreScript(script);
    script.viralityScore     = viralityResult.score;
    script.viralityBreakdown = viralityResult.breakdown;
    script.approved          = viralityResult.approved;

    // ═══════════════════════════════════════════════════════════════
    // APLICAR PENALIZACIÓN POR CALIDAD DE HOOK
    // ═══════════════════════════════════════════════════════════════
    const adjustedViralityScore = applyHookPenalty(script.viralityScore, finalHookValidation);
    if (adjustedViralityScore < script.viralityScore) {
      const penalty = script.viralityScore - adjustedViralityScore;
      logger.info(`Hook quality penalty applied | confScore=${finalHookValidation.score} | penalty=-${penalty}`, {
        original: script.viralityScore,
        adjusted: adjustedViralityScore,
      });
      script.viralityScore = adjustedViralityScore;
    }

    const allSegments = [script.hook, script.open_loop, script.micro_value, script.escalation, script.reengage, script.peak, script.open_ending, script.soft_cta];
    const totalWords  = allSegments.filter(Boolean).join(' ').split(/\s+/).length;
    script.estimatedWords  = totalWords;
    script.durationSeconds = Math.round((totalWords / 140) * 60);

    if (totalWords > 170) {
      throw new Error(`Script demasiado largo: ${totalWords} palabras (máx 170). Regenerando.`);
    }
    if (totalWords < 90) {
      throw new Error(`Script demasiado corto: ${totalWords} palabras (mín 90). Regenerando.`);
    }

    // ═══════════════════════════════════════════════════════════════
    // HUMANITYCORE CALCULATION (REQUIRED FOR V4.1)
    // ═══════════════════════════════════════════════════════════════
    script.humanityScore = scoreHumanity(script);

    // ═══════════════════════════════════════════════════════════════
    // V4.1 METADATA INJECTION (CRÍTICO)
    // ═══════════════════════════════════════════════════════════════
    script.structureVersion = 'confessional';
    script.retentionSpikeVersion = 'v4.1';
    script.renderMode = 'video_use';
    script.subtitleTimingMode = 'word_timestamps';
    script.wordAlignmentEngine = 'whisper';
    script.duration = script.durationSeconds;

    attachLlmMetrics(script, llmMetrics);
    script.generationSource = 'generateScript';
    script.llmPath = ['generateScript'];
    saveLastValidScript(script, {
      topic: script.topic,
      generationSource: 'generateScript',
      createdAt: new Date().toISOString(),
    });

    // ═══════════════════════════════════════════════════════════════
    // V4.1 CONTRACT VALIDATION (FAIL-FAST)
    // ═══════════════════════════════════════════════════════════════
    const v4Validation = validateVideoV4(script);
    if (!v4Validation.valid) {
      logger.error('V4_FAIL | generation', { videoId: script.videoId, errors: v4Validation.errors });
      throw new Error(`V4 contract violation: ${v4Validation.errors.join(' | ')}`);
    }
    logger.info(`V4_PASS | generation | videoId=${script.videoId}`);

    logger.info(`Script OK | words=${totalWords} | duration=${script.durationSeconds}s | structure=confessional | v4.1=true | reengage=${script.hasReengage} | score=${viralityResult.score} | llmCalls=${llmMetrics.llm_total_calls} | recovery=${llmMetrics.llm_recovery_used ? 1 : 0} | truncated=${llmMetrics.llm_truncated_suspected ? 1 : 0} | model=${formatDurationMs(modelPhase.durationMs)} | parse=${formatDurationMs(parsePhase.durationMs)} | total=${formatDurationMs(perf.snapshot().totalMs)}`);
    return script;

  } catch (err) {
    markLlmHardFail(llmMetrics, err);
    err.llmMetrics = { ...llmMetrics };
    perf.fail(err, llmMetrics);
    logger.error(`Script generation failed: ${err.message} | reason=${err.llm_truncated_suspected ? 'truncated' : err.llm_schema_fail ? 'schema' : err.llm_parse_fail ? 'parse' : 'hard_fail'}`);
    throw err;
  }
}

/**
 * Genera una serie de N vídeos conectados (Parte 1/N, Parte 2/N…).
 * Estrategia viral: cada parte termina con CTA que envía al perfil.
 *
 * @param {Object} options - { topic, parts: 2|3|4, satisfying: bool }
 * @returns {Array} array de scripts, uno por parte
 */
async function generateSeries(options = {}) {
  const { topic, parts = 3 } = options;
  const baseHook = selectHook(topic);
  const topicName = baseHook?.topic || topic || 'psychology';

  logger.info(`Generating series | Topic: ${topicName} | Parts: ${parts}`);

  const seriesPrompt = `Eres un experto en contenido viral en español para YouTube Shorts.

Crea una SERIE de ${parts} vídeos conectados sobre "${topicName}".

REGLAS DE LA SERIE:
• Cada parte dura ~55-60 segundos (120-130 palabras)
• Parte 1: introduce el concepto, termina con "¿Quieres saber el resto? Parte 2 en mi perfil →"
${parts > 2 ? `• Partes intermedias: continúan el desarrollo, terminan con "Parte ${parts} en mi perfil →"` : ''}
• Parte ${parts} (última): conclusión poderosa, CTA normal pidiendo comentario o follow
• Cada parte debe tener sentido sola Y crear urgencia de ver la siguiente
• El título de la serie conecta todas las partes (ej: "El efecto Pigmalión Parte 1/${parts}")

FORMATO DE RESPUESTA — JSON puro con array "series":
{
  "seriesTitle": "nombre de la serie",
  "topic": "${topicName}",
  "series": [
    {
      "part": 1,
      "totalParts": ${parts},
      "hook": "hook impactante (15-20 palabras)",
      "claim": "dato sorprendente (20-30 palabras)",
      "explanation": "desarrollo (60-75 palabras)",
      "cta": "CTA con referencia a la siguiente parte (15-20 palabras)",
      "psychologicalFact": "dato central",
      "viralTrigger": "sorpresa|identificacion|controversia|utilidad|miedo",
      "emotionalTrigger": "curiosity|fear|awe|validation|urgency",
      "keywords": ["keyword1", "keyword2", "keyword3"],
      "hashtags": ["#psicologia", "#serie", "#parte1"]
    }
    // ... resto de partes
  ]
}`;

  try {
    const llmMetrics = createLlmMetrics();
    llmMetrics.llm_total_calls += 1;
    const message = await callAnthropicWithTimeout(client, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800 * parts,
      messages: [{ role: 'user', content: seriesPrompt }],
    }, { label: 'content-generator.generateSeries' });

    const rawText = message.content[0].text.trim();
    const { data: parsed, meta: parseMeta } = await parseModelJsonWithRecovery(rawText, {
      label: 'content-generator.generateSeries',
      recover: (failedRaw) => requestJsonRecovery(seriesPrompt, failedRaw, 'content-generator.generateSeries', llmMetrics, 1200 * parts),
    });
    mergeLlmMetrics(llmMetrics, parseMeta);
    const seriesArr = parsed.series || [];

    // Enriquecer cada parte con score de viralidad
    const scripts = seriesArr.map((s) => {
      s.title = `${parsed.seriesTitle}_parte${s.part}`;
      s.topic = s.topic || topicName;
      s.durationSeconds = 58;
      s.isSeries = true;
      s.seriesTitle = parsed.seriesTitle;
      const viralityResult = scoreScript(s);
      s.viralityScore    = viralityResult.score;
      s.viralityBreakdown = viralityResult.breakdown;
      const totalWords = [s.hook, s.claim, s.explanation, s.cta].join(' ').split(/\s+/).length;
      s.estimatedWords   = totalWords;
      return s;
    });

    logger.info(`Series OK | "${parsed.seriesTitle}" | ${scripts.length} partes`);
    return scripts;

  } catch (err) {
    logger.error(`Series generation failed: ${err.message}`);
    throw err;
  }
}

async function generateBatch(count = 3) {
  const topics = hooksData.topics;
  const scripts = [];

  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    try {
      const script = await generateScript({ topic });
      scripts.push(script);
      logger.info(`Batch ${i + 1}/${count}: ${script.title}`);
      if (i < count - 1) await sleep(2000);
    } catch (err) {
      logger.error(`Batch item ${i + 1} failed: ${err.message}`);
    }
  }

  return scripts;
}

function validateScriptFields(script) {
  for (const field of ['hook', 'claim', 'explanation', 'cta', 'topic']) {
    if (!script[field]) throw new Error(`Missing field: ${field}`);
  }
  if (/^\s*¿?\s*sab[ií]as que/i.test(script.hook) || /^\s*tu cerebro\b/i.test(script.hook)) {
    throw new Error('Hook genérico: regenerar');
  }
  for (const key of ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta']) {
    if (script[key] && !soundsSpoken(script[key])) throw new Error(`Segmento poco natural en voz alta: ${key}`);
  }
  if (script.hook && script.hook.split(/\s+/).length > 11) throw new Error('Hook poco natural: regenerar');
  if (script.hook && /[,;:]/.test(script.hook)) throw new Error('Hook poco oral: regenerar');
  if (!script.reengage) throw new Error('Missing field: reengage');
  if (REENGAGE_TEMPLATE_PATTERN.test(script.reengage)) throw new Error('Reengage plantilla: regenerar');
  if (script.reengage && script.reengage.split(/\s+/).length > 14) throw new Error('Reengage poco directo: regenerar');
  if (script.peak && script.peak.split(/[.!?]/).filter(Boolean).length > 3) throw new Error('Peak demasiado explicativo: regenerar');
  // CTA puede ser pregunta o invitación suave (sin ser imperativa/agresiva)
  if (script.soft_cta && /^(no|nunca|debes|tienes que|deberías)/.test(script.soft_cta.toLowerCase())) {
    throw new Error('CTA agresivo/negativo: regenerar');
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { generateScript, generateBatch, generateSeries };
