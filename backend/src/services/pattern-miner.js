/**
 * pattern-miner.js
 * Extrae patrones estructurales de hooks ganadores y los usa para mejorar
 * la generación futura.
 *
 * Patrones identificados (basados en los hooks que más retención generan):
 *   si_entonces      → "Si haces X, tu cerebro ya está Y"
 *   tu_cerebro       → "Tu cerebro/mente hace X sin que lo sepas"
 *   porcentaje       → "El N% de personas X"
 *   por_que          → "Por qué [no puedes/siempre] X"
 *   hay_razon        → "Hay una razón por la que X"
 *   cada_vez         → "Cada vez que X, tu mente Y"
 *   nombre_efecto    → "Efecto X / Síndrome del X — Y"
 *   dash_revelation  → "X — [consecuencia inesperada]"
 *   negacion_falsa   → "Lo que crees sobre X es completamente falso"
 *   pregunta_directa → "¿Por qué tu cerebro X?"
 *
 * Persiste en: backend/data/hook-patterns.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const HOOK_PATTERNS_PATH = path.resolve('./data/hook-patterns.json');
const VIDEOS_PATH        = path.resolve('./data/videos.json');

// ─────────────────────────────────────────────
//  DEFINICIÓN DE PATRONES
// ─────────────────────────────────────────────

const PATTERNS = [
  {
    id:       'si_entonces',
    label:    'Si [condición], [consecuencia]',
    regex:    /^si\s+.{5,}/i,
    example:  'Si revisas el móvil al despertar, tu día ya está saboteado.',
    priority: 1,
  },
  {
    id:       'tu_cerebro',
    label:    'Tu [cerebro/mente/cuerpo] [acción inesperada]',
    regex:    /^tu\s+(cerebro|mente|cuerpo|sistema\s+nervioso)\s+/i,
    example:  'Tu cerebro te miente cada vez que procrastinas.',
    priority: 2,
  },
  {
    id:       'porcentaje',
    label:    'El N% de personas [comportamiento]',
    regex:    /^el\s+\d+[,.]?\d*\s*%\s+/i,
    example:  'El 73% de las decisiones que tomas hoy no son tuyas.',
    priority: 3,
  },
  {
    id:       'cada_vez',
    label:    'Cada vez que [situación], [consecuencia]',
    regex:    /^cada\s+vez\s+que\s+/i,
    example:  'Cada vez que te distraes, tu cerebro paga un coste real.',
    priority: 4,
  },
  {
    id:       'por_que',
    label:    'Por qué [no puedes / siempre] [comportamiento]',
    regex:    /^por\s+qué\s+/i,
    example:  'Por qué no puedes dejar de pensar en lo que te dijeron.',
    priority: 5,
  },
  {
    id:       'hay_razon',
    label:    'Hay una razón por la que [comportamiento]',
    regex:    /^hay\s+(una?)\s+(razón|mecanismo|explicación|causa)\s+/i,
    example:  'Hay una razón por la que no puedes dejar las cosas sin terminar.',
    priority: 6,
  },
  {
    id:       'nombre_efecto',
    label:    'Efecto [nombre] — [consecuencia]',
    regex:    /(efecto|síndrome|paradoja|sesgo|ley)\s+[a-záéíóúüñ\-]+/i,
    example:  'Efecto Zeigarnik — por qué recuerdas lo que no terminaste.',
    priority: 7,
  },
  {
    id:       'negacion_falsa',
    label:    'Lo que crees sobre X es incorrecto',
    regex:    /^(lo\s+que\s+crees|lo\s+que\s+piensas|lo\s+que\s+sabes)\s+/i,
    example:  'Lo que crees sobre la motivación es completamente falso.',
    priority: 8,
  },
  {
    id:       'pregunta_directa',
    label:    '¿Por qué tu cerebro X?',
    regex:    /^¿?(por\s+qué\s+tu|cómo\s+tu|cuándo\s+tu)\s+/i,
    example:  '¿Por qué tu cerebro convierte el aburrimiento en ansiedad?',
    priority: 9,
  },
  {
    id:       'dash_revelation',
    label:    '[X] — [revelación inesperada]',
    regex:    /\s[—–-]\s/,
    example:  'Dopamina — la razón real por la que no puedes concentrarte.',
    priority: 10,
  },
];

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

// ─────────────────────────────────────────────
//  CLASIFICACIÓN
// ─────────────────────────────────────────────

/**
 * Clasifica un hook en uno de los patrones definidos.
 * @param {string} hook
 * @returns {string} patternId
 */
