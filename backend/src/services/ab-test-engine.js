/**
 * ab-test-engine.js  v2 — A/B TESTING REAL DE PUBLICACIÓN
 *
 * CAMBIO CRÍTICO respecto a v1:
 *   Antes → genera variantes, elige UNA, publica 1 vídeo.
 *   Ahora → genera variantes, publica TODAS (2 vídeos por experimento).
 *
 * Flujo:
 *   1. createMultiVariantExperiment(baseScript)
 *      → genera 1 hook alternativo con Claude Haiku
 *      → encola v_a (hook original) y v_b (hook alternativo)
 *      → crea registro del experimento en ab-experiments-v2.json
 *
 *   2. evaluateMultiVariantExperiments(recentVideos)
 *      → compara earlyScore entre variantes
 *      → si una supera a la otra ≥ 1.3x → winner
 *      → actualiza pesos de hookType en hook-performance.json
 *
 * Persistencia:
 *   ab-experiments-v2.json  → experimentos multi-variante (nuevo formato)
 *   ab-experiments.json     → experimentos legacy (solo lectura, sin modificar)
 *   hook-performance.json   → pesos de hookType (compartido con early-winner)
 */

'use strict';

require('dotenv').config();

const fs        = require('fs');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');
const { ensureLegacyFields } = require('../utils/script-segments');
const { parseModelJsonWithRecovery } = require('../utils/llm-json');
const { callAnthropicWithTimeout, createLlmMetrics, mergeLlmMetrics, markLlmHardFail } = require('../utils/llm-call');
const { linkAbVariantToSlot } = require('../../../content-engine/tracking/ab-slot-linker');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function requestJsonRecovery(prompt, rawText, label, llmMetrics, maxTokens = 220) {
  logger.warn(`${label}: requesting clean JSON recovery from model`);
  llmMetrics.llm_total_calls += 1;
  const recovery = await callAnthropicWithTimeout(client, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: `${prompt}\n\nTu respuesta anterior no era JSON valido. Devuelve SOLO JSON VALIDO. Sin markdown. Sin fences. Sin javascript. Sin texto explicativo. Sin texto antes ni despues. Una unica respuesta JSON parseable.\n\nRESPUESTA ANTERIOR:\n${String(rawText || '').slice(0, 12000)}`,
    }],
  }, { label: `${label}.recovery` });
  return recovery.content?.[0]?.text?.trim() || '';
}

const EXPERIMENTS_V2_PATH   = path.resolve('./data/ab-experiments-v2.json');
const EXPERIMENTS_LEGACY_PATH = path.resolve('./data/ab-experiments.json');
const HOOK_PERFORMANCE_PATH = path.resolve('./data/hook-performance.json');

// Mínimo de vistas por ventana temporal para considerar el earlyScore válido
const WINDOW_CONFIGS = [
  { label: '1-3h',   minH: 1,  maxH: 3,  minViews: 200, threshold: 1.5 },
  { label: '6-12h',  minH: 6,  maxH: 12, minViews: 500, threshold: 1.3 },
  { label: '12-24h', minH: 12, maxH: 24, minViews: 1000,threshold: 1.2 },
];

const DEFAULT_TYPE_WEIGHTS = {
  revelation: 4, pattern: 3, challenge: 2, original: 2,
};

