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
const { generateOptimizedScript, generateViralScript } = require('./content-optimizer');
const { getFullAnalytics }                     = require('./analytics-tracker');
const { createMultiVariantExperiment, getABStats } = require('./ab-test-engine');
const logger                                   = require('../utils/logger');

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
  const { forceGenerate = false, maxRetries = 3 } = options;

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

  while (attempts <= maxRetries) {
    attempts++;

    try {
      // Intentar primero el generador viral (con contexto histórico real del canal)
      // Último intento: siempre usa base generator como safety net
      const genOptions = { retryCount: attempts - 1, previousGaps, trendContext };
      const isLastAttempt = attempts >= maxRetries;
      try {
        script = await generateViralScript(decision, genOptions);
        // Si el viral generator devuelve rechazado en el último intento, probar base generator
        if (!script.approved && isLastAttempt) {
          logger.info('Growth Engine: viral rejected on last attempt — trying base generator');
          script = await generateOptimizedScript(decision, genOptions);
        }
      } catch (viralErr) {
        logger.warn(`Growth Engine: viral generator failed (${viralErr.message}), falling back to base generator`);
        script = await generateOptimizedScript(decision, genOptions);
      }
    } catch (err) {
      logger.error(`Growth Engine: generation failed (attempt ${attempts}): ${err.message}`);
      if (attempts > maxRetries) {
        return { success: false, reason: `generation_error: ${err.message}`, decision };
      }
      await new Promise((r) => setTimeout(r, 2000 * attempts));
      continue;
    }

    if (script.approved) {
      logger.info(`Growth Engine: approved (attempt ${attempts}) virality=${script.viralityScore} format=${script.formatMatchScore} emotion=${script.emotionalImpactScore}`);
      break;
    }

    // Guardar gaps para el siguiente reintento (feedback loop)
    previousGaps = script.formatMatchGaps || [];

    logger.warn(`Growth Engine: rejected (attempt ${attempts}) | ${script.rejectionReason}`);
    logRejected(script, script.rejectionReason);

    if (attempts > maxRetries) {
      logger.warn('Growth Engine: max retries reached — skipping this cycle');
      return { success: false, reason: `rejected_after_${attempts}_attempts: ${script.rejectionReason}`, script, decision };
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  // 4. Encolar variante A (script aprobado — hook original o mejorado por context-learner)
  script.abExperimentId = null; // se rellena después
  script.abVariantId    = 'v_a';
  const finalJobId = await addVideoToQueue({
    topic:         script.topic,
    prefabScript:  script,
    growthContext: decision,
  });

  // 5. A/B REAL: generar variante B con hook alternativo y encolarla
  //    createMultiVariantExperiment encola v_b internamente con publishAfter +2h
  let experimentId = null;
  try {
    const experiment = await createMultiVariantExperiment(script, finalJobId, decision);
    experimentId = experiment.experimentId;
    logger.info(`Growth Engine: A/B experiment=${experimentId} | variants=${experiment.variants.length} | topic=${script.topic}`);
  } catch (abErr) {
    logger.warn(`Growth Engine: A/B multi-variant failed (${abErr.message}), single publish`);
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

  logger.info(`Growth Engine: cycle done | jobId=${finalJobId} topic=${script.topic} virality=${script.viralityScore} format=${script.formatMatchScore} ab=${script.abSelectedType || 'off'}`);

  return { success: true, jobId: finalJobId, script, decision, attempts };
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
