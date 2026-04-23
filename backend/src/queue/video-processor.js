/**
 * video-processor.js
 * Cola de trabajos sin Redis ni BullMQ.
 * Usa archivos JSON en disco + p-queue para concurrencia.
 * 100% gratis, persistente entre reinicios.
 *
 * Estructura de carpetas:
 *   queue/pending/   → trabajos esperando
 *   queue/active/    → trabajo en curso
 *   queue/done/      → completados (últimos 50)
 *   queue/failed/    → fallidos con error
 */

require('dotenv').config();
const PQueue = require('p-queue').default;
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { generateScript } = require('../services/content-generator');
const { generateFruitDrama } = require('../services/fruit-drama-generator');
const { renderFruitDrama }   = require('../services/fruit-drama-renderer');
const { generateBestScript } = require('../../../content-engine/decision-engine');
const { synthesizeVoice } = require('../services/voice-synthesizer');
const { renderVideoWithRouter, shouldBlockPublish } = require('../services/render-engines');
const { publishAll } = require('../services/publisher');
const { saveVideo, pollAllMetrics } = require('../services/analytics-tracker');
const {
  notifyVideoPublished,
  notifyJobFailed,
  notifyCandidateDiscarded,
  notifyPipelineBlocked,
} = require('../services/telegram-notifier');
const { postprocessAudioSafe, getProcessedAudioPath } = require('../services/audio-postprocess');
const { checkProductionQuality, saveQCResult } = require('../services/production-quality-checker');
const { assignSlotToCandidate, markSlotAssignmentStatus } = require('../../../content-engine/tracking/slot-assignment-manager');
const { recordPublication } = require('../../../content-engine/tracking/publication-attribution');
const { touchPipelineState, getOperationalThresholds } = require('../services/operational-state.service');
const themes = require('../templates/visual-themes.json');
const logger = require('../utils/logger');
const { createPerfTracker, formatDurationMs } = require('../utils/perf-tracker');

// ─────────────────────────────────────────────
//  PATHS DE LA COLA
// ─────────────────────────────────────────────

const QUEUE_BASE = path.resolve(process.env.QUEUE_DIR || './queue');
const DIRS = {
  pending: path.join(QUEUE_BASE, 'pending'),
  active: path.join(QUEUE_BASE, 'active'),
  done: path.join(QUEUE_BASE, 'done'),
  failed: path.join(QUEUE_BASE, 'failed'),
};

for (const dir of Object.values(DIRS)) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─────────────────────────────────────────────
//  COLA EN MEMORIA (concurrencia 1)
// ─────────────────────────────────────────────

const QUEUE_CONCURRENCY = Math.max(1, parseInt(process.env.QUEUE_CONCURRENCY || '2', 10) || 2);
const queue = new PQueue({ concurrency: QUEUE_CONCURRENCY });
let themeRotationIndex = 0;

// ─────────────────────────────────────────────
//  GESTIÓN DE JOBS EN DISCO
// ─────────────────────────────────────────────

function writeJob(dir, job) {
  const filePath = path.join(dir, `${job.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(job, null, 2));
  return filePath;
}

function deleteJob(dir, jobId) {
  const filePath = path.join(dir, `${jobId}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function moveJob(fromDir, toDir, job) {
  deleteJob(fromDir, job.id);
  writeJob(toDir, job);
}

function getPendingJobs() {
  return fs.readdirSync(DIRS.pending)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(DIRS.pending, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function trimDoneFolder(maxFiles = 50) {
  const files = fs.readdirSync(DIRS.done)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(DIRS.done, f)).mtime }))
    .sort((a, b) => a.mtime - b.mtime);

  while (files.length > maxFiles) {
    fs.unlinkSync(path.join(DIRS.done, files.shift().name));
  }
}

async function withRetries(label, fn, options = {}) {
  const attempts = Math.max(1, options.attempts || 1);
  const baseDelayMs = Math.max(500, options.baseDelayMs || 1500);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      logger.warn(`${label}: attempt ${attempt}/${attempts} failed | ${error.message}`);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
  }

  throw lastError;
}