const SEGMENT_TEST_PLANS = {
  hook: {
    segmentType: 'hook',
    testedVariable: 'hook_style',
    variantIntent: 'hook_b_more_aggressive',
    fields: ['hook', 'open_loop', 'micro_value'],
  },
  reengage: {
    segmentType: 'reengage',
    testedVariable: 'mid_retention_recovery',
    variantIntent: 'reengage_b_more_aggressive',
    fields: ['hook', 'escalation', 'reengage', 'peak'],
  },
  open_ending: {
    segmentType: 'open_ending',
    testedVariable: 'loop_openness',
    variantIntent: 'open_ending_b_more_open_loop',
    fields: ['peak', 'open_ending', 'soft_cta'],
  },
  peak: {
    segmentType: 'peak',
    testedVariable: 'peak_frame',
    variantIntent: 'peak_b_more_emotional',
    fields: ['micro_value', 'escalation', 'reengage', 'peak', 'open_ending'],
  },
  soft_cta: {
    segmentType: 'soft_cta',
    testedVariable: 'comment_conversion',
    variantIntent: 'soft_cta_b_more_identification',
    fields: ['peak', 'open_ending', 'soft_cta'],
  },
};

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function readJSON(file, def) {
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

// Lazy-require para evitar dependencia circular con video-processor
function getQueue() {
  return require('../queue/video-processor');
}

function rebuildLegacySegments(scriptInput = {}) {
  return ensureLegacyFields({
    ...scriptInput,
    claim: scriptInput.claim || scriptInput.micro_value,
    explanation: scriptInput.explanation || [scriptInput.escalation, scriptInput.reengage, scriptInput.peak].filter(Boolean).join(' ').trim(),
    cta: scriptInput.cta || [scriptInput.open_ending, scriptInput.soft_cta].filter(Boolean).join(' ').trim(),
    structureVersion: scriptInput.structureVersion || 'open_loop_escalation_v1',
    hasReengage: typeof scriptInput.hasReengage === 'boolean' ? scriptInput.hasReengage : Boolean(scriptInput.reengage),
  });
}

function chooseExperimentPlan(scriptInput = {}, growthContext = {}) {
  const script = rebuildLegacySegments(scriptInput);
  const requested = growthContext.abTestSegmentType || script.abTestSegmentType;
  if (requested && SEGMENT_TEST_PLANS[requested]) return SEGMENT_TEST_PLANS[requested];

  if (!script.reengage) return SEGMENT_TEST_PLANS.hook;
  if (script.durationSeconds >= 55) return SEGMENT_TEST_PLANS.reengage;
  if (script.viralTrigger === 'controversia') return { ...SEGMENT_TEST_PLANS.soft_cta, variantIntent: 'soft_cta_b_more_polemic' };
  if (script.emotionalTrigger === 'validation') return { ...SEGMENT_TEST_PLANS.peak, variantIntent: 'peak_b_more_emotional' };
  if (script.emotionalTrigger === 'awe') return { ...SEGMENT_TEST_PLANS.peak, variantIntent: 'peak_b_more_scientific' };
  return SEGMENT_TEST_PLANS.open_ending;
}

function buildSegmentVariantPrompt(script, plan, originalHookType = 'original') {
  const contextText = plan.fields
    .map((field) => `${field.toUpperCase()}: ${script[field] || ''}`)
    .join('\n');

  return `Eres un copywriter de retención para YouTube Shorts de psicología.

Quiero generar SOLO una variante B del segmento "${plan.segmentType}".
No reescribas el vídeo entero. Solo cambia ese segmento.

ESTRUCTURA VERSION: ${script.structureVersion || 'open_loop_escalation_v1'}
HOOK TYPE ORIGINAL: ${originalHookType}
TESTED VARIABLE: ${plan.testedVariable}
SEGMENT TYPE: ${plan.segmentType}
VARIANT INTENT: ${plan.variantIntent}

CONTEXTO RELEVANTE:
${contextText}

REGLAS:
- Si segmentType=hook: cambia hook y hookType
- Si segmentType=reengage: hazlo más agresivo y mejor colocado contra la caída de retención
- Si segmentType=open_ending: deja el loop más abierto
- Si segmentType=peak y variantIntent=peak_b_more_emotional: sube identificación y escena cotidiana
- Si segmentType=peak y variantIntent=peak_b_more_scientific: sube autoridad científica sin volverlo frío
- Si segmentType=soft_cta y variantIntent=soft_cta_b_more_identification: invita a comentar desde auto-reconocimiento
- Si segmentType=soft_cta y variantIntent=soft_cta_b_more_polemic: invita a comentar desde fricción o debate suave
- Mantén compatibilidad legacy rellenando claim/explanation/cta

Devuelve SOLO JSON:
{
  "hookType": "revelation|pattern|challenge|warning|question|${originalHookType}",
  "segmentType": "${plan.segmentType}",
  "testedVariable": "${plan.testedVariable}",
  "variantIntent": "${plan.variantIntent}",
  "updatedSegment": "nuevo texto del segmento",
  "claim": "fallback legacy",
  "explanation": "fallback legacy",
  "cta": "fallback legacy"
}`;
}

// ─────────────────────────────────────────────
//  GENERACIÓN DE HOOK ALTERNATIVO (1 variante)
//  Una sola llamada Haiku — barato y rápido
// ─────────────────────────────────────────────

const ALT_HOOK_PROMPT = `Eres el mejor copywriter de contenido psicológico viral en español.

Dado este guión, necesito 1 versión alternativa del HOOK (primera frase, máx 12 palabras).
El hook alternativo debe usar un tipo DISTINTO al original y ser igual o más impactante.

HOOK ORIGINAL (tipo: {ORIGINAL_TYPE}):
"{HOOK}"

TEMA: {TOPIC}
CLAIM: {CLAIM}

Devuelve SOLO este JSON (sin markdown):
{
  "hookType": "revelation|pattern|challenge|warning|question",
  "hook": "el hook alternativo (máx 12 palabras)"
}

IMPORTANTE:
- NO uses el mismo tipo que el original
- revelation → "Tu cerebro/mente hace X sin que lo notes"
- pattern    → "Cada vez que X, tu cerebro está haciendo Y"
- challenge  → "El N% de personas X (comportamiento sorprendente)"
- warning    → "Si haces X, tu cerebro ya está haciendo Y"
- question   → "Por qué [no puedes/siempre] [comportamiento universal]"`;

async function generateAltHook(script, originalHookType = 'original') {
  const normalized = rebuildLegacySegments(script);
  const prompt = buildSegmentVariantPrompt(normalized, SEGMENT_TEST_PLANS.hook, originalHookType);
  const llmMetrics = createLlmMetrics();

  try {
    llmMetrics.llm_total_calls += 1;
    const msg = await callAnthropicWithTimeout(client, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 180,
      messages: [{ role: 'user', content: prompt }],
    }, { label: 'ab-test-engine.generateAltHook' });

    const raw = msg.content[0].text.trim();
    const { data, meta } = await parseModelJsonWithRecovery(raw, {
      label: 'ab-test-engine.generateAltHook',
      recover: (failedRaw) => requestJsonRecovery(prompt, failedRaw, 'ab-test-engine.generateAltHook', llmMetrics, 220),
    });
    mergeLlmMetrics(llmMetrics, meta);
    if (!data.updatedSegment) throw new Error('Invalid response');
    return {
      hookType: data.hookType || originalHookType,
      hook: data.updatedSegment,
      segmentType: 'hook',
      testedVariable: data.testedVariable || 'hook_style',
      variantIntent: data.variantIntent || 'hook_b_more_aggressive',
      claim: data.claim || normalized.claim,
      explanation: data.explanation || normalized.explanation,
      cta: data.cta || normalized.cta,
    };
  } catch (err) {
    markLlmHardFail(llmMetrics, err);
    logger.warn(`AB v2: alt hook generation failed: ${err.message}`);
    return null;
  }
}

