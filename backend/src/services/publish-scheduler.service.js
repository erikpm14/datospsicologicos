/**
 * publish-scheduler.service.js  v2
 * Scheduler autónomo de PUBLICACIÓN — con estrategia de crecimiento real.
 *
 * MEJORAS v2:
 *   • Horarios optimizados para España (TikTok + YouTube Shorts)
 *   • Detección de fase: inicial (2-4/día) vs crecimiento (3-6/día)
 *   • Respeto de publishAfter en scripts de variantes A/B
 *     (v_b se publica mínimo 2h después de v_a)
 *   • Spacing mínimo entre publicaciones: 1h
 *   • Priorización de vídeos de mayor score dentro de cada slot
 *
 * Slots óptimos España (Europe/Madrid):
 *   Horario A (peak): 13:00 / 19:00 / 21:00
 *   Horario B (alt):  09:00 / 15:30
 *
 * Activar con: AUTO_PUBLISH_ENABLED=true
 */

require('dotenv').config();
const cron   = require('node-cron');
const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');
const { evaluateCandidate, discardVideo, loadPublishLog } = require('./content-quality-gate');
const { checkProductionQuality, saveQCResult } = require('./production-quality-checker');
const { recordPublication } = require('../../../content-engine/tracking/publication-attribution');
const { canConsumeSlot, transitionSlotState } = require('../../../content-engine/tracking/slot-consumption-guard');
const { buildSlotVsResultReport } = require('../../../content-engine/tracking/slot-vs-result-report');
const {
  getOperationalThresholds,
  getQueueSnapshot,
  getReadyVideoEntries,
  inspectOutputVideo,
  isMetadataComplete,
  touchPipelineState,
  getExpectedPublishSlot,
} = require('./operational-state.service');
const {
  notifySlotFailed,
  notifyQueueLow,
  notifyCandidateDiscarded,
  notifySystemRecovered,
  notifyPipelineBlocked,
} = require('./telegram-notifier');
const {
  validateCaptionsForPublish,
  logCaptionValidation,
} = require('./caption-pre-publish-validator');
const {
  isPerfectVideo,
  publishOpportunistic,
  hasReachedDailyLimit,
  isTooCloseToNextSlot,
} = require('./opportunistic-publish');
const {
  publishWithRetries,
  ensureAtLeastOnePublishable,
} = require('./anti-failure-publish-wrapper');

const OUTPUT_DIR         = path.resolve(process.env.OUTPUT_DIR || './output');
const PUBLISH_LOG_PATH   = path.resolve('./data/publish-log.json');
const PUBLISH_STATE_PATH = path.resolve('./data/publish-state.json');

// Horarios peak España — probados en canales de psicología
// Configurable vía PUBLISH_TIMES_CET (separa por comas)
const DEFAULT_TIMES = '09:00,13:00,15:30,19:00,21:00';

let isPublishing = false;

// ─────────────────────────────────────────────
//  FASES DE CRECIMIENTO
// ─────────────────────────────────────────────

function getGrowthPhase() {
  const phase = process.env.GROWTH_PHASE || 'initial'; // initial | growth | scale
  return phase;
}

function getMaxPerDayForPhase() {
  const phase   = getGrowthPhase();
  const override = parseInt(process.env.MAX_PUBLISH_PER_DAY || '0');
  if (override > 0) return override;

  switch (phase) {
    case 'scale':   return 6;
    case 'growth':  return 4;
    default:        return 3; // initial
  }
}

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

// ─────────────────────────────────────────────
//  ESTADO DIARIO
// ─────────────────────────────────────────────

function getPublishState() {
  const today = new Date().toISOString().split('T')[0];
  const state = readJSON(PUBLISH_STATE_PATH, {});
  if (state?.date !== today) return { date: today, count: 0, published: [], lastPublishedAt: null };
  return state;
}

function savePublishState(state) {
  writeJSON(PUBLISH_STATE_PATH, state);
}

// ─────────────────────────────────────────────
//  SPACING — min 1h entre publicaciones
// ─────────────────────────────────────────────

function hasMinSpacing(state, minMinutes = 60) {
  if (!state.lastPublishedAt) return true;
  const elapsed = (Date.now() - new Date(state.lastPublishedAt).getTime()) / 60000;
  return elapsed >= minMinutes;
}

// ─────────────────────────────────────────────
//  PRIORIDAD DE PUBLICACIÓN
// ─────────────────────────────────────────────

function calcPriority(script) {
  if (!script) return 0;
  const virality  = script.viralityScore        || 0;
  const format    = script.formatMatchScore      || 0;
  const retention = script.emotionalImpactScore  || 0;
  return Math.round(virality * 0.40 + format * 0.35 + retention * 0.25);
}

// meetsThresholds eliminado — reemplazado por content-quality-gate.js (3-stage evaluation)

// ─────────────────────────────────────────────
//  ESCANEO DE VÍDEOS LISTOS
// ─────────────────────────────────────────────