function updateJobProgress(job, progress, stage, extra = {}) {
  job.progress = progress;
  job.lastStage = stage;
  job.lastProgressAt = new Date().toISOString();
  Object.assign(job, extra);
  touchPipelineState({
    lastProgressAt: job.lastProgressAt,
    lastProgressType: stage,
    lastJobId: job.id,
    lastVideoId: extra.videoId || job.result?.videoId || null,
  });
  writeJob(DIRS.active, job);
}

// ─────────────────────────────────────────────
//  PIPELINE PRINCIPAL
// ─────────────────────────────────────────────

async function processPipeline(job) {
  // ── Fruit Drama: pipeline completamente distinto ────────────────────
  if (job.data.isFruitDrama) {
    return processFruitDramaPipeline(job);
  }

  const { topic, hookId, themeIndex } = job.data;
  const videoId = uuidv4();
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './output', videoId);
  fs.mkdirSync(outputDir, { recursive: true });
  const perf = createPerfTracker('video-pipeline', { jobId: job.id, videoId, topic: topic || job.data.prefabScript?.topic || null });

  logger.info(`[Job ${job.id}] Pipeline start: video ${videoId}`);
  job.progress = 0;
  job.startedAt = new Date().toISOString();
  job.status = 'active';
  job.performance = perf.snapshot();
  job.videoId = videoId;
  moveJob(DIRS.pending, DIRS.active, job);
  touchPipelineState({
    pipelineActive: true,
    lastProgressAt: job.startedAt,
    lastProgressType: 'pipeline_started',
    lastJobId: job.id,
    lastVideoId: videoId,
  });

  // 1. Guión con Claude (o usar guión prefabricado de una serie)
  logger.info(`[Job ${job.id}] 1/4 Generating script...`);
  perf.start('script_generation');
  let script = job.data.prefabScript
    ? job.data.prefabScript
    : await withRetries(`[Job ${job.id}] script_generation`, async () => (
      generateBestScript({ topic }) || await generateScript({ topic, hookId, forceHighScore: true })
    ), { attempts: parseInt(process.env.GENERATION_STEP_RETRIES || '3', 10) || 3, baseDelayMs: 2000 });
  script = script.slotTracking?.exactTraceAvailable
    ? script
    : assignSlotToCandidate(script, { jobId: job.id, growthContext: job.data.growthContext, assignmentStatus: 'queued' });
  if (script.slotTracking?.slotId) {
    markSlotAssignmentStatus(script.slotTracking.slotId, 'queued', {
      queueJobId: job.id,
      assignedCandidateId: script.id || null,
      assignedCandidateTitle: script.title || null,
      variantId: script.abVariantId || null,
      abExperimentId: script.abExperimentId || null,
      assignmentConfidence: script.slotTracking.assignmentConfidence || 0,
      traceConfidence: script.slotTracking.traceConfidence || 0
    });
  }

  // Estampar versión de contenido para bloquear publicación de contenido antiguo
  script.contentVersion = process.env.CONTENT_VERSION || 'v2';

  // Guardar script.json en disco para que el frontend pueda mostrarlo
  fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2));
  const scriptPhase = perf.end({
    source: job.data.prefabScript ? 'prefab' : script.generationFallback || 'llm',
    estimatedWords: script.estimatedWords || null,
    durationSeconds: script.durationSeconds || null,
  });
  logger.info(`[Job ${job.id}] script_generation done in ${formatDurationMs(scriptPhase.durationMs)}`);
  job.performance = perf.snapshot();
  updateJobProgress(job, 25, 'script_generated', { videoId });

  // 2. Voz (Kokoro local o Edge TTS fallback)
  logger.info(`[Job ${job.id}] 2/5 Synthesizing voice...`);
  perf.start('tts');
  const audioPathHint = path.join(outputDir, 'voice.mp3');
  const { audioPath: rawAudioPath, estimatedDuration: audioDuration, wordBoundaries, sectionDurations, narrationPlan } = await withRetries(
    `[Job ${job.id}] tts`,
    async () => synthesizeVoice(script, audioPathHint),
    { attempts: parseInt(process.env.TTS_STEP_RETRIES || '2', 10) || 2, baseDelayMs: 2500 },
  );
  script.narrationPlan = narrationPlan || script.narrationPlan || null;
  fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2));
  // rawAudioPath puede ser .wav (Kokoro) o .mp3 (Edge TTS)
  const ttsPhase = perf.end({
    provider: rawAudioPath.toLowerCase().endsWith('.wav') ? 'kokoro' : 'edge',
    estimatedDuration: audioDuration,
    wordBoundaries: wordBoundaries?.length || 0,
  });
  logger.info(`[Job ${job.id}] tts done in ${formatDurationMs(ttsPhase.durationMs)}`);
  job.performance = perf.snapshot();
  updateJobProgress(job, 40, 'tts_done', { videoId });

  // 2b. Postproceso de audio: loudnorm -16 LUFS + compresión + highpass
  logger.info(`[Job ${job.id}] 2b/5 Postprocessing audio...`);
  perf.start('audio_postprocess');
  const processedAudioPath = getProcessedAudioPath(rawAudioPath);
  const { audioPath } = await withRetries(
    `[Job ${job.id}] audio_postprocess`,
    async () => postprocessAudioSafe(rawAudioPath, processedAudioPath),
    { attempts: parseInt(process.env.AUDIO_POSTPROCESS_RETRIES || '2', 10) || 2, baseDelayMs: 1500 },
  );
  const postPhase = perf.end({ outputPath: audioPath });
  logger.info(`[Job ${job.id}] audio_postprocess done in ${formatDurationMs(postPhase.durationMs)}`);
  job.performance = perf.snapshot();
  updateJobProgress(job, 50, 'audio_postprocessed', { videoId });

  // 3. Renderizado FFmpeg
  logger.info(`[Job ${job.id}] 3/5 Rendering video...`);
  const themeId = themes.rotation[(themeIndex || 0) % themes.rotation.length];
  const videoPath = path.join(outputDir, 'output.mp4');
  perf.start('render');
  if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 1024) {
    logger.info(`[Job ${job.id}] render skipped | existing output reused`);
  } else {
    await withRetries(
      `[Job ${job.id}] render`,
      async () => renderVideoWithRouter({ script, audioPath, audioDuration, outputPath: videoPath, themeId, wordBoundaries, sectionDurations, bgStyle: job.data.bgStyle }),
      { attempts: parseInt(process.env.RENDER_STEP_RETRIES || '2', 10) || 2, baseDelayMs: 3000 },
    );
  }
  const renderPhase = perf.end({ outputPath: videoPath });
  logger.info(`[Job ${job.id}] render done in ${formatDurationMs(renderPhase.durationMs)}`);
  if (script.slotTracking?.slotId) {
    markSlotAssignmentStatus(script.slotTracking.slotId, 'rendered', {
      assignedCandidateId: script.id || null,
      assignedCandidateTitle: script.title || null,
      variantId: script.abVariantId || null,
      abExperimentId: script.abExperimentId || null
    });
  }
  job.performance = perf.snapshot();
  updateJobProgress(job, 70, 'render_done', { videoId });

  // 3b. Quality Gate — productionQualityScore antes de publicar
  logger.info(`[Job ${job.id}] 3b/5 Running production quality check...`);
  perf.start('quality_check');
  const qcResult = await withRetries(
    `[Job ${job.id}] quality_check`,
    async () => checkProductionQuality(outputDir, script),
    { attempts: parseInt(process.env.QC_STEP_RETRIES || '2', 10) || 2, baseDelayMs: 1000 },
  );
  saveQCResult(outputDir, qcResult);
  const qcPhase = perf.end({ passed: qcResult.passed, score: qcResult.score, threshold: qcResult.threshold });
  logger.info(`[Job ${job.id}] quality_check done in ${formatDurationMs(qcPhase.durationMs)} | passed=${qcResult.passed}`);
  if (!qcResult.passed) {
    logger.warn(`[Job ${job.id}] QC FAILED (score=${qcResult.score}/${qcResult.threshold}) — skipping publish | issues: ${qcResult.reasons.join(' | ')}`);
    job.progress  = 100;
    job.result    = { videoId, skipped: true, qcScore: qcResult.score, qcReasons: qcResult.reasons };
    job.completedAt = new Date().toISOString();
    job.status = 'done';
    job.performance = perf.snapshot({ result: 'qc_failed' });
    fs.writeFileSync(path.join(outputDir, 'pipeline-metrics.json'), JSON.stringify(job.performance, null, 2));
    moveJob(DIRS.active, DIRS.done, job);
    trimDoneFolder(50);
    touchPipelineState({
      lastProgressAt: new Date().toISOString(),
      lastProgressType: 'qc_failed',
      lastFailedVideoId: videoId,
      pipelineActive: false,
    });
    await notifyCandidateDiscarded({ videoId, reasons: qcResult.reasons, fallbackAttempted: true });
    try {
      const { runGenerationCycle } = require('../services/scheduler.service');
      setTimeout(() => runGenerationCycle({ urgent: true }).catch(() => {}), 0);
    } catch {}
    return job.result;
  }
  logger.info(`[Job ${job.id}] QC PASSED (score=${qcResult.score})`);
  job.performance = perf.snapshot();
  updateJobProgress(job, 75, 'qc_passed', { videoId });

  // 4. Publicación o diferimiento según AUTO_PUBLISH_ENABLED
  // BLOQUEAR si VIDEO_USE + DRY_RUN
  const dryRunBlocksPublish = shouldBlockPublish(outputDir);
  if (dryRunBlocksPublish) {
    logger.warn(`[Job ${job.id}] 4/5 PUBLICATION BLOCKED — video-use dry-run active (VIDEO_USE_DRY_RUN=true)`);
    job.progress = 100;
    job.result = { videoId, blocked: true, reason: 'video_use_dry_run', readyAt: new Date().toISOString() };
    job.completedAt = new Date().toISOString();
    job.status = 'done';
    job.performance = perf.snapshot({ result: 'blocked_dry_run' });
    fs.writeFileSync(path.join(outputDir, 'pipeline-metrics.json'), JSON.stringify(job.performance, null, 2));
    moveJob(DIRS.active, DIRS.done, job);
    trimDoneFolder(50);
    logger.info(`[Job ${job.id}] Done! Video ${videoId} ready (dry-run, not published) | total=${formatDurationMs(job.performance.totalMs)}`);
    return job.result;
  }

  if (process.env.AUTO_PUBLISH_ENABLED === 'true') {
    // Modo diferido: el publish-scheduler.service.js publica a las horas configuradas
    logger.info(`[Job ${job.id}] 4/5 Render done — deferred publication (AUTO_PUBLISH_ENABLED=true)`);

    job.progress = 100;
    job.result = { videoId, deferred: true, readyAt: new Date().toISOString() };
    job.completedAt = new Date().toISOString();
    job.status = 'done';
    job.performance = perf.snapshot({ result: 'deferred' });
    fs.writeFileSync(path.join(outputDir, 'pipeline-metrics.json'), JSON.stringify(job.performance, null, 2));

    moveJob(DIRS.active, DIRS.done, job);
    trimDoneFolder(50);

    logger.info(`[Job ${job.id}] Done! Video ${videoId} ready at output/${videoId}/output.mp4 — awaiting scheduled publish | total=${formatDurationMs(job.performance.totalMs)}`);
  } else {
    // Modo inmediato: publicar ahora
    logger.info(`[Job ${job.id}] 4/5 Publishing...`);
    perf.start('publish');
    const { results, errors } = await publishAll(videoPath, script);
    const publishPhase = perf.end({ platforms: results.map((r) => r.platform), errors: errors.length });
    logger.info(`[Job ${job.id}] publish done in ${formatDurationMs(publishPhase.durationMs)}`);

    const publishedIds = {};
    for (const r of results) {
      if (r.platform === 'tiktok') publishedIds.tiktokId = r.publishId;
      if (r.platform === 'instagram') publishedIds.instagramId = r.mediaId;
      if (r.platform === 'youtube') publishedIds.youtubeId = r.videoId;
    }

    await saveVideo({
      id: videoId, title: script.title, topic: script.topic, hook: script.hook,
      viralityScore: script.viralityScore, themeId, script, tracking: script.slotTracking, ...publishedIds,
    });
    recordPublication({
      script,
      publishedVideoId: videoId,
      platformVideoId: publishedIds.youtubeId || publishedIds.tiktokId || publishedIds.instagramId || null,
      publishedAt: new Date().toISOString(),
      executionStatus: 'published'
    });

    job.progress = 100;
    job.result = { videoId, platforms: results.map((r) => r.platform), errors };
    job.completedAt = new Date().toISOString();
    job.status = 'done';
    job.performance = perf.snapshot({ result: 'published' });
    fs.writeFileSync(path.join(outputDir, 'pipeline-metrics.json'), JSON.stringify(job.performance, null, 2));

    moveJob(DIRS.active, DIRS.done, job);
    trimDoneFolder(50);

    logger.info(`[Job ${job.id}] Done! Published to: ${results.map((r) => r.platform).join(', ') || 'none'} | total=${formatDurationMs(job.performance.totalMs)}`);
    if (errors.length > 0) logger.warn(`[Job ${job.id}] Publish errors: ${JSON.stringify(errors)}`);

    await notifyVideoPublished({ script, results, errors, videoId });
    touchPipelineState({
      lastProgressAt: new Date().toISOString(),
      lastProgressType: 'video_published_immediate',
      lastPublishedVideoId: videoId,
      pipelineActive: false,
    });
  }

  if (job.result?.deferred) {
    touchPipelineState({
      lastProgressAt: new Date().toISOString(),
      lastProgressType: 'video_ready',
      lastReadyVideoId: videoId,
      pipelineActive: false,
    });
  }

  return job.result;
}

