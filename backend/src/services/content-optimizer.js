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
const logger                                 = require('../utils/logger');

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
const TARGET_MIN = parseInt(process.env.FORMAT_TARGET_MIN_SECONDS || '20');
const TARGET_MAX = parseInt(process.env.FORMAT_TARGET_MAX_SECONDS || '30');
const WPS        = 2.3; // palabras/segundo narración calmada

const TARGET_MIN_WORDS = Math.round(TARGET_MIN * WPS);
const TARGET_MAX_WORDS = Math.round(TARGET_MAX * WPS);
const TARGET_MID_SECS  = Math.round((TARGET_MIN + TARGET_MAX) / 2);

// ─────────────────────────────────────────────
//  SYSTEM PROMPT
// ─────────────────────────────────────────────

function buildSystemPrompt(growthContext = {}, trendContext = null) {
  const {
    nextTopic, hookType, emotionalTrigger, angle,
    avoidTopics = [], avoidRecentHooks = [],
  } = growthContext;

  const recentHooksNote = avoidRecentHooks.length > 0
    ? `\nHOOKS USADOS RECIENTEMENTE (NO repetir ni parecerse):\n${avoidRecentHooks.slice(0, 5).map((h) => `  - "${h}"`).join('\n')}`
    : '';

  const trendNote = (trendContext?.hookHints?.length > 0)
    ? `\n\nTENDENCIAS ACTIVAS AHORA:\n${trendContext.hookHints.slice(0, 6).map((h) => `  • "${h}"`).join('\n')}\nAdapta el lenguaje del hook a estas tendencias. No copies literalmente — úsalas para hacer el hook más reconocible hoy.`
    : '';

  const patternNote = getPatternContextForPrompt(nextTopic) || '';

  return `No eres un educador. No eres un divulgador.
Eres una máquina de retención para YouTube Shorts de psicología.
Tu único objetivo: detener el scroll en menos de 2 segundos, mantener la atención hasta el final, provocar identificación emocional, generar comentarios y hacer que el vídeo se repita.

════════════════════════════════════════
ESTRUCTURA OBLIGATORIA DEL GUIÓN
════════════════════════════════════════

[SEGUNDO 0-2 — HOOK]
La única frase que decide si la persona sigue o no.
Sin introducción. Sin contexto previo. Impacto directo.

[SEGUNDOS 2-10 — DESARROLLO (claim)]
Explicación parcial. Mantén la tensión. Cada frase añade algo nuevo.
Dato concreto: número, nombre de efecto psicológico, mecanismo neurológico.

[SEGUNDOS 10-18 — REVELACIÓN (explanation)]
Explicación clara pero impactante. Sensación de "esto me pasa a mí".
2-3 frases. Ejemplo cotidiano vivido esta semana.

[SEGUNDOS 18-22 — LOOP FINAL (cta)]
Conecta con el inicio. Deja una idea abierta.
Provoca que el usuario lo vuelva a ver.
Añade una micro-conexión: "y probablemente te pasa más de lo que crees" / "y no eres el único al que le pasa esto".

════════════════════════════════════════
REGLA MÁS IMPORTANTE — EL HOOK
════════════════════════════════════════

El hook debe cumplir AL MENOS UNA de estas condiciones:
  1. Hacer que el espectador se sienta identificado de forma incómoda
  2. Insinuar que hay algo mal en su comportamiento
  3. Revelar algo que "no debería saber"
  4. Crear una duda urgente en su cabeza
  5. Atacar directamente al espectador ("si haces esto…")

NIVEL DE CALIDAD OBLIGATORIO (estudia la diferencia):

  ✗ MALO: "Si haces esto, tu cerebro hace X"
  ✓ BUENO: "Si haces esto sin darte cuenta, tu cerebro está fallando"

  ✗ MALO: "Esto pasa cuando lees mal"
  ✓ BUENO: "Si relees lo mismo, algo en tu cerebro no está funcionando"

  ✗ MALO: "Tu cerebro usa atajos cognitivos"
  ✓ BUENO: "Tu cerebro te convence de que tus decisiones son tuyas. No lo son."

  ✗ MALO: "La dopamina afecta tu motivación"
  ✓ BUENO: "Cada vez que completas algo fácil, tu cerebro mata tu ambición"

HOOKS DE REFERENCIA (este nivel o superior):
  ✓ "Si revisas el móvil al despertar, tu día ya está saboteado."
  ✓ "El 73% de las decisiones que tomas hoy no son tuyas."
  ✓ "Cada vez que dices 'estoy bien', tu cuerpo registra lo contrario."
  ✓ "Tu mente tiene un modo automático que opera sin que lo sepas."

HOOKS PROHIBIDOS (nunca):
  ✗ Cualquier hook que empiece con: "Hoy", "En este vídeo", "Hola", "Existen", "Es importante"
  ✗ Hooks vagos o académicos que no creen tensión inmediata
  ✗ Hooks que informen sin provocar

REGLAS TÉCNICAS DEL HOOK:
  • 8-13 palabras exactas
  • Sin puntos suspensivos al final

════════════════════════════════════════
REGLAS DE CADA SECCIÓN
════════════════════════════════════════

DESARROLLO (claim):
  • 1-2 frases, máximo 20 palabras total
  • Obligatorio: cifra (68%) O nombre de efecto (Efecto Zeigarnik) O neurociencia (amígdala, cortisol, dopamina)
  • Afirma. No expliques todavía. Crea tensión.

REVELACIÓN (explanation):
  • 2-3 frases. Máximo 40 palabras total. Cada frase: ≤12 palabras.
  • Al menos 3 de: cerebro, cortisol, dopamina, amígdala, inconsciente, automáticamente, estudio, neurona, hipocampo, prefrontal
  • Usa "tú", "te", "tu" — nunca "las personas" o "la gente"
  • Ejemplo vivido HOY o esta semana
  • Introduce una micro-frase que provoque reacción natural (sin pedir): "seguro que te ha pasado" / "lo has notado alguna vez" / "esto explica mucho"

LOOP FINAL (cta):
  • 1 frase. Máximo 12 palabras.
  • Conecta con el hook del inicio — cierra el arco
  • Deja una idea abierta que siga rebotando
  • Incluye micro-conexión emocional para generar suscriptores: "y probablemente te pasa más de lo que crees" / "y no eres el único"
  • PROHIBIDO: "suscríbete", "dale like", "sígueme", pregunta directa tipo "¿comenta si..."

TOTAL: ${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} palabras (${TARGET_MIN}-${TARGET_MAX}s)
${recentHooksNote}${trendNote}${patternNote}

════════════════════════════════════════
PARÁMETROS DE ESTE GUIÓN
════════════════════════════════════════${nextTopic ? `\nTema: ${nextTopic}` : ''}${angle ? `\nÁngulo: ${angle}` : ''}${hookType ? `\nTipo de hook: ${hookType}` : ''}${emotionalTrigger ? `\nTrigger emocional objetivo: ${emotionalTrigger}` : ''}${avoidTopics.length > 0 ? `\nEvitar (ya cubiertos): ${avoidTopics.join(', ')}` : ''}

FÓRMULAS DE HOOK SEGÚN TIPO:
  • revelation → "Tu [cerebro/mente] [hace algo inesperado] sin que lo sepas"
  • pattern    → "Cada vez que [situación cotidiana], tu cerebro [consecuencia sorprendente]"
  • challenge  → "El [X]% de personas [comportamiento universal sorprendente]"
  • warning    → "Si [hábito común], [consecuencia que no esperabas]"
  • question   → "Por qué [no puedes/siempre haces/nunca logras] [comportamiento universal]"
  • secret     → "Hay [un mecanismo/una razón] por la que [comportamiento propio]"

════════════════════════════════════════
AUTOEVALUACIÓN OBLIGATORIA (antes de devolver)
════════════════════════════════════════
Responde internamente SÍ/NO:
  1. ¿Esto detiene el scroll en menos de 2 segundos?
  2. ¿El hook hace que el espectador se sienta identificado o incómodo?
  3. ¿Cada frase añade algo nuevo — no repite ni rellena?
  4. ¿Hay progresión clara: hook → tensión → revelación → loop?
  5. ¿El loop final conecta con el hook y deja algo rebotando?
  6. ¿Tiene potencial de rewatch (alguien lo volvería a ver)?

Si cualquier respuesta es NO → reescribe antes de responder.

════════════════════════════════════════
DEVUELVE SOLO JSON — sin markdown, sin texto extra
════════════════════════════════════════
{
  "title": "slug_breve_identificador",
  "topic": "habits|dopamine|procrastination|cognitive_biases|body_language|emotional_patterns|relationships|decision_making|attention|memory|social_patterns|perception|motivation|self_talk|emotions",
  "hook": "frase que para el scroll — identificación incómoda (8-13 palabras)",
  "claim": "dato concreto con cifra o nombre de efecto (10-20 palabras)",
  "explanation": "2-3 frases cortas, max 40 palabras, ejemplo cotidiano + micro-frase de identificación natural",
  "cta": "loop final — conecta con hook, micro-conexión emocional, sin pedir nada (≤12 palabras)",
  "psychologicalFact": "el mecanismo psicológico exacto con su nombre si existe",
  "viralTrigger": "sorpresa|identificacion|controversia|utilidad|miedo",
  "emotionalTrigger": "curiosity|fear|awe|validation|urgency|relatability",
  "durationSeconds": ${TARGET_MID_SECS},
  "keywords": ["concepto_visual_1", "concepto_visual_2"],
  "hashtags": ["#psicologia", "#mente", "#cerebro", "#habitos", "#viral"]
}`;
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
      ? `Fallos del intento anterior:\n${previousGaps.map((g) => `  • ${g}`).join('\n')}`
      : '';
    retryFeedback = `\n\n⚠️ REINTENTO ${retryCount}: El intento anterior fue rechazado. ${gapLines}
Correcciones obligatorias: hook más brutal (<13 palabras), explicación más corta (<40 palabras total), cero relleno.`;
  }

  const userPrompt = `Genera un guión de psicología viral de ALTA CALIDAD.

PARÁMETROS:
- Tema: ${nextTopic || 'comportamiento humano'}
- Ángulo: ${angle || 'mecanismo cognitivo cotidiano'}
- Tipo de hook: ${hookType || 'revelation'}
- Trigger emocional: ${emotionalTrigger || 'curiosity'}

EXIGENCIAS DE CALIDAD (se comprueba con scorer automático):
- Hook: 1 frase, 8-13 palabras, impacto brutal en segundo 0 — sin intro, sin contexto
- Claim: breve y concreto (≤15 palabras), con dato real: número, nombre de efecto o mecanismo
- Explanation: 2-3 frases, máximo 40 palabras, cada frase ≤10 palabras, 1 idea
- CTA: 1 frase de cierre, ≤10 palabras
- Total: ${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} palabras (${TARGET_MIN}-${TARGET_MAX}s)
- Cero intro, cero relleno, cero academicismo${retryFeedback}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 450,
    system: buildSystemPrompt(growthContext, trendContext),
    messages: [{ role: 'user', content: userPrompt }],
  });

  const rawText  = message.content[0].text.trim();
  const jsonText = rawText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const script   = JSON.parse(jsonText);

  for (const field of ['hook', 'claim', 'explanation', 'cta', 'topic']) {
    if (!script[field]) throw new Error(`Campo requerido ausente: ${field}`);
  }

  // Duración real
  const totalWords = [script.hook, script.claim, script.explanation, script.cta]
    .filter(Boolean).join(' ').split(/\s+/).length;
  script.estimatedWords  = totalWords;
  script.durationSeconds = Math.round(totalWords / WPS);

  // ── Scores ──
  const viralityResult = scoreScript(script);
  script.viralityScore     = viralityResult.score;
  script.viralityBreakdown = viralityResult.breakdown;

  const formatResult            = scoreFormatMatch(script);
  script.formatMatchScore       = formatResult.score;
  script.formatMatchBreakdown   = formatResult.breakdown;
  script.formatMatchGaps        = formatResult.gaps;

  const emotionalResult           = scoreEmotionalImpact(script);
  script.emotionalImpactScore     = emotionalResult.score;
  script.emotionalImpactBreakdown = emotionalResult.breakdown;

  // ── Aprobación (para cola) ──
  const minFormat      = parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '70');
  const minVirality    = parseInt(process.env.MIN_VIRALITY_SCORE_TO_QUEUE     || '55');
  const minHookStrength = parseInt(process.env.MIN_HOOK_STRENGTH              || '8');

  const hookStr    = viralityResult.breakdown?.hookStrength ?? getHookStrength(script.hook);
  const formatOk   = formatResult.score >= minFormat;
  const viralityOk = viralityResult.score >= minVirality;
  const hookOk     = hookStr >= minHookStrength;

  script.approved = formatOk && viralityOk && hookOk;
  script.rejectionReason = !script.approved
    ? [
        !formatOk   ? `format_match ${formatResult.score}/${minFormat}` : null,
        !viralityOk ? `virality ${viralityResult.score}/${minVirality}` : null,
        !hookOk     ? `hook_weak ${hookStr}/${minHookStrength}` : null,
      ].filter(Boolean).join(' | ')
    : null;

  // Contexto trazable
  script.growthContext = {
    topic:           growthContext.nextTopic,
    hookType:        growthContext.hookType,
    emotionalTrigger:growthContext.emotionalTrigger,
    angle:           growthContext.angle,
    strategy:        growthContext.strategy,
    decisionAt:      growthContext.decisionAt,
  };

  logger.info(
    `Script | ${totalWords}w ${script.durationSeconds}s | ` +
    `virality=${viralityResult.score} format=${formatResult.score} emotion=${emotionalResult.score} | ` +
    `${script.approved ? '✓ APROBADO' : `✗ RECHAZADO (${script.rejectionReason})`}`,
  );

  // Guardar en caché solo si está aprobado
  if (script.approved) {
    saveToCache(nextTopic, angle, hookType, script);
  }

  return script;
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
    topic, angle, hookType, emotionalTrigger,
    topPatterns, worstPatterns, previousWinners, previousFlops,
    bestHookTypes, channelAverages, recentPerformanceInsights,
    trendingKeywords, trendingTopics, hasEnoughData,
    topHooksRef, flopHooks, hookTypePerf, bestHookTypeFromAdv,
  } = ctx;

  // Formatear patrones ganadores
  const topPatternsText = topPatterns.length > 0
    ? topPatterns.map(p =>
        `  • [${p.id}] "${p.label}"` +
        (p.avgViews > 0 ? ` — ${p.avgViews} views prom, winRate ${((p.winRate || 0) * 100).toFixed(0)}%` : '') +
        (p.topExample ? `\n    Ejemplo real: "${p.topExample}"` : '') +
        (p.topics?.length ? `\n    Funciona en: ${p.topics.join(', ')}` : '')
      ).join('\n')
    : '  (sin datos suficientes — el canal está aprendiendo)';

  const worstPatternsText = worstPatterns.length > 0
    ? worstPatterns.map(p =>
        `  ✗ [${p.id}] "${p.label}"` +
        (p.avgViews > 0 ? ` — solo ${p.avgViews} views prom` : '') +
        (p.topExample ? ` → "${p.topExample}"` : '')
      ).join('\n')
    : '  (sin datos de fallos todavía)';

  const winnersText = previousWinners.length > 0
    ? previousWinners.map(w =>
        `  ✓ "${w.hook}" → ${w.views.toLocaleString()} views${w.engagement > 0 ? `, ${(w.engagement * 100).toFixed(1)}% eng` : ''} [${w.topic}]`
      ).join('\n')
    : '  (sin winners registrados todavía)';

  const flopsText = previousFlops.length > 0
    ? previousFlops.map(f =>
        `  ✗ "${f.hook}" → solo ${f.views} views [${f.topic}]`
      ).join('\n')
    : '  (sin flops registrados todavía)';

  const trendText = trendingKeywords.length > 0
    ? `Señales activas ahora:\n${trendingKeywords.map(k => `  • "${k}"`).join('\n')}\n\nTopics en tendencia: ${trendingTopics.join(', ')}\n\nCómo usarlas: No solo elijas el tema — usa el lenguaje real de la tendencia en el hook y en el framing. Si trend="doomscrolling", el hook NO es "el doomscrolling es malo" — es "Si haces esto antes de dormir, no es casualidad".`
    : '(sin señales de tendencias activas esta sesión)';

  const insightsText = recentPerformanceInsights.length > 0
    ? recentPerformanceInsights.join('\n  ')
    : 'sin datos históricos para este topic aún';

  const channelText = channelAverages.totalVideos > 0
    ? `${channelAverages.totalVideos} vídeos publicados | virality score promedio: ${channelAverages.avgViralScore} | format score promedio: ${channelAverages.avgFormatScore}`
    : 'canal en fase inicial — sin datos históricos suficientes';

  const bestHookTypesText = bestHookTypes.length > 0
    ? bestHookTypes.join(', ')
    : 'revelation (por defecto, mejor retención documentada)';

  // Top hooks reales del canal como referencia de estructura (Part 16)
  const topHooksRefText = topHooksRef?.length > 0
    ? topHooksRef.map(h =>
        `  ✓ "${h.hook}" [${h.hookType}/${h.topic}]${h.views > 0 ? ` — ${h.views.toLocaleString()} views` : ''}`
      ).join('\n')
    : null;

  // Hooks de flop a evitar
  const flopHooksText = flopHooks?.length > 0
    ? flopHooks.slice(0, 3).map(h => `  ✗ "${h}"`).join('\n')
    : null;

  // Rendimiento del hookType actual
  const hookTypePerfText = hookTypePerf
    ? `HookType "${hookTypePerf.hookType}": avgViews=${hookTypePerf.avgViews}, winRate=${hookTypePerf.winRate}%, earlyScore=${hookTypePerf.avgEarlyScore ?? 'sin datos'}`
    : null;

  const topHooksSection = topHooksRefText
    ? `\n═══════════════════════════════════════\nTOP HOOKS REALES DEL CANAL (top 20% — reutiliza su ESTRUCTURA, no el texto)\n═══════════════════════════════════════\n\n${topHooksRefText}${flopHooksText ? `\n\nHOOKS DE FLOP (evita estas estructuras):\n${flopHooksText}` : ''}${hookTypePerfText ? `\n\nRENDIMIENTO DEL HOOK TYPE ACTUAL:\n  ${hookTypePerfText}` : ''}${bestHookTypeFromAdv ? `\n\nMEJOR HOOK TYPE GLOBAL DEL CANAL: "${bestHookTypeFromAdv}"` : ''}\n`
    : '';

  return `No eres un educador. No eres un divulgador clásico.