function classifyHook(hook) {
  if (!hook) return 'otros';
  const clean = hook.trim();
  // Evalúa en orden de prioridad
  const sorted = [...PATTERNS].sort((a, b) => a.priority - b.priority);
  for (const p of sorted) {
    if (p.regex.test(clean)) return p.id;
  }
  return 'otros';
}

// ─────────────────────────────────────────────
//  MINERÍA
// ─────────────────────────────────────────────

/**
 * Analiza todos los vídeos publicados y extrae estadísticas por patrón.
 * Se llama cuando analytics-tracker actualiza métricas.
 *
 * @returns {Array} patrones ordenados por avgViews desc
 */
function minePatterns() {
  const videos = readJSON(VIDEOS_PATH, []) || [];
  if (videos.length === 0) {
    logger.debug('Pattern Miner: no videos to mine');
    return [];
  }

  const stats = {}; // patternId → stats

  // Inicializar todos los patrones conocidos
  for (const p of [...PATTERNS, { id: 'otros', label: 'Otros', example: '' }]) {
    stats[p.id] = {
      patternId:    p.id,
      label:        p.label || p.id,
      count:        0,
      totalViews:   0,
      totalLikes:   0,
      totalScore:   0,
      winnerCount:  0,
      topics:       {},
      examples:     [],
    };
  }

  for (const video of videos) {
    if (!video.hook) continue;

    const patternId = classifyHook(video.hook);
    const views     = video.tiktok_views || video.youtube_views || video.max_views || 0;
    const likes     = video.tiktok_likes || video.youtube_likes || 0;
    const score     = video.virality_score || video.viralityScore || 0;
    const topic     = video.topic || 'unknown';

    const s = stats[patternId] || stats['otros'];
    s.count++;
    s.totalViews   += views;
    s.totalLikes   += likes;
    s.totalScore   += score;
    s.topics[topic] = (s.topics[topic] || 0) + 1;

    // Clasificar como winner: top 20% de vistas en el dataset
    // (se recalcula después)
    s.examples.push({ hook: video.hook, views, likes, score, topic });
  }

  // P80 de vistas para clasificar winners
  const allViews = videos.map(v => v.tiktok_views || v.youtube_views || v.max_views || 0).sort((a,b)=>a-b);
  const p80 = allViews[Math.floor(allViews.length * 0.8)] || 0;

  const result = Object.values(stats)
    .filter(s => s.count > 0)
    .map(s => {
      const avgViews      = Math.round(s.totalViews / s.count);
      const avgLikes      = Math.round(s.totalLikes / s.count);
      const avgScore      = parseFloat((s.totalScore / s.count).toFixed(1));
      const avgEngagement = avgViews > 0 ? parseFloat((avgLikes / avgViews).toFixed(4)) : 0;

      // Contar winners (hooks con vistas >= p80)
      const winners = s.examples.filter(e => e.views >= p80 && p80 > 0);
      const winRate = s.count > 0 ? parseFloat((winners.length / s.count).toFixed(3)) : 0;

      const topTopics = Object.entries(s.topics)
        .sort(([,a],[,b]) => b - a)
        .slice(0, 3)
        .map(([t]) => t);

      // Mejores ejemplos: vistas altas
      const bestExamples = s.examples
        .sort((a, b) => b.views - a.views)
        .slice(0, 5)
        .map(e => ({ hook: e.hook, views: e.views, score: e.score, topic: e.topic }));

      return {
        ...s,
        avgViews,
        avgLikes,
        avgScore,
        avgEngagement,
        winRate,
        winnerCount: winners.length,
        topTopics,
        examples:    bestExamples,
        // Quitar campos de acumulación
        totalViews:  undefined,
        totalLikes:  undefined,
        totalScore:  undefined,
        topics:      s.topics,
      };
    })
    .sort((a, b) => b.avgViews - a.avgViews);

  const output = {
    patterns:     result,
    p80Threshold: p80,
    totalVideos:  videos.length,
    minedAt:      new Date().toISOString(),
  };

  writeJSON(HOOK_PATTERNS_PATH, output);

  const topPattern = result[0];
  logger.info(`Pattern Miner: mined ${result.length} patterns | top="${topPattern?.patternId}" avgViews=${topPattern?.avgViews}`);

  return result;
}

