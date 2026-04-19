/**
 * server.js
 * API REST + arranque del worker de colas (sin Redis, sin servidores externos).
 */

require('dotenv').config();

// Configura el binario de FFmpeg incluido en node_modules (sin instalación del sistema)
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const axios = require('axios');
const logger = require('./utils/logger');
const { initializeDatabase, getDashboardStats, getFullAnalytics } = require('./services/analytics-tracker');
const { addVideoToQueue, getQueueStatus } = require('./queue/video-processor');
const { generateScript, generateSeries } = require('./services/content-generator');
const { scoreScript } = require('./utils/virality-scorer');
const { scoreFormatMatch } = require('./services/format-match-engine');
const { getSpanishVoices } = require('./services/voice-synthesizer');
const { runGrowthCycle, getGrowthInsights, getNextVideoRecommendation, exploitWinner } = require('./services/growth-engine');
const { getABStats } = require('./services/ab-test-engine');
const { getDecisionHistory, detectWinningPatterns } = require('./services/decision-engine');
const { getLearningReport, rebuildMatrix } = require('./services/context-learner');
const { detectEarlyWinners } = require('./services/early-winner-detector');
const { getCacheStats, clearCache } = require('./services/script-cache');
const { getPatternsReport, minePatterns } = require('./services/pattern-miner');
const { getClassificationReport, getWinners, getFlops, classifyAllVideos } = require('./services/video-classifier');
const { startGenerationScheduler, runGenerationCycle, getSchedulerStatus } = require('./services/scheduler.service');
const { analyzeHookPerformance, getHookPerformanceAnalysis, getTopHooks, getHookInsights } = require('./services/hook-performance-analyzer');
const { startPublishScheduler, runPublishCycle, getPublishSchedulerStatus, getReadyToPublishVideos } = require('./services/publish-scheduler.service');
const hooksData = require('./templates/psychology-hooks.json');
const themesData = require('./templates/visual-themes.json');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
//  MIDDLEWARES
// ─────────────────────────────────────────────

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://psychology-shorts.vercel.app']
    : ['http://localhost:5173', 'http://localhost:3001'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────
//  RUTAS
// ─────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), free: true });
});

// ─────────────────────────────────────────────
//  YOUTUBE OAUTH — renovar refresh token
// ─────────────────────────────────────────────

const YOUTUBE_REDIRECT_URI = `http://localhost:${process.env.PORT || 3001}/auth/youtube/callback`;

