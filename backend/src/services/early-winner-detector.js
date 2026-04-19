/**
 * early-winner-detector.js
 * Detecta ganadores en experimentos A/B antes de que se evalúen en el ciclo normal.
 *
 * Cuándo se activa:
 *   - El experimento tiene > 12h de antigüedad (hay datos estables)
 *   - El vídeo publicado supera un umbral mínimo de vistas (≥200)
 *   - El engagement es >= 1.5x el promedio histórico del mismo hookType
 *
 * Al detectar un ganador:
 *   - Marca el experimento como evaluado
 *   - Aumenta el peso del hookType ganador en hook-performance.json
 *   - Registra el evento en growth-log para trazabilidad
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const EXPERIMENTS_PATH      = path.resolve('./data/ab-experiments.json');
const HOOK_PERFORMANCE_PATH = path.resolve('./data/hook-performance.json');
const GROWTH_LOG_PATH       = path.resolve('./data/growth-log.json');
const VIDEOS_PATH           = path.resolve('./data/videos.json');

const MIN_VIEWS_FOR_EVAL  = parseInt(process.env.EARLY_WIN_MIN_VIEWS  || '200');
const MIN_AGE_HOURS       = parseFloat(process.env.EARLY_WIN_MIN_HOURS || '12');
const WIN_MULTIPLIER      = parseFloat(process.env.EARLY_WIN_MULTIPLIER || '1.5');

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

/**
 * Calcula el engagement promedio de un hookType desde el historial.
 * Devuelve null si hay menos de 3 muestras.
 */
function getBaselineEngagement(perf, hookType) {
  const history = (perf.history || []).filter(h => h.hookType === hookType);
  if (history.length < 3) return null;
  const avg = history.reduce((sum, h) => sum + h.engagment, 0) / history.length;
  return avg;
}

// ─────────────────────────────────────────────
//  DETECCIÓN PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Analiza experimentos sin evaluar y detecta ganadores tempranos.
 * Se llama después de cada pollAllMetrics().
 *
 * @returns {{ detected: number, details: Array }}
 */
function detectEarlyWinners() {
  const experiments = readJSON(EXPERIMENTS_PATH, []);
  const videos      = readJSON(VIDEOS_PATH, []) || [];
  const perf        = readJSON(HOOK_PERFORMANCE_PATH, { typeWeights: {}, history: [] });
  const growthLog   = readJSON(GROWTH_LOG_PATH, []) || [];

  const videoMap = {};
  for (const v of videos) videoMap[v.id] = v;

  const now        = Date.now();
  let   detected   = 0;
  const details    = [];
  let   perfDirty  = false;

  for (const exp of experiments) {
    if (exp.winner) continue;            // ya evaluado
    if (!exp.selectedType) continue;

    // Antigüedad mínima
    const ageHours = (now - new Date(exp.createdAt).getTime()) / (1000 * 60 * 60);
    if (ageHours < MIN_AGE_HOURS) continue;

    const video = videoMap[exp.id];
    if (!video) continue;

    const views    = video.tiktok_views || video.youtube_views || video.max_views || 0;
    const likes    = video.tiktok_likes || video.youtube_likes || 0;

    if (views < MIN_VIEWS_FOR_EVAL) continue;

    const engagement = views > 0 ? likes / views : 0;

    // Comparar con línea base del hookType
    const baseline = getBaselineEngagement(perf, exp.selectedType);

    const isEarlyWin = baseline !== null
      ? engagement >= baseline * WIN_MULTIPLIER      // supera 1.5x el promedio
      : engagement >= 0.05;                          // sin historial: umbral fijo 5%

    // Marcar como evaluado (ganador o no)
    exp.winner      = exp.selectedType;
    exp.evaluatedAt = new Date().toISOString();
    exp.metrics     = {
      views,
      likes,
      engagment: parseFloat(engagement.toFixed(4)),
    };
    exp.earlyDetection = true;
    exp.earlyWin       = isEarlyWin;

    // Registrar en historial de performance
    perf.history = perf.history || [];
    perf.history.unshift({
      date:       new Date().toISOString(),
      hookType:   exp.selectedType,
      topic:      exp.topic,
      hook:       exp.selectedHook,
      views,
      likes,
      engagment:  parseFloat(engagement.toFixed(4)),
      earlyWin:   isEarlyWin,
    });

    // Si es ganador temprano, boost directo al peso del tipo
    if (isEarlyWin) {
      const currentWeight = perf.typeWeights?.[exp.selectedType] || 2;
      if (!perf.typeWeights) perf.typeWeights = {};
      perf.typeWeights[exp.selectedType] = Math.min(currentWeight + 1, 6);
      logger.info(`Early Winner: hookType="${exp.selectedType}" engagement=${(engagement * 100).toFixed(1)}% (${WIN_MULTIPLIER}x baseline) → weight boosted to ${perf.typeWeights[exp.selectedType]}`);
    }

    perfDirty = true;
    detected++;

    details.push({
      experimentId: exp.id,
      topic:        exp.topic,
      hookType:     exp.selectedType,
      hook:         exp.selectedHook,
      views,
      engagement:   parseFloat((engagement * 100).toFixed(1)),
      isEarlyWin,
      ageHours:     parseFloat(ageHours.toFixed(1)),
    });
  }

  if (perfDirty) {
    perf.history     = perf.history.slice(0, 200);
    perf.lastUpdated = new Date().toISOString();
    writeJSON(HOOK_PERFORMANCE_PATH, perf);
    writeJSON(EXPERIMENTS_PATH, experiments);

    // Añadir al growth log
    if (detected > 0) {
      growthLog.unshift({
        cycleAt:      new Date().toISOString(),
        event:        'early_winner_detection',
        detected,
        details,
      });
      writeJSON(GROWTH_LOG_PATH, growthLog.slice(0, 200));
    }
  }

  if (detected > 0) {
    logger.info(`Early Winner Detector: ${detected} experiment(s) evaluated early`);
  }

  return { detected, details };
}

module.exports = { detectEarlyWinners };
