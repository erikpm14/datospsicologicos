/**
 * growth-engine.js
 * Orquesta el ciclo autónomo completo:
 *
 *   ANALYTICS → DECISION → CONTENT → SCORE → FILTER → QUEUE
 *
 * Cada ciclo:
 *   1. Verifica espacio en cola
 *   2. Pide decisión al decision-engine
 *   3. Genera guión con content-optimizer (hasta maxRetries intentos)
 *   4. Filtra por virality_score + format_match_score
 *   5. Si supera umbrales: encola
 *   6. Si no: registra rechazo y termina
 *   7. Guarda log de ciclo para aprendizaje iterativo
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { makeDecision, detectWinningPatterns, registerWinningStreak, getActiveStreaks } = require('./decision-engine');
const {
  generateOptimizedScript,
  generateViralScript,
  improveWeakSegments,
  isClearlyInvalidCandidate,
  buildSelectionPenalties,
} = require('./content-optimizer');
const { generateScript }                         = require('./content-generator');
const { scoreScriptByRealData }          = require('../utils/real-virality-scorer');
const { scoreFormatMatch, scoreEmotionalImpact } = require('./format-match-engine');
const { getFullAnalytics }                     = require('./analytics-tracker');
const { createMultiVariantExperiment, getABStats } = require('./ab-test-engine');
const { runLearningCycle, getTopicWeight }     = require('./context-learner');
const { buildEmergencyScript, loadLastValidScript, saveLastValidScript, registerFallbackUsage, buildScriptMetadata } = require('../utils/script-fallback');
const { createLlmMetrics, mergeLlmMetrics, classifyLlmFailure, attachLlmMetrics }    = require('../utils/llm-call');
const logger                                   = require('../utils/logger');
const { createPerfTracker, formatDurationMs }  = require('../utils/perf-tracker');

const TRENDS_PATH = path.resolve('./data/trends.json');

// Umbral de score combinado para activar un winning streak
const STREAK_ACTIVATION_THRESHOLD = parseInt(process.env.STREAK_SCORE_THRESHOLD || '72');

// Cola importada de forma lazy para evitar dependencia circular al arrancar
function getQueue() {
  return require('../queue/video-processor');
}

const REJECTED_LOG_PATH = path.resolve('./data/rejected-scripts.json');
const GROWTH_LOG_PATH   = path.resolve('./data/growth-log.json');

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function readJSON(file, def = []) {
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

function logRejected(script, reason) {
  const rejected = readJSON(REJECTED_LOG_PATH, []);
  rejected.unshift({
    rejectedAt:      new Date().toISOString(),
    reason,
    topic:           script.topic,
    hook:            script.hook,
    viralityScore:   script.viralityScore,
    formatMatchScore:script.formatMatchScore,
    formatMatchGaps: script.formatMatchGaps || [],
  });
  writeJSON(REJECTED_LOG_PATH, rejected.slice(0, 100));
}

function buildGenerationRoute(script, route, llmMetrics, extras = {}) {
  return {
    generationSource: extras.generationSource || script.generationSource || route.at(-1) || 'unknown',
    generationFallback: extras.generationFallback || script.generationFallback || null,
    llmPath: route,
    usedRecovery: Boolean(llmMetrics.llm_recovery_used),
    usedLastValid: Boolean(extras.usedLastValid || script.reusedLastValidScript),
    usedEmergencyFallback: Boolean(extras.usedEmergencyFallback || script.emergencyFallback),
    approvalBypassReason: extras.approvalBypassReason || script.approvalBypass || null,
    final_generation_route: route.join(' -> '),
    total_llm_calls: llmMetrics.llm_total_calls || 0,
    fallback_level_reached: extras.fallbackLevel || 0,
  };
}

function hydrateFallbackScript(script, decision, reason, options = {}) {
  const {
    generator = 'content-generator',
    forceApprove = false,
    llmMetrics = {},
    approvalBypassReason = null,
  } = options;
  const viralityResult = script.viralityScore && script.viralityBreakdown
    ? { score: script.viralityScore, dataPoints: script.viralityBreakdown }
    : scoreScriptByRealData(script);
  script.viralityScore = viralityResult.score;
  script.viralityBreakdown = viralityResult.dataPoints;

  const formatResult = scoreFormatMatch(script);
  script.formatMatchScore = formatResult.score;
  script.formatMatchBreakdown = formatResult.breakdown;
  script.formatMatchSegmentGaps = script.segmentFeedbackSummary || [];
  script.formatMatchGaps = [...formatResult.gaps, ...(script.segmentFeedbackSummary || [])];

  const emotionalResult = scoreEmotionalImpact(script);
  script.emotionalImpactScore = emotionalResult.score;
  script.emotionalImpactBreakdown = emotionalResult.breakdown;

  const minFormat = parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '70');
  const minVirality = parseInt(process.env.MIN_VIRALITY_SCORE_TO_QUEUE || '60');
  const formatOk = formatResult.score >= minFormat;
  const viralityOk = viralityResult.score >= minVirality;

  script.approved = forceApprove ? true : (formatOk && viralityOk);
  script.rejectionReason = !script.approved
    ? [
        !formatOk ? `format_match ${formatResult.score}/${minFormat}` : null,
        !viralityOk ? `virality_data ${viralityResult.score}/${minVirality} (real data threshold)` : null,
      ].filter(Boolean).join(' | ')
    : null;
  script.growthContext = { ...decision, ...(script.growthContext || {}), fallbackGenerator: generator, fallbackReason: reason };
  script.generationFallback = generator;
  script.llmMetrics = { ...(script.llmMetrics || {}), ...llmMetrics };
  if (forceApprove) {
    script.approvalBypass = approvalBypassReason || `${generator}_fallback`;
    script.rejectionReason = null;
  }

  return script;
}

function calcCandidateScore(script = {}) {
  const virality = script.viralityScore || 0;
  const format = script.formatMatchScore || 0;
  const emotion = script.emotionalImpactScore || 0;
  return Math.round(virality * 0.5 + format * 0.35 + emotion * 0.15);
}

function classifySelectedQuality(script = {}, score = calcCandidateScore(script)) {
  if (script.emergencyFallback || script.reusedLastValidScript || script.generationFallback === 'emergency' || script.generationFallback === 'last-valid-script') {
    return 'fallback';
  }
  const optimalThreshold = parseInt(process.env.GENERATION_OPTIMAL_SCORE || '74', 10) || 74;
  return score >= optimalThreshold && !script.approvalBypass ? 'optimal' : 'acceptable';
}

function buildGuaranteedFallbackScript(decision, reason, llmMetrics) {
  const lastValidScript = loadLastValidScript({
    topic: decision.nextTopic,
    angle: decision.angle,
    hookType: decision.hookType,
    emotionalTrigger: decision.emotionalTrigger,
  });
  if (lastValidScript) {
    logger.warn(`Growth Engine: reusing last valid script after hard failure | reason=${reason}`);
    const script = hydrateFallbackScript({
      ...lastValidScript,
      title: `${lastValidScript.title || 'last_valid'}_${Date.now()}`,
      reusedLastValidScript: true,
    }, decision, reason, {
      generator: 'last-valid-script',
      forceApprove: true,
      llmMetrics,
    });
    registerFallbackUsage('last-valid-script', script.lastValidMetadata?.id || script.title);
    return script;
  }

  logger.warn(`Growth Engine: using emergency script fallback | topic=${decision.nextTopic} | reason=${reason}`);
  const script = hydrateFallbackScript(buildEmergencyScript({
    topic: decision.nextTopic,
    reason,
    decision,
  }), decision, reason, {
    generator: 'emergency',
    forceApprove: true,
    llmMetrics: {
      ...llmMetrics,
      emergency_fallback_used: true,
    },
  });
  registerFallbackUsage('emergency', `${script.topic}:${script.emergencyVariantId || script.title}`);
  return script;
}

// ─────────────────────────────────────────────
//  CICLO PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Ejecuta un ciclo completo del growth engine.
 *
 * @param {{ forceGenerate?: boolean, maxRetries?: number }} options
 * @returns {{ success, jobId?, script?, decision, attempts, reason? }}
 */