Eres una máquina de retención para YouTube Shorts de psicología.

Tu objetivo NO es informar. Tu objetivo es:
  • Detener el scroll en menos de 2 segundos
  • Mantener la atención hasta el final
  • Provocar identificación emocional
  • Generar comentarios de forma orgánica
  • Hacer que el vídeo se repita (rewatch)
  • Conseguir que el espectador piense "quiero ver más de este canal"

Generas el guión con mayor probabilidad de retención real — usando el histórico real de este canal, no intuición general.

═══════════════════════════════════════
DATOS REALES DEL CANAL (prioridad máxima)
═══════════════════════════════════════

📊 ESTADO DEL CANAL:
${channelText}

🏆 HOOKS GANADORES — reutiliza su estructura:
${winnersText}

💀 HOOKS FALLIDOS — evita estas estructuras:
${flopsText}

🎯 TIPOS DE HOOK CON MEJOR RENDIMIENTO (en orden):
${bestHookTypesText}
${topHooksSection}

📈 RENDIMIENTO RECIENTE PARA ESTE TOPIC (${topic}):
  ${insightsText}

═══════════════════════════════════════
PATRONES ESTRUCTURALES DEL CANAL
═══════════════════════════════════════

✅ PATRONES GANADORES (prioriza en este orden):
${topPatternsText}