/**
 * Devuelve vídeos con output.mp4 + script.json pero sin published.json,
 * respetando publishAfter (campo A/B) y ordenados por prioridad.
 */
function getReadyToPublishVideos() {
  return getReadyVideoEntries()
    .map((entry) => ({
      videoId: entry.videoId,
      videoPath: entry.videoPath,
      script: entry.script,
      qc: entry.qc,
      createdAt: entry.createdAt,
      priority: calcPriority(entry.script),
      isAbVariant: !!entry.script?.abExperimentId,
      experimentId: entry.script?.abExperimentId || null,
      variantId: entry.script?.abVariantId || null,
    }))
    .sort((a, b) => b.priority - a.priority);
}

function isSlotFillEligible(video, qg) {
  return Boolean(
    video?.qc?.passed &&
    fs.existsSync(video.videoPath) &&
    ['discarded_low_virality', 'discarded_low_quality'].includes(qg?.discardReason) &&
    (video.script?.viralityScore || 0) >= Math.max(
      0,
      parseInt(process.env.MIN_VIRALITY_SCORE_TO_PUBLISH || '72', 10) - (parseInt(process.env.SLOT_FILL_MAX_VIRALITY_GAP || '6', 10) || 6),
    )
  );
}

async function validateReadyCandidate(video, allowFallback = false) {
  const snapshot = inspectOutputVideo(video.videoId);

  // Core validation using centralized validator
  const { validatePublishCandidate } = require('./publish-candidate-validator.service');
  const coreValidation = validatePublishCandidate({ videoId: video.videoId }, true);

  // If hard blocks, reject immediately
  if (!coreValidation.hardPassed) {
    return {
      ok: false,
      reasons: coreValidation.hardBlocks,
      blockingReasons: coreValidation.hardBlocks,
      nonBlockingReasons: [],
      blocking: true,
      snapshot,
      videoDuration: coreValidation.duration,
      coreValidation
    };
  }

  const videoDuration = coreValidation.duration;

  const qc = await checkProductionQuality(snapshot.dir, snapshot.script);
  saveQCResult(snapshot.dir, qc);

  const blockingReasons = [];
  const nonBlockingReasons = [];

  // Separar bloqueantes vs no bloqueantes
  if (!qc.passed) {
    // Si QC falla pero el video es básicamente válido (>300KB, >8s), es no bloqueante en fallback
    if (allowFallback && snapshot.sizeBytes >= 300 * 1024 && videoDuration >= 8) {
      nonBlockingReasons.push(...qc.reasons);
    } else {
      blockingReasons.push(...qc.reasons);
    }
  }

  if (snapshot.render?.visibleVisuals !== true && !allowFallback) {
    blockingReasons.push('render without visible visuals');
  }

  if (['gradient', 'gradient_fallback'].includes(snapshot.render?.renderMode) && !allowFallback) {
    blockingReasons.push(`render degraded (${snapshot.render.renderMode})`);
  }

  // Captions: bloqueante solo si hay error crítico
  const captionValidation = validateCaptionsForPublish(video.videoId);
  if (!captionValidation.ok) {
    if (captionValidation.reason?.includes('CRITICAL') || captionValidation.reason?.includes('MISSING')) {
      blockingReasons.push(`captions_critical | ${captionValidation.reason}`);
    } else if (!allowFallback) {
      blockingReasons.push(`captions_invalid | ${captionValidation.reason}`);
    } else {
      nonBlockingReasons.push(`captions_warning | ${captionValidation.reason}`);
    }
    logCaptionValidation(video.videoId, captionValidation, 'CHECK');
  } else {
    logCaptionValidation(video.videoId, captionValidation, 'CHECK');
  }

  // Add core validation warnings to non-blocking
  nonBlockingReasons.push(...coreValidation.warnings);

  const allReasons = [...blockingReasons, ...nonBlockingReasons];
  const hasBlockingReasons = blockingReasons.length > 0;

  return {
    ok: !hasBlockingReasons,
    reasons: allReasons,
    blockingReasons,
    nonBlockingReasons,
    blocking: hasBlockingReasons,
    qc,
    snapshot,
    captionValidation,
    videoDuration,
    coreValidation
  };
}

async function findFallbackCandidate() {
  try {
    const allReadyVideos = getReadyToPublishVideos();
    if (allReadyVideos.length === 0) {
      return null;
    }

    const candidates = [];
    for (const video of allReadyVideos) {
      const validation = await validateReadyCandidate(video, true);

      if (validation.snapshot?.videoPath && fs.existsSync(validation.snapshot.videoPath)) {
        const stats = fs.statSync(validation.snapshot.videoPath);

        if (stats.size >= 300 * 1024 && validation.videoDuration >= 8) {
          candidates.push({
            ...video,
            validation,
            sizeBytes: stats.size,
            score: (video.script?.viralityScore || 0) + (validation.qc?.score || 0) * 0.5,
          });
        }
      }
    }

    if (candidates.length === 0) {
      logger.warn(`PublishScheduler: FALLBACK no candidates found (need >=300KB, >=8s duration)`);
      return null;
    }

    const best = candidates.sort((a, b) => {
      return (b.script?.viralityScore || 0) - (a.script?.viralityScore || 0) ||
             (b.validation?.qc?.score || 0) - (a.validation?.qc?.score || 0) ||
             (b.createdAt || 0) - (a.createdAt || 0);
    })[0];

    logger.info(`PublishScheduler: FALLBACK_CANDIDATE selected | videoId=${best.videoId} | virality=${best.script?.viralityScore || 0} | size=${(best.sizeBytes / 1024 / 1024).toFixed(1)}MB | duration=${best.validation.videoDuration?.toFixed(1)}s`);

    return best;
  } catch (err) {
    logger.error(`PublishScheduler: findFallbackCandidate error: ${err.message}`);
    return null;
  }
}

