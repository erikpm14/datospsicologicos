/**
 * content-optimizer.js
 * Generador de guiones optimizado para el patrón viral objetivo.
 *
 * Características:
 * - Contexto del decision-engine (topic, angle, hookType, trigger)
 * - Formato ultra-corto: 20-30s por defecto (configurable)
 * - Evita hooks usados recientemente
 * - Calcula virality_score + format_match_score + emotional_impact_score
 * - Aprueba/rechaza con umbral dual (format_match ≥70, virality ≥55)
 * - En reintentos: refuerza instrucciones más débiles del intento anterior
 */

require('dotenv').config();
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { scoreScript, getHookStrength }       = require('../utils/virality-scorer');
const { scoreFormatMatch, scoreEmotionalImpact } = require('./format-match-engine');
const { getFromCache, saveToCache }          = require('./script-cache');
const { getPatternContextForPrompt }         = require('./pattern-miner');
const { ensureLegacyFields, getScriptSections, hasExpandedStructure } = require('../utils/script-segments');
const { parseModelJsonWithRecovery }         = require('../utils/llm-json');
const { callAnthropicWithTimeout, createLlmMetrics, mergeLlmMetrics, markLlmHardFail, attachLlmMetrics } = require('../utils/llm-call');
const { validateGeneratedScriptSchema, saveLastValidScript } = require('../utils/script-fallback');
const { buildSceneVisualPrompt, buildUnifiedVideoStyle, normalizeVideoInstructions } = require('../utils/visual-style-system');
const logger                                 = require('../utils/logger');
const { createPerfTracker, formatDurationMs } = require('../utils/perf-tracker');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Paths para el contexto dinámico
const HOOK_PATTERNS_PATH    = path.resolve('./data/hook-patterns.json');
const CLASSIFICATIONS_PATH  = path.resolve('./data/video-classifications.json');
const HOOK_PERFORMANCE_PATH = path.resolve('./data/hook-performance.json');
const CONTEXT_MATRIX_PATH   = path.resolve('./data/context-matrix.json');
const GROWTH_LOG_PATH       = path.resolve('./data/growth-log.json');
const TOP_HOOKS_PATH        = path.resolve('./data/top-hooks.json');
const HOOK_PERF_ADV_PATH    = path.resolve('./data/hook-performance-advanced.json');

function _readJSON(file, def = null) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return def; }
}

// Duración objetivo (20-30s por defecto para formato viral corto)
const TARGET_MIN = parseInt(process.env.FORMAT_TARGET_MIN_SECONDS || '40');
const TARGET_MAX = parseInt(process.env.FORMAT_TARGET_MAX_SECONDS || '65');
const WPS        = 2.3; // palabras/segundo narración calmada

const TARGET_MIN_WORDS = Math.round(TARGET_MIN * WPS);
const TARGET_MAX_WORDS = Math.round(TARGET_MAX * WPS);
const TARGET_MID_SECS  = Math.round((TARGET_MIN + TARGET_MAX) / 2);
const SEGMENT_KEYS = ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'];
const COMPACT_SCRIPT_SCHEMA = `{
  "title": "slug_corto",
  "topic": "topic",
  "hook": "max 12 palabras",
  "open_loop": "10-15 palabras",
  "micro_value": "12-18 palabras",
  "escalation": "20-30 palabras",
  "reengage": "8-14 palabras",
  "peak": "20-32 palabras",
  "open_ending": "8-14 palabras",
  "soft_cta": "7-12 palabras",
  "psychologicalFact": "1 frase breve",
  "viralTrigger": "sorpresa|identificacion|controversia|utilidad|miedo",
  "emotionalTrigger": "curiosity|fear|awe|validation|urgency|relatability",
  "effectName": "mecanismo breve",
  "keywords": ["keyword1", "keyword2"]
}`;
const COMPACT_VIRAL_SCHEMA = `{
  "topic": "topic",
  "selectedHookType": "revelation|pattern|challenge",
  "hookSelectionReason": "frase corta",
  "patternUsed": "patron breve",
  "script": ${COMPACT_SCRIPT_SCHEMA}
}`;

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

async function requestJsonRecovery(prompt, rawText, label, llmMetrics, maxTokens = 450, schema = COMPACT_SCRIPT_SCHEMA) {
  logger.warn(`${label}: requesting clean JSON recovery from model`);
  llmMetrics.llm_total_calls += 1;
  const recovery = await callAnthropicWithTimeout(client, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: `${prompt}\n\nLa respuesta anterior no era JSON valido y puede estar truncada. Reconstruye una version MAS CORTA.\nDevuelve SOLO JSON VALIDO. Sin markdown. Sin fences. Sin comentarios. Sin texto antes ni despues.\nUsa SOLO este esquema minimo:\n${schema}\nLimites duros: hook<=9, open_loop<=15, micro_value<=18, escalation<=30, reengage<=14, peak<=32, open_ending<=14, soft_cta<=12, psychologicalFact<=16, keywords=2, hashtags=3.\n\nRESPUESTA ANTERIOR:\n${String(rawText || '').slice(0, 3000)}`,
    }],
  }, { label: `${label}.recovery` });
  return recovery.content?.[0]?.text?.trim() || '';
}