async function generateSegmentVariant(script, plan, originalHookType = 'original') {
  if (plan.segmentType === 'hook') {
    return generateAltHook(script, originalHookType);
  }

  const normalized = rebuildLegacySegments(script);
  const prompt = buildSegmentVariantPrompt(normalized, plan, originalHookType);
  const llmMetrics = createLlmMetrics();

  try {
    llmMetrics.llm_total_calls += 1;
    const msg = await callAnthropicWithTimeout(client, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 220,
      messages: [{ role: 'user', content: prompt }],
    }, { label: 'ab-test-engine.generateSegmentVariant' });

    const raw = msg.content[0].text.trim();
    const { data, meta } = await parseModelJsonWithRecovery(raw, {
      label: 'ab-test-engine.generateSegmentVariant',
      recover: (failedRaw) => requestJsonRecovery(prompt, failedRaw, 'ab-test-engine.generateSegmentVariant', llmMetrics, 260),
    });
    mergeLlmMetrics(llmMetrics, meta);
    if (!data.updatedSegment) throw new Error('Invalid response');
    return {
      segmentType: plan.segmentType,
      testedVariable: data.testedVariable || plan.testedVariable,
      variantIntent: data.variantIntent || plan.variantIntent,
      hookType: data.hookType || originalHookType,
      updatedSegment: data.updatedSegment,
      claim: data.claim || normalized.claim,
      explanation: data.explanation || normalized.explanation,
      cta: data.cta || normalized.cta,
    };
  } catch (err) {
    markLlmHardFail(llmMetrics, err);
    logger.warn(`AB v2: segment variant generation failed (${plan.segmentType}): ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
//  EARLY SCORE COMPUESTO
//  earlyScore = likeRate*0.20 + commentRate*0.20 + shareRate*0.35
//             + viewVelocity*0.15 + completionProxy*0.10
// ─────────────────────────────────────────────

function calcEarlyScore(metrics, publishedAt) {
  const { views = 0, likes = 0, comments = 0, shares = 0 } = metrics;

  if (views < 50) return null;  // sin señal mínima

  const ageHours = publishedAt
    ? (Date.now() - new Date(publishedAt).getTime()) / 3600000
    : 1;

  const likeRate       = views > 0 ? likes / views : 0;
  const commentRate    = views > 0 ? comments / views : 0;
  const shareRate      = views > 0 ? shares / views : 0;
  const viewVelocity   = Math.min(ageHours > 0 ? views / ageHours / 1000 : 0, 1); // norm a [0,1]
  // completionProxy: sin dato real, usamos (likeRate + shareRate) * 0.5 como proxy
  const completionProxy = Math.min((likeRate + shareRate) * 10, 1);

  const score =
    likeRate       * 0.20 +
    commentRate    * 0.20 +
    shareRate      * 0.35 +
    viewVelocity   * 0.15 +
    completionProxy* 0.10;

  return parseFloat((score * 1000).toFixed(4)); // escalar a rango legible
}

function detectWindow(publishedAt) {
  if (!publishedAt) return null;
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3600000;
  return WINDOW_CONFIGS.find(w => ageHours >= w.minH && ageHours <= w.maxH) || null;
}

// ─────────────────────────────────────────────
//  API PRINCIPAL — CREAR EXPERIMENTO MULTI-VARIANTE
// ─────────────────────────────────────────────

/**
 * Crea un experimento real publicando 2 vídeos con hooks distintos.
 *
 * v_a = script original (encolado por growth-engine antes de llamar aquí)
 * v_b = hook alternativo (este método lo encola)
 *
 * @param {Object}  baseScript      - guión aprobado de content-optimizer
 * @param {string}  baseJobId       - jobId de v_a (ya encolado)
 * @param {Object}  growthContext   - decisión del decision-engine
 * @returns {Object}                - experimento creado
 */
async function createMultiVariantExperiment(baseScript, baseJobId, growthContext = {}) {
  const experimentId = `exp_${Date.now()}_${baseJobId.slice(0, 8)}`;
  const normalizedBase = rebuildLegacySegments(baseScript);
  const originalType = growthContext.hookType || normalizedBase.selectedHookType || 'original';
  const plan = chooseExperimentPlan(normalizedBase, growthContext);
  normalizedBase.abExperimentId = experimentId;
  linkAbVariantToSlot({
    script: normalizedBase,
    abExperimentId: experimentId,
    variantId: normalizedBase.abVariantId || 'v_a',
    variantRole: 'control'
  });

  logger.info(`AB v2: creating experiment ${experimentId} | topic=${baseScript.topic}`);

  // v_a: variante original (ya encolada)
  const variants = [
    {
      variantId:   'v_a',
      jobId:       baseJobId,
      hookType:    originalType,
      hook:        normalizedBase.hook,
      segmentType: plan.segmentType,
      testedVariable: plan.testedVariable,
      variantIntent: 'control',
      structureVersion: normalizedBase.structureVersion || 'legacy_v1',
      publishedAt: null,
      tiktokId:    null,
      youtubeId:   null,
      metrics:     {},
      earlyScore:  null,
      checkedAt:   null,
      isWinner:    false,
    },
  ];

  // v_b: hook alternativo — generamos y encolamos si AB_PUBLISH_VARIANTS no es 'false'
  if (process.env.AB_PUBLISH_VARIANTS !== 'false') {
    const variantPayload = await generateSegmentVariant(normalizedBase, plan, originalType);
    if (variantPayload) {
      // v_b se publica 2h después de v_a para no saturar al algoritmo
      const publishAfter = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

      const altScript = rebuildLegacySegments({
        ...normalizedBase,
        abExperimentId: experimentId,
        abVariantId:    'v_b',
        structureVersion: normalizedBase.structureVersion || 'legacy_v1',
        hookType: variantPayload.hookType || originalType,
        publishAfter,           // publish-scheduler respeta este campo
        [plan.segmentType]: variantPayload.updatedSegment || variantPayload.hook,
        hook: plan.segmentType === 'hook' ? variantPayload.hook : normalizedBase.hook,
        claim: variantPayload.claim,
        explanation: variantPayload.explanation,
        cta: variantPayload.cta,
      });

      try {
        const { addVideoToQueue } = getQueue();
        const altJobId = await addVideoToQueue({
          topic:         altScript.topic,
          prefabScript:  altScript,
          growthContext,
        });

        variants.push({
          variantId:   'v_b',
          jobId:       altJobId,
          hookType:    variantPayload.hookType || originalType,
          hook:        altScript.hook,
          segmentType: plan.segmentType,
          testedVariable: variantPayload.testedVariable || plan.testedVariable,
          variantIntent: variantPayload.variantIntent || plan.variantIntent,
          structureVersion: altScript.structureVersion || 'legacy_v1',
          changedSegmentValue: altScript[plan.segmentType],
          publishedAt: null,
          tiktokId:    null,
          youtubeId:   null,
          metrics:     {},
          earlyScore:  null,
          checkedAt:   null,
          isWinner:    false,
        });
        linkAbVariantToSlot({
          script: altScript,
          abExperimentId: experimentId,
          variantId: 'v_b',
          variantRole: 'test'
        });

        logger.info(`AB v2: enqueued v_b job=${altJobId} hookType=${variantPayload.hookType || originalType} segment=${plan.segmentType} publishAfter=${publishAfter}`);
      } catch (err) {
        logger.warn(`AB v2: failed to enqueue v_b: ${err.message}`);
      }
    }
  }

  const experiment = {
    experimentId,
    topic:       normalizedBase.topic,
    angle:       growthContext.angle || null,
    baseHook:    normalizedBase.abOriginalHook || normalizedBase.hook,
    testedVariable: plan.testedVariable,
    segmentType: plan.segmentType,
    variantIntent: plan.variantIntent,
    structureVersion: normalizedBase.structureVersion || 'legacy_v1',
    createdAt:   new Date().toISOString(),
    status:      'running',            // running | decided
    winnerVariantId: null,
    decidedAt:   null,
    variants,
  };

  // Guardar
  const experiments = readJSON(EXPERIMENTS_V2_PATH, []);
  experiments.unshift(experiment);
  writeJSON(EXPERIMENTS_V2_PATH, experiments.slice(0, 500));

  logger.info(`AB v2: experiment ${experimentId} created | variants=${variants.length} | topic=${experiment.topic}`);
  return experiment;
}

// ─────────────────────────────────────────────
//  EVALUACIÓN — COMPARAR VARIANTES CON MÉTRICAS REALES
// ─────────────────────────────────────────────

/**
 * Evalúa experimentos multi-variante usando métricas reales de los vídeos.
 * Declara ganador si una variante supera a la otra en earlyScore.
 *
 * @param {Array} recentVideos - array de vídeos con métricas de analytics-tracker
 */
function evaluateMultiVariantExperiments(recentVideos = []) {
  if (!recentVideos.length) return;

  const experiments = readJSON(EXPERIMENTS_V2_PATH, []);
  const perf        = readJSON(HOOK_PERFORMANCE_PATH, { typeWeights: { ...DEFAULT_TYPE_WEIGHTS }, history: [] });
  const videoMap    = {};
  for (const v of recentVideos) videoMap[v.id] = v;

  let updatedCount = 0;

  for (const exp of experiments) {
    if (exp.status === 'decided') continue;

    let variantsUpdated = false;

    // Actualizar métricas de cada variante
    for (const variant of exp.variants) {
      const video = videoMap[variant.jobId];
      if (!video) continue;

      const views    = video.tiktok_views || video.youtube_views || video.max_views || 0;
      const likes    = video.tiktok_likes || video.youtube_likes || 0;
      const comments = video.tiktok_comments || video.youtube_comments || 0;
      const shares   = video.tiktok_shares  || video.youtube_shares   || 0;

      variant.metrics   = { views, likes, comments, shares };
      variant.publishedAt = variant.publishedAt || video.published_at || null;

      // Calcular earlyScore si hay datos
      const window = detectWindow(variant.publishedAt);
      if (window && views >= window.minViews) {
        variant.earlyScore = calcEarlyScore(variant.metrics, variant.publishedAt);
        variant.checkedAt  = new Date().toISOString();
        variant.windowLabel = window.label;
        variantsUpdated    = true;
      }
    }

    if (!variantsUpdated) continue;

    // Intentar declarar ganador
    const scored   = exp.variants.filter(v => v.earlyScore !== null && v.metrics.views > 0);
    if (scored.length < 2) {
      // Solo 1 variante con datos — ganador provisional si tiene suficientes vistas
      const single = scored[0];
      if (single && single.metrics.views >= 1000) {
        single.isWinner       = true;
        exp.winnerVariantId   = single.variantId;
        exp.status            = 'decided';
        exp.decidedAt         = new Date().toISOString();
        exp.decisionReason    = 'single_variant_sufficient_data';
        updatedCount++;
        _recordWinner(single, exp, perf);
      }
      continue;
    }

    // Comparar variantes — dimensión earlyScore (reach) + dimensión comercial
    const sorted = [...scored].sort((a, b) => b.earlyScore - a.earlyScore);
    const best   = sorted[0];
    const second = sorted[1];
    const window = detectWindow(best.publishedAt);
    const threshold = window?.threshold ?? 1.3;

    // Calcular businessScore para cada variante usando proxies comerciales
    // businessScore = earlyScore × topic_commercial_mult × engagement_quality
    const { TOPIC_COMMERCIAL_MULT } = (() => {
      try { return require('../../../content-engine/tracking/slot-commercial-proxy-scorer'); }
      catch { return { TOPIC_COMMERCIAL_MULT: {} }; }
    })();
    const topicMult = TOPIC_COMMERCIAL_MULT[exp.topic] || 1.0;

    for (const v of scored) {
      const engRate = (v.metrics.views > 0)
        ? ((v.metrics.likes || 0) + (v.metrics.comments || 0) * 2.5 + (v.metrics.shares || 0) * 4) / v.metrics.views
        : 0;
      v.businessScore = parseFloat(((v.earlyScore || 0) * topicMult * (1 + Math.min(engRate, 0.1) * 5)).toFixed(4));
    }

    // Ganador final: preferir businessScore sobre earlyScore puro
    // salvo que el gap de views sea explosivo (>2x) — en ese caso earlyScore domina
    const bestBiz   = scored.sort((a, b) => b.businessScore - a.businessScore)[0];
    const secondBiz = scored.sort((a, b) => b.businessScore - a.businessScore)[1];

    // Restaurar sorted original para earlyScore
    scored.sort((a, b) => b.earlyScore - a.earlyScore);

    const viewsGap = second?.metrics.views > 0
      ? best.metrics.views / second.metrics.views : 1;
    const decisionWinner = (viewsGap > 2.0) ? best : bestBiz;

    if (decisionWinner.earlyScore >= (second?.earlyScore || 0) * (viewsGap > 2.0 ? threshold : threshold * 0.85)) {
      decisionWinner.isWinner = true;
      exp.winnerVariantId     = decisionWinner.variantId;
      exp.status              = 'decided';
      exp.decidedAt           = new Date().toISOString();
      exp.decisionReason      = viewsGap > 2.0
        ? `${decisionWinner.variantId} domina por views (${viewsGap.toFixed(1)}x). earlyScore=${decisionWinner.earlyScore.toFixed(3)}`
        : `${decisionWinner.variantId} gana por businessScore=${decisionWinner.businessScore.toFixed(3)} (earlyScore=${decisionWinner.earlyScore.toFixed(3)}) en window ${window?.label || 'unknown'}`;
      exp.winnerByViews       = best.variantId;
      exp.winnerByBusiness    = bestBiz.variantId;
      exp.viewsAndBizAgree    = best.variantId === bestBiz.variantId;
      updatedCount++;
      _recordWinner(decisionWinner, exp, perf);
      logger.info(`AB v2: winner=${decisionWinner.variantId} hookType=${decisionWinner.hookType} business=${decisionWinner.businessScore?.toFixed(3)} (${exp.decisionReason})`);
    }
  }

  if (updatedCount > 0) {
    // Recalcular pesos desde historial reciente
    perf.typeWeights = _recalcTypeWeights(perf.history.slice(0, 100));
    perf.lastUpdated = new Date().toISOString();
    perf.history     = perf.history.slice(0, 500);

    writeJSON(EXPERIMENTS_V2_PATH, experiments);
    writeJSON(HOOK_PERFORMANCE_PATH, perf);
    logger.info(`AB v2: evaluated ${updatedCount} experiments | weights: ${JSON.stringify(perf.typeWeights)}`);
  }
}

function _recordWinner(variant, exp, perf) {
  perf.history = perf.history || [];
  perf.history.unshift({
    date:           new Date().toISOString(),
    hookType:       variant.hookType,
    topic:          exp.topic,
    hook:           variant.hook,
    segmentType:    variant.segmentType || exp.segmentType || 'hook',
    testedVariable: variant.testedVariable || exp.testedVariable || 'hook_style',
    variantIntent:  variant.variantIntent || exp.variantIntent || 'unknown',
    structureVersion: variant.structureVersion || exp.structureVersion || 'legacy_v1',
    views:          variant.metrics.views,
    likes:          variant.metrics.likes,
    earlyScore:     variant.earlyScore,
    businessScore:  variant.businessScore || null,
    isWinner:       variant.isWinner,
    window:         variant.windowLabel || null,
    viewsAndBizAgree: exp.viewsAndBizAgree ?? true,
    // Para _recalcTypeWeights: usar businessScore si disponible
    scoringDimension: variant.businessScore ? 'business' : 'earlyScore',
  });
}

function _recalcTypeWeights(history) {
  if (history.length < 5) return { ...DEFAULT_TYPE_WEIGHTS };

  const byType = {};
  for (const h of history) {
    if (!h.earlyScore) continue;
    if (!byType[h.hookType]) byType[h.hookType] = { sum: 0, n: 0, wins: 0 };
    byType[h.hookType].sum  += h.earlyScore;
    byType[h.hookType].n++;
    if (h.isWinner) byType[h.hookType].wins++;
  }

  // Preferir businessScore sobre earlyScore para el ranking si está disponible
  for (const h of history) {
    if (h.businessScore && !byType[h.hookType]._bizSum) byType[h.hookType]._bizSum = 0;
    if (h.businessScore) {
      byType[h.hookType]._bizSum = (byType[h.hookType]._bizSum || 0) + h.businessScore;
      byType[h.hookType]._bizN   = (byType[h.hookType]._bizN   || 0) + 1;
    }
  }

  const averages = Object.entries(byType)
    .filter(([, v]) => v.n >= 2)
    .map(([type, v]) => ({
      type,
      avg: v._bizN >= 2 ? (v._bizSum / v._bizN) : (v.sum / v.n),  // preferir businessScore
      winRate: v.wins / v.n,
    }));

  if (!averages.length) return { ...DEFAULT_TYPE_WEIGHTS };

  const maxAvg = Math.max(...averages.map(a => a.avg));
  const minAvg = Math.min(...averages.map(a => a.avg));
  const range  = maxAvg - minAvg || 0.001;

  const weights = { ...DEFAULT_TYPE_WEIGHTS };
  for (const { type, avg } of averages) {
    weights[type] = Math.max(1, Math.round(1 + ((avg - minAvg) / range) * 4));
  }
  return weights;
}

// ─────────────────────────────────────────────
//  LEGACY COMPAT — mantiene la API antigua para analytics-tracker
// ─────────────────────────────────────────────

/**
 * Evalúa experimentos legacy (v1, un solo vídeo por experimento).
 * Se llama desde analytics-tracker igual que antes.
 */
function evaluateExperiments(recentVideos = []) {
  // 1. Evaluar legacy (v1)
  _evaluateLegacyExperiments(recentVideos);
  // 2. Evaluar multi-variante (v2)
  evaluateMultiVariantExperiments(recentVideos);
}

function _evaluateLegacyExperiments(recentVideos = []) {
  if (!recentVideos.length) return;

  const experiments = readJSON(EXPERIMENTS_LEGACY_PATH, []);
  const perf        = readJSON(HOOK_PERFORMANCE_PATH, { typeWeights: { ...DEFAULT_TYPE_WEIGHTS }, history: [] });
  const videoMap    = {};
  for (const v of recentVideos) videoMap[v.id] = v;

  let updated = 0;
  for (const exp of experiments) {
    if (exp.winner) continue;
    const video = videoMap[exp.id];
    if (!video) continue;
    const views    = video.tiktok_views || video.youtube_views || 0;
    const likes    = video.tiktok_likes || video.youtube_likes || 0;
    if (views < 100) continue;

    exp.winner      = exp.selectedType;
    exp.evaluatedAt = new Date().toISOString();
    exp.metrics     = { views, likes, engagment: views > 0 ? parseFloat((likes / views).toFixed(4)) : 0 };

    perf.history = perf.history || [];
    perf.history.unshift({
      date: new Date().toISOString(),
      hookType: exp.selectedType,
      topic: exp.topic,
      hook: exp.selectedHook,
      views, likes,
      engagment: exp.metrics.engagment,
    });
    updated++;
  }

  if (updated > 0) {
    perf.typeWeights = _recalcTypeWeights(perf.history.slice(0, 100));
    perf.lastUpdated = new Date().toISOString();
    perf.history     = perf.history.slice(0, 500);
    writeJSON(EXPERIMENTS_LEGACY_PATH, experiments);
    writeJSON(HOOK_PERFORMANCE_PATH, perf);
  }
}

// ─────────────────────────────────────────────
//  STATS — DASHBOARD
// ─────────────────────────────────────────────

function getABStats() {
  const v2   = readJSON(EXPERIMENTS_V2_PATH, []);
  const v1   = readJSON(EXPERIMENTS_LEGACY_PATH, []);
  const perf = readJSON(HOOK_PERFORMANCE_PATH, { typeWeights: { ...DEFAULT_TYPE_WEIGHTS }, history: [] });

  const total     = v2.length + v1.length;
  const decided   = v2.filter(e => e.status === 'decided').length + v1.filter(e => e.winner).length;
  const running   = v2.filter(e => e.status === 'running').length;

  // Distribución de tipos ganadores
  const winnerTypes = {};
  const winnerSegments = {};
  for (const e of v2.filter(e => e.winnerVariantId)) {
    const w = e.variants.find(v => v.variantId === e.winnerVariantId);
    if (w) {
      winnerTypes[w.hookType] = (winnerTypes[w.hookType] || 0) + 1;
      winnerSegments[w.segmentType || e.segmentType || 'hook'] = (winnerSegments[w.segmentType || e.segmentType || 'hook'] || 0) + 1;
    }
  }
  for (const e of v1.filter(e => e.winner)) {
    winnerTypes[e.winner] = (winnerTypes[e.winner] || 0) + 1;
  }

  const topHooks = (perf.history || [])
    .filter(h => h.views >= 500 || h.earlyScore > 0)
    .sort((a, b) => (b.earlyScore || 0) - (a.earlyScore || 0))
    .slice(0, 10)
    .map(h => ({ type: h.hookType, hook: h.hook, views: h.views, earlyScore: h.earlyScore, isWinner: h.isWinner }));

  return {
    total, decided, running,
    v2Total:     v2.length,
    v1Total:     v1.length,
    typeWeights: perf.typeWeights,
    winnerTypes,
    winnerSegments,
    topHooks,
    lastUpdated: perf.lastUpdated || null,
    recentExperiments: v2.slice(0, 5).map(e => ({
      experimentId: e.experimentId,
      topic:        e.topic,
      status:       e.status,
      segmentType:  e.segmentType || 'hook',
      testedVariable: e.testedVariable || 'hook_style',
      variantIntent: e.variantIntent || 'unknown',
      structureVersion: e.structureVersion || 'legacy_v1',
      winner:       e.winnerVariantId,
      variants:     e.variants.map(v => ({
        id: v.variantId,
        type: v.hookType,
        segmentType: v.segmentType || e.segmentType || 'hook',
        testedVariable: v.testedVariable || e.testedVariable || 'hook_style',
        variantIntent: v.variantIntent || 'unknown',
        views: v.metrics?.views || 0,
        earlyScore: v.earlyScore
      })),
    })),
  };
}

module.exports = {
  createMultiVariantExperiment,
  evaluateMultiVariantExperiments,
  evaluateExperiments,    // compat con analytics-tracker
  getABStats,
  calcEarlyScore,
};
