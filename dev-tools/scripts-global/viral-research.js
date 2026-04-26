/**
 * viral-research.js
 * Descarga los metadatos de los shorts de psicología más virales en español
 * usando la YouTube Data API v3 (ya configurada en .env).
 *
 * Uso: node scripts/viral-research.js
 * Output: backend/data/viral-research.json
 */

/**
 * FIX: usar dependencias del backend desde scripts/
 */
const path = require('path');
const { createRequire } = require('module');

// Crear require apuntando al backend
const backendRequire = createRequire(path.join(__dirname, '../backend/package.json'));

// Cargar .env desde backend
backendRequire('dotenv').config({
  path: path.join(__dirname, '../backend/.env'),
});

// Usar dependencias del backend
const axios = backendRequire('axios');

// Node core (estos sí normales)
const fs = require('fs');
const API_KEY = process.env.YOUTUBE_API_KEY;
const OUTPUT_PATH = path.join(__dirname, '../backend/data/viral-research.json');

// Si no hay API key separada, usa el client ID como fallback con OAuth
// Para búsqueda pública solo necesitamos API key (no OAuth)
// Puedes obtener una gratis en console.cloud.google.com → YouTube Data API v3 → Credentials → API Key
if (!API_KEY) {
  console.error('❌  Falta YOUTUBE_API_KEY en .env');
  console.error('   Ve a console.cloud.google.com → APIs → YouTube Data API v3 → Credentials → Create API Key');
  console.error('   Añade: YOUTUBE_API_KEY=tu_api_key_aqui');
  process.exit(1);
}

const YT = 'https://www.googleapis.com/youtube/v3';

// Términos de búsqueda para capturar distintos ángulos del nicho
const SEARCH_QUERIES = [
  'psicologia datos curiosos shorts',
  'datos psicologicos impactantes',
  'lenguaje corporal secretos',
  'manipulacion psicologica señales',
  'sesgos cognitivos mente',
  'autoestima confianza psicologia',
  'relaciones toxicas señales',
  'motivacion cerebro psicologia',
  'memoria trucos psicologia',
  'emociones psicologia viral',
];

// Rango de fechas: últimos 8 meses (para capturar tendencias recientes)
const publishedAfter = new Date();
publishedAfter.setMonth(publishedAfter.getMonth() - 8);

async function searchVideos(query, maxResults = 25) {
  const res = await axios.get(`${YT}/search`, {
    params: {
      key: API_KEY,
      q: query,
      type: 'video',
      videoDuration: 'short',   // menos de 4 minutos (shorts)
      relevanceLanguage: 'es',
      order: 'viewCount',
      publishedAfter: publishedAfter.toISOString(),
      maxResults,
      part: 'snippet',
      fields: 'items(id/videoId,snippet/title,snippet/channelTitle,snippet/publishedAt)',
    },
  });
  return res.data.items || [];
}

async function getVideoStats(videoIds) {
  // YouTube permite hasta 50 IDs por llamada
  const chunks = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  const results = [];
  for (const chunk of chunks) {
    const res = await axios.get(`${YT}/videos`, {
      params: {
        key: API_KEY,
        id: chunk.join(','),
        part: 'statistics,contentDetails,snippet',
        fields: 'items(id,snippet/title,snippet/description,snippet/tags,snippet/channelTitle,snippet/publishedAt,statistics,contentDetails/duration)',
      },
    });
    results.push(...(res.data.items || []));
  }
  return results;
}

