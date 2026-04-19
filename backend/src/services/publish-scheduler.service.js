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
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  const now = Date.now();

  return fs.readdirSync(OUTPUT_DIR)
    .filter((d) => {
      const videoPath      = path.join(OUTPUT_DIR, d, 'output.mp4');
      const scriptPath     = path.join(OUTPUT_DIR, d, 'script.json');
      const publishedPath  = path.join(OUTPUT_DIR, d, 'published.json');
      const discardedPath  = path.join(OUTPUT_DIR, d, 'discarded.json');
      if (!fs.existsSync(videoPath) || !fs.existsSync(scriptPath)) return false;
      if (fs.existsSync(publishedPath) || fs.existsSync(discardedPath)) return false;

      // Respetar publishAfter (variante B de A/B)
      try {
        const script = readJSON(scriptPath);
        if (script?.publishAfter && new Date(script.publishAfter).getTime() > now) return false;
      } catch {}

      return true;
    })
    .map((d) => {
      const scriptPath = path.join(OUTPUT_DIR, d, 'script.json');
      const script     = readJSON(scriptPath);
      const stat       = fs.statSync(path.join(OUTPUT_DIR, d, 'output.mp4'));
      return {
        videoId:       d,
        videoPath:     path.join(OUTPUT_DIR, d, 'output.mp4'),
        script,
        createdAt:     stat.mtime.toISOString(),
        priority:      calcPriority(script),
        isAbVariant:   !!script?.abExperimentId,
        experimentId:  script?.abExperimentId || null,
        variantId:     script?.abVariantId || null,
      };
    })
    .sort((a, b) => b.priority - a.priority);
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

  try {
    const state     = getPublishState();
    const maxPerDay = getMaxPerDayForPhase();

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

    for (const video of readyVideos) {
      if (state.count >= maxPerDay || publishedThisSlot >= maxThisSlot) break;

      // ── Quality Gate: 3-stage evaluation ────────────────────────────────────
      if (!force) {
        const qg = evaluateCandidate(video.script, publishLog);
        if (!qg.pass) {
          logger.warn(
            `PublishScheduler: DESCARTADO ${video.videoId} | ` +
            `motivo=${qg.discardReason} | ${qg.discardDetail} | ` +
            `scoreA=${qg.scoreA} scoreB=${qg.scoreB}`,
          );
          discardVideo(video.videoId, qg.discardReason, qg.discardDetail);
          discardSummary.push({ videoId: video.videoId, reason: qg.discardReason, detail: qg.discardDetail });
          continue;
        }
        logger.info(`PublishScheduler: APROBADO ${video.videoId} | scoreA=${qg.scoreA} scoreB=${qg.scoreB} final=${qg.scoreFinal}`);
      }

      logger.info(`PublishScheduler: publishing ${video.videoId} | priority=${video.priority}${video.isAbVariant ? ` | AB=${video.experimentId}/${video.variantId}` : ''}`);

      try {
        const { results, errors } = await publishAll(video.videoPath, video.script);

        const publishedIds = {};
        for (const r of results) {
          if (r.platform === 'tiktok')    publishedIds.tiktokId    = r.publishId;
          if (r.platform === 'instagram') publishedIds.instagramId = r.mediaId;
          if (r.platform === 'youtube')   publishedIds.youtubeId   = r.videoId;
        }

        // Marca como publicado
        writeJSON(path.join(OUTPUT_DIR, video.videoId, 'published.json'), {
          publishedAt: new Date().toISOString(),
          platforms:   results.map(r => r.platform),
          errors,
          ...publishedIds,
        });

        // Registrar en analytics — incluir experimentId/variantId para tracking A/B
        await saveVideo({
          id:              video.videoId,
          title:           video.script?.title || video.videoId,
          topic:           video.script?.topic,
          hook:            video.script?.hook,
          viralityScore:   video.script?.viralityScore,
          script:          video.script,
          abExperimentId:  video.experimentId,
          abVariantId:     video.variantId,
          ...publishedIds,
        });

        // Actualizar variante en experimento A/B si aplica
        if (video.experimentId) {
          _markVariantPublished(video.experimentId, video.variantId, {
            publishedAt: new Date().toISOString(),
            ...publishedIds,
          });
        }

        state.count++;
        state.lastPublishedAt = new Date().toISOString();
        publishedThisSlot++;
        state.published.push({ videoId: video.videoId, publishedAt: state.lastPublishedAt });
        savePublishState(state);

        // Log
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
          abExperimentId:   video.experimentId,
          abVariantId:      video.variantId,
          errors,
        });
        writeJSON(PUBLISH_LOG_PATH, log.slice(0, 200));

        logger.info(`PublishScheduler: ✓ published ${video.videoId} → ${results.map(r => r.platform).join(', ') || 'no platforms (no API keys)'}`);

        // Telegram
        try {
          const { notifyVideoPublished } = require('./telegram-notifier');
          await notifyVideoPublished({ script: video.script, results, errors, videoId: video.videoId });
        } catch {}

        // Limpiar carpeta local
        try {
          fs.rmSync(path.join(OUTPUT_DIR, video.videoId), { recursive: true, force: true });
        } catch {}

      } catch (err) {
        logger.error(`PublishScheduler: failed ${video.videoId}: ${err.message}`);
      }
    }

    // ── Log de slot vacío ────────────────────────────────────────────────────
    if (publishedThisSlot === 0) {
      if (discardSummary.length > 0) {
        const byReason = discardSummary.reduce((acc, d) => {
          acc[d.reason] = (acc[d.reason] || 0) + 1;
          return acc;
        }, {});
        logger.warn(
          `PublishScheduler: SLOT VACÍO — ${discardSummary.length} candidato(s) descartado(s) | ` +
          Object.entries(byReason).map(([r, n]) => `${r}×${n}`).join(' | '),
        );
      } else if (readyVideos.length === 0) {
        logger.info('PublishScheduler: SLOT VACÍO — sin candidatos disponibles (cola vacía)');
      }
    }

  } finally {
    isPublishing = false;
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