app.get('/auth/youtube', (_req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.YOUTUBE_CLIENT_ID,
    redirect_uri:  YOUTUBE_REDIRECT_URI,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/youtube.upload',
    access_type:   'offline',
    prompt:        'consent',   // fuerza nuevo refresh_token aunque ya haya uno
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/youtube/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`<h2>Error OAuth: ${error}</h2>`);
  }
  if (!code) {
    return res.status(400).send('<h2>No se recibió code de autorización</h2>');
  }

  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id:     process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      redirect_uri:  YOUTUBE_REDIRECT_URI,
      grant_type:    'authorization_code',
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { refresh_token, access_token } = tokenRes.data;

    if (!refresh_token) {
      return res.status(500).send('<h2>Google no devolvió refresh_token. Revoca el acceso en myaccount.google.com/permissions e inténtalo de nuevo.</h2>');
    }

    // Actualizar YOUTUBE_REFRESH_TOKEN en .env
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('YOUTUBE_REFRESH_TOKEN=')) {
        envContent = envContent.replace(
          /^YOUTUBE_REFRESH_TOKEN=.*/m,
          `YOUTUBE_REFRESH_TOKEN=${refresh_token}`,
        );
      } else {
        envContent += `\nYOUTUBE_REFRESH_TOKEN=${refresh_token}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
      logger.info('YouTube OAuth: refresh_token actualizado en .env');
    }

    // Actualizar en memoria sin reiniciar
    process.env.YOUTUBE_REFRESH_TOKEN = refresh_token;

    res.send(`
      <html><body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center">
        <h2>✅ YouTube autorizado correctamente</h2>
        <p>Refresh token actualizado en <code>.env</code> y activo en memoria.</p>
        <p><strong>No necesitas reiniciar PM2.</strong></p>
        <p style="color:#888;font-size:12px">Token: ${refresh_token.slice(0, 20)}...</p>
        <a href="/" style="display:inline-block;margin-top:20px;padding:10px 24px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Volver al dashboard</a>
      </body></html>
    `);
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error(`YouTube OAuth callback error: ${JSON.stringify(detail)}`);
    res.status(500).send(`<h2>Error al canjear código</h2><pre>${JSON.stringify(detail, null, 2)}</pre>`);
  }
});

app.get('/api/analytics', (_req, res) => {
  try {
    res.json({ ok: true, data: getFullAnalytics() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/stats', async (_req, res) => {
  try {
    const stats = getDashboardStats();
    res.json({ ok: true, data: stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/queue', (_req, res) => {
  try {
    res.json({ ok: true, data: getQueueStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Preview de guión (solo Claude, sin renderizar)
app.post('/api/scripts/preview', async (req, res) => {
  try {
    const { topic, hookId } = req.body;
    const script = await generateScript({ topic, hookId, forceHighScore: false });
    res.json({ ok: true, data: script });
  } catch (err) {
    logger.error(`Script preview error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Generar y encolar un video
app.post('/api/videos/generate', async (req, res) => {
  try {
    const { topic, hookId } = req.body;
    const jobId = await addVideoToQueue({ topic, hookId });
    res.json({ ok: true, data: { jobId, message: 'Video added to queue' } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Generar serie de N partes conectadas
app.post('/api/videos/series', async (req, res) => {
  try {
    const { topic, parts = 3, bgStyle } = req.body;
    const count = Math.min(Math.max(parseInt(parts), 2), 5);

    // Genera todos los guiones de la serie en una sola llamada
    const scripts = await generateSeries({ topic, parts: count });

    // Encola cada parte como un job independiente
    const jobIds = [];
    for (const script of scripts) {
      const jobId = await addVideoToQueue({ topic: script.topic, prefabScript: script, bgStyle });
      jobIds.push(jobId);
    }

    res.json({
      ok: true,
      data: {
        seriesTitle: scripts[0]?.seriesTitle,
        parts: count,
        jobIds,
        message: `Serie de ${count} partes encolada`,
      },
    });
  } catch (err) {
    logger.error(`Series generation error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Generar lote de N videos
app.post('/api/videos/batch', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body.count || 3), 10);
    const jobIds = [];
    for (let i = 0; i < count; i++) {
      jobIds.push(await addVideoToQueue({}));
    }
    res.json({ ok: true, data: { jobIds, message: `${count} videos queued` } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Score de viralidad para guión custom
app.post('/api/score', (req, res) => {
  try {
    const { script } = req.body;
    if (!script) return res.status(400).json({ ok: false, error: 'script is required' });
    const virality = scoreScript(script);
    const format   = scoreFormatMatch(script);
    res.json({ ok: true, data: { virality, format } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
//  GROWTH ENGINE — MÁQUINA AUTÓNOMA
// ─────────────────────────────────────────────

// Estado completo del sistema de crecimiento
app.get('/api/growth/insights', (_req, res) => {
  try {
    res.json({ ok: true, data: getGrowthInsights() });
  } catch (err) {
    logger.error(`Growth insights error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Próximo vídeo recomendado por el decision engine
app.get('/api/growth/next-video', (_req, res) => {
  try {
    res.json({ ok: true, data: getNextVideoRecommendation() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Historial de decisiones del decision engine
app.get('/api/growth/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20');
    res.json({ ok: true, data: getDecisionHistory(limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Patrones ganadores detectados
app.get('/api/growth/patterns', (_req, res) => {
  try {
    res.json({ ok: true, data: detectWinningPatterns() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Disparar manualmente un ciclo completo de growth
app.post('/api/growth/run', async (req, res) => {
  try {
    const { force = false } = req.body;
    logger.info(`Manual growth cycle triggered (force=${force})`);
    // No await — responde inmediatamente, el ciclo corre en background
    runGrowthCycle({ forceGenerate: Boolean(force), maxRetries: 2 }).catch((err) =>
      logger.error(`Manual growth cycle error: ${err.message}`),
    );
    res.json({ ok: true, message: 'Growth cycle iniciado en background (~60-90s)' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Explotación de winners — genera 2 variantes basadas en el winner indicado
app.post('/api/growth/exploit-winner', async (req, res) => {
  try {
    const { videoId, hook, topic, hookType, viralityScore, formatMatchScore } = req.body;
    if (!topic || !hook) return res.status(400).json({ ok: false, error: 'topic y hook son requeridos' });
    exploitWinner({ videoId, hook, topic, hookType, viralityScore, formatMatchScore })
      .catch(err => logger.error(`exploit-winner API error: ${err.message}`));
    res.json({ ok: true, message: 'Explotación de winner iniciada en background' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// A/B test stats
app.get('/api/ab/stats', (_req, res) => {
  try {
    res.json({ ok: true, data: getABStats() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Trends actuales
app.get('/api/trends', (_req, res) => {
  try {
    const trendsPath = require('path').resolve('./data/trends.json');
    if (!require('fs').existsSync(trendsPath)) {
      return res.json({ ok: true, data: null, message: 'Sin datos. Ejecuta: npm run trends' });
    }
    const trends = JSON.parse(require('fs').readFileSync(trendsPath, 'utf8'));
    res.json({ ok: true, data: trends });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
//  OBSERVABILIDAD — LEARNING / CACHE / HEALTH
// ─────────────────────────────────────────────

// Informe del aprendizaje contextual (topic × hookType)
app.get('/api/learning/context', (_req, res) => {
  try {
    res.json({ ok: true, data: getLearningReport() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Forzar reconstrucción de la matriz de aprendizaje
app.post('/api/learning/rebuild', (_req, res) => {
  try {
    const matrix = rebuildMatrix();
    res.json({ ok: true, data: { topics: Object.keys(matrix.matrix || {}).length, topPerformers: matrix.topPerformers?.length || 0 } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Experimentos A/B activos (sin evaluar)
app.get('/api/experiments/active', (_req, res) => {
  try {
    const experimentsPath = require('path').resolve('./data/ab-experiments.json');
    const all = require('fs').existsSync(experimentsPath)
      ? JSON.parse(require('fs').readFileSync(experimentsPath, 'utf8'))
      : [];
    const active = all.filter(e => !e.winner).slice(0, 50);
    res.json({ ok: true, data: { count: active.length, experiments: active } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Detección manual de ganadores tempranos
app.post('/api/experiments/detect-winners', (_req, res) => {
  try {
    const result = detectEarlyWinners();
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Estado de la caché de guiones
app.get('/api/cache/stats', (_req, res) => {
  try {
    res.json({ ok: true, data: getCacheStats() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Vaciar la caché de guiones
app.post('/api/cache/clear', (_req, res) => {
  try {
    clearCache();
    res.json({ ok: true, message: 'Script cache cleared' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Patrones de hooks (pattern-miner) ────────────────────────────────────────
app.get('/api/patterns', (_req, res) => {
  try {
    res.json({ ok: true, data: getPatternsReport() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/patterns/mine', (_req, res) => {
  try {
    const patterns = minePatterns();
    res.json({ ok: true, data: { patterns: patterns.length, top: patterns.slice(0, 3).map(p => ({ id: p.patternId, avgViews: p.avgViews, count: p.count })) } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Clasificación de vídeos ───────────────────────────────────────────────────
app.get('/api/videos/classification', (_req, res) => {
  try {
    res.json({ ok: true, data: getClassificationReport() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/videos/winners', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20');
    res.json({ ok: true, data: getWinners(limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/videos/flops', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20');
    res.json({ ok: true, data: getFlops(limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/videos/classify', (_req, res) => {
  try {
    const result = classifyAllVideos();
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── A/B Experiments v2 ────────────────────────────────────────────────────────
app.get('/api/ab/experiments', (req, res) => {
  try {
    const status = req.query.status; // running | decided
    const EXPERIMENTS_V2 = require('path').resolve('./data/ab-experiments-v2.json');
    let experiments = require('fs').existsSync(EXPERIMENTS_V2)
      ? JSON.parse(require('fs').readFileSync(EXPERIMENTS_V2, 'utf8'))
      : [];
    if (status) experiments = experiments.filter(e => e.status === status);
    res.json({ ok: true, data: { count: experiments.length, experiments: experiments.slice(0, 50) } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Dashboard consolidado ─────────────────────────────────────────────────────
app.get('/api/dashboard', (_req, res) => {
  try {
    const queueStatus  = getQueueStatus();
    const abStats      = getABStats();
    const patterns     = getPatternsReport();
    const classif      = getClassificationReport();
    const learning     = getLearningReport();
    const cacheStats   = getCacheStats();
    const publisherStatus = getPublishSchedulerStatus();

    const trendsPath = require('path').resolve('./data/trends.json');
    let trendsData = null;
    if (require('fs').existsSync(trendsPath)) {
      try { trendsData = JSON.parse(require('fs').readFileSync(trendsPath, 'utf8')); } catch {}
    }

    res.json({
      ok: true,
      data: {
        system: {
          uptime:   Math.round(process.uptime()),
          memory:   Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          queue:    queueStatus,
          phase:    process.env.GROWTH_PHASE || 'initial',
        },
        ab: {
          total:       abStats.total,
          running:     abStats.running,
          decided:     abStats.decided,
          typeWeights: abStats.typeWeights,
          winnerTypes: abStats.winnerTypes,
          topHooks:    abStats.topHooks?.slice(0, 5),
          recent:      abStats.recentExperiments?.slice(0, 3),
        },
        patterns: {
          status:  patterns.status,
          total:   patterns.patterns?.length || 0,
          topThree:patterns.patterns?.slice(0, 3).map(p => ({ id: p.patternId, avgViews: p.avgViews, count: p.count, winRate: p.winRate })),
        },
        videos: {
          winners:   classif.winners,
          medios:    classif.medios,
          flops:     classif.flops,
          total:     classif.total,
          topTopics: classif.topWinnerTopics?.slice(0, 3),
        },
        learning: {
          status:        learning.status,
          topicsLearned: learning.topicsLearned,
          topPerformers: learning.topPerformers?.slice(0, 3),
        },
        trends: {
          ageHours:  trendsData ? Math.round((Date.now() - new Date(trendsData.generatedAt).getTime()) / 3600000) : null,
          trending:  trendsData?.trending?.slice(0, 5).map(t => t.topic),
          stale:     !trendsData || (Date.now() - new Date(trendsData.generatedAt).getTime()) > 12 * 3600000,
        },
        publish: {
          readyToPublish: publisherStatus.readyToPublish,
          todayCount:     publisherStatus.todayState?.count || 0,
          maxPerDay:      publisherStatus.maxPerDay,
          nextSlots:      publisherStatus.publishTimes,
        },
        cache:  { size: cacheStats.size, maxSize: cacheStats.maxSize },
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Health check detallado del sistema
app.get('/api/system/health', (_req, res) => {
  try {
    const queueStatus   = getQueueStatus();
    const abStats       = getABStats();
    const cacheStats    = getCacheStats();
    const learning      = getLearningReport();

    const trendsPath = require('path').resolve('./data/trends.json');
    let trendsAge = null;
    if (require('fs').existsSync(trendsPath)) {
      try {
        const t = JSON.parse(require('fs').readFileSync(trendsPath, 'utf8'));
        trendsAge = Math.round((Date.now() - new Date(t.generatedAt).getTime()) / 3600000);
      } catch {}
    }

    res.json({
      ok: true,
      data: {
        status:   'running',
        uptime:   Math.round(process.uptime()),
        memory:   Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        queue:    queueStatus,
        ab:       { total: abStats.total, running: abStats.running, decided: abStats.decided, typeWeights: abStats.typeWeights },
        cache:    { size: cacheStats.size, maxSize: cacheStats.maxSize },
        learning: { topicsLearned: learning.topicsLearned, status: learning.status },
        trends:   { ageHours: trendsAge, stale: trendsAge === null || trendsAge > 12 },
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
//  SCHEDULERS — ESTADO Y CONTROL
// ─────────────────────────────────────────────

// Estado de ambos schedulers
app.get('/api/scheduler/status', (_req, res) => {
  try {
    res.json({
      ok: true,
      data: {
        generation: getSchedulerStatus(),
        publish:    getPublishSchedulerStatus(),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Disparar manualmente el ciclo de generación
app.post('/api/scheduler/run-generation', async (_req, res) => {
  try {
    runGenerationCycle().catch((err) => logger.error(`Manual gen cycle: ${err.message}`));
    res.json({ ok: true, message: 'Ciclo de generación iniciado en background' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
//  PUBLISH SCHEDULER — ESTADO Y CONTROL
// ─────────────────────────────────────────────

// Estado del publish scheduler
app.get('/api/publish/status', (_req, res) => {
  try {
    res.json({ ok: true, data: getPublishSchedulerStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Vídeos listos para publicar (output.mp4 + script.json, sin published.json)
app.get('/api/publish/ready', (_req, res) => {
  try {
    const videos = getReadyToPublishVideos().map((v) => ({
      videoId:         v.videoId,
      topic:           v.script?.topic,
      hook:            v.script?.hook,
      viralityScore:   v.script?.viralityScore,
      formatMatchScore:v.script?.formatMatchScore,
      durationSeconds: v.script?.durationSeconds,
      createdAt:       v.createdAt,
    }));
    res.json({ ok: true, data: videos });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Disparar manualmente el ciclo de publicación
// ?force=true salta los filtros de calidad (uso manual)
app.post('/api/publish/run', async (req, res) => {
  try {
    const force = req.body?.force === true || req.query.force === 'true';
    runPublishCycle({ force }).catch((err) => logger.error(`Manual publish cycle: ${err.message}`));
    res.json({ ok: true, message: 'Ciclo de publicación iniciado en background', force });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Templates y configuración
app.get('/api/hooks', (_req, res) => res.json({ ok: true, data: hooksData }));
app.get('/api/themes', (_req, res) => res.json({ ok: true, data: themesData }));
app.get('/api/voices', (_req, res) => res.json({ ok: true, data: getSpanishVoices() }));

// Subir video local a YouTube manualmente
app.post('/api/videos/upload-youtube', async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) return res.status(400).json({ ok: false, error: 'videoId is required' });

    const outputDir = path.resolve(process.env.OUTPUT_DIR || './output');
    const videoPath = path.join(outputDir, videoId, 'output.mp4');
    const scriptPath = path.join(outputDir, videoId, 'script.json');

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ ok: false, error: 'Video not found' });
    }

    const script = fs.existsSync(scriptPath)
      ? JSON.parse(fs.readFileSync(scriptPath, 'utf8'))
      : { hook: videoId, topic: 'psychology', hashtags: [] };

    const { publishToYouTube } = require('./services/publisher');
    const result = await publishToYouTube(videoPath, script);

    res.json({ ok: true, data: result });
  } catch (err) {
    logger.error(`YouTube upload error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Stream de un vídeo concreto (para el player del dashboard)
app.get('/api/videos/:videoId/stream', (req, res) => {
  const videoId = path.basename(req.params.videoId); // evita path traversal
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './output');
  const videoPath = path.join(outputDir, videoId, 'output.mp4');

  if (!fs.existsSync(videoPath)) return res.status(404).json({ ok: false, error: 'Not found' });

  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Soporte para range requests (necesario para que el <video> pueda hacer seek)
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunkSize,
      'Content-Type':   'video/mp4',
    });
    fs.createReadStream(videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   'video/mp4',
      'Accept-Ranges':  'bytes',
    });
    fs.createReadStream(videoPath).pipe(res);
  }
});

// Lista de videos en output/
app.get('/api/videos/local', (_req, res) => {
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './output');
  if (!fs.existsSync(outputDir)) return res.json({ ok: true, data: [] });

  const videos = fs.readdirSync(outputDir)
    .filter((d) => fs.existsSync(path.join(outputDir, d, 'output.mp4')))
    .map((d) => {
      const scriptPath = path.join(outputDir, d, 'script.json');
      const script = fs.existsSync(scriptPath)
        ? JSON.parse(fs.readFileSync(scriptPath, 'utf8'))
        : null;
      return { id: d, script, videoPath: path.join(outputDir, d, 'output.mp4') };
    })
    .reverse();

  res.json({ ok: true, data: videos });
});

// Generar episodio de Fruit Drama
app.post('/api/videos/fruit-drama', async (req, res) => {
  try {
    const { pairIndex, themeId, episode, seriesTitle } = req.body;
    const jobId = await addVideoToQueue({
      isFruitDrama: true,
      pairIndex:    pairIndex    !== undefined ? parseInt(pairIndex) : undefined,
      themeId:      themeId      || undefined,
      episode:      episode      || 1,
      seriesTitle:  seriesTitle  || undefined,
    });
    res.json({ ok: true, data: { jobId, message: 'Fruit Drama en cola (~3 min)' } });
  } catch (err) {
    logger.error(`Fruit drama error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Metadatos disponibles para el selector de Fruit Drama
app.get('/api/videos/fruit-drama/options', (_req, res) => {
  const { FRUIT_PAIRS, DRAMA_THEMES } = require('./services/fruit-drama-generator');
  res.json({ ok: true, data: { pairs: FRUIT_PAIRS.map((p, i) => ({ index: i, a: p.a.name, b: p.b.name })), themes: DRAMA_THEMES } });
});

// Sincronizar vídeos existentes del canal de YouTube → videos.json
app.post('/api/youtube/sync', async (_req, res) => {
  try {
    const { saveVideo } = require('./services/analytics-tracker');

    // 1. Obtener access token
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      client_id:     process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    });
    const accessToken = tokenRes.data.access_token;

    // 2. Obtener ID del canal y playlist de subidas
    const chRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'contentDetails', mine: true },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const uploadsPlaylistId = chRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return res.status(400).json({ ok: false, error: 'No se encontró el canal de YouTube' });

    // 3. Listar vídeos del canal (máx 50)
    const plRes = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
      params: { part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: 50 },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const items = plRes.data.items || [];
    if (!items.length) return res.json({ ok: true, data: { imported: 0, message: 'El canal no tiene vídeos' } });

    // 4. Obtener estadísticas de todos los vídeos de una vez
    const videoIds = items.map(i => i.contentDetails.videoId).join(',');
    const statsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { part: 'statistics', id: videoIds },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const statsMap = {};
    for (const v of statsRes.data.items || []) statsMap[v.id] = v.statistics;

    // 5. Importar a videos.json los que no existan ya
    const { getFullAnalytics } = require('./services/analytics-tracker');
    const existingIds = new Set((getFullAnalytics().allVideos || []).map(v => v.youtube_id).filter(Boolean));

    let imported = 0;
    for (const item of items) {
      const ytId = item.contentDetails.videoId;
      if (existingIds.has(ytId)) continue;

      const snippet = item.snippet;
      const stats   = statsMap[ytId] || {};
      const views   = parseInt(stats.viewCount || 0);
      const likes   = parseInt(stats.likeCount || 0);
      const comments= parseInt(stats.commentCount || 0);

      saveVideo({
        id:            `yt_${ytId}`,
        title:         snippet.title,
        topic:         'psychology',
        hook:          snippet.title,
        viralityScore: 0,
        youtubeId:     ytId,
        script: {
          hook:            snippet.title,
          psychologicalFact: snippet.description?.slice(0, 200) || '',
        },
      });

      // Guardar la métrica inicial también
      const { insertMetric } = require('./services/analytics-tracker');
      if (views > 0) {
        const er = views > 0 ? ((likes + comments) / views) * 100 : 0;
        insertMetric({ videoId: `yt_${ytId}`, platform: 'youtube', views, likes, comments, shares: 0, engagementRate: er });
      }

      imported++;
    }

    res.json({ ok: true, data: { imported, total: items.length, message: `${imported} vídeo${imported !== 1 ? 's' : ''} importado${imported !== 1 ? 's' : ''}` } });
  } catch (err) {
    logger.error(`YouTube sync error: ${err.response?.data?.error?.message || err.message}`);
    res.status(500).json({ ok: false, error: err.response?.data?.error?.message || err.message });
  }
});

// ─────────────────────────────────────────────
//  HOOK PERFORMANCE ANALYZER (Parts 7-9)
// ─────────────────────────────────────────────

// Análisis completo de rendimiento de hooks
app.get('/api/hooks/analysis', (_req, res) => {
  try {
    const data = getHookPerformanceAnalysis();
    if (!data) return res.json({ ok: true, data: null, message: 'Sin análisis todavía. Espera al próximo ciclo de métricas o POST /api/hooks/analyze' });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Top 20% hooks por combinación views + earlyScore + engagement
app.get('/api/hooks/top', (_req, res) => {
  try {
    const data = getTopHooks();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Insights generados (best hookType, rising/falling, v2 vs v1...)
app.get('/api/hooks/insights', (_req, res) => {
  try {
    res.json({ ok: true, data: getHookInsights() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Forzar análisis inmediato
app.post('/api/hooks/analyze', (_req, res) => {
  try {
    const result = analyzeHookPerformance();
    if (!result) return res.json({ ok: true, message: 'Sin vídeos suficientes para analizar' });
    res.json({ ok: true, data: { hookTypes: result.hookTypeStats.length, topics: result.topicStats.length, insights: result.insights.length } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Quality Gate endpoints ──────────────────────────────────────────────────

// Lee los últimos resultados de QC de los vídeos más recientes
app.get('/api/quality/latest', (_req, res) => {
  try {
    const outputBase = path.resolve(process.env.OUTPUT_DIR || './output');
    if (!fs.existsSync(outputBase)) return res.json({ ok: true, data: [] });

    const dirs = fs.readdirSync(outputBase)
      .map(d => ({ name: d, mtime: fs.statSync(path.join(outputBase, d)).mtime }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10)
      .map(d => d.name);

    const results = [];
    for (const dir of dirs) {
      const qcPath = path.join(outputBase, dir, 'qc.json');
      if (fs.existsSync(qcPath)) {
        try {
          const qc = JSON.parse(fs.readFileSync(qcPath, 'utf8'));
          results.push({ videoId: dir, ...qc });
        } catch {}
      }
    }
    res.json({ ok: true, data: results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Corre QC manual sobre un vídeo específico
app.post('/api/quality/check/:videoId', async (req, res) => {
  try {
    const { checkProductionQuality, saveQCResult } = require('./services/production-quality-checker');
    const outputDir = path.resolve(process.env.OUTPUT_DIR || './output', req.params.videoId);
    if (!fs.existsSync(outputDir)) return res.status(404).json({ ok: false, error: 'Video not found' });
    const result = await checkProductionQuality(outputDir);
    saveQCResult(outputDir, result);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Lista templates visuales disponibles
app.get('/api/templates', (_req, res) => {
  try {
    const themes = require('./templates/visual-themes.json');
    res.json({ ok: true, data: { themes: themes.themes, rotation: themes.rotation } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Debug: qué queries de Pexels se generarían para un script dado
app.post('/api/assets/debug', (req, res) => {
  try {
    const { renderVideo: _rv, ...renderer } = require('./services/video-renderer');
    // buildPexelsQueries no se exporta directamente — re-construir aquí de forma simplificada
    const script = req.body || {};
    const hook   = script.hook   || '';
    const topic  = script.topic  || '';
    const effect = (script.effectName || script.psychologicalFact || '').toLowerCase();
    const eTrig  = script.emotionalTrigger || '';
    res.json({ ok: true, debug: { hook, topic, effect, emotionalTrigger: eTrig, note: 'See video-renderer.js buildPexelsQueries for full logic' } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Fuerza una nueva investigación viral en background
app.post('/api/research/run', (_req, res) => {
  const { runViralResearch } = require('./queue/video-processor');
  runViralResearch('manual trigger').catch(() => {});
  res.json({ ok: true, message: 'Investigación iniciada en background (~2 min)' });
});

// Devuelve los últimos insights generados
app.get('/api/research/insights', (_req, res) => {
  const insightsPath = path.resolve('./data/insights.json');
  if (!fs.existsSync(insightsPath)) {
    return res.json({ ok: true, data: null, message: 'Sin insights todavía. Ejecuta node scripts/viral-research.js' });
  }
  try {
    const insights = JSON.parse(fs.readFileSync(insightsPath, 'utf8'));
    res.json({ ok: true, data: insights });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
//  LIMPIEZA — elimina jobs fallidos y renders incompletos
// ─────────────────────────────────────────────

app.post('/api/admin/cleanup', (_req, res) => {
  try {
    const QUEUE_BASE = path.resolve(process.env.QUEUE_DIR || './queue');
    const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

    // 1. Vacía queue/failed/
    let failedRemoved = 0;
    const failedDir = path.join(QUEUE_BASE, 'failed');
    if (fs.existsSync(failedDir)) {
      for (const f of fs.readdirSync(failedDir).filter(f => f.endsWith('.json'))) {
        try { fs.unlinkSync(path.join(failedDir, f)); failedRemoved++; } catch {}
      }
    }

    // 2. Elimina directorios output/ sin output.mp4 (renders incompletos)
    let incompleteRemoved = 0;
    if (fs.existsSync(OUTPUT_DIR)) {
      for (const d of fs.readdirSync(OUTPUT_DIR)) {
        const dir = path.join(OUTPUT_DIR, d);
        if (!fs.statSync(dir).isDirectory()) continue;
        if (!fs.existsSync(path.join(dir, 'output.mp4'))) {
          try { fs.rmSync(dir, { recursive: true }); incompleteRemoved++; } catch {}
        }
      }
    }

    logger.info(`Cleanup: ${failedRemoved} failed jobs, ${incompleteRemoved} incomplete renders removed`);
    res.json({ ok: true, data: { failedRemoved, incompleteRemoved } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
//  DASHBOARD OPERATIVO — endpoint agregado
// ─────────────────────────────────────────────

app.get('/api/dashboard/operations', (_req, res) => {
  try {
    const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
    const QUEUE_BASE = path.resolve(process.env.QUEUE_DIR  || './queue');
    const DATA_DIR   = path.resolve('./data');

    const readJSON = (file, def) => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
    };

    // ── Publish scheduler ──
    const publishStatus = getPublishSchedulerStatus();
    const publishTimes  = publishStatus.publishTimes || [];
    const todayState    = publishStatus.todayState   || { count: 0 };
    const maxPerDay     = publishStatus.maxPerDay    || 4;

    // ── Next publish slot (hora de Madrid) ──
    const nowMadrid   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const currentMins = nowMadrid.getHours() * 60 + nowMadrid.getMinutes();
    const timesAsMins = publishTimes
      .map(t => { const [h, m] = t.split(':').map(Number); return { label: t, mins: h * 60 + m }; })
      .sort((a, b) => a.mins - b.mins);

    let nextPublishTime = null, nextPublishIn = null, nextPublishMins = null;
    const nextSlot = timesAsMins.find(t => t.mins > currentMins);
    if (nextSlot) {
      const diff = nextSlot.mins - currentMins;
      nextPublishTime = nextSlot.label;
      nextPublishIn   = diff >= 60 ? `${Math.floor(diff / 60)}h ${diff % 60}m` : `${diff}m`;
      nextPublishMins = diff;
    } else if (timesAsMins.length > 0) {
      const first = timesAsMins[0];
      const diff  = (24 * 60 - currentMins) + first.mins;
      nextPublishTime = first.label + ' (mañana)';
      nextPublishIn   = `${Math.floor(diff / 60)}h ${diff % 60}m`;
      nextPublishMins = diff;
    }

    // ── Queue status ──
    getQueueStatus(); // warm up

    // ── Pipeline: pending jobs ──
    const pendingJobs = [];
    const pendingDir = path.join(QUEUE_BASE, 'pending');
    if (fs.existsSync(pendingDir)) {
      for (const f of fs.readdirSync(pendingDir).filter(f => f.endsWith('.json'))) {
        try {
          const job = readJSON(path.join(pendingDir, f), null);
          if (job) pendingJobs.push({
            jobId:            job.id,
            topic:            job.data?.topic || '—',
            hook:             job.data?.prefabScript?.hook,
            viralityScore:    job.data?.prefabScript?.viralityScore,
            formatMatchScore: job.data?.prefabScript?.formatMatchScore,
            createdAt:        job.createdAt,
          });
        } catch {}
      }
      pendingJobs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }

    // ── Pipeline: active render ──
    let rendering = null;
    const activeDir = path.join(QUEUE_BASE, 'active');
    if (fs.existsSync(activeDir)) {
      const af = fs.readdirSync(activeDir).filter(f => f.endsWith('.json'));
      if (af.length > 0) {
        try {
          const job = readJSON(path.join(activeDir, af[0]), null);
          if (job) rendering = {
            jobId:    job.id,
            topic:    job.data?.topic || '—',
            hook:     job.data?.prefabScript?.hook,
            progress: job.progress || 0,
            startedAt:job.startedAt || job.createdAt,
          };
        } catch {}
      }
    }

    // ── Pipeline: rendered (output/ con mp4, sin published.json) ──
    const readyVideos = getReadyToPublishVideos();
    const rendered = readyVideos.map(v => ({
      videoId:             v.videoId,
      topic:               v.script?.topic,
      hook:                v.script?.hook,
      viralityScore:       v.script?.viralityScore,
      formatMatchScore:    v.script?.formatMatchScore,
      emotionalImpactScore:v.script?.emotionalImpactScore,
      priorityScore:       v.priority,
      createdAt:           v.createdAt,
    }));

    // ── Pipeline: publicados hoy ──
    const todayStr    = new Date().toISOString().split('T')[0];
    const publishLog  = readJSON(path.join(DATA_DIR, 'publish-log.json'), []);
    const publishedToday = publishLog
      .filter(p => p.publishedAt?.startsWith(todayStr))
      .slice(0, 10)
      .map(p => ({
        videoId:          p.videoId,
        topic:            p.topic,
        hook:             p.hook,
        publishedAt:      p.publishedAt,
        platforms:        p.platforms,
        priorityScore:    p.priorityScore,
        viralityScore:    p.viralityScore,
        formatMatchScore: p.formatMatchScore,
      }));

    // ── Pipeline: failed ──
    const failedJobs = [];
    const failedDir = path.join(QUEUE_BASE, 'failed');
    if (fs.existsSync(failedDir)) {
      for (const f of fs.readdirSync(failedDir).filter(f => f.endsWith('.json')).slice(0, 5)) {
        try {
          const job = readJSON(path.join(failedDir, f), null);
          if (job) failedJobs.push({ jobId: job.id, topic: job.data?.topic || '—', error: job.error, failedAt: job.failedAt });
        } catch {}
      }
    }

    // ── Quality metrics (últimos 20 ciclos del growth log) ──
    const growthLog    = readJSON(path.join(DATA_DIR, 'growth-log.json'), []);
    const recentCycles = growthLog.slice(0, 20);
    const avg = (arr, key) => arr.length
      ? Math.round(arr.reduce((s, c) => s + (c[key] || 0), 0) / arr.length) : 0;
    const avgVirality  = avg(recentCycles, 'viralityScore');
    const avgFormat    = avg(recentCycles, 'formatMatchScore');
    const avgEmotion   = avg(recentCycles, 'emotionalImpact');

    // Tasa de rechazo
    const rejectedLog   = readJSON(path.join(DATA_DIR, 'rejected-scripts.json'), []);
    const schedulerLog  = readJSON(path.join(DATA_DIR, 'scheduler-generation-log.json'), []);
    const totalAttempts = Math.max(schedulerLog.length, 1);
    const rejectionRate = Math.min(100, Math.round((rejectedLog.length / totalAttempts) * 100));

    // ── Rechazados recientes ──
    const recentRejections = rejectedLog.slice(0, 8).map(r => ({
      rejectedAt:       r.rejectedAt,
      topic:            r.topic,
      hook:             r.hook,
      viralityScore:    r.viralityScore,
      formatMatchScore: r.formatMatchScore,
      reason:           r.reason,
    }));

    // ── Próxima decisión (sin guardar en historial) ──
    const { makeDecision } = require('./services/decision-engine');
    const nextDecision = makeDecision();

    // ── Upcoming: asignar slots de publicación a los mejores candidatos ──
    const futureSlots = [
      ...timesAsMins.filter(t => t.mins > currentMins),
      ...timesAsMins.map(t => ({ ...t, tomorrow: true })),
    ];
    const upcoming = rendered.slice(0, maxPerDay).map((v, i) => ({
      ...v,
      scheduledSlot:     futureSlots[i]?.label || '—',
      scheduledTomorrow: !!(futureSlots[i]?.tomorrow),
    }));

    res.json({
      ok: true,
      data: {
        timestamp: new Date().toISOString(),
        overview: {
          nextPublishTime,
          nextPublishIn,
          nextPublishMins,
          publishedToday:    todayState.count || 0,
          maxPerDay,
          readyToPublish:    rendered.length,
          queuePending:      pendingJobs.length,
          queueRendering:    rendering ? 1 : 0,
          queueFailed:       failedJobs.length,
          generationEnabled: process.env.AUTO_GENERATION_ENABLED === 'true',
          publishEnabled:    process.env.AUTO_PUBLISH_ENABLED    === 'true',
          isPublishing:      publishStatus.isPublishing,
        },
        pipeline: { pending: pendingJobs, rendering, rendered, publishedToday, failed: failedJobs },
        upcoming,
        quality: {
          avgVirality,
          avgFormatMatch: avgFormat,
          avgEmotional:   avgEmotion,
          rejectionRate,
          approvalRate:   100 - rejectionRate,
          totalCycles:    schedulerLog.length,
          thresholds: {
            viralityToQueue:   parseInt(process.env.MIN_VIRALITY_SCORE_TO_QUEUE    || '75'),
            formatMatchToQueue:parseInt(process.env.MIN_FORMAT_MATCH_SCORE_TO_QUEUE|| '70'),
            viralityToPublish: parseInt(process.env.MIN_VIRALITY_SCORE_TO_PUBLISH  || '82'),
          },
        },
        recentRejections,
        nextDecision,
      },
    });
  } catch (err) {
    logger.error(`Operations dashboard error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
//  FRONTEND ESTÁTICO (build de producción)
// ─────────────────────────────────────────────

const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback — cualquier ruta no-API sirve index.html
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendDist, 'index.html'));
    }
  });
  logger.info(`Frontend serving from: ${frontendDist}`);
}

// ─────────────────────────────────────────────
//  ERROR HANDLER
// ─────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  logger.error(`Unhandled: ${err.message}`);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// ─────────────────────────────────────────────
//  ARRANQUE
// ─────────────────────────────────────────────

async function start() {
  initializeDatabase();

  app.listen(PORT, () => {
    logger.info(`Server on port ${PORT}`);
    logger.info(`Stack: Claude API + Edge TTS (free) + JSON DB + FFmpeg`);
    logger.info(`Growth Engine: autonomous content machine active`);
  });

  // Arrancar schedulers autónomos (después del servidor para que los logs sean ordenados)
  setTimeout(() => {
    startGenerationScheduler();
    startPublishScheduler();
  }, 2000);
}

start();

module.exports = app;