// ─────────────────────────────────────────────
//  PIPELINE FRUIT DRAMA
// ─────────────────────────────────────────────

async function processFruitDramaPipeline(job) {
  const videoId   = uuidv4();
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './output', videoId);
  const workDir   = path.join(outputDir, 'work');
  fs.mkdirSync(outputDir, { recursive: true });

  logger.info(`[Job ${job.id}] 🍓 FruitDrama pipeline: ${videoId}`);
  job.progress = 0;
  moveJob(DIRS.pending, DIRS.active, job);

  // 1. Guión dramático con Claude
  logger.info(`[Job ${job.id}] 1/3 Generating fruit drama script...`);
  const script = job.data.prefabScript || await generateFruitDrama({
    pairIndex:   job.data.pairIndex,
    themeId:     job.data.themeId,
    episode:     job.data.episode     || 1,
    seriesTitle: job.data.seriesTitle || undefined,
  });
  fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2));
  job.progress = 25;
  writeJob(DIRS.active, job);

  // 2. Render escena a escena (imágenes Pexels + Ken Burns + Edge TTS)
  logger.info(`[Job ${job.id}] 2/3 Rendering ${script.scenes.length} scenes...`);
  const videoPath = path.join(outputDir, 'output.mp4');
  await renderFruitDrama({ script, outputPath: videoPath, workDir });
  job.progress = 75;
  writeJob(DIRS.active, job);

  // 3. Publicar o diferir
  const publishScript = {
    hook:      script.hook,
    topic:     'relationships',
    hashtags:  ['#drama', '#fruta', '#pareja', '#celos', '#psicologia'],
    cta:       script.cliffhanger || '',
  };

  // Guardar script.json para que publish-scheduler lo pueda leer
  fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(publishScript, null, 2));

  if (process.env.AUTO_PUBLISH_ENABLED === 'true') {
    logger.info(`[Job ${job.id}] 3/3 Render done — deferred publication (AUTO_PUBLISH_ENABLED=true)`);

    job.progress  = 100;
    job.result    = { videoId, deferred: true, readyAt: new Date().toISOString() };
    job.completedAt = new Date().toISOString();
    moveJob(DIRS.active, DIRS.done, job);
    trimDoneFolder(50);

    logger.info(`[Job ${job.id}] 🍓 FruitDrama done! Video ${videoId} ready — awaiting scheduled publish`);
  } else {
    logger.info(`[Job ${job.id}] 3/3 Publishing...`);
    const { results, errors } = await publishAll(videoPath, publishScript);

    const publishedIds = {};
    for (const r of results) {
      if (r.platform === 'youtube') publishedIds.youtubeId = r.videoId;
    }

    await saveVideo({
      id: videoId, title: script.seriesTitle, topic: 'relationships',
      hook: script.hook, viralityScore: 0, themeId: 'fruit_drama', script: publishScript, tracking: publishScript.slotTracking, ...publishedIds,
    });
    recordPublication({
      script: publishScript,
      publishedVideoId: videoId,
      platformVideoId: publishedIds.youtubeId || null,
      publishedAt: new Date().toISOString(),
      executionStatus: 'published'
    });

    job.progress  = 100;
    job.result    = { videoId, platforms: results.map(r => r.platform), errors };
    job.completedAt = new Date().toISOString();
    moveJob(DIRS.active, DIRS.done, job);
    trimDoneFolder(50);

    logger.info(`[Job ${job.id}] 🍓 FruitDrama done! | ${script.scenes.length} scenes`);
    await notifyVideoPublished({ script: publishScript, results, errors, videoId });
  }

  return job.result;
}