async function runGrowthCycle(options = {}) {
  const { forceGenerate = false, maxRetries = parseInt(process.env.GROWTH_MAX_RETRIES || '3', 10) || 3 } = options;
  const maxAttempts = Math.max(1, maxRetries);
  const perf = createPerfTracker('growth-cycle', { forceGenerate, maxAttempts });
  const llmMetrics = createLlmMetrics();

  logger.info('Growth Engine: starting cycle...');

  const { addVideoToQueue, getQueueStatus } = getQueue();

  // 1. Verificar espacio en cola
  const queueStatus = getQueueStatus();
  const maxPending  = parseInt(process.env.QUEUE_MAX_PENDING || '5');

  if (!forceGenerate && queueStatus.waiting >= maxPending) {
    logger.info(`Growth Engine: queue full (${queueStatus.waiting}/${maxPending}), skipping`);
    return { success: false, reason: 'queue_full', queueStatus };
  }

  // 2. Leer tendencias actuales (si existen) para sesgar la decisión
  let trendContext = null;
  if (fs.existsSync(TRENDS_PATH)) {
    try {
      const trends = JSON.parse(fs.readFileSync(TRENDS_PATH, 'utf8'));
      const age    = (Date.now() - new Date(trends.generatedAt).getTime()) / (1000 * 60 * 60);
      if (age < 12 && trends.trending?.length) {          // solo si tiene < 12h
        trendContext = {
          trendingTopics: trends.trending.map(t => t.topic),
          hookHints:      trends.trending.flatMap(t => t.hookHints || []).slice(0, 6),
        };
        logger.info(`Growth Engine: trend context loaded | trending: [${trendContext.trendingTopics.join(', ')}]`);
      }
    } catch { /* trends corruptos, ignorar */ }
  }

  // 3. Decisión (con sesgo hacia topics trending si existen)
  const decision = makeDecision({ trendBias: trendContext?.trendingTopics });
  logger.info(`Growth Engine: decision → topic=${decision.nextTopic} strategy=${decision.strategy} hook=${decision.hookType}`);

  // 3. Generación con reintentos
  // Pasar los gaps del intento anterior para feedback específico
  let script       = null;
  let attempts     = 0;
  let previousGaps = [];
  let bestCandidate = null;

  while (attempts < maxAttempts) {
    attempts++;
    const genOptions = { retryCount: attempts - 1, previousGaps, trendContext };
    const isLastAttempt = attempts >= maxAttempts;
    const route = [];
    perf.start(`generation_attempt_${attempts}`);

    try {
      // Intentar primero el generador viral (con contexto histórico real del canal)
      // Último intento: siempre usa base generator como safety net
      try {
        route.push('generateViralScript');
        script = await generateViralScript(decision, genOptions);
        mergeLlmMetrics(llmMetrics, script.llmMetrics || {});
        // Si el viral generator devuelve rechazado en el último intento, probar base generator
        if (!script.approved && isLastAttempt) {
          logger.info('Growth Engine: viral rejected on last attempt — trying base generator');
          route.push('generateOptimizedScript');
          script = await generateOptimizedScript(decision, genOptions);
          mergeLlmMetrics(llmMetrics, script.llmMetrics || {});
        }
      } catch (viralErr) {
        mergeLlmMetrics(llmMetrics, viralErr.llmMetrics || {});
        llmMetrics.llm_hard_fail = Boolean(llmMetrics.llm_hard_fail || viralErr?.llm_hard_fail || viralErr?.isLlmTimeout);
        logger.warn(`Growth Engine: viral generator failed | reason=${classifyLlmFailure(viralErr)} | detail=${viralErr.message}`);
        try {
          route.push('generateOptimizedScript');
          script = await generateOptimizedScript(decision, genOptions);
          mergeLlmMetrics(llmMetrics, script.llmMetrics || {});
        } catch (baseErr) {
          mergeLlmMetrics(llmMetrics, baseErr.llmMetrics || {});
          llmMetrics.llm_hard_fail = true;
          logger.error(`Growth Engine: optimized generator failed | reason=${classifyLlmFailure(baseErr)} | detail=${baseErr.message}`);
          if (!isLastAttempt) throw baseErr;

          logger.warn(`Growth Engine: switching to generator fallback after parse/generation failure | topic=${decision.nextTopic}`);
          try {
            route.push('generateScript');
            const fallbackScript = await generateScript({ topic: decision.nextTopic });
            mergeLlmMetrics(llmMetrics, fallbackScript.llmMetrics || {});
            script = hydrateFallbackScript(fallbackScript, decision, baseErr.message, {
              generator: 'content-generator',
              forceApprove: true,
              llmMetrics,
            });
            logger.info(
              `Growth Engine: fallback generator completed | topic=${script.topic} virality=${script.viralityScore} format=${script.formatMatchScore} approved=${script.approved}`,
            );
          } catch (fallbackErr) {
            mergeLlmMetrics(llmMetrics, fallbackErr.llmMetrics || {});
            llmMetrics.llm_hard_fail = true;
            script = buildGuaranteedFallbackScript(decision, fallbackErr.message, llmMetrics);
            route.push(script.generationFallback);
            logger.warn(`Growth Engine: guaranteed fallback completed | generator=${script.generationFallback} topic=${script.topic}`);
          }
        }
      }
    } catch (err) {
      logger.error(`Growth Engine: generation failed (attempt ${attempts}): ${err.message}`);
      mergeLlmMetrics(llmMetrics, err.llmMetrics || {});
      llmMetrics.llm_hard_fail = Boolean(llmMetrics.llm_hard_fail || err?.llm_hard_fail || err?.isLlmTimeout);
      const failedPhase = perf.fail(err, { attempt: attempts, ...llmMetrics });
      logger.warn(`Growth Engine: attempt ${attempts} failed in ${formatDurationMs(failedPhase.durationMs)}`);
      if (attempts >= maxAttempts) {
        return { success: false, reason: `generation_error: ${err.message}`, decision, attempts, totalMs: perf.snapshot().totalMs };
      }
      await new Promise((r) => setTimeout(r, 2000 * attempts));
      continue;
    }

    // Aplicar multiplicador de topic aprendido (topics con alta tasa de aprobación
    // obtienen un boost efectivo en su score; los que fallan mucho se penalizan)
    if (!script.approved && script.viralityScore) {
      const topicMult = getTopicWeight(script.topic);
      if (topicMult !== 1.0) {
        const minVirality = parseInt(process.env.MIN_VIRALITY_SCORE_TO_QUEUE || '60');
        const effectiveScore = Math.round(script.viralityScore * topicMult);
        if (effectiveScore >= minVirality && script.formatMatchScore >= parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '60')) {
          script.approved = true;
          script.rejectionReason = null;
          script.topicWeightApplied = topicMult;
          logger.info(`Growth Engine: topic weight ×${topicMult} applied | effective=${effectiveScore} (raw=${script.viralityScore}) → APPROVED`);
        }
      }
    }

    const routeMeta = buildGenerationRoute(script, route, llmMetrics, {
      generationSource: script.generationSource || route.at(-1),
      generationFallback: script.generationFallback || null,
      usedLastValid: script.generationFallback === 'last-valid-script',
      usedEmergencyFallback: script.generationFallback === 'emergency',
      approvalBypassReason: script.approvalBypass || null,
      fallbackLevel: Math.max(0, route.length - 1),
    });
    Object.assign(script, routeMeta);
    attachLlmMetrics(script, llmMetrics);

    const candidateScore = calcCandidateScore(script);
    const candidatePenalties = buildSelectionPenalties(script);
    const clearlyInvalid = isClearlyInvalidCandidate(script);
    const selectedQuality = classifySelectedQuality(script, candidateScore);
    if (!clearlyInvalid && (!bestCandidate || candidateScore > bestCandidate.score)) {
      bestCandidate = {
        script: JSON.parse(JSON.stringify(script)),
        score: candidateScore,
        attempts,
        penalties: candidatePenalties,
        reason: script.rejectionReason || (script.approved ? 'valid_candidate' : 'acceptable_candidate'),
        selectedQuality,
      };
    }

    // Guardar gaps para el siguiente reintento (feedback loop)
    previousGaps = script.formatMatchGaps || script.segmentFeedbackSummary || [];
    const attemptPhase = perf.end({
      attempt: attempts,
      approved: script.approved,
      rejectionReason: script.rejectionReason,
      viralityScore: script.viralityScore,
      formatMatchScore: script.formatMatchScore,
      candidateScore,
      selectedQuality,
      ...llmMetrics,
    });

    logger.info(
      `Growth Engine: candidate ${attempts}/${maxAttempts} | selectedQuality=${selectedQuality} | ` +
      `score=${candidateScore} | penalties=${candidatePenalties.join(' || ') || 'none'} | ` +
      `reason=${script.rejectionReason || 'valid_candidate'}`
    );
    logger.info(`Growth Engine: attempt ${attempts} completed in ${formatDurationMs(attemptPhase.durationMs)}`);
    if (clearlyInvalid) {
      logRejected(script, script.rejectionReason || 'clearly_invalid_candidate');
    }

    if (!clearlyInvalid && script.approved && selectedQuality === 'optimal') {
      logger.info(`Growth Engine: selected optimal candidate on attempt ${attempts}`);
      break;
    }
      logger.warn('Growth Engine: max retries reached — skipping this cycle');
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 4. Encolar variante A (script aprobado — hook original o mejorado por context-learner)
  script.abExperimentId = null; // se rellena después
  if ((!script || isClearlyInvalidCandidate(script) || classifySelectedQuality(script, calcCandidateScore(script)) !== 'optimal') && bestCandidate) {
    let chosen = bestCandidate.script;
    if (!isClearlyInvalidCandidate(chosen) && !['emergency', 'last-valid-script'].includes(chosen.generationFallback)) {
      const improved = await improveWeakSegments(chosen, {
        issues: chosen.segmentFeedbackSummary || chosen.formatMatchGaps || [],
        growthContext: decision,
      });
      chosen = improved.script;
    }
    const chosenScore = calcCandidateScore(chosen);
    chosen.selectionPenalties = buildSelectionPenalties(chosen);
    chosen.selectedQuality = classifySelectedQuality(chosen, chosenScore);
    script = chosen.approved
      ? chosen
      : hydrateFallbackScript(chosen, decision, bestCandidate.reason, {
          generator: 'best-available',
          forceApprove: true,
          llmMetrics,
          approvalBypassReason: `best_available_after_${attempts}_attempts`,
        });
    script.bestAvailableScore = chosenScore;
    script.selectionReasons = bestCandidate.penalties || [];
    script.selectedQuality = script.selectedQuality || classifySelectedQuality(script, chosenScore);
    logger.warn(
      `Growth Engine: selected best candidate | selectedQuality=${script.selectedQuality} | ` +
      `score=${chosenScore} | penalties=${(script.selectionPenalties || []).join(' || ') || 'none'} | reason=${bestCandidate.reason}`
    );
  }

  if (!script || isClearlyInvalidCandidate(script)) {
    script = buildGuaranteedFallbackScript(decision, 'no_valid_candidate_after_attempts', llmMetrics);
    script.selectedQuality = 'fallback';
  }

  script.abVariantId    = 'v_a';
  const finalJobId = await addVideoToQueue({
    topic:         script.topic,
    prefabScript:  script,
    growthContext: decision,
  });
  if (!script.emergencyFallback && !script.reusedLastValidScript) {
    saveLastValidScript(script, {
      ...buildScriptMetadata(script, {
        topic: script.topic,
        angle: decision.angle,
        hookType: decision.hookType,
        emotionalTrigger: decision.emotionalTrigger,
        generationSource: script.generationSource || script.generationFallback || 'growth-cycle',
        createdAt: new Date().toISOString(),
      }),
    });
  }

  // 5. A/B REAL: generar variante B con hook alternativo y encolarla
  //    createMultiVariantExperiment encola v_b internamente con publishAfter +2h
  let experimentId = null;
  if (['emergency', 'last-valid-script'].includes(script.generationFallback)) {
    logger.warn(`Growth Engine: skipping A/B for fallback script | generator=${script.generationFallback}`);
  } else {
    try {
      const experiment = await createMultiVariantExperiment(script, finalJobId, decision);
      experimentId = experiment.experimentId;
      logger.info(`Growth Engine: A/B experiment=${experimentId} | variants=${experiment.variants.length} | topic=${script.topic}`);
    } catch (abErr) {
      logger.warn(`Growth Engine: A/B multi-variant failed (${abErr.message}), single publish`);
    }
  }

  // 6. Growth log
  const growthLog = readJSON(GROWTH_LOG_PATH, []);
  const logEntry = {
    cycleAt:            new Date().toISOString(),
    jobId:              finalJobId,
    topic:              script.topic,
    angle:              decision.angle,
    hookType:           decision.hookType,
    emotionalTrigger:   decision.emotionalTrigger,
    strategy:           decision.strategy,
    viralityScore:      script.viralityScore,
    formatMatchScore:   script.formatMatchScore,
    emotionalImpact:    script.emotionalImpactScore,
    durationSeconds:    script.durationSeconds,
    estimatedWords:     script.estimatedWords,
    attempts,
    hook:               script.hook,
    abExperimentId:     experimentId || null,
    abHookType:         script.abVariantId || 'v_a',
    trendingTopics:     trendContext?.trendingTopics || [],
    generationFallback: script.generationFallback || null,
    generationSource:   script.generationSource || null,
    final_generation_route: script.final_generation_route || null,
    approvalBypassReason: script.approvalBypassReason || script.approvalBypass || null,
    bestAvailableScore:   script.bestAvailableScore || null,
    selectedQuality:      script.selectedQuality || classifySelectedQuality(script, calcCandidateScore(script)),
    selectionPenalties:   script.selectionPenalties || [],
    selectionReasons:     script.selectionReasons || [],
    usedRecovery:       script.usedRecovery || false,
    usedLastValid:      script.usedLastValid || false,
    usedEmergencyFallback: script.usedEmergencyFallback || false,
    total_llm_calls:    script.total_llm_calls || llmMetrics.llm_total_calls || 0,
    fallback_level_reached: script.fallback_level_reached || 0,
    llmMetrics,
  };
  growthLog.unshift(logEntry);
  writeJSON(GROWTH_LOG_PATH, growthLog.slice(0, 200));

  // 7. Registrar winning streak si el script tiene alta puntuación combinada
  const combinedScore = (script.viralityScore + script.formatMatchScore) / 2;
  if (combinedScore >= STREAK_ACTIVATION_THRESHOLD) {
    registerWinningStreak({
      topic:           script.topic,
      hookType:        decision.hookType,
      jobId:           finalJobId,
      viralityScore:   script.viralityScore,
      formatMatchScore:script.formatMatchScore,
      hook:            script.hook,
    });
  }

  logger.info(`Growth Engine: cycle done | jobId=${finalJobId} topic=${script.topic} virality=${script.viralityScore} format=${script.formatMatchScore} quality=${script.selectedQuality || classifySelectedQuality(script, calcCandidateScore(script))} ab=${script.abSelectedType || 'off'}`);
  logger.info(
    `Growth Engine summary | route=${script.final_generation_route} | llmCalls=${script.total_llm_calls || llmMetrics.llm_total_calls || 0} | ` +
    `fallbackLevel=${script.fallback_level_reached || 0} | bypass=${script.approvalBypassReason || 'none'} | ` +
    `selectedQuality=${script.selectedQuality || classifySelectedQuality(script, calcCandidateScore(script))} | ` +
    `scoreFinal=${calcCandidateScore(script)}${script.bestAvailableScore ? ` | fallbackBest=${script.bestAvailableScore}` : ''} | ` +
    `penalties=${(script.selectionPenalties || []).join(' || ') || 'none'}`
  );
  logger.info(`Growth Engine: total cycle time ${formatDurationMs(perf.snapshot().totalMs)}`);

  // Disparar ciclo de aprendizaje cada LEARNING_CYCLE_INTERVAL generaciones (async, no bloquea)
  runLearningCycle().catch(err => logger.warn(`Learning cycle error: ${err.message}`));

  return { success: true, jobId: finalJobId, script, decision, attempts, totalMs: perf.snapshot().totalMs };
}