function countScriptWords(script) {
  return getScriptSections(script)
    .map((section) => section.text)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function buildSegmentFeedback(scriptInput = {}) {
  const script = ensureLegacyFields(scriptInput);
  const feedback = [];
  const add = (segment, issue) => feedback.push({ segment, issue });
  const wordCount = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const soundsSpoken = (text) => !/[;()[\]{}]/.test(String(text || '')) && !/\bprimero\b|\bsegundo\b|\btercero\b|\ben primer lugar\b/i.test(String(text || ''));

  if (!script.hook || wordCount(script.hook) < 6) add('hook', 'hook débil');
  else if (wordCount(script.hook) > 13) add('hook', 'hook demasiado largo');
  else if (/^\s*¿?\s*sab[ií]as que/i.test(script.hook) || /^\s*tu cerebro\b/i.test(script.hook)) add('hook', 'hook genérico');

  if (script.hook && !/^\s*Â¿?\s*sab[iÃ­]as que/i.test(script.hook) && !/^\s*tu cerebro\b/i.test(script.hook) && !soundsSpoken(script.hook)) {
    add('hook', 'hook poco natural');
  }

  if (hasExpandedStructure(script)) {
    if (!script.open_loop) add('open_loop', 'open_loop ausente');
    else if (/\bporque\b|\bla razón\b|\besto significa\b|\ben resumen\b/i.test(script.open_loop)) add('open_loop', 'open_loop demasiado resolutivo');

    if (!script.micro_value) add('micro_value', 'micro_value ausente');
    else if (!/\bse llama\b|\befecto\b|\bsesgo\b|\bestudio\b|\bdopamina\b|\bcortisol\b|\bamígdala\b/i.test(script.micro_value)) add('micro_value', 'micro_value poco concreto');

    if (!script.escalation) add('escalation', 'escalation ausente');
    else if (wordCount(script.escalation) < 18) add('escalation', 'escalation con poca densidad');
    else if (!soundsSpoken(script.escalation)) add('escalation', 'escalation suena escrito, no hablado');

    if (!script.reengage) add('reengage', 'reengage ausente');
    else if (!/\bpero\b|\baquí\b|\bahora\b|\bespera\b|\bcuántas veces\b|\bte ha pasado\b|\besto es lo importante\b/i.test(script.reengage)) add('reengage', 'reengage poco agresivo');

    if (!script.peak) add('peak', 'peak ausente');
    else if (!/\btu\b|\bte\b|\bcontigo\b|\bcuando\b|\ben el trabajo\b|\ben una conversación\b|\ben pareja\b|\ba diario\b/i.test(script.peak)) add('peak', 'peak abstracto');

    if (!script.open_ending) add('open_ending', 'open_ending ausente');
    else if (/\bpor eso\b|\besa es la razón\b|\basí funciona\b|\bfin\b/i.test(script.open_ending)) add('open_ending', 'open_ending demasiado cerrado');

    if (!script.soft_cta) add('soft_cta', 'soft_cta ausente');
    else if (/sígueme|suscríbete|dale like|comenta si/i.test(script.soft_cta)) add('soft_cta', 'soft_cta forzado');
    else if (wordCount(script.soft_cta) < 5) add('soft_cta', 'soft_cta genérico');
    else if (!/[?¿]/.test(script.soft_cta)) add('soft_cta', 'soft_cta poco conversacional');
  } else {
    if (!script.claim || wordCount(script.claim) < 8) add('claim', 'claim poco concreto');
    if (!script.explanation || wordCount(script.explanation) < 18) add('explanation', 'explanation demasiado débil');
    if (!script.cta || wordCount(script.cta) < 5) add('cta', 'cta genérico');
  }

  return feedback;
}

function buildRetryFeedback(previousGaps = []) {
  if (!previousGaps.length) return '';
  return previousGaps.map((gap) => {
    if (typeof gap === 'string') return `  • ${gap}`;
    if (gap?.segment && gap?.issue) return `  • [${gap.segment}] ${gap.issue}`;
    return `  • ${String(gap)}`;
  }).join('\n');
}

function finalizeOptimizedScript(scriptInput = {}, growthContext = {}) {
  const script = ensureLegacyFields(scriptInput);
  script.structureVersion = script.structureVersion || (hasExpandedStructure(script) ? 'open_loop_escalation_v1' : 'legacy_v1');
  script.hasReengage = script.hasReengage ?? Boolean(script.reengage);
  script.segmentFeedback = buildSegmentFeedback(script);
  script.segmentFeedbackSummary = script.segmentFeedback.map((item) => `[${item.segment}] ${item.issue}`);
  script.estimatedWords = countScriptWords(script);
  script.durationSeconds = Math.round(script.estimatedWords / WPS);
  enrichScriptOutput(script);
  script.growthContext = {
    topic: growthContext.nextTopic,
    hookType: growthContext.hookType,
    emotionalTrigger: growthContext.emotionalTrigger,
    angle: growthContext.angle,
    strategy: growthContext.strategy,
    decisionAt: growthContext.decisionAt,
  };
  return script;
}

function buildSelectionPenalties(script = {}) {
  const penalties = [];
  if ((script.viralityScore || 0) < 70) penalties.push(`virality_low:${script.viralityScore || 0}`);
  if ((script.formatMatchScore || 0) > 0 && (script.formatMatchScore || 0) < 70) penalties.push(`format_low:${script.formatMatchScore}`);
  penalties.push(...(script.segmentFeedbackSummary || []).slice(0, 4));
  return penalties.filter(Boolean);
}

function isClearlyInvalidCandidate(script = {}) {
  if (!script || !hasExpandedStructure(script)) return true;
  if ((script.estimatedWords || 0) < 55) return true;
  if ((script.durationSeconds || 0) < 25) return true;
  if ((script.durationSeconds || 0) > 60) return true;
  if (!String(script.hook || '').trim()) return true;
  if (!String(script.peak || '').trim()) return true;
  return false;
}

async function improveWeakSegments(scriptInput = {}, options = {}) {
  const script = ensureLegacyFields(JSON.parse(JSON.stringify(scriptInput || {})));
  const issues = Array.isArray(options.issues) ? options.issues : script.segmentFeedbackSummary || [];
  const softIssue = issues.find((issue) => /\[hook\]|\[reengage\]|\[escalation\]|\[micro_value\]/i.test(issue));
  if (!softIssue) return { script, improved: false, target: null, reason: 'no_soft_issue' };

  const target = /\[hook\]/i.test(softIssue)
    ? 'hook'
    : /\[reengage\]/i.test(softIssue)
      ? 'reengage'
      : /\[escalation\]/i.test(softIssue)
        ? 'escalation'
        : 'micro_value';

  const patchSchema = `{
  "${target}": "texto corto mejorado"
}`;
  const targetRule = target === 'hook'
    ? 'Reescribe SOLO el hook. Hazlo mas corto, mas incomodo, mas concreto. Maximo 12 palabras.'
    : target === 'reengage'
      ? 'Reescribe SOLO el reengage. Debe sonar a golpe breve. Ejemplos: "Y aqui viene lo peor.", "Pero esto casi nadie lo nota.", "La trampa esta en esto."'
      : target === 'escalation'
        ? 'Reescribe SOLO la escalation. Debe sonar hablada, cotidiana y natural. Sin tono escrito.'
        : 'Reescribe SOLO el micro_value. Debe ser mas concreto y practico con ejemplo humano breve.';

  const userPrompt = `Tienes un guion casi valido para Shorts virales de psicologia.
${targetRule}
No rehagas nada mas.
Devuelve SOLO JSON puro.

Hook actual: ${script.hook}
Open loop actual: ${script.open_loop}
Micro value actual: ${script.micro_value}
Escalation actual: ${script.escalation}
Reengage actual: ${script.reengage}
Peak actual: ${script.peak}

Salida:
${patchSchema}`;

  const llmMetrics = createLlmMetrics();
  try {
    llmMetrics.llm_total_calls += 1;
    const message = await callAnthropicWithTimeout(client, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 160,
      system: 'Corrige solo el segmento pedido. Devuelve solo JSON valido.',
      messages: [{ role: 'user', content: userPrompt }],
    }, { label: `content-optimizer.improveWeakSegments.${target}` });
    const rawText = message.content?.[0]?.text?.trim() || '';
    const { data } = await parseModelJsonWithRecovery(rawText, {
      label: `content-optimizer.improveWeakSegments.${target}`,
      recover: (failedRaw) => requestJsonRecovery(userPrompt, failedRaw, `content-optimizer.improveWeakSegments.${target}`, llmMetrics, 140, patchSchema),
    });
    if (typeof data?.[target] === 'string' && data[target].trim().length >= 4) {
      script[target] = data[target].trim();
      const normalized = finalizeOptimizedScript(script, script.growthContext || options.growthContext || {});
      normalized.quickOptimizedSegment = target;
      normalized.quickOptimizedReason = softIssue;
      return { script: normalized, improved: true, target, reason: softIssue };
    }
  } catch (error) {
    logger.warn(`Segment optimizer skipped | target=${target} | reason=${error.message}`);
  }

  return { script, improved: false, target, reason: softIssue };
}