// ─────────────────────────────────────────────
//  AÑADIR JOB A LA COLA
// ─────────────────────────────────────────────

async function addVideoToQueue(data = {}) {
  const prefabScript = data.prefabScript
    ? assignSlotToCandidate(data.prefabScript, { growthContext: data.growthContext, assignmentStatus: 'assigned' })
    : null;
  if (data.prefabScript && prefabScript) {
    Object.assign(data.prefabScript, prefabScript);
  }
  const job = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    progress: 0,
    performance: null,
    data: {
      ...data,
      topic: data.topic || null,
      hookId: data.hookId || null,
      themeIndex: themeRotationIndex++,
      slotTracking: prefabScript?.slotTracking || data.slotTracking || null,
      prefabScript,
    },
  };

  writeJob(DIRS.pending, job);
  touchPipelineState({
    lastProgressAt: new Date().toISOString(),
    lastProgressType: 'job_queued',
    lastJobId: job.id,
  });
  if (prefabScript?.slotTracking?.slotId) {
    markSlotAssignmentStatus(prefabScript.slotTracking.slotId, 'queued', {
      queueJobId: job.id,
      assignedCandidateId: prefabScript.id || null,
      assignedCandidateTitle: prefabScript.title || null,
      variantId: prefabScript.abVariantId || null,
      abExperimentId: prefabScript.abExperimentId || null,
      assignmentConfidence: prefabScript.slotTracking.assignmentConfidence || 0,
      traceConfidence: prefabScript.slotTracking.traceConfidence || 0
    });
  }
  logger.info(`Job queued: ${job.id}`);
  logger.info(`Queue state | concurrency=${QUEUE_CONCURRENCY} size=${queue.size} pending=${queue.pending}`);

  // Encola en p-queue
  queue.add(async () => {
    try {
      await processPipeline(job);
    } catch (err) {
      logger.error(`[Job ${job.id}] FAILED: ${err.message}`);
      job.error = err.message;
      job.failedAt = new Date().toISOString();
       job.status = 'failed';
      moveJob(DIRS.active, DIRS.failed, job);
      await notifyJobFailed({ jobId: job.id, error: err.message });
      touchPipelineState({
        pipelineActive: false,
        lastProgressAt: new Date().toISOString(),
        lastProgressType: 'job_failed',
        lastFailedJobId: job.id,
      });
      await notifyPipelineBlocked({ reason: 'pipeline_step_failed', detail: err.message });
    }
  });

  return job.id;
}