async function triggerGenerationTopUp(urgent = false) {
  try {
    const { runGenerationCycle } = require('./scheduler.service');
    const thresholds = getOperationalThresholds();
    const snapshot = getQueueSnapshot();
    const deficit = Math.max(0, thresholds.targetReady - snapshot.readyCount);
    if (snapshot.readyCount >= thresholds.targetReady && snapshot.inPipeline >= 0) {
      logger.info(`PublishScheduler: top-up skipped | target ready reached (${snapshot.readyCount}/${thresholds.targetReady})`);
      return;
    }
    const cycles = urgent ? Math.max(1, Math.min(thresholds.topUpBatchSize, deficit || 1)) : 1;
    logger.info(`PublishScheduler: top-up triggered | urgent=${urgent} | ready=${snapshot.readyCount}/${thresholds.targetReady} | inPipeline=${snapshot.inPipeline} | cycles=${cycles}`);
    setTimeout(async () => {
      for (let attempt = 0; attempt < cycles; attempt++) {
        try {
          await runGenerationCycle({ urgent });
        } catch (err) {
          logger.warn(`PublishScheduler: top-up generation failed: ${err.message}`);
          break;
        }
      }
    }, 0);
  } catch (err) {
    logger.warn(`PublishScheduler: top-up generation unavailable: ${err.message}`);
  }
}

async function publishCandidate(video, { publishAll, saveVideo, state, fallbackReason = null } = {}) {
  const guard = canConsumeSlot(video.script?.slotTracking || {}, video.script || {}, {
    abExperimentId: video.experimentId,
    variantId: video.variantId
  });
  if (!guard.allowed) {
    logger.warn(`PublishScheduler: blocked ${video.videoId} | slot=${video.script?.slotTracking?.slotId || 'none'} | reason=${guard.reason}`);
    return false;
  }

  const { results, errors } = await publishAll(video.videoPath, video.script);
  const publishedIds = {};
  for (const r of results) {
    if (r.platform === 'tiktok')    publishedIds.tiktokId    = r.publishId;
    if (r.platform === 'instagram') publishedIds.instagramId = r.mediaId;
    if (r.platform === 'youtube')   publishedIds.youtubeId   = r.videoId;
  }

  writeJSON(path.join(OUTPUT_DIR, video.videoId, 'published.json'), {
    publishedAt: new Date().toISOString(),
    platforms:   results.map(r => r.platform),
    errors,
    fallbackReason,
    ...publishedIds,
  });

  await saveVideo({
    id:              video.videoId,
    title:           video.script?.title || video.videoId,
    topic:           video.script?.topic,
    hook:            video.script?.hook,
    viralityScore:   video.script?.viralityScore,
    script:          { ...video.script, publishFallbackReason: fallbackReason || null },
    tracking:        video.script?.slotTracking || null,
    abExperimentId:  video.experimentId,
    abVariantId:     video.variantId,
    ...publishedIds,
  });

  recordPublication({
    script: video.script,
    publishedVideoId: video.videoId,
    platformVideoId: publishedIds.youtubeId || publishedIds.tiktokId || publishedIds.instagramId || null,
    publishedAt: new Date().toISOString(),
    actualRole: video.script?.strategicRole || video.script?.portfolioRole || null,
    actualCluster: video.script?.slotTracking?.plannedCluster || video.script?.inheritedFromCluster || video.script?.topic || null,
    variantId: video.variantId,
    executionStatus: 'published'
  });

  if (video.script?.slotTracking?.slotId) {
    transitionSlotState(video.script.slotTracking.slotId, 'published', {
      publishedVideoId: video.videoId,
      publishedAt: new Date().toISOString(),
      actualOrder: state.count + 1,
      variantId: video.variantId,
      abExperimentId: video.experimentId
    });
  }
  buildSlotVsResultReport();

  if (video.experimentId) {
    _markVariantPublished(video.experimentId, video.variantId, {
      publishedAt: new Date().toISOString(),
      ...publishedIds,
    });
  }

  state.count++;
  state.lastPublishedAt = new Date().toISOString();
  state.published.push({ videoId: video.videoId, publishedAt: state.lastPublishedAt });
  savePublishState(state);

  const log = readJSON(PUBLISH_LOG_PATH, []);
  log.unshift({
    videoId:          video.videoId,
    publishedAt:      state.lastPublishedAt,
    platforms:        results.map(r => r.platform),
    priority:         video.priority,
    viralityScore:    video.script?.viralityScore,
    formatMatchScore: video.script?.formatMatchScore,
    topic:            video.script?.topic,
    hook:             video.script?.hook,
    batchId:          video.script?.slotTracking?.batchId || null,
    slotId:           video.script?.slotTracking?.slotId || null,
    plannedRole:      video.script?.slotTracking?.plannedRole || null,
    plannedCluster:   video.script?.slotTracking?.plannedCluster || null,
    recommendedCandidateId: video.script?.slotTracking?.recommendedCandidateId || null,
    abExperimentId:   video.experimentId,
    abVariantId:      video.variantId,
    fallbackReason,
    errors,
  });
  writeJSON(PUBLISH_LOG_PATH, log.slice(0, 200));

  logger.info(`PublishScheduler: ✓ published ${video.videoId} → ${results.map(r => r.platform).join(', ') || 'no platforms (no API keys)'}${fallbackReason ? ` | fallback=${fallbackReason}` : ''}`);

  touchPipelineState({
    publishLastSuccessfulAt: new Date().toISOString(),
    lastProgressAt: new Date().toISOString(),
    lastProgressType: 'publish_success',
    lastPublishedVideoId: video.videoId,
  });

  try {
    const { notifyVideoPublished } = require('./telegram-notifier');
    await notifyVideoPublished({ script: { ...video.script, publishFallbackReason: fallbackReason || null }, results, errors, videoId: video.videoId });
  } catch {}

  try {
    if (process.env.CLEANUP_PUBLISHED_OUTPUT !== 'false') {
      fs.rmSync(path.join(OUTPUT_DIR, video.videoId), { recursive: true, force: true });
    }
  } catch {}

  return true;
}