❌ PATRONES DE BAJO RENDIMIENTO (evitar):
${worstPatternsText}

Si un patrón ganador coincide con el topic → priorízalo sobre cualquier intuición creativa.
Si el histórico contradice tu decisión → el histórico manda.

═══════════════════════════════════════
TENDENCIAS ACTIVAS AHORA
═══════════════════════════════════════

${trendText}

═══════════════════════════════════════
LA REGLA MÁS IMPORTANTE — EL HOOK
═══════════════════════════════════════

El hook debe cumplir AL MENOS UNA:
  1. Hacer que el espectador se sienta identificado de forma incómoda
  2. Insinuar que hay algo mal en su comportamiento
  3. Revelar algo que "no debería saber"
  4. Crear una duda urgente en su cabeza
  5. Atacar directamente al espectador ("si haces esto…")

Si el hook no genera reacción inmediata → ES INVÁLIDO. Reescribe.

NIVEL DE CALIDAD (aprende la diferencia):
  ✗ MALO:  "Si haces esto, tu cerebro hace X"
  ✓ BUENO: "Si haces esto sin darte cuenta, tu cerebro está fallando"

  ✗ MALO:  "Tu cerebro usa atajos cognitivos"
  ✓ BUENO: "Tu cerebro te convence de que tus decisiones son tuyas. No lo son."

  ✗ MALO:  "La dopamina afecta tu motivación"
  ✓ BUENO: "Cada vez que completas algo fácil, tu cerebro mata tu ambición"