// ─────────────────────────────────────────────
//  RECUPERACIÓN AL ARRANCAR
// ─────────────────────────────────────────────

function recoverPendingJobs() {
  // Al reiniciar, limpiar active y pending para no saltarse el horario establecido.
  // El cron se encargará de publicar a las horas correctas.
  const activeFiles = fs.readdirSync(DIRS.active).filter((f) => f.endsWith('.json'));
  for (const file of activeFiles) {
    try {
      const job = JSON.parse(fs.readFileSync(path.join(DIRS.active, file), 'utf8'));
      job.status = 'pending';
      job.recoveredAt = new Date().toISOString();
      job.recoveredFrom = 'active';
      moveJob(DIRS.active, DIRS.pending, job);
    } catch {}
  }

  const pendingJobs = getPendingJobs();
  for (const job of pendingJobs) {
    queue.add(async () => {
      try {
        await processPipeline(job);
      } catch (err) {
        logger.error(`[Job ${job.id}] FAILED after recovery: ${err.message}`);
        job.error = err.message;
        job.failedAt = new Date().toISOString();
        job.status = 'failed';
        moveJob(DIRS.active, DIRS.failed, job);
        await notifyJobFailed({ jobId: job.id, error: err.message });
      }
    });
  }

  if (activeFiles.length + pendingJobs.length > 0) {
    logger.info(`Startup: recovered ${activeFiles.length} active + resumed ${pendingJobs.length} pending job(s)`);
  }
}