// ─────────────────────────────────────────────
//  SYSTEM PROMPT
// ─────────────────────────────────────────────

function buildSystemPrompt(growthContext = {}, trendContext = null) {
  const {
    nextTopic, hookType, emotionalTrigger, angle,
    avoidTopics = [], avoidRecentHooks = [],
  } = growthContext;
  const recentHooksNote = avoidRecentHooks.length > 0
    ? `\nNo repitas hooks recientes: ${avoidRecentHooks.slice(0, 4).join(' | ')}`
    : '';
  const trendNote = trendContext?.hookHints?.length
    ? `\nTendencias activas: ${trendContext.hookHints.slice(0, 4).join(' | ')}`
    : '';
  const patternNote = getPatternContextForPrompt(nextTopic) || '';

  return `Escribes Shorts virales de psicologia en espanol de Espana.
No suenes academico. No suenes a blog. No suenes a IA.

Objetivo:
- hooks agresivos
- micro_value concreto
- escalation hablada
- reengage fuerte
- peak emocional
- produccion constante

Reglas:
- frases cortas
- segunda persona
- tono intimo, incomodo y curioso
- nada de "En este video", "La psicologia dice", "Segun estudios", "Hoy vamos a hablar", "Es importante recordar", "No estas solo", "Sabias que"
- usa contraste: "no es X, es Y"
- usa revelacion: "lo grave no es..., es..."
- situaciones humanas concretas
- una frase memorable
- objetivo ${TARGET_MIN}-${TARGET_MAX}s
- si el hook no frena scroll, reescribe
- si el reengage no golpea, reescribe

Tema: ${nextTopic || 'emotional_patterns'}
Angulo: ${angle || 'mecanismo cotidiano'}
HookType: ${hookType || 'revelation'}
Trigger emocional: ${emotionalTrigger || 'curiosity'}
Evitar temas: ${avoidTopics.join(', ') || 'ninguno'}${recentHooksNote}${trendNote}
${patternNote}

Devuelve solo JSON valido.`;
}

// ─────────────────────────────────────────────
//  GENERACIÓN PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Genera un guión optimizado con contexto del decision engine.
 *
 * @param {Object} growthContext - Salida de makeDecision()
 * @param {Object} options       - { retryCount, previousGaps }
 * @returns {Object} script enriquecido con scores y approval
 */