// ─────────────────────────────────────────────
//  PUBLICACIÓN OPPORTUNISTIC (sin slots)
// ─────────────────────────────────────────────

async function checkOpportunisticPublishes(readyVideos, nextSlotTime) {
  const { saveVideo } = require('./analytics-tracker');

  const opportunisticPublished = [];
  const remainingVideos = [];

  // PROTECCIÓN 1: Máximo 1 por ciclo
  let publishedThisRound = 0;
  const MAX_PER_CYCLE = 1;

  // PROTECCIÓN 3: Límite diario
  if (hasReachedDailyLimit()) {
    logger.info('OPPORTUNISTIC_PUBLISH_SKIPPED daily_limit_reached');
    return {
      opportunisticPublished: [],
      remainingVideos: readyVideos,
      maxPerCycleEnforced: true,
      dailyLimitReached: true,
    };
  }

  // PROTECCIÓN 4: Guard de proximidad a slot
  if (isTooCloseToNextSlot(nextSlotTime)) {
    const minutesToSlot = Math.round((nextSlotTime.getTime() - new Date().getTime()) / 60000);
    logger.info(`OPPORTUNISTIC_SKIPPED_NEAR_SLOT minutesToNextSlot=${minutesToSlot}`);
    return {
      opportunisticPublished: [],
      remainingVideos: readyVideos,
      maxPerCycleEnforced: true,
      skippedNearSlot: true,
    };
  }

  for (const video of readyVideos) {
    try {
      // Si ya publicamos 1 este ciclo, todos los demás van a remaining
      if (publishedThisRound >= MAX_PER_CYCLE) {
        remainingVideos.push(video);
        continue;
      }

      const videoPath = video.videoPath;
      const outputDir = path.dirname(videoPath);
      const videoId = video.videoId;

      // PROTECCIÓN 2: Validación estricta (output.mp4 + metadata)
      const validation = isPerfectVideo(videoPath, outputDir, videoId);
      if (!validation.perfect) {
        logger.debug(`OPPORTUNISTIC_PUBLISH_REJECTED videoId=${videoId} reason=${validation.reason}`, validation);
        remainingVideos.push(video);
        continue;
      }

      logger.info(`OPPORTUNISTIC_PUBLISH_TRIGGERED videoId=${videoId}`, {
        reason: 'perfect_video_detected',
        criteria: validation.metadata,
      });

      const result = await publishOpportunistic(videoId, videoPath, video.script);

      if (result.published) {
        logger.info(`OPPORTUNISTIC_PUBLISH_SUCCESS videoId=${videoId} youtubeUrl=${result.youtubeUrl}`);

        // Registrar en analytics sin consumir slot
        await saveVideo({
          id: videoId,
          title: video.script?.title || videoId,
          topic: video.script?.topic,
          hook: video.script?.hook,
          viralityScore: video.script?.viralityScore,
          script: { ...video.script, opportunisticPublish: true },
          youtubeId: result.youtubeUrl ? result.youtubeUrl.split('/').pop() : null,
        }).catch(err => {
          logger.warn(`Failed to save opportunistic video to analytics: ${err.message}`);
        });

        opportunisticPublished.push(videoId);
        publishedThisRound++;

        // Cleanup si está configurado
        try {
          if (process.env.CLEANUP_PUBLISHED_OUTPUT !== 'false') {
            fs.rmSync(outputDir, { recursive: true, force: true });
          }
        } catch {}
      } else {
        // Si falla la publicación opportunistic, deja en ready para siguiente slot
        remainingVideos.push(video);
        logger.warn(`OPPORTUNISTIC_PUBLISH_FAILED videoId=${videoId} error=${result.error}`);
      }
    } catch (err) {
      logger.error(`OPPORTUNISTIC_PUBLISH_EXCEPTION videoId=${video.videoId} error=${err.message}`);
      remainingVideos.push(video);
    }
  }

  return {
    opportunisticPublished,
    remainingVideos,
    maxPerCycleEnforced: publishedThisRound <= MAX_PER_CYCLE,
  };
}