// ─────────────────────────────────────────────
//  ESTADO DE LA COLA
// ─────────────────────────────────────────────

function getQueueStatus() {
  return {
    waiting: fs.readdirSync(DIRS.pending).filter((f) => f.endsWith('.json')).length,
    active: fs.readdirSync(DIRS.active).filter((f) => f.endsWith('.json')).length,
    completed: fs.readdirSync(DIRS.done).filter((f) => f.endsWith('.json')).length,
    failed: fs.readdirSync(DIRS.failed).filter((f) => f.endsWith('.json')).length,
    queueSize: queue.size,
    queuePending: queue.pending,
    queueConcurrency: QUEUE_CONCURRENCY,
  };
}

// ─────────────────────────────────────────────
//  CRON JOBS DE PUBLICACIÓN (legacy)
//  Solo activo si AUTO_GENERATION_ENABLED != true.
//  Cuando el growth engine está activo, él gestiona la generación.
// ─────────────────────────────────────────────

if (process.env.AUTO_GENERATION_ENABLED !== 'true') {
  const publishTimes = (process.env.PUBLISH_TIMES_CET || '15:00,18:00,21:00').split(',');

  publishTimes.forEach((time) => {
    const [hour, minute] = time.split(':');
    const cronExpr = `${minute} ${hour} * * *`;

    logger.info(`Legacy cron scheduled: ${time} CET → ${cronExpr}`);

    cron.schedule(
      cronExpr,
      async () => {
        logger.info(`Legacy cron fired: ${time} CET — queuing video`);
        try {
          await addVideoToQueue({ topic: null });
        } catch (err) {
          logger.error(`Legacy cron failed (${time}): ${err.message}`);
        }
      },
      { timezone: 'Europe/Madrid' }
    );
  });
} else {
  logger.info('Legacy publish cron disabled — growth engine scheduler is active');
}