REGLAS TÉCNICAS DEL HOOK:
  • 8-13 palabras exactas
  • Sin intro ("Hoy", "En este vídeo", "Hola", "Quiero contarte")
  • Sin puntos suspensivos al final

═══════════════════════════════════════
ESTRUCTURA OBLIGATORIA DEL GUIÓN
═══════════════════════════════════════

HOOK (0-2s) → campo "hook":
  Directo, incómodo, intrigante. Sin contexto previo.

DESARROLLO (2-10s) → campo "claim":
  Explicación parcial. Mantén tensión. Dato concreto (número, efecto, mecanismo).
  1-2 frases, máximo 20 palabras.

REVELACIÓN (10-18s) → campo "explanation":
  Explicación clara pero impactante. Sensación de "esto me pasa".
  2-3 frases cortas, máximo 40 palabras total.
  Incluye ejemplo cotidiano + micro-frase orgánica de identificación:
    "seguro que te ha pasado" / "lo has notado alguna vez" / "esto explica mucho"
  NO hagas pregunta directa tipo "¿comenta si…". Debe ser natural.

LOOP FINAL (18-22s) → campo "cta":
  Conecta con el inicio. Deja una idea abierta. Provoca rewatch.
  Añade micro-conexión emocional para generar suscriptores:
    "y probablemente te pasa más de lo que crees" / "y no eres el único al que le pasa esto"
  1 frase, máximo 12 palabras.
  PROHIBIDO: "suscríbete", "dale like", "sígueme"