// ─────────────────────────────────────────────
//  CICLO DE PUBLICACIÓN
// ─────────────────────────────────────────────

async function runPublishCycle({ force = false } = {}) {
  if (!force && process.env.AUTO_PUBLISH_ENABLED !== 'true') {
    logger.info('PublishScheduler: AUTO_PUBLISH_ENABLED=false, skipping');
    return;
  }

  if (isPublishing) {
    logger.warn('PublishScheduler: already running, skipping');
    return;
  }

  isPublishing = true;
  const cycleStartTime = new Date();
  const slotTime = cycleStartTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  touchPipelineState({ publishRunning: true, publishLastStartedAt: cycleStartTime.toISOString() });

  // HEARTBEAT/WATCHDOG LOG: Confirmar que el scheduler está vivo
  logger.info(`🔴 [SCHEDULER_HEARTBEAT] slot=${slotTime} CET | process.uptime=${(process.uptime()/3600).toFixed(1)}h | AUTO_PUBLISH_ENABLED=${process.env.AUTO_PUBLISH_ENABLED}`);

  try {
    // TRIGGER: Slot activation
    logger.warn(
      `🔔 [SLOT_TRIGGERED] slotTime=${slotTime} CET | ` +
      `phase=${getGrowthPhase()} | AUTO_PUBLISH_ENABLED=${process.env.AUTO_PUBLISH_ENABLED}`
    );

    const state     = getPublishState();
    const maxPerDay = getMaxPerDayForPhase();
    const thresholds = getOperationalThresholds();
    const expectedSlot = getExpectedPublishSlot();

    logger.info(`📊 [SLOT_DETAILS] time=${slotTime} CET | phase=${getGrowthPhase()} | maxPerDay=${maxPerDay} | todayCount=${state.count}`);
    logger.info(`📋 [REGISTERED_SLOTS] PUBLISH_TIMES_CET=${process.env.PUBLISH_TIMES_CET || DEFAULT_TIMES}`);

    if (state.count >= maxPerDay) {
      logger.info(`PublishScheduler: daily limit reached (${state.count}/${maxPerDay}) — phase=${getGrowthPhase()}`);
      return;
    }

    // Spacing mínimo: 1h entre publicaciones (45min en force)
    const minSpacingMin = force ? 45 : 60;
    if (!hasMinSpacing(state, minSpacingMin)) {
      const elapsed = state.lastPublishedAt
        ? Math.round((Date.now() - new Date(state.lastPublishedAt).getTime()) / 60000)
        : 999;
      logger.info(`PublishScheduler: spacing not met (${elapsed}/${minSpacingMin}min), skipping`);
      return;
    }

    let readyVideos = getReadyToPublishVideos();
    if (readyVideos.length === 0) {
      logger.info('PublishScheduler: no videos ready to publish');
      try {
        await notifySlotFailed({ reason: 'no_videos', slot: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) });
      } catch {}
      return;
    }

    // FASE 1: Buscar y publicar vídeos perfectos (sin consumir slots)
    // Calcular próximo slot para guard de proximidad
    let nextSlotTime = null;
    if (expectedSlot && expectedSlot.slot) {
      const [hour, minute] = expectedSlot.slot.split(':').map(Number);
      nextSlotTime = new Date();
      nextSlotTime.setHours(hour, minute, 0, 0);
      // Si el slot es hoy y ya pasó, apuntar al siguiente
      if (nextSlotTime <= new Date()) {
        nextSlotTime.setDate(nextSlotTime.getDate() + 1);
      }
    }

    const { opportunisticPublished, remainingVideos } = await checkOpportunisticPublishes(readyVideos, nextSlotTime);
    readyVideos = remainingVideos; // Actualizar lista para flujo normal

    if (opportunisticPublished.length > 0) {
      logger.info(`PublishScheduler: ${opportunisticPublished.length} videos published opportunistically (without slots)`);
    }

    if (readyVideos.length === 0) {
      logger.info('PublishScheduler: no regular-slot videos available after opportunistic publishes');
      return;
    }

    // Máximo 1 por slot (el cron fires múltiples veces al día)
    const maxThisSlot = Math.min(maxPerDay - state.count, 1);
    logger.info(`PublishScheduler: ${readyVideos.length} ready (after opportunistic) | publishing ${maxThisSlot} | phase=${getGrowthPhase()} (${state.count}/${maxPerDay} today)`);

    const { publishAll } = require('./publisher');
    const { saveVideo }  = require('./analytics-tracker');

    let publishedThisSlot = 0;
    const publishLog = loadPublishLog();
    const discardSummary = [];
    const validCandidates = []; // hardPassed videos
    const qcFailedCandidates = []; // hardPassed but QC failed

    for (const video of readyVideos) {
      if (state.count >= maxPerDay || publishedThisSlot >= maxThisSlot) break;

      const validation = await validateReadyCandidate(video, false);

      // CRITICAL: Hard blocks must reject immediately (technical impossibilities)
      if (!validation.coreValidation?.hardPassed) {
        const videoPath = validation.snapshot?.videoPath;
        const sizeKB = validation.snapshot?.sizeBytes ? (validation.snapshot.sizeBytes / 1024).toFixed(0) : 'unknown';
        const durationStr = validation.videoDuration ? `${validation.videoDuration.toFixed(1)}s` : 'unknown';

        logger.warn(
          `⏭️  [CANDIDATE_HARD_REJECTED] videoId=${video.videoId} | ` +
          `file=${sizeKB}KB | duration=${durationStr} | ` +
          `hard_blocks=${validation.coreValidation?.hardBlocks?.join(' | ') || 'unknown'}`
        );

        discardVideo(video.videoId, 'discarded_hard_block', validation.coreValidation?.hardBlocks?.join(' | ') || 'unknown');
        discardSummary.push({
          videoId: video.videoId,
          reason: 'discarded_hard_block',
          detail: validation.coreValidation?.hardBlocks?.join(' | ') || 'unknown',
          sizeKB: parseInt(sizeKB) || 0,
          duration: validation.videoDuration || 0,
        });

        await notifyCandidateDiscarded({ videoId: video.videoId, reasons: validation.coreValidation?.hardBlocks || [], fallbackAttempted: false });

        // Only hard delete if truly invalid (missing file, <100KB)
        const hardDelete = !validation.snapshot?.videoPath ||
          !fs.existsSync(validation.snapshot.videoPath) ||
          (validation.snapshot.sizeBytes || 0) < 100 * 1024;
        if (hardDelete) {
          try { fs.rmSync(path.join(OUTPUT_DIR, video.videoId), { recursive: true, force: true }); } catch {}
        }
        await triggerGenerationTopUp(true);
        continue;
      }

      // Video passed hard blocks: it's technically publishable
      video.qc = validation.qc;
      video.script = validation.snapshot.script;
      video.validation = validation;

      // ── Quality Gate: NEVER blocks hardPassed videos, only affects priority ────────────────────────────────────
      if (!force) {
        const qg = evaluateCandidate(video.script, publishLog);
        if (!qg.pass) {
          // QC failed but video is technically valid: add to fallback pool
          logger.warn(
            `⚠️  [QC_FAILED_SAVE_FOR_FALLBACK] ${video.videoId} | ` +
            `motivo=${qg.discardReason} | ${qg.discardDetail} | ` +
            `scoreA=${qg.scoreA} scoreB=${qg.scoreB} | STATUS=will_use_if_no_qc_pass`
          );
          qcFailedCandidates.push({ video, qg });
          continue;
        }
        logger.info(`PublishScheduler: QC_PASSED ${video.videoId} | scoreA=${qg.scoreA} scoreB=${qg.scoreB} final=${qg.scoreFinal}`);
        video.qg = qg;
      }

      // Passed hard blocks and (no QC required OR QC passed): eligible to publish
      validCandidates.push(video);
    }

    // ── PRIMARY ATTEMPT: Publish videos that passed QC with anti-failure retries ────────────────────────────────────
    for (const video of validCandidates) {
      if (state.count >= maxPerDay || publishedThisSlot >= maxThisSlot) break;

      logger.info(
        `PublishScheduler: attempting QC-passed video ${video.videoId} | ` +
        `priority=${video.priority}${video.isAbVariant ? ` | AB=${video.experimentId}/${video.variantId}` : ''}`
      );

      try {
        const published = await publishWithRetries({
          video,
          strategy: 'normal',
          publishAll,
          saveVideo,
          state,
        });

        if (!published) {
          logger.warn(`PublishScheduler: QC-passed retry exhausted ${video.videoId}, trying next candidate`);
          continue;
        }

        publishedThisSlot++;
        await triggerGenerationTopUp(false);
        const postPublishSnapshot = getQueueSnapshot();
        if (postPublishSnapshot.readyCount < thresholds.minReady) {
          await notifyQueueLow({
            readyCount: postPublishSnapshot.readyCount,
            minReady: thresholds.minReady,
            inPipeline: postPublishSnapshot.inPipeline,
            reason: 'post_publish_below_min',
          });
        }
        await notifySystemRecovered({ scope: 'publish', detail: `slot ${expectedSlot?.slot || 'manual'} completado` });
        return;
      } catch (err) {
        logger.error(`PublishScheduler: exception during QC-passed publish ${video.videoId}: ${err.message}`);
        await triggerGenerationTopUp(true);
        continue;
      }
    }

    // ── FALLBACK: If no QC-passed videos, use hardPassed videos (QC override) ────────────────────────────────────
    if (publishedThisSlot === 0 && qcFailedCandidates.length > 0) {
      logger.warn(`⚠️  [QC_OVERRIDE_FALLBACK] no_qc_passed_videos | qc_failed_but_valid=${qcFailedCandidates.length}`);

      // Sort by virality to pick best despite QC failure
      const picked = qcFailedCandidates.sort((a, b) => {
        const virB = b.video.script?.viralityScore || 0;
        const virA = a.video.script?.viralityScore || 0;
        return virB - virA;
      })[0];

      if (picked) {
        logger.warn(
          `🔄 [QC_OVERRIDE_PUBLISH] videoId=${picked.video.videoId} | ` +
          `qc_fail_reason=${picked.qg?.discardReason} | ` +
          `virality=${picked.video.script?.viralityScore || 0} | ` +
          `reason=hardpassed_override`
        );

        try {
          const published = await publishWithRetries({
            video: picked.video,
            strategy: 'force',
            publishAll,
            saveVideo,
            state,
          });

          if (published) {
            logger.info(`✅ [QC_OVERRIDE_EXECUTED] videoId=${picked.video.videoId} | slot_protected_by_hardpassed`);
            publishedThisSlot++;
            await triggerGenerationTopUp(true);
            return;
          } else {
            logger.warn(`PublishScheduler: QC override retry exhausted ${picked.video.videoId}, trying best-valid fallback`);
          }
        } catch (err) {
          logger.error(`PublishScheduler: QC override exception ${picked.video.videoId}: ${err.message}`);
        }
      }

      // FALLBACK 2: Buscar best valid MP4 (>300KB, >=8s) entre todos ready videos
      const fallbackCandidate = await findFallbackCandidate();
      if (fallbackCandidate) {
        logger.warn(
          `🔄 [FALLBACK_PUBLISH_ATTEMPT] strategy=best_valid_output | ` +
          `videoId=${fallbackCandidate.videoId} | virality=${fallbackCandidate.script?.viralityScore || 0}`
        );
        try {
          const published = await publishWithRetries({
            video: { ...fallbackCandidate, script: fallbackCandidate.validation.snapshot.script, qc: fallbackCandidate.validation.qc },
            strategy: 'fallback',
            publishAll,
            saveVideo,
            state,
          });

          if (published) {
            logger.info(`✅ [FALLBACK_PUBLISH_USED] strategy=best_valid_output | videoId=${fallbackCandidate.videoId}`);
            publishedThisSlot++;
            await triggerGenerationTopUp(true);
            return;
          } else {
            logger.warn(`PublishScheduler: Fallback retry exhausted ${fallbackCandidate.videoId}`);
          }
        } catch (err) {
          logger.error(`❌ [FALLBACK_PUBLISH_FAILED] videoId=${fallbackCandidate.videoId} | error=${err.message}`);
        }
      }

      // NO FALLBACK POSIBLE: Registrar SLOT_SKIPPED_NO_VALID_VIDEO o SLOT_LOST_FINAL
      if (discardSummary.length > 0) {
        const byReason = discardSummary.reduce((acc, d) => {
          acc[d.reason] = (acc[d.reason] || 0) + 1;
          return acc;
        }, {});
        const blockingCount = discardSummary.filter(d => d.blocking).length;
        const nonBlockingCount = discardSummary.filter(d => !d.blocking).length;
        const hasValidSize = discardSummary.some(d => d.sizeKB >= 300 && d.duration >= 8);

        if (!hasValidSize) {
          // No hay candidatos con size>=300KB y duration>=8s: guardar estado de slot saltado
          logger.warn(
            `⏸️  [SLOT_SKIPPED_NO_VALID_VIDEO] slot=${slotTime} CET | ` +
            `totalDiscarded=${discardSummary.length} (blocking=${blockingCount}, non-blocking=${nonBlockingCount}) | ` +
            `reasons=[${Object.entries(byReason).map(([r, n]) => `${r}×${n}`).join(', ')}]`
          );

          // Guardar estado de slot saltado para late publish recovery
          const skippedSlotState = {
            lastSkippedSlot: {
              slotTime,
              date: new Date().toISOString().split('T')[0],
              skippedAt: new Date().toISOString(),
              mustExpireAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 horas
              reason: 'no_valid_candidates',
            },
          };
          try {
            const stateFile = path.join(path.resolve('.'), 'data', 'skipped-slots-state.json');
            const dataDir = path.dirname(stateFile);
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(stateFile, JSON.stringify(skippedSlotState, null, 2));
            logger.info(`[SLOT_SKIPPED_SAVED] late-publish will be attempted within 2h`);
          } catch (err) {
            logger.warn(`[SLOT_SKIPPED_SAVE_ERROR] ${err.message}`);
          }
        } else {
          // Hay candidatos válidos pero fueron rechazados por QC: registrar como LOST
          logger.error(
            `🔴 [SLOT_LOST_FINAL] slot=${slotTime} CET | ` +
            `totalDiscarded=${discardSummary.length} (blocking=${blockingCount}, non-blocking=${nonBlockingCount}) | ` +
            `reasons=[${Object.entries(byReason).map(([r, n]) => `${r}×${n}`).join(', ')}]`
          );
          try {
            await notifySlotFailed({ reason: 'discarded', discards: discardSummary, slot: slotTime });
          } catch {}
        }
        await triggerGenerationTopUp(true);
      } else {
        logger.error(`🔴 [SLOT_LOST_FINAL] slot=${slotTime} CET | reason=no_ready_videos (queue empty)`);
        await triggerGenerationTopUp(true);
      }
    }

  } finally {
    isPublishing = false;
    touchPipelineState({
      publishRunning: false,
      publishLastFinishedAt: new Date().toISOString(),
    });
  }
}