async function generateOptimizedScript(growthContext = {}, options = {}) {
  const { nextTopic, angle, hookType, emotionalTrigger } = growthContext;
  const { retryCount = 0, previousGaps = [], trendContext = null } = options;
  const perf = createPerfTracker('content-optimizer.generateOptimizedScript', { topic: nextTopic, attempt: retryCount + 1 });
  const llmMetrics = createLlmMetrics();

  try {
    logger.info(`Content Optimizer | topic=${nextTopic} | angle=${angle} | hook=${hookType} | attempt=${retryCount + 1}`);

  // Cache lookup — solo en el primer intento (retries siempre generan fresco)
  if (retryCount === 0) {
    const cached = getFromCache(nextTopic, angle, hookType);
    if (cached) return cached;
  }

  // En reintentos: incluye feedback específico de los gaps del intento anterior
  let retryFeedback = '';
  if (retryCount > 0) {
    const gapLines = previousGaps.length > 0
      ? `Fallos del intento anterior:\n${buildRetryFeedback(previousGaps)}`
      : '';
    retryFeedback = `\n\n⚠️ REINTENTO ${retryCount}: El intento anterior fue rechazado. ${gapLines}
Correcciones obligatorias: más claridad por segmento, reengage más fuerte, peak más concreto y soft_cta menos genérico.`;
  }

  const userPrompt = `Genera un guión de psicología viral de ALTA CALIDAD.

PARÁMETROS:
- Tema: ${nextTopic || 'comportamiento humano'}
- Ángulo: ${angle || 'mecanismo cognitivo cotidiano'}
- Tipo de hook: ${hookType || 'revelation'}
- Trigger emocional: ${emotionalTrigger || 'curiosity'}

EXIGENCIAS DE CALIDAD (se comprueba con scorer automático):
- hook: 6-9 palabras, scroll stop brutal, personal e incómodo
- open_loop: curiosidad sin resolver todavía
- micro_value: primer pago con efecto o mecanismo real
- escalation: tensión creciente y frases cortas
- reengage: golpe breve en segundo ~20
- peak: ejemplo cotidiano fuerte, identificable y concreto
- open_ending: deja loop abierto
- soft_cta: pregunta real, natural, sin pedir follow
- Total: ${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} palabras (${TARGET_MIN}-${TARGET_MAX}s)
- Prohibido "¿Sabías que...?" y prohibido empezar hook con "Tu cerebro..."
- Devuelve también fullScript y videoInstructions con escenas, ritmo, cortes y keywords visuales
- Cero intro, cero relleno, cero academicismo${retryFeedback}`;

  const compactUserPrompt = `Genera un guion viral de psicologia.

Parametros:
- tema: ${nextTopic || 'comportamiento humano'}
- angulo: ${angle || 'mecanismo cognitivo cotidiano'}
- hookType: ${hookType || 'revelation'}
- emotionalTrigger: ${emotionalTrigger || 'curiosity'}

Estilo:
- espanol natural de Espana
- voz directa
- frases cortas
- tono intimo, incomodo y curioso
- nada academico
- nada de blog

Reglas:
- HOOK maximo 12 palabras
- OPEN_LOOP 10-15 palabras
- MICRO_VALUE 12-18 palabras y concreto
- ESCALATION 20-30 palabras, hablada y cotidiana
- REENGAGE 8-14 palabras, golpe fuerte
- PEAK 20-32 palabras, conclusion emocional
- OPEN_ENDING 8-14 palabras
- SOFT_CTA 7-12 palabras
- keywords exactamente 2
- cero markdown, cero fences, cero texto extra${retryFeedback}

Devuelve solo este JSON minimo:
${COMPACT_SCRIPT_SCHEMA}`;


  perf.start('model_call');
  llmMetrics.llm_total_calls += 1;
  const message = await callAnthropicWithTimeout(client, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 450,
    system: buildSystemPrompt(growthContext, trendContext),
    messages: [{ role: 'user', content: compactUserPrompt }],
  }, { label: 'content-optimizer.generateOptimizedScript' });
  const modelPhase = perf.end({ model: 'claude-haiku-4-5-20251001' });

  const rawText  = message.content[0].text.trim();
  perf.start('json_parse');
  const { data: script, meta: parseMeta } = await parseModelJsonWithRecovery(rawText, {
    label: 'content-optimizer.generateOptimizedScript',
    recover: (failedRaw) => requestJsonRecovery(compactUserPrompt, failedRaw, 'content-optimizer.generateOptimizedScript', llmMetrics, 450, COMPACT_SCRIPT_SCHEMA),
    validate: (data) => validateGeneratedScriptSchema(data, { label: 'content-optimizer.generateOptimizedScript', requireExpanded: true }),
  });
  mergeLlmMetrics(llmMetrics, parseMeta);
  const parsePhase = perf.end(parseMeta);

  for (const field of ['hook', 'topic']) {
    if (!script[field]) throw new Error(`Campo requerido ausente: ${field}`);
  }

  const normalizedScript = finalizeOptimizedScript(script, growthContext);

  // ── Scores ──
  const viralityResult = scoreScript(normalizedScript);
  normalizedScript.viralityScore     = viralityResult.score;
  normalizedScript.viralityBreakdown = viralityResult.breakdown;

  const formatResult                  = scoreFormatMatch(normalizedScript);
  normalizedScript.formatMatchScore   = formatResult.score;
  normalizedScript.formatMatchBreakdown = formatResult.breakdown;
  normalizedScript.formatMatchSegmentGaps = normalizedScript.segmentFeedbackSummary;
  normalizedScript.formatMatchGaps    = [...formatResult.gaps, ...normalizedScript.segmentFeedbackSummary];

  const emotionalResult                 = scoreEmotionalImpact(normalizedScript);
  normalizedScript.emotionalImpactScore = emotionalResult.score;
  normalizedScript.emotionalImpactBreakdown = emotionalResult.breakdown;

  // ── Aprobación (para cola) ──
  const minFormat      = parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '70');
  const minVirality    = parseInt(process.env.MIN_VIRALITY_SCORE_TO_QUEUE     || '60');
  const minHookStrength = parseInt(process.env.MIN_HOOK_STRENGTH              || '8');

  const hookStr    = viralityResult.breakdown?.hookStrength ?? getHookStrength(normalizedScript.hook);
  const formatOk   = formatResult.score >= minFormat;
  const viralityOk = viralityResult.score >= minVirality;
  const hookOk     = hookStr >= minHookStrength;

  normalizedScript.approved = formatOk && viralityOk;
  normalizedScript.rejectionReason = !normalizedScript.approved
    ? [
          !formatOk   ? `format_match ${formatResult.score}/${minFormat}` : null,
          !viralityOk ? `virality ${viralityResult.score}/${minVirality}` : null,
          !hookOk     ? `hook_weak ${hookStr}/${minHookStrength} (penalty)` : null,
        ...normalizedScript.segmentFeedbackSummary.slice(0, 3).map((issue) => `${issue} (penalty)`),
        ].filter(Boolean).join(' | ')
    : null;
  normalizedScript.selectionPenalties = buildSelectionPenalties(normalizedScript);

  logger.info(
    `Script | ${normalizedScript.estimatedWords}w ${normalizedScript.durationSeconds}s | ` +
    `virality=${viralityResult.score} format=${formatResult.score} emotion=${emotionalResult.score} | ` +
    `${normalizedScript.approved ? '✓ APROBADO' : `✗ RECHAZADO (${normalizedScript.rejectionReason})`}`,
  );

  // Guardar en caché solo si está aprobado
  logger.info(
    `Content Optimizer timing | topic=${nextTopic} | attempt=${retryCount + 1} | ` +
    `llmCalls=${llmMetrics.llm_total_calls} recovery=${llmMetrics.llm_recovery_used ? 1 : 0} truncated=${llmMetrics.llm_truncated_suspected ? 1 : 0} ` +
    `model=${formatDurationMs(modelPhase.durationMs)} parse=${formatDurationMs(parsePhase.durationMs)} ` +
    `total=${formatDurationMs(perf.snapshot().totalMs)}`,
  );

  attachLlmMetrics(normalizedScript, llmMetrics);
  normalizedScript.generationSource = 'generateOptimizedScript';
  normalizedScript.llmPath = ['generateOptimizedScript'];
  if (normalizedScript.approved) {
    saveLastValidScript(normalizedScript, {
      topic: normalizedScript.topic,
      angle,
      hookType,
      emotionalTrigger,
      generationSource: 'generateOptimizedScript',
      createdAt: new Date().toISOString(),
    });
    saveToCache(nextTopic, angle, hookType, normalizedScript);
  }

  return normalizedScript;
  } catch (err) {
    markLlmHardFail(llmMetrics, err);
    err.llmMetrics = { ...llmMetrics };
    perf.fail(err, llmMetrics);
    logger.error(`Content Optimizer failed: ${err.message} | reason=${err.llm_truncated_suspected ? 'truncated' : err.llm_schema_fail ? 'schema' : err.llm_parse_fail ? 'parse' : 'hard_fail'}`);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VIRAL SCRIPT GENERATOR — Sistema de auto-mejora con contexto real del canal
//  Usa datos históricos reales para adaptar cada guión: winners, flops,
//  patrones, tendencias, rendimiento por topic+hookType.
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
//  CONTEXTO DINÁMICO — lee todos los archivos de aprendizaje
// ─────────────────────────────────────────────

function buildDynamicContext(growthContext, { trendContext = null } = {}) {
  const { nextTopic: topic, angle, hookType, emotionalTrigger, strategy } = growthContext;

  // ── Patrones de hooks (pattern-miner) ──
  const patternsData = _readJSON(HOOK_PATTERNS_PATH, null);
  const allPatterns  = patternsData?.patterns || [];
  const topPatterns  = allPatterns
    .filter(p => p.count >= 2 && p.avgViews > 0)
    .slice(0, 4)
    .map(p => ({
      id:        p.patternId,
      label:     p.label,
      avgViews:  p.avgViews,
      winRate:   p.winRate,
      topExample:p.examples?.[0]?.hook || null,
      topics:    p.topTopics,
    }));

  const worstPatterns = allPatterns
    .filter(p => p.count >= 2)
    .sort((a, b) => a.avgViews - b.avgViews)
    .slice(0, 3)
    .map(p => ({
      id:      p.patternId,
      label:   p.label,
      avgViews:p.avgViews,
      topExample: p.examples?.[0]?.hook || null,
    }));

  // ── Clasificación de vídeos (video-classifier) ──
  const classifData      = _readJSON(CLASSIFICATIONS_PATH, {}) || {};
  const allClassified    = Object.values(classifData);
  const previousWinners  = allClassified
    .filter(v => v.classification === 'WINNER')
    .sort((a, b) => b.views - a.views)
    .slice(0, 6)
    .map(v => ({ hook: v.hook, topic: v.topic, views: v.views, engagement: v.engagement }));

  const previousFlops = allClassified
    .filter(v => v.classification === 'FLOP')
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, 5)
    .map(v => ({ hook: v.hook, topic: v.topic, views: v.views }));

  // ── Tipos de hook con mejor rendimiento (ab-test-engine) ──
  const perfData      = _readJSON(HOOK_PERFORMANCE_PATH, { typeWeights: {}, history: [] });
  const typeWeights   = perfData.typeWeights || {};
  const bestHookTypes = Object.entries(typeWeights)
    .sort(([, a], [, b]) => b - a)
    .map(([type, weight]) => `${type} (peso: ${weight})`);

  // ── Promedios del canal ──
  const growthLog    = _readJSON(GROWTH_LOG_PATH, []) || [];
  const recentCycles = growthLog.slice(0, 20);
  const avgViralScore = recentCycles.length > 0
    ? Math.round(recentCycles.reduce((s, c) => s + (c.viralityScore || 0), 0) / recentCycles.length)
    : 0;
  const avgFormatScore = recentCycles.length > 0
    ? Math.round(recentCycles.reduce((s, c) => s + (c.formatMatchScore || 0), 0) / recentCycles.length)
    : 0;

  // ── Rendimiento reciente por topic (context-matrix) ──
  const matrixData      = _readJSON(CONTEXT_MATRIX_PATH, null);
  const topicMatrix     = matrixData?.matrix?.[topic] || {};
  const topicInsights   = Object.entries(topicMatrix)
    .sort(([, a], [, b]) => b.avgEngagement - a.avgEngagement)
    .slice(0, 3)
    .map(([hookT, stats]) => `${hookT}: ${stats.avgViews} views, ${(stats.avgEngagement * 100).toFixed(1)}% eng (${stats.count} vídeos)`);

  // ── Tendencias ──
  const trendingKeywords = trendContext?.hookHints?.slice(0, 6) || [];
  const trendingTopics   = trendContext?.trendingTopics?.slice(0, 5) || [];

  // ── Top hooks reales del canal (Part 16: reutilizar patrones ganadores) ──
  const topHooksData  = _readJSON(TOP_HOOKS_PATH, null);
  const topHooksForTopic = topHooksData?.hooks
    ?.filter(h => h.topic === topic && h.hook)
    .slice(0, 3) || [];
  const topHooksGlobal = topHooksData?.hooks
    ?.filter(h => h.hook)
    .slice(0, 3) || [];
  const topHooksRef = topHooksForTopic.length > 0 ? topHooksForTopic : topHooksGlobal;

  // ── Hooks de bajo rendimiento a evitar (flop hooks del canal) ──
  const flopHooks = previousFlops.map(f => f.hook).filter(Boolean);

  // ── Insights del análisis avanzado ──
  const advAnalysis  = _readJSON(HOOK_PERF_ADV_PATH, null);
  const hookTypePerf = advAnalysis?.hookTypeStats?.find(h => h.hookType === hookType);
  const bestHookTypeFromAdv = advAnalysis?.hookTypeStats?.[0]?.hookType || null;

  return {
    topic,
    angle,
    hookType,
    emotionalTrigger,
    strategy,
    topPatterns,
    worstPatterns,
    previousWinners,
    previousFlops,
    bestHookTypes,
    channelAverages: { avgViralScore, avgFormatScore, totalVideos: allClassified.length },
    recentPerformanceInsights: topicInsights,
    trendingKeywords,
    trendingTopics,
    hasEnoughData: allClassified.length >= 5,
    topHooksRef,
    flopHooks,
    hookTypePerf,
    bestHookTypeFromAdv,
  };
}