TOTAL: 46-69 palabras (20-30 segundos)

═══════════════════════════════════════
OPTIMIZACIÓN PARA COMENTARIOS Y SUSCRIPTORES
═══════════════════════════════════════

El contenido debe hacer que el usuario piense:
  • "quiero ver más de esto"
  • "este canal me entiende"
  • "esto me pasa siempre"

Para comentarios: introduce la micro-frase orgánica en la REVELACIÓN (no en el CTA).
Para suscriptores: introduce la micro-conexión en el LOOP FINAL.
Ambas deben sonar naturales — jamás como una instrucción.

═══════════════════════════════════════
AUTOEVALUACIÓN OBLIGATORIA (antes de devolver)
═══════════════════════════════════════

Responde internamente SÍ/NO. Si alguna es NO → reescribe:
  1. ¿El hook detiene el scroll en menos de 2 segundos?
  2. ¿El hook provoca identificación incómoda o duda urgente?
  3. ¿Cada frase añade algo nuevo — sin repetir ni rellenar?
  4. ¿Hay progresión: hook → tensión → revelación → loop que conecta con inicio?
  5. ¿El loop final deja algo rebotando en la cabeza?
  6. ¿Tiene potencial de rewatch real?
  7. ¿Es mejor que la media del canal (${channelAverages.avgViralScore} virality, ${channelAverages.avgFormatScore} format)?
  8. ¿Es diferente a los flops del canal?