/**
 * Actualiza el timestamp de publicación de una variante en ab-experiments-v2.json
 */
function _markVariantPublished(experimentId, variantId, publishData) {
  try {
    const EXPERIMENTS_V2 = path.resolve('./data/ab-experiments-v2.json');
    if (!fs.existsSync(EXPERIMENTS_V2)) return;
    const experiments = JSON.parse(fs.readFileSync(EXPERIMENTS_V2, 'utf8'));
    const exp         = experiments.find(e => e.experimentId === experimentId);
    if (!exp) return;
    const variant     = exp.variants.find(v => v.variantId === variantId);
    if (!variant) return;
    Object.assign(variant, publishData);
    fs.writeFileSync(EXPERIMENTS_V2, JSON.stringify(experiments, null, 2));
  } catch {}
}

// ─────────────────────────────────────────────
//  API PÚBLICA
// ─────────────────────────────────────────────

function getPublishSchedulerStatus() {
  const times = (process.env.PUBLISH_TIMES_CET || DEFAULT_TIMES).split(',').map(t => t.trim());
  return {
    type:          'publish',
    enabled:       process.env.AUTO_PUBLISH_ENABLED === 'true',
    phase:         getGrowthPhase(),
    publishTimes:  times,
    maxPerDay:     getMaxPerDayForPhase(),
    isPublishing,
    todayState:    getPublishState(),
    recentLog:     readJSON(PUBLISH_LOG_PATH, []).slice(0, 10),
    readyToPublish:getReadyToPublishVideos().length,
  };
}