// ─────────────────────────────────────────────
//  SYSTEM PROMPT — hidratado con datos reales del canal
// ─────────────────────────────────────────────

function buildViralSystemPrompt(ctx) {
  const {
    topic, topPatterns, worstPatterns, previousWinners, previousFlops,
    bestHookTypes, channelAverages, recentPerformanceInsights,
    trendingKeywords, trendingTopics, topHooksRef, flopHooks, hookTypePerf, bestHookTypeFromAdv,
  } = ctx;

  const topPatternsText = topPatterns.length
    ? topPatterns.map((p) => `  • [${p.id}] "${p.label}"${p.avgViews > 0 ? ` — ${p.avgViews} views` : ''}`).join('\n')
    : '  (sin datos suficientes)';
  const worstPatternsText = worstPatterns.length
    ? worstPatterns.map((p) => `  ✗ [${p.id}] "${p.label}"${p.avgViews > 0 ? ` — ${p.avgViews} views` : ''}`).join('\n')
    : '  (sin datos de fallos todavía)';
  const winnersText = previousWinners.length
    ? previousWinners.map((w) => `  ✓ "${w.hook}" [${w.topic}]`).join('\n')
    : '  (sin winners registrados todavía)';
  const flopsText = previousFlops.length
    ? previousFlops.map((f) => `  ✗ "${f.hook}" [${f.topic}]`).join('\n')
    : '  (sin flops registrados todavía)';
  const trendText = trendingKeywords.length
    ? `Señales activas:\n${trendingKeywords.map((k) => `  • "${k}"`).join('\n')}\nTopics: ${trendingTopics.join(', ')}`
    : '(sin señales de tendencias activas esta sesión)';
  const insightsText = recentPerformanceInsights.length ? recentPerformanceInsights.join('\n  ') : 'sin datos históricos para este topic';
  const channelText = channelAverages.totalVideos > 0
    ? `${channelAverages.totalVideos} vídeos | virality medio ${channelAverages.avgViralScore} | format medio ${channelAverages.avgFormatScore}`
    : 'canal en fase inicial';
  const bestHookTypesText = bestHookTypes.length ? bestHookTypes.join(', ') : 'revelation';
  const topHooksSection = topHooksRef?.length
    ? `\nTOP HOOKS REALES:\n${topHooksRef.map((h) => `  ✓ "${h.hook}" [${h.hookType}/${h.topic}]`).join('\n')}${flopHooks?.length ? `\nHOOKS DE FLOP:\n${flopHooks.slice(0, 3).map((h) => `  ✗ "${h}"`).join('\n')}` : ''}${hookTypePerf ? `\nHookType actual: ${hookTypePerf.hookType} | avgViews=${hookTypePerf.avgViews}` : ''}${bestHookTypeFromAdv ? `\nMejor hook type global: ${bestHookTypeFromAdv}` : ''}`
    : '';

  return `No eres un educador. Eres una máquina de retención para YouTube Shorts de psicología.
Tu objetivo: scroll stop, watch time, comentarios y rewatch.

DATOS REALES DEL CANAL:
${channelText}

HOOKS GANADORES:
${winnersText}

HOOKS FALLIDOS:
${flopsText}

TIPOS DE HOOK CON MEJOR RENDIMIENTO:
${bestHookTypesText}
${topHooksSection}

RENDIMIENTO RECIENTE PARA ${topic}:
  ${insightsText}

PATRONES GANADORES:
${topPatternsText}

PATRONES A EVITAR:
${worstPatternsText}

TENDENCIAS:
${trendText}

REGLA DEL HOOK:
Debe provocar identificación incómoda, contradicción o duda urgente. Si no frena el scroll, es inválido. Prohibido "¿Sabías que...?" y prohibido empezar con "Tu cerebro...".

ESTRUCTURA OBLIGATORIA — OPEN LOOP ESCALATION V1:
1. hook: scroll stop, 6-9 palabras
2. open_loop: curiosidad sin resolver, 10-15 palabras
3. micro_value: primer pago con efecto o mecanismo real, 12-18 palabras
4. escalation: tensión creciente, 20-30 palabras
5. reengage: golpe breve en s~20, 8-14 palabras
6. peak: máximo impacto con ejemplo cotidiano, 20-32 palabras
7. open_ending: deja loop abierto, 8-14 palabras
8. soft_cta: provoca comentario sin sonar CTA, 7-12 palabras
9. fullScript: une los 8 segmentos
10. videoInstructions: escenas, cortes, ritmo, b-roll y keywords visuales

COMPATIBILIDAD:
claim = micro_value
explanation = escalation + reengage + peak
cta = open_ending + soft_cta

CRITERIO NARRATIVO:
hook = scroll stop
open_loop = curiosidad
micro_value = primer pago
escalation = densidad
reengage = evitar caída de segundo 20
peak = máxima identificación o impacto
open_ending = loop abierto
soft_cta = comentario natural

AUTOEVALUACIÓN OBLIGATORIA:
1. ¿El hook frena el scroll?
2. ¿El open_loop no resuelve demasiado pronto?
3. ¿El micro_value paga algo real?
4. ¿La escalation sube tensión?
5. ¿El reengage recupera atención?
6. ¿El peak es concreto y vivido?
7. ¿Open ending + soft_cta dejan algo rebotando?
8. ¿Es mejor que la media del canal?

Devuelve solo JSON.`;
}