// ─────────────────────────────────────────────
//  INSIGHTS DEL SISTEMA
// ─────────────────────────────────────────────

/**
 * Devuelve una vista completa del estado del sistema de crecimiento.
 * Usado por GET /api/growth/insights
 */
function getGrowthInsights() {
  const analytics  = getFullAnalytics();
  const patterns   = detectWinningPatterns();
  const rejected   = readJSON(REJECTED_LOG_PATH, []);
  const growthLog  = readJSON(GROWTH_LOG_PATH, []);

  const { getQueueStatus } = getQueue();
  const queueStatus = getQueueStatus();

  // Próxima recomendación (sin guardar en historial — solo lectura)
  const nextRecommendation = makeDecision();

  return {
    nextRecommendation,
    winningPatterns: patterns,
    activeStreaks:   getActiveStreaks(),
    queueStatus,
    kpis:            analytics.kpis,
    topicPerformance:analytics.topicPerformance?.slice(0, 8),
    durationAnalysis:analytics.durationAnalysis,
    recentRejections:rejected.slice(0, 10),
    recentCycles:    growthLog.slice(0, 15),
    recentVideos:    (analytics.allVideos || []).slice(0, 5),
    thresholds: {
      formatMatchToQueue:  parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE || '70'),
      viralityToQueue:     parseInt(process.env.MIN_VIRALITY_SCORE_TO_QUEUE || '55'),
      viralityToPublish:   parseInt(process.env.MIN_VIRALITY_SCORE_TO_PUBLISH || '70'),
      streakActivation:    STREAK_ACTIVATION_THRESHOLD,
    },
    generatedAt:     new Date().toISOString(),
  };
}