═══════════════════════════════════════
FORMATO DE RESPUESTA — SOLO JSON, SIN MARKDOWN
═══════════════════════════════════════

{
  "hooks": {
    "revelation": "hook tipo revelation — identificación incómoda (8-13 palabras)",
    "pattern": "hook tipo pattern — comportamiento cotidiano sorprendente (8-13 palabras)",
    "challenge": "hook tipo challenge — duda urgente o ataque directo (8-13 palabras)"
  },
  "selectedHook": {
    "tipo": "revelation|pattern|challenge",
    "texto": "el hook seleccionado",
    "razon": "por qué este hook tiene mayor probabilidad de retención (1 frase)"
  },
  "script": {
    "hook": "(= selectedHook.texto — identificación incómoda)",
    "claim": "dato concreto, tensión, sin explicar todavía (≤20 palabras)",
    "explanation": "2-3 frases. Revelación impactante. Ejemplo real. Micro-frase orgánica de identificación. (≤40 palabras)",
    "cta": "loop mental — conecta con hook — micro-conexión emocional — sin pedir nada (≤12 palabras)"
  },
  "topic": "${topic}",
  "viralTrigger": "sorpresa|identificacion|controversia|utilidad|miedo",
  "emotionalTrigger": "curiosity|fear|awe|validation|urgency|relatability",
  "keywords": ["keyword_visual_1", "keyword_visual_2"],
  "hashtags": ["#psicologia", "#mente", "#cerebro", "#habitos"],
  "optimizationNotes": {
    "patronUsado": "id y nombre del patrón estructural elegido",
    "tendenciaAprovechada": "qué señal de tendencia se usó o 'ninguna activa'",
    "queSeEvito": "qué estructura de flop o patrón débil se descartó",
    "porQueEsteHookEsFuerte": "qué regla de identificación/incomodidad cumple",
    "porQueGeneraRewatch": "por qué el loop final provoca ver el vídeo otra vez",
    "porQueGeneraComentarios": "qué micro-frase orgánica provoca reacción"
  },
  "learningSignals": {
    "expectedHookTypePerformance": "alto|medio|bajo",
    "expectedPatternPerformance": "alto|medio|bajo",
    "expectedAudienceReaction": "descripción de 1 frase",
    "possibleRisk": "riesgo identificado o 'ninguno detectado'"
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
}`;
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
Selecciona el de mayor probabilidad de detener el scroll.

El guión debe:
  1. Hook → detener scroll en 2s con identificación incómoda o duda urgente
  2. Desarrollo → tensión creciente, dato concreto, sin explicar todavía
  3. Revelación → impacto emocional + ejemplo real + micro-frase orgánica de identificación
  4. Loop final → conectar con el hook, dejar idea abierta, micro-conexión para suscriptores

El objetivo NO es informar. Es crear un vídeo que se repita.

Devuelve SOLO el JSON. Sin texto antes ni después.`;
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
    retryFeedback = `\n\n⚠️ REINTENTO ${retryCount}: El intento anterior fue rechazado.\nCorrecciones obligatorias:\n${previousGaps.map(g => `  • ${g}`).join('\n')}\nReescribe completamente con estas correcciones.`;
  }

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1400,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt + retryFeedback }],
  });

  const rawText  = message.content[0].text.trim();
  const jsonText = rawText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const output   = JSON.parse(jsonText);

  // Validación del output
  for (const field of ['hooks', 'selectedHook', 'script']) {
    if (!output[field]) throw new Error(`Campo requerido ausente en respuesta: ${field}`);
  }
  for (const field of ['hook', 'claim', 'explanation', 'cta']) {
    if (!output.script[field]) throw new Error(`Campo de script ausente: ${field}`);
  }

  // Construir script compatible con sistema de scoring
  const script = {
    title:            `${nextTopic}_${Date.now()}`,
    topic:            output.topic || nextTopic,
    hook:             output.script.hook,
    claim:            output.script.claim,
    explanation:      output.script.explanation,
    cta:              output.script.cta,
    psychologicalFact:output.optimizationNotes?.patronUsado || '',
    viralTrigger:     output.viralTrigger     || 'identificacion',
    emotionalTrigger: output.emotionalTrigger || growthContext.emotionalTrigger || 'curiosity',
    durationSeconds:  Math.round((TARGET_MIN + TARGET_MAX) / 2),
    keywords:         output.keywords  || [],
    hashtags:         output.hashtags  || ['#psicologia', '#mente', '#cerebro'],
    // Metadata del sistema viral
    allHooks:            output.hooks,
    selectedHookType:    output.selectedHook?.tipo,
    hookSelectionReason: output.selectedHook?.razon,
    optimizationNotes:   output.optimizationNotes  || {},
    learningSignals:     output.learningSignals     || {},
    autoevaluacion:      output.autoevaluacion      || {},
  };

  // Duración real
  const totalWords       = [script.hook, script.claim, script.explanation, script.cta]
    .filter(Boolean).join(' ').split(/\s+/).length;
  script.estimatedWords  = totalWords;
  script.durationSeconds = Math.round(totalWords / WPS);

  // ── Scores ──
  const viralityResult = scoreScript(script);
  script.viralityScore     = viralityResult.score;
  script.viralityBreakdown = viralityResult.breakdown;

  const formatResult            = scoreFormatMatch(script);
  script.formatMatchScore       = formatResult.score;
  script.formatMatchBreakdown   = formatResult.breakdown;
  script.formatMatchGaps        = formatResult.gaps;

  const emotionalResult           = scoreEmotionalImpact(script);
  script.emotionalImpactScore     = emotionalResult.score;
  script.emotionalImpactBreakdown = emotionalResult.breakdown;

  // ── Aprobación ──
  const minFormat       = parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '70');
  const minVirality     = parseInt(process.env.MIN_VIRALITY_SCORE_TO_QUEUE     || '55');
  const minHookStrength = parseInt(process.env.MIN_HOOK_STRENGTH               || '8');

  const hookStr    = viralityResult.breakdown?.hookStrength ?? getHookStrength(script.hook);
  const formatOk   = formatResult.score >= minFormat;
  const viralityOk = viralityResult.score >= minVirality;
  const hookOk     = hookStr >= minHookStrength;

  script.approved  = formatOk && viralityOk && hookOk;
  script.rejectionReason = !script.approved
    ? [
        !formatOk   ? `format_match ${formatResult.score}/${minFormat}` : null,
        !viralityOk ? `virality ${viralityResult.score}/${minVirality}` : null,
        !hookOk     ? `hook_weak ${hookStr}/${minHookStrength}` : null,
      ].filter(Boolean).join(' | ')
    : null;

  // ── Contexto de decisión ──
  script.growthContext = {
    topic:            growthContext.nextTopic,
    hookType:         output.selectedHook?.tipo || growthContext.hookType,
    emotionalTrigger: growthContext.emotionalTrigger,
    angle:            growthContext.angle,
    strategy:         growthContext.strategy,
    decisionAt:       growthContext.decisionAt,
  };

  logger.info(
    `Viral Script | hook=${output.selectedHook?.tipo} | pattern=${output.optimizationNotes?.patronUsado} | ` +
    `${totalWords}w ${script.durationSeconds}s | ` +
    `virality=${viralityResult.score} format=${formatResult.score} | ` +
    `${script.approved ? '✓ APROBADO' : `✗ RECHAZADO (${script.rejectionReason})`}`,
  );

  if (script.approved) {
    saveToCache(nextTopic, angle, output.selectedHook?.tipo || hookType, script);
  }

  return script;
}

module.exports = { generateOptimizedScript, generateViralScript, buildDynamicContext };