// Polling de analytics cada hora
cron.schedule('0 * * * *', async () => {
  logger.info('Cron: Analytics polling...');
  try {
    await pollAllMetrics();
  } catch (err) {
    logger.error(`Analytics cron failed: ${err.message}`);
  }
});

// Trend scraping cada 6 horas (Reddit tiene rate limit suave, no necesita más frecuencia)
cron.schedule('0 */6 * * *', async () => {
  logger.info('Cron: Trend scraping...');
  try {
    const { runTrendScraper } = require('../../../scripts/trend-scraper');
    await runTrendScraper();
    logger.info('Cron: Trend scraping done');
  } catch (err) {
    logger.error(`Trend scraping cron failed: ${err.message}`);
  }
});

// ─────────────────────────────────────────────
//  INVESTIGACIÓN VIRAL AUTOMÁTICA
// ─────────────────────────────────────────────

const INSIGHTS_PATH = path.resolve('./data/insights.json');
const RESEARCH_PATH = path.resolve('./data/viral-research.json');
const RESEARCH_MAX_AGE_DAYS = 7; // renovar insights cada semana

/**
 * Ejecuta la investigación completa en background (no bloquea la cola de vídeos).
 * 1. viral-research.js  → descarga stats de YouTube
 * 2. analyze-patterns.js → Claude analiza y actualiza el generador
 */
