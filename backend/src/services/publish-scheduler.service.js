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

async function validateReadyCandidate(video) {
  const snapshot = inspectOutputVideo(video.videoId);
  if (!snapshot.exists || !fs.existsSync(snapshot.videoPath)) {
    return { ok: false, reasons: ['output file missing'] };
  }
  if (!snapshot.sizeBytes || snapshot.sizeBytes < 1024) {
    return { ok: false, reasons: ['output file empty or too small'] };
  }
  if (!isMetadataComplete(snapshot.script)) {
    return { ok: false, reasons: ['critical metadata missing'] };
  }

  const qc = await checkProductionQuality(snapshot.dir, snapshot.script);
  saveQCResult(snapshot.dir, qc);

  const reasons = [];
  if (!qc.passed) reasons.push(...qc.reasons);
  if (snapshot.render?.visibleVisuals !== true) reasons.push('render without visible visuals');
  if (['gradient', 'gradient_fallback'].includes(snapshot.render?.renderMode)) reasons.push(`render degraded (${snapshot.render.renderMode})`);

  return {
    ok: reasons.length === 0,
    reasons,
    qc,
    snapshot,
  };
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
  touchPipelineState({ publishRunning: true, publishLastStartedAt: new Date().toISOString() });

  try {
    const state     = getPublishState();
    const maxPerDay = getMaxPerDayForPhase();
    const thresholds = getOperationalThresholds();
    const expectedSlot = getExpectedPublishSlot();

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

    const readyVideos = getReadyToPublishVideos();
    if (readyVideos.length === 0) {
      logger.info('PublishScheduler: no videos ready to publish');
      try {
        await notifySlotFailed({ reason: 'no_videos', slot: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) });
      } catch {}
      await notifyQueueLow({ readyCount: 0, minReady: thresholds.minReady, inPipeline: getQueueSnapshot().inPipeline, reason: 'publish_slot_empty' });
      await notifyPipelineBlocked({ reason: 'publish_slot_without_ready_video', detail: expectedSlot?.slot || 'sin slot detectado' });
      return;
    }

    // Máximo 1 por slot (el cron fires múltiples veces al día)
    const maxThisSlot = Math.min(maxPerDay - state.count, 1);
    logger.info(`PublishScheduler: ${readyVideos.length} ready | publishing ${maxThisSlot} | phase=${getGrowthPhase()} (${state.count}/${maxPerDay} today)`);

    const { publishAll } = require('./publisher');
    const { saveVideo }  = require('./analytics-tracker');

    let publishedThisSlot = 0;
    const publishLog = loadPublishLog();
    const discardSummary = [];
    const slotFillCandidates = [];

    for (const video of readyVideos) {
      if (state.count >= maxPerDay || publishedThisSlot >= maxThisSlot) break;

      const validation = await validateReadyCandidate(video);
      if (!validation.ok) {
        logger.warn(`PublishScheduler: invalid render ${video.videoId} | ${validation.reasons.join(' | ')}`);
        discardVideo(video.videoId, 'discarded_invalid_render', validation.reasons.join(' | '));
        discardSummary.push({ videoId: video.videoId, reason: 'discarded_invalid_render', detail: validation.reasons.join(' | ') });
        await notifyCandidateDiscarded({ videoId: video.videoId, reasons: validation.reasons, fallbackAttempted: true });
        try { fs.rmSync(path.join(OUTPUT_DIR, video.videoId), { recursive: true, force: true }); } catch {}
        await triggerGenerationTopUp(true);
        continue;
      }
      video.qc = validation.qc;
      video.script = validation.snapshot.script;

      // ── Quality Gate: 3-stage evaluation ────────────────────────────────────
      if (!force) {
        const qg = evaluateCandidate(video.script, publishLog);
        if (!qg.pass) {
          if (isSlotFillEligible(video, qg)) {
            logger.warn(`PublishScheduler: defer-slot-fill ${video.videoId} | motivo=${qg.discardReason} | ${qg.discardDetail}`);
            discardSummary.push({ videoId: video.videoId, reason: qg.discardReason, detail: qg.discardDetail });
            slotFillCandidates.push(video);
            continue;
          }
          logger.warn(
            `PublishScheduler: DESCARTADO ${video.videoId} | ` +
            `motivo=${qg.discardReason} | ${qg.discardDetail} | ` +
            `scoreA=${qg.scoreA} scoreB=${qg.scoreB}`,
          );
          discardVideo(video.videoId, qg.discardReason, qg.discardDetail);
          discardSummary.push({ videoId: video.videoId, reason: qg.discardReason, detail: qg.discardDetail });
          await notifyCandidateDiscarded({ videoId: video.videoId, reasons: [qg.discardReason, qg.discardDetail], fallbackAttempted: true });
          // Limpiar carpeta para no acumular GB de MP4 descartados
          try { fs.rmSync(path.join(OUTPUT_DIR, video.videoId), { recursive: true, force: true }); } catch {}
          await triggerGenerationTopUp(true);
          continue;
        }
        logger.info(`PublishScheduler: APROBADO ${video.videoId} | scoreA=${qg.scoreA} scoreB=${qg.scoreB} final=${qg.scoreFinal}`);
      }

      logger.info(`PublishScheduler: publishing ${video.videoId} | priority=${video.priority}${video.isAbVariant ? ` | AB=${video.experimentId}/${video.variantId}` : ''}`);

      try {
        const published = await publishCandidate(video, { publishAll, saveVideo, state });
        if (!published) continue;
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
      } catch (err) {
        logger.error(`PublishScheduler: failed ${video.videoId}: ${err.message}`);
        try {
          await notifySlotFailed({ reason: 'publish_error', error: err.message, slot: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) });
        } catch {}
        await notifyPipelineBlocked({ reason: 'publish_error', detail: err.message });
        await triggerGenerationTopUp(true);
      }
    }

    // ── Log de slot vacío ────────────────────────────────────────────────────
    if (publishedThisSlot === 0) {
      if (slotFillCandidates.length > 0) {
        const picked = slotFillCandidates.sort((a, b) => b.priority - a.priority)[0];
        logger.warn(`PublishScheduler: slot-fill fallback publishing ${picked.videoId} to avoid empty slot`);
        const validation = await validateReadyCandidate(picked);
        if (!validation.ok) {
          discardVideo(picked.videoId, 'discarded_invalid_slot_fill', validation.reasons.join(' | '));
          await notifyCandidateDiscarded({ videoId: picked.videoId, reasons: validation.reasons, fallbackAttempted: true });
          await triggerGenerationTopUp(true);
          return;
        }
        const published = await publishCandidate({ ...picked, script: validation.snapshot.script, qc: validation.qc }, { publishAll, saveVideo, state, fallbackReason: 'slot_fill_low_virality' });
        if (published) {
          publishedThisSlot++;
          await triggerGenerationTopUp(true);
          return;
        }
      }
      if (discardSummary.length > 0) {
        const byReason = discardSummary.reduce((acc, d) => {
          acc[d.reason] = (acc[d.reason] || 0) + 1;
          return acc;
        }, {});
        logger.warn(
          `PublishScheduler: SLOT VACÍO — ${discardSummary.length} candidato(s) descartado(s) | ` +
          Object.entries(byReason).map(([r, n]) => `${r}×${n}`).join(' | '),
        );
        try {
          const slotTime = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
          await notifySlotFailed({ reason: 'discarded', discards: discardSummary, slot: slotTime });
        } catch {}
        await triggerGenerationTopUp(true);
      } else {
        logger.info('PublishScheduler: SLOT VACÍO — sin candidatos disponibles (cola vacía)');
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