// ─────────────────────────────────────────────
//  CONSULTA — para content-optimizer
// ─────────────────────────────────────────────

/**
 * Devuelve los top N patrones con sus mejores ejemplos.
 * Usado por content-optimizer para inyectar ejemplos reales en el prompt.
 *
 * @param {number} topN       - número de patrones a devolver
 * @param {string} [topic]    - filtrar por topic (opcional)
 * @returns {Array}
 */
function getTopPatterns(topN = 3, topic = null) {
  const data = readJSON(HOOK_PATTERNS_PATH, null);
  if (!data?.patterns?.length) return [];

  let patterns = data.patterns.filter(p => p.count >= 2 && p.avgViews > 0);

  if (topic) {
    // Priorizar patrones que funcionan en este topic
    patterns = patterns.sort((a, b) => {
      const aTopicScore = a.topics?.[topic] || 0;
      const bTopicScore = b.topics?.[topic] || 0;
      // Combinar relevancia de topic con avgViews
      const aScore = a.avgViews + aTopicScore * 500;
      const bScore = b.avgViews + bTopicScore * 500;
      return bScore - aScore;
    });
  }

  return patterns.slice(0, topN).map(p => ({
    patternId:    p.patternId,
    label:        p.label,
    avgViews:     p.avgViews,
    winRate:      p.winRate,
    topExample:   p.examples?.[0]?.hook || null,
    topTopics:    p.topTopics,
  }));
}

/**
 * Genera texto de contexto de patrones para inyectar en el system prompt.
 * Devuelve null si no hay datos suficientes.
 *
 * @param {string} [topic]
 * @returns {string|null}
 */
function getPatternContextForPrompt(topic = null) {
  const topPatterns = getTopPatterns(3, topic);
  if (topPatterns.length === 0) return null;

  const lines = topPatterns.map(p =>
    `  • [${p.patternId}] "${p.label}" — ${p.avgViews > 0 ? `${p.avgViews} views prom.` : ''} ${p.topExample ? `\n    Ejemplo real: "${p.topExample}"` : ''}`
  );

  return `\nPATRONES QUE FUNCIONAN EN ESTE CANAL (extraído de vídeos reales):\n${lines.join('\n')}\nUsa estos patrones como referencia de estructura — no como copia literal.`;
}

/**
 * Informe completo para el dashboard.
 */
function getPatternsReport() {
  const data = readJSON(HOOK_PATTERNS_PATH, null);
  if (!data) return { status: 'no_data', patterns: [], minedAt: null };

  return {
    status:       'ok',
    totalVideos:  data.totalVideos,
    p80Threshold: data.p80Threshold,
    patterns:     data.patterns.filter(p => p.count > 0),
    minedAt:      data.minedAt,
  };
}

module.exports = {
  classifyHook,
  minePatterns,
  getTopPatterns,
  getPatternContextForPrompt,
  getPatternsReport,
  PATTERNS,
};