function parseDuration(iso) {
  // PT1M30S → 90 segundos
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

function calcEngagement(stats) {
  const views = parseInt(stats.viewCount || 0);
  const likes = parseInt(stats.likeCount || 0);
  const comments = parseInt(stats.commentCount || 0);
  if (!views) return 0;
  return parseFloat(((likes + comments) / views * 100).toFixed(4));
}

function extractHookWords(title) {
  // Primeras 8 palabras del título
  return title.split(/\s+/).slice(0, 8).join(' ');
}

function detectHookPattern(title) {
  const t = title.toLowerCase();
  if (/^\d+/.test(t)) return 'number_list';           // "3 señales que..."
  if (t.startsWith('nunca') || t.startsWith('jamás')) return 'never';
  if (t.startsWith('si ') || t.startsWith('si alguien')) return 'conditional';
  if (t.startsWith('por qué') || t.startsWith('¿por qué')) return 'why_question';
  if (t.startsWith('el ') && /%/.test(t)) return 'percentage';
  if (t.startsWith('cómo') || t.startsWith('¿cómo')) return 'how_to';
  if (t.startsWith('la verdad') || t.startsWith('el secreto')) return 'secret_truth';
  if (t.includes('sin que') || t.includes('sin saberlo')) return 'without_knowing';
  if (t.includes('inmediatamente') || t.includes('ahora mismo')) return 'urgency';
  return 'other';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('🔍  Iniciando investigación de vídeos virales...\n');

  const allVideoIds = new Set();
  const snippetMap = {};

  // 1. Búsqueda por queries
  for (let i = 0; i < SEARCH_QUERIES.length; i++) {
    const q = SEARCH_QUERIES[i];
    process.stdout.write(`   [${i + 1}/${SEARCH_QUERIES.length}] "${q}"... `);
    try {
      const items = await searchVideos(q, 25);
      items.forEach((item) => {
        const id = item.id.videoId;
        allVideoIds.add(id);
        snippetMap[id] = item.snippet;
      });
      console.log(`${items.length} resultados`);
    } catch (err) {
      console.log(`ERROR: ${err.response?.data?.error?.message || err.message}`);
    }
    await sleep(300); // respeta rate limits
  }

  console.log(`\n📦  Total vídeos únicos encontrados: ${allVideoIds.size}`);
  console.log('📊  Descargando estadísticas detalladas...');

  // 2. Stats detalladas
  const videoIds = [...allVideoIds];
  let detailed = [];
  try {
    detailed = await getVideoStats(videoIds);
  } catch (err) {
    console.error(`Error obteniendo stats: ${err.message}`);
    process.exit(1);
  }

  // 3. Procesamiento y enriquecimiento
  const processed = detailed
    .map((v) => {
      const stats = v.statistics || {};
      const durationSec = parseDuration(v.contentDetails?.duration || 'PT0S');
      const views = parseInt(stats.viewCount || 0);
      const likes = parseInt(stats.likeCount || 0);
      const comments = parseInt(stats.commentCount || 0);
      const title = v.snippet?.title || '';

      return {
        id: v.id,
        title,
        channel: v.snippet?.channelTitle,
        publishedAt: v.snippet?.publishedAt,
        durationSec,
        views,
        likes,
        comments,
        engagementRate: calcEngagement(stats),
        likeRate: views ? parseFloat((likes / views * 100).toFixed(4)) : 0,
        commentRate: views ? parseFloat((comments / views * 100).toFixed(4)) : 0,
        hookWords: extractHookWords(title),
        hookPattern: detectHookPattern(title),
        tags: (v.snippet?.tags || []).slice(0, 10),
        descriptionPreview: (v.snippet?.description || '').slice(0, 200),
      };
    })
    .filter((v) => v.durationSec <= 90 && v.views >= 1000) // solo shorts reales con tracción
    .sort((a, b) => b.views - a.views);

  // 4. Estadísticas agregadas
  const totalVideos = processed.length;
  const avgViews = Math.round(processed.reduce((s, v) => s + v.views, 0) / totalVideos);
  const avgEngagement = parseFloat((processed.reduce((s, v) => s + v.engagementRate, 0) / totalVideos).toFixed(4));

  // Top 20 por vistas
  const top20 = processed.slice(0, 20);

  // Distribución de patrones de hook
  const hookPatternCounts = {};
  processed.forEach((v) => {
    hookPatternCounts[v.hookPattern] = (hookPatternCounts[v.hookPattern] || 0) + 1;
  });

  // Distribución de duraciones (buckets de 15s)
  const durationBuckets = { '0-30s': 0, '31-45s': 0, '46-60s': 0, '61-75s': 0, '76-90s': 0 };
  processed.forEach((v) => {
    if (v.durationSec <= 30) durationBuckets['0-30s']++;
    else if (v.durationSec <= 45) durationBuckets['31-45s']++;
    else if (v.durationSec <= 60) durationBuckets['46-60s']++;
    else if (v.durationSec <= 75) durationBuckets['61-75s']++;
    else durationBuckets['76-90s']++;
  });

  // Engagement promedio por duración
  const engagementByDuration = {};
  Object.keys(durationBuckets).forEach((bucket) => {
    const videos = processed.filter((v) => {
      if (bucket === '0-30s') return v.durationSec <= 30;
      if (bucket === '31-45s') return v.durationSec > 30 && v.durationSec <= 45;
      if (bucket === '46-60s') return v.durationSec > 45 && v.durationSec <= 60;
      if (bucket === '61-75s') return v.durationSec > 60 && v.durationSec <= 75;
      return v.durationSec > 75;
    });
    engagementByDuration[bucket] = videos.length
      ? parseFloat((videos.reduce((s, v) => s + v.engagementRate, 0) / videos.length).toFixed(4))
      : 0;
  });

  // Engagement promedio por patrón de hook
  const engagementByPattern = {};
  Object.keys(hookPatternCounts).forEach((pattern) => {
    const videos = processed.filter((v) => v.hookPattern === pattern);
    engagementByPattern[pattern] = {
      count: videos.length,
      avgEngagement: parseFloat((videos.reduce((s, v) => s + v.engagementRate, 0) / videos.length).toFixed(4)),
      avgViews: Math.round(videos.reduce((s, v) => s + v.views, 0) / videos.length),
    };
  });

  // Palabras más comunes en títulos de los TOP 50
  const wordFreq = {};
  const stopWords = new Set(['de', 'la', 'el', 'en', 'que', 'y', 'a', 'los', 'las', 'un', 'una', 'es', 'se', 'del', 'por', 'con', 'no', 'tu', 'te', 'lo', 'su', 'si', 'al', 'más', 'esto', 'esta', 'este', 'son', 'hay', 'cada', 'para', 'como', 'pero', 'qué', 'cómo']);
  processed.slice(0, 50).forEach((v) => {
    v.title.toLowerCase().split(/\s+/).forEach((word) => {
      const clean = word.replace(/[¿?¡!.,:"']/g, '');
      if (clean.length > 3 && !stopWords.has(clean)) {
        wordFreq[clean] = (wordFreq[clean] || 0) + 1;
      }
    });
  });
  const topWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([word, count]) => ({ word, count }));

  // Output final
  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalVideosAnalyzed: totalVideos,
      avgViews,
      avgEngagement,
      dateRange: {
        from: publishedAfter.toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
      },
    },
    hookPatternPerformance: Object.entries(engagementByPattern)
      .sort((a, b) => b[1].avgEngagement - a[1].avgEngagement)
      .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {}),
    durationPerformance: {
      distribution: durationBuckets,
      avgEngagementByBucket: engagementByDuration,
    },
    topWords,
    top20Videos: top20.map((v) => ({
      title: v.title,
      channel: v.channel,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      engagementRate: v.engagementRate,
      durationSec: v.durationSec,
      hookPattern: v.hookPattern,
      hookWords: v.hookWords,
      tags: v.tags,
    })),
    allVideos: processed,
  };

  // Guarda
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  // Resumen en consola
  console.log(`\n✅  Análisis completado:`);
  console.log(`   • Vídeos analizados: ${totalVideos}`);
  console.log(`   • Vistas promedio: ${avgViews.toLocaleString()}`);
  console.log(`   • Engagement promedio: ${avgEngagement}%`);
  console.log(`\n📈  Patrones de hook por engagement:`);
  Object.entries(engagementByPattern)
    .sort((a, b) => b[1].avgEngagement - a[1].avgEngagement)
    .forEach(([p, d]) => console.log(`   ${p.padEnd(20)} ${d.avgEngagement}% engagement | ${d.count} vídeos | ${d.avgViews.toLocaleString()} vistas avg`));
  console.log(`\n⏱  Engagement por duración:`);
  Object.entries(engagementByDuration).forEach(([b, e]) =>
    console.log(`   ${b.padEnd(10)} ${e}%`)
  );
  console.log(`\n🔑  Top 10 palabras en títulos virales:`);
  topWords.slice(0, 10).forEach((w) => console.log(`   "${w.word}" × ${w.count}`));
  console.log(`\n💾  Guardado en: ${OUTPUT_PATH}`);
  console.log('\n▶  Siguiente paso: node scripts/analyze-patterns.js');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