// ─────────────────────────────────────────────
//  USER PROMPT — instrucción directa a Claude
// ─────────────────────────────────────────────

function buildViralUserPrompt(ctx) {
  const { topic, angle, hookType, emotionalTrigger, hasEnoughData } = ctx;
  return `Genera un guión para YouTube Shorts de psicología.

PARÁMETROS:
  - Topic: ${topic}
  - Ángulo: ${angle || 'mecanismo cognitivo cotidiano'}
  - Tipo de hook (según rendimiento histórico): ${hookType || 'revelation'}
  - Trigger emocional: ${emotionalTrigger || 'curiosity'}

${hasEnoughData
  ? 'El canal tiene datos históricos reales. El patrón ganador más relevante para este topic debe guiar el hook.'
  : 'Canal en fase inicial. Prioriza revelation > pattern > challenge por probabilidad estadística de retención.'}

Genera EXACTAMENTE 3 hooks (revelation, pattern, challenge).
Para cada uno evalúa: ¿provoca identificación incómoda? ¿crea duda urgente? ¿ataca directamente?
Ninguno puede empezar por "Tu cerebro..." ni sonar a "¿Sabías que...?".
Selecciona el de mayor probabilidad de detener el scroll.

El guión debe:
  1. hook → detener scroll en 2s con identificación incómoda o duda urgente
  2. open_loop → abrir curiosidad sin resolver
  3. micro_value → primer pago real
  4. escalation → tensión creciente
  5. reengage → recuperar atención en s~20
  6. peak → impacto máximo con ejemplo cotidiano
  7. open_ending → dejar idea abierta
  8. soft_cta → provocar comentario natural

El objetivo NO es informar. Es crear un vídeo que se repita.

Devuelve EXACTAMENTE este JSON:
{
  "hooks": {
    "revelation": "hook tipo revelation",
    "pattern": "hook tipo pattern",
    "challenge": "hook tipo challenge"
  },
  "selectedHook": {
    "tipo": "revelation|pattern|challenge",
    "texto": "hook ganador",
    "razon": "por qué gana"
  },
  "script": {
    "hook": "segmento hook",
    "open_loop": "segmento open_loop",
    "micro_value": "segmento micro_value",
    "escalation": "segmento escalation",
    "reengage": "segmento reengage",
    "peak": "segmento peak",
    "open_ending": "segmento open_ending",
    "soft_cta": "segmento soft_cta",
    "claim": "fallback legacy",
    "explanation": "fallback legacy",
    "cta": "fallback legacy"
  },
  "topic": "${topic}",
  "viralTrigger": "sorpresa|identificacion|controversia|utilidad|miedo",
  "emotionalTrigger": "curiosity|fear|awe|validation|urgency|relatability",
  "keywords": ["keyword_visual_1", "keyword_visual_2"],
  "hashtags": ["#psicologia", "#mente", "#cerebro"],
  "fullScript": "texto unido de los 8 segmentos",
  "videoInstructions": {
    "visualStyle": ["cambio de plano cada 2-3 segundos", "zoom progresivo", "movimiento constante"],
    "subtitleStyle": "subtitulos grandes y sincronizados",
    "audioStyle": { "voice": "voz clara y con ritmo", "pauses": ["hook", "reengage", "peak"] },
    "scenes": [{ "segment": "hook", "timing": "0-2s", "visual": "tension social", "cut": "corte rapido" }],
    "clipKeywords": ["social tension", "phone checking"]
  },
  "optimizationNotes": {
    "patronUsado": "patrón elegido",
    "tendenciaAprovechada": "tendencia o ninguna",
    "queSeEvito": "patrón descartado",
    "porQueEsteHookEsFuerte": "motivo",
    "segmentDiagnostics": {
      "hook": "fuerte|mejorable",
      "open_loop": "fuerte|mejorable",
      "micro_value": "fuerte|mejorable",
      "escalation": "fuerte|mejorable",
      "reengage": "fuerte|mejorable",
      "peak": "fuerte|mejorable",
      "open_ending": "fuerte|mejorable",
      "soft_cta": "fuerte|mejorable"
    },
    "porQueGeneraRewatch": "motivo",
    "porQueGeneraComentarios": "motivo"
  },
  "learningSignals": {
    "expectedHookTypePerformance": "alto|medio|bajo",
    "expectedPatternPerformance": "alto|medio|bajo",
    "expectedAudienceReaction": "descripción",
    "possibleRisk": "riesgo o ninguno"
  },
  "autoevaluacion": {
    "hookFrenaMenos2s": true,
    "hookIdentificacionIncomoda": true,
    "cadaFraseAnade": true,
    "progresionClara": true,
    "loopConectaConHook": true,
    "potencialRewatch": true,
    "superaMediaCanal": true,
    "diferenteDeFlops": true
  }
}
Sin texto antes ni después.`;
}