function startPublishScheduler() {
  if (process.env.AUTO_PUBLISH_ENABLED !== 'true') {
    logger.info('PublishScheduler: AUTO_PUBLISH_ENABLED=false — not starting');
    return;
  }

  const times = (process.env.PUBLISH_TIMES_CET || DEFAULT_TIMES)
    .split(',').map(t => t.trim());

  for (const time of times) {
    const [hour, min = '0'] = time.split(':');
    const cronExpr = `${min} ${hour} * * *`;
    logger.info(`PublishScheduler: scheduled at ${time} CET (${cronExpr})`);

    // Pre-slot ping (5 minutos antes): visibilidad + alerta si cola baja
    try {
      const h = parseInt(hour, 10);
      const m = parseInt(min, 10);
      if (!Number.isNaN(h) && !Number.isNaN(m)) {
        const preMins = (h * 60 + m - 5 + 24 * 60) % (24 * 60);
        const preH = Math.floor(preMins / 60);
        const preMin = preMins % 60;
        const preExpr = `${preMin} ${preH} * * *`;
        cron.schedule(preExpr, async () => {
          try {
            const snapshot = getQueueSnapshot();
            const ready = snapshot?.readyCount ?? (snapshot?.readyVideos?.length || 0);
            logger.info(`PublishScheduler: pre-slot check for ${time} | ready=${ready} | inPipeline=${snapshot?.inPipeline ?? 'n/a'}`);
            try {
              const { notifyQueueLow } = require('./telegram-notifier');
              await notifyQueueLow({ readyCount: ready, minReady: 2, inPipeline: snapshot?.inPipeline ?? 0, reason: 'pre_slot', slot: time, minutesUntilSlot: 5 });
            } catch {}
          } catch (err) {
            logger.warn(`PublishScheduler: pre-slot check failed: ${err.message}`);
          }
        }, { timezone: 'Europe/Madrid' });
      }
    } catch {}

    cron.schedule(cronExpr, async () => {
      logger.info(`PublishScheduler: slot fired at ${time}`);
      await runPublishCycle();
    }, { timezone: 'Europe/Madrid' });
  }

  logger.info(`PublishScheduler: active | phase=${getGrowthPhase()} | maxPerDay=${getMaxPerDayForPhase()}`);
}

module.exports = {
  startPublishScheduler,
  runPublishCycle,
  getPublishSchedulerStatus,
  getReadyToPublishVideos,
};