/**
 * Devuelve el próximo vídeo recomendado con justificación.
 * Usado por GET /api/growth/next-video
 */
function getNextVideoRecommendation() {
  const decision = makeDecision();
  const patterns = detectWinningPatterns();

  return {
    recommendation: decision,
    topicContext: {
      winningTopics: patterns.topTopics,
      gapsToExplore: patterns.gaps.slice(0, 5),
      scoreCorrelation: patterns.scoreCorrelation,
    },
    readyAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
//  EXPLOTACIÓN DE WINNERS
// ─────────────────────────────────────────────

/**
 * Cuando un vídeo es WINNER, genera automáticamente 2 variantes:
 *   - mismo topic, mismo patrón de hook, mismo tipo emocional
 *   - wording completamente diferente
 *   - solo si hay espacio en cola (totalPending < MAX_QUEUE)
 *
 * Se llama desde analytics-tracker cuando un vídeo supera el umbral de winner.
 *
 * @param {Object} winnerData - { videoId, hook, topic, hookType, viralityScore, formatMatchScore }
 */
async function exploitWinner(winnerData = {}) {
  const { hook, topic, hookType, viralityScore } = winnerData;

  logger.info(`exploit Winner: topic=${topic} hookType=${hookType} virality=${viralityScore} | generating 2 variants`);

  const OUTPUT_DIR   = path.resolve(process.env.OUTPUT_DIR || './output');
  const maxQueue     = parseInt(process.env.QUEUE_MAX_PENDING || '3');
  const { getQueueStatus, addVideoToQueue } = getQueue();

  // Contar espacio disponible
  const pending = fs.existsSync(OUTPUT_DIR)
    ? fs.readdirSync(OUTPUT_DIR).filter(d => {
        const vp = path.join(OUTPUT_DIR, d, 'output.mp4');
        const pp = path.join(OUTPUT_DIR, d, 'published.json');
        return fs.existsSync(vp) && !fs.existsSync(pp);
      }).length
    : 0;
  const qs = getQueueStatus();
  const totalPend = pending + (qs.waiting || 0) + (qs.active || 0);

  if (totalPend >= maxQueue) {
    logger.info(`exploit Winner: queue full (${totalPend}/${maxQueue}), deferring exploitation`);
    // Guardar en log para intentarlo en el próximo ciclo
    const EXPLOIT_LOG = path.resolve('./data/exploit-queue.json');
    const q = readJSON(EXPLOIT_LOG, []);
    q.unshift({ ...winnerData, deferredAt: new Date().toISOString() });
    writeJSON(EXPLOIT_LOG, q.slice(0, 20));
    return { deferred: true };
  }

  const slots = Math.min(2, maxQueue - totalPend);
  const results = [];

  for (let i = 0; i < slots; i++) {
    try {
      // Decisión sesgada al topic+hookType ganador
      const decision = makeDecision({ topicBias: topic, hookTypeBias: hookType });
      decision.nextTopic        = topic;
      decision.hookType         = hookType;
      decision.strategy         = 'exploit_winner';
      decision.winnerReference  = hook;

      const genOptions = {
        retryCount:     0,
        exploitContext: `Variante ${i + 1} del winner: "${hook}". Mismo patrón, wording completamente distinto.`,
      };

      let script;
      try {
        script = await generateViralScript(decision, genOptions);
      } catch {
        script = await generateOptimizedScript(decision, genOptions);
      }

      if (!script.approved) {
        logger.warn(`exploit Winner: variant ${i + 1} rejected (${script.rejectionReason})`);
        continue;
      }

      script.contentVersion      = process.env.CONTENT_VERSION || 'v2';
      script.exploitedFromWinner = winnerData.videoId || hook;

      const jobId = await addVideoToQueue({
        topic:         script.topic,
        prefabScript:  script,
        growthContext: decision,
      });

      logger.info(`exploit Winner: variant ${i + 1} queued | jobId=${jobId} virality=${script.viralityScore}`);
      results.push({ jobId, hook: script.hook, viralityScore: script.viralityScore });

    } catch (err) {
      logger.error(`exploit Winner: variant ${i + 1} error: ${err.message}`);
    }
  }

  logger.info(`exploit Winner: done | ${results.length}/${slots} variants queued`);
  return { queued: results.length, variants: results };
}

module.exports = { runGrowthCycle, getGrowthInsights, getNextVideoRecommendation, exploitWinner };