// ─────────────────────────────────────────────
//  GENERACIÓN VIRAL — función principal nueva
// ─────────────────────────────────────────────

/**
 * Genera un guión viral usando el sistema de auto-mejora con datos reales del canal.
 * Es la función principal — growth-engine la usa como primera opción.
 * Fallback: generateOptimizedScript() si esta falla.
 *
 * @param {Object} growthContext  - salida de makeDecision()
 * @param {Object} options        - { retryCount, previousGaps, trendContext }
 * @returns {Object}              - script completo con scores + metadata de aprendizaje
 */
async function generateViralScript(growthContext = {}, options = {}) {
  const { nextTopic, angle, hookType } = growthContext;
  const { retryCount = 0, previousGaps = [], trendContext = null } = options;
  const perf = createPerfTracker('content-optimizer.generateViralScript', { topic: nextTopic, attempt: retryCount + 1 });
  const llmMetrics = createLlmMetrics();

  try {
    logger.info(`Viral Generator | topic=${nextTopic} | hook=${hookType} | attempt=${retryCount + 1}`);

  // Cache lookup — solo primer intento
  if (retryCount === 0) {
    const cached = getFromCache(nextTopic, angle, hookType);
    if (cached) return cached;
  }

  // Construir contexto dinámico con datos reales del canal
  const dynCtx       = buildDynamicContext(growthContext, { trendContext });
  const systemPrompt = buildViralSystemPrompt(dynCtx);
  const userPrompt   = buildViralUserPrompt(dynCtx);
  // Feedback de reintento
  let retryFeedback = '';
  if (retryCount > 0 && previousGaps.length > 0) {
    retryFeedback = `\n\nREINTENTO ${retryCount}:\n${previousGaps.map(g => `- ${g}`).join('\n')}\nCorrige solo esos puntos y manten el resto fuerte.`;
  }

  const compactUserPrompt = `Genera un guion para Shorts virales de psicologia.

Parametros:
- topic: ${dynCtx.topic}
- angulo: ${dynCtx.angle || 'mecanismo cognitivo cotidiano'}
- hookType: ${dynCtx.hookType || 'revelation'}
- emotionalTrigger: ${dynCtx.emotionalTrigger || 'curiosity'}
- contexto: ${dynCtx.hasEnoughData ? 'usa el patron ganador historico del topic' : 'prioriza revelation > pattern > challenge'}

Estilo:
- espanol natural de Espana
- humano
- hablado
- directo
- incomodo y curioso
- no academico

Reglas:
- selecciona un solo hook ganador
- no empieces con "Tu cerebro..."
- no uses "Sabias que..."
- hook maximo 12 palabras
- open_loop 10-15 palabras
- micro_value 12-18 palabras y concreto
- escalation 20-30 palabras, hablada y cotidiana
- reengage 8-14 palabras con golpe
- peak 20-32 palabras
- open_ending 8-14 palabras
- soft_cta 7-12 palabras
- keywords exactamente 2
- solo JSON puro, sin markdown, sin fences, sin texto extra${retryFeedback}

Devuelve exactamente este JSON minimo:
${COMPACT_VIRAL_SCHEMA}`;

  perf.start('model_call');
  llmMetrics.llm_total_calls += 1;
  const message = await callAnthropicWithTimeout(client, {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 650,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: compactUserPrompt }],
  }, { label: 'content-optimizer.generateViralScript' });
  const modelPhase = perf.end({ model: 'claude-haiku-4-5-20251001' });

  const rawText  = message.content[0].text.trim();
  perf.start('json_parse');
  const { data: output, meta: parseMeta } = await parseModelJsonWithRecovery(rawText, {
    label: 'content-optimizer.generateViralScript',
    recover: (failedRaw) => requestJsonRecovery(compactUserPrompt, failedRaw, 'content-optimizer.generateViralScript', llmMetrics, 500, COMPACT_VIRAL_SCHEMA),
    validate: (data) => validateGeneratedScriptSchema(data?.script || data, { label: 'content-optimizer.generateViralScript.script', requireExpanded: true }) && data,
  });
  mergeLlmMetrics(llmMetrics, parseMeta);
  const parsePhase = perf.end(parseMeta);

  // Validación del output
  for (const field of ['script']) {
    if (!output[field]) throw new Error(`Campo requerido ausente en respuesta: ${field}`);
  }
  for (const field of ['hook']) {
    if (!output.script[field]) throw new Error(`Campo de script ausente: ${field}`);
  }

  const rawScript = {
    title:            `${nextTopic}_${Date.now()}`,
    topic:            output.topic || output.script.topic || nextTopic,
    hook:             output.script.hook,
    open_loop:        output.script.open_loop,
    micro_value:      output.script.micro_value || output.script.claim,
    escalation:       output.script.escalation,
    reengage:         output.script.reengage,
    peak:             output.script.peak || output.script.explanation,
    open_ending:      output.script.open_ending,
    soft_cta:         output.script.soft_cta || output.script.cta,
    claim:            output.script.claim,
    explanation:      output.script.explanation,
    cta:              output.script.cta,
    psychologicalFact:output.script.psychologicalFact || output.patternUsed || '',
    viralTrigger:     output.viralTrigger     || 'identificacion',
    emotionalTrigger: output.emotionalTrigger || output.script.emotionalTrigger || growthContext.emotionalTrigger || 'curiosity',
    durationSeconds:  Math.round((TARGET_MIN + TARGET_MAX) / 2),
    keywords:         output.script.keywords || output.keywords || [],
    hashtags:         output.script.hashtags || output.hashtags || ['#psicologia', '#mente', '#cerebro'],
    // Metadata del sistema viral
    allHooks:            null,
    selectedHookType:    output.selectedHookType || hookType,
    hookSelectionReason: output.hookSelectionReason || '',
    optimizationNotes:   { patronUsado: output.patternUsed || '' },
    learningSignals:     {},
    autoevaluacion:      {},
  };
  const script = finalizeOptimizedScript(rawScript, growthContext);

  // ── Scores ──
  const viralityResult = scoreScript(script);
  script.viralityScore     = viralityResult.score;
  script.viralityBreakdown = viralityResult.breakdown;

  const formatResult            = scoreFormatMatch(script);
  script.formatMatchScore       = formatResult.score;
  script.formatMatchBreakdown   = formatResult.breakdown;
  script.formatMatchSegmentGaps = script.segmentFeedbackSummary;
  script.formatMatchGaps        = [...formatResult.gaps, ...script.segmentFeedbackSummary];

  const emotionalResult           = scoreEmotionalImpact(script);
  script.emotionalImpactScore     = emotionalResult.score;
  script.emotionalImpactBreakdown = emotionalResult.breakdown;

  // ── Aprobación ──
  const minFormat       = parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '70');
  const minVirality     = parseInt(process.env.MIN_VIRALITY_SCORE_TO_QUEUE     || '60');
  const minHookStrength = parseInt(process.env.MIN_HOOK_STRENGTH               || '8');

  const hookStr    = viralityResult.breakdown?.hookStrength ?? getHookStrength(script.hook);
  const formatOk   = formatResult.score >= minFormat;
  const viralityOk = viralityResult.score >= minVirality;
  const hookOk     = hookStr >= minHookStrength;

  script.approved  = formatOk && viralityOk;
  script.rejectionReason = !script.approved
    ? [
          !formatOk   ? `format_match ${formatResult.score}/${minFormat}` : null,
          !viralityOk ? `virality ${viralityResult.score}/${minVirality}` : null,
          !hookOk     ? `hook_weak ${hookStr}/${minHookStrength} (penalty)` : null,
        ...script.segmentFeedbackSummary.slice(0, 3).map((issue) => `${issue} (penalty)`),
        ].filter(Boolean).join(' | ')
    : null;
  script.selectionPenalties = buildSelectionPenalties(script);
  script.growthContext.hookType = output.selectedHookType || growthContext.hookType;

  logger.info(
    `Viral Script | hook=${output.selectedHookType || hookType} | pattern=${output.patternUsed || '-'} | ` +
    `${script.estimatedWords}w ${script.durationSeconds}s | ` +
    `virality=${viralityResult.score} format=${formatResult.score} | ` +
    `${script.approved ? '✓ APROBADO' : `✗ RECHAZADO (${script.rejectionReason})`}`,
  );

  logger.info(
    `Viral Generator timing | topic=${nextTopic} | attempt=${retryCount + 1} | ` +
    `llmCalls=${llmMetrics.llm_total_calls} recovery=${llmMetrics.llm_recovery_used ? 1 : 0} truncated=${llmMetrics.llm_truncated_suspected ? 1 : 0} ` +
    `model=${formatDurationMs(modelPhase.durationMs)} parse=${formatDurationMs(parsePhase.durationMs)} ` +
    `total=${formatDurationMs(perf.snapshot().totalMs)}`,
  );

  attachLlmMetrics(script, llmMetrics);
  script.generationSource = 'generateViralScript';
  script.llmPath = ['generateViralScript'];
  if (script.approved) {
    saveLastValidScript(script, {
      topic: script.topic,
      angle,
      hookType: output.selectedHookType || hookType,
      emotionalTrigger: script.emotionalTrigger,
      generationSource: 'generateViralScript',
      createdAt: new Date().toISOString(),
    });
    saveToCache(nextTopic, angle, output.selectedHookType || hookType, script);
  }

  return script;
  } catch (err) {
    markLlmHardFail(llmMetrics, err);
    err.llmMetrics = { ...llmMetrics };
    perf.fail(err, llmMetrics);
    logger.error(`Viral Generator failed: ${err.message} | reason=${err.llm_truncated_suspected ? 'truncated' : err.llm_schema_fail ? 'schema' : err.llm_parse_fail ? 'parse' : 'hard_fail'}`);
    throw err;
  }
}

module.exports = {
  generateOptimizedScript,
  generateViralScript,
  buildDynamicContext,
  improveWeakSegments,
  isClearlyInvalidCandidate,
  buildSelectionPenalties,
};