async function runViralResearch(reason) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'RELLENAR') {
    logger.warn(`Viral research skipped (${reason}): YOUTUBE_API_KEY no configurada`);
    return;
  }

  logger.info(`🔍 Iniciando investigación viral automática (${reason})...`);

  const { execFile } = require('child_process');
  // __dirname = backend/src/queue → ../../../scripts = Generador_videos/scripts
  const scriptsDir = path.resolve(__dirname, '../../../scripts');

  const runScript = (script) =>
    new Promise((resolve, reject) => {
      execFile('node', [path.join(scriptsDir, script)], { cwd: path.dirname(scriptsDir) }, (err, stdout, stderr) => {
        if (stdout) String(stdout).split('\n').filter(Boolean).forEach((l) => logger.info(`[research] ${l}`));
        if (err) return reject(new Error(String(stderr || err.message)));
        resolve();
      });
    });

  try {
    await runScript('viral-research.js');
    await runScript('analyze-patterns.js');
    logger.info('✅ Investigación viral completada — generador actualizado');
  } catch (err) {
    logger.error(`Viral research failed: ${err.message}`);
  }
}

/**
 * Comprueba si los insights están desactualizados y lanza investigación si hace falta.
 */
function checkAndRunResearchIfStale() {
  if (!fs.existsSync(INSIGHTS_PATH)) {
    // Primera vez — lanza en background con delay para no chocar con el arranque
    setTimeout(() => runViralResearch('first run'), 15000);
    return;
  }

  try {
    const insights = JSON.parse(fs.readFileSync(INSIGHTS_PATH, 'utf8'));
    const age = (Date.now() - new Date(insights.generatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (age >= RESEARCH_MAX_AGE_DAYS) {
      logger.info(`Insights tienen ${age.toFixed(1)} días — renovando en background...`);
      setTimeout(() => runViralResearch(`stale (${age.toFixed(1)}d)`), 15000);
    } else {
      logger.info(`Insights vigentes (${age.toFixed(1)} días) — sin investigación necesaria`);
    }
  } catch {
    setTimeout(() => runViralResearch('corrupt insights'), 15000);
  }
}

// Cron semanal: domingos a las 3:00 AM (hora Madrid)
cron.schedule('0 3 * * 0', () => {
  logger.info('Cron semanal: lanzando investigación viral...');
  runViralResearch('weekly cron');
}, { timezone: 'Europe/Madrid' });

// ─────────────────────────────────────────────
//  ARRANQUE
// ─────────────────────────────────────────────

recoverPendingJobs();
checkAndRunResearchIfStale();
logger.info(`Video processor ready | Queue dir: ${QUEUE_BASE} | concurrency=${QUEUE_CONCURRENCY}`);

module.exports = { addVideoToQueue, getQueueStatus, runViralResearch };
