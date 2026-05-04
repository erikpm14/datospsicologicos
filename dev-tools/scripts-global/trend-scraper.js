/**
 * trend-scraper.js
 * Obtiene tendencias en tiempo real para informar la generación de contenido.
 *
 * Fuentes:
 *   1. Reddit  — API pública JSON (sin auth, free, rate-limit 1 req/s)
 *   2. YouTube — reutiliza viral-research.js
 *
 * Salida: backend/data/trends.json
 *
 * Uso:
 *   node scripts/trend-scraper.js
 *   npm run trends   (desde ./backend)
 *
 * Cron recomendado: cada 4 horas (suficiente para capturar tendencias diarias)
 */

'use strict';

const path             = require('path');
const fs               = require('fs');
const { spawnSync }    = require('child_process');
const { createRequire } = require('module');

// Usar dependencias del backend
const backendRequire = createRequire(path.join(__dirname, '../backend/package.json'));
backendRequire('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const axios = backendRequire('axios');

const OUTPUT_PATH   = path.join(__dirname, '../backend/data/trends.json');
const RESEARCH_PATH = path.join(__dirname, '../backend/data/viral-research.json');

// ─────────────────────────────────────────────────────────────────────────────
//  KEYWORD → TOPIC MAP
//  Mapea palabras clave del título de un post Reddit a nuestros topics internos
// ─────────────────────────────────────────────────────────────────────────────

const KEYWORD_TOPIC_MAP = {
  habit:           'habits',
  hábito:          'habits',
  rutina:          'habits',
  routine:         'habits',
  dopamine:        'dopamine',
  dopamina:        'dopamine',
  reward:          'dopamine',
  recompensa:      'dopamine',
  procrastin:      'procrastination',
  postergac:       'procrastination',
  bias:            'cognitive_biases',
  sesgo:           'cognitive_biases',
  heuristic:       'cognitive_biases',
  anchoring:       'cognitive_biases',
  'body language': 'body_language',
  'lenguaje corporal': 'body_language',
  gesture:         'body_language',
  gesto:           'body_language',
  emotion:         'emotions',
  emoción:         'emotions',
  emocional:       'emotions',
  feeling:         'emotions',
  relationship:    'relationships',
  relación:        'relationships',
  toxic:           'relationships',
  tóxico:          'relationships',
  decision:        'decision_making',
  decisión:        'decision_making',
  choice:          'decision_making',
  attention:       'attention',
  atención:        'attention',
  focus:           'attention',
  foco:            'attention',
  memory:          'memory',
  memoria:         'memory',
  recall:          'memory',
  social:          'social_patterns',
  conformity:      'social_patterns',
  conformidad:     'social_patterns',
  peer:            'social_patterns',
  motivat:         'motivation',
  motivac:         'motivation',
  self:            'self_talk',
  autoestima:      'self_talk',
  'self-esteem':   'self_talk',
  perception:      'perception',
  percepción:      'perception',
  illusion:        'perception',
  ilusión:         'perception',
};

function detectTopic(text) {
  const lower = text.toLowerCase();
  for (const [keyword, topic] of Object.entries(KEYWORD_TOPIC_MAP)) {
    if (lower.includes(keyword)) return topic;
  }
  return 'cognitive_biases'; // fallback más genérico y viral
}

// ─────────────────────────────────────────────────────────────────────────────
//  REDDIT SCRAPER
//  Usa la API pública JSON de Reddit (no requiere auth para posts públicos)
//  Rate limit: ~1 req/s sin token. Añadir User-Agent real para no ser bloqueado.
// ─────────────────────────────────────────────────────────────────────────────

const REDDIT_HEADERS = {
  'User-Agent': 'datos-psicologicos-bot/1.0 (research; contact: noreply@example.com)',
  'Accept': 'application/json',
};

const REDDIT_SOURCES = [
  // Comunidades en español — alta relevancia directa
  { subreddit: 'psicologia',           lang: 'es', weight: 5 },
  { subreddit: 'neurociencia',         lang: 'es', weight: 5 },
  { subreddit: 'es',                   lang: 'es', weight: 2 },
  { subreddit: 'mexico',               lang: 'es', weight: 2 },
  // Comunidades en inglés — mayor volumen, extraemos conceptos
  { subreddit: 'psychology',           lang: 'en', weight: 4 },
  { subreddit: 'socialskills',         lang: 'en', weight: 3 },
  { subreddit: 'BehavioralEconomics',  lang: 'en', weight: 3 },
  { subreddit: 'cogsci',               lang: 'en', weight: 3 },
  { subreddit: 'DecidingToBeBetter',   lang: 'en', weight: 2 },
  { subreddit: 'productivity',         lang: 'en', weight: 2 },
];

async function scrapeReddit(subreddit, timeframe = 'week') {
  const url = `https://www.reddit.com/r/${subreddit}/top.json?limit=25&t=${timeframe}`;
  try {
    const res = await axios.get(url, {
      headers: REDDIT_HEADERS,
      timeout: 10000,
    });

    const posts = res.data?.data?.children || [];
    return posts
      .filter(p => !p.data.stickied && p.data.score > 50)
      .map(p => ({
        source:     'reddit',
        subreddit,
        title:      p.data.title,
        score:      p.data.score,       // upvotes = engagement proxy
        comments:   p.data.num_comments,
        ratio:      p.data.upvote_ratio,
        created:    new Date(p.data.created_utc * 1000).toISOString(),
        url:        `https://reddit.com${p.data.permalink}`,
        topic:      detectTopic(p.data.title + ' ' + (p.data.selftext || '')),
        // Hook potencial: primeras 12 palabras del título
        hookHint:   p.data.title.split(' ').slice(0, 12).join(' '),
        // Señal de viralidad: score * ratio (upvotes netos)
        viralSignal: Math.round(p.data.score * p.data.upvote_ratio),
      }));
  } catch (err) {
    console.warn(`  ⚠  Reddit r/${subreddit}: ${err.message}`);
    return [];
  }
}

async function scrapeAllReddit() {
  console.log('\n  Scraping Reddit...');
  const results = [];

  for (const { subreddit, weight } of REDDIT_SOURCES) {
    const posts = await scrapeReddit(subreddit);
    // Aplicar peso según relevancia de la comunidad
    const weighted = posts.map(p => ({ ...p, viralSignal: p.viralSignal * weight }));
    results.push(...weighted);
    // Rate limit: 1 req/s
    await new Promise(r => setTimeout(r, 1100));
    process.stdout.write(`    r/${subreddit}: ${posts.length} posts\n`);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
//  YOUTUBE TRENDS
//  Lee el archivo viral-research.json generado por viral-research.js
//  (no volvemos a llamar a la API — ya la cachea)
// ─────────────────────────────────────────────────────────────────────────────

function loadYoutubeTrends() {
  if (!fs.existsSync(RESEARCH_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(RESEARCH_PATH, 'utf8'));
    const videos = data.videos || [];
    return videos.map(v => ({
      source:      'youtube',
      title:       v.title,
      views:       v.viewCount,
      likes:       v.likeCount,
      comments:    v.commentCount,
      channelName: v.channelTitle,
      publishedAt: v.publishedAt,
      url:         `https://youtube.com/watch?v=${v.videoId}`,
      topic:       detectTopic(v.title + ' ' + (v.description || '')),
      hookHint:    v.title.split(' ').slice(0, 12).join(' '),
      viralSignal: Math.round((v.viewCount || 0) / 1000), // vistas en miles como señal
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCORING DE TENDENCIAS
//  Agrega todas las fuentes y calcula qué topics están trending ahora mismo
// ─────────────────────────────────────────────────────────────────────────────

function aggregateTrends(allItems) {
  // Agrupar por topic y calcular señal total
  const byTopic = {};

  for (const item of allItems) {
    const t = item.topic;
    if (!byTopic[t]) {
      byTopic[t] = { topic: t, totalSignal: 0, posts: [], sources: new Set() };
    }
    byTopic[t].totalSignal += item.viralSignal;
    byTopic[t].posts.push(item);
    byTopic[t].sources.add(item.source);
  }

  // Convertir a array y ordenar por señal
  const ranked = Object.values(byTopic)
    .map(t => ({
      ...t,
      sources:     Array.from(t.sources),
      topPosts:    t.posts
                     .sort((a, b) => b.viralSignal - a.viralSignal)
                     .slice(0, 3)
                     .map(p => ({ title: p.title, signal: p.viralSignal, source: p.source })),
      // Hook hints de los posts más virales (para inspirar el generador)
      hookHints:   [...new Set(
                     t.posts
                       .sort((a, b) => b.viralSignal - a.viralSignal)
                       .slice(0, 5)
                       .map(p => p.hookHint)
                   )],
    }))
    .sort((a, b) => b.totalSignal - a.totalSignal);

  // Top 5 trending
  const trending = ranked.slice(0, 5).map((t, i) => ({
    rank:        i + 1,
    topic:       t.topic,
    totalSignal: t.totalSignal,
    sources:     t.sources,
    topPosts:    t.topPosts,
    hookHints:   t.hookHints,
    isTrending:  true,
  }));

  return { trending, allTopics: ranked };
}

// ─────────────────────────────────────────────────────────────────────────────
//  GOOGLE TRENDS (pytrends — opcional, graceful fallback)
//  Llama al script Python y parsea su salida JSON.
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_TRENDS_SCRIPT = path.join(__dirname, 'google-trends.py');

function loadGoogleTrends() {
  if (!fs.existsSync(GOOGLE_TRENDS_SCRIPT)) return [];

  try {
    const result = spawnSync(process.platform === 'win32' ? 'pythonw' : 'python', [GOOGLE_TRENDS_SCRIPT], {
      encoding: 'utf8',
      timeout:  60000,  // 60s max
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status !== 0 || !result.stdout) return [];

    const data = JSON.parse(result.stdout.trim());
    if (data.error || !data.trending?.length) return [];

    return data.trending.map(item => ({
      source:      'google_trends',
      title:       item.keyword,
      topic:       item.topic,
      hookHint:    item.keyword,
      viralSignal: Math.round(item.signal * 10), // escalar a rango similar a Reddit
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function runTrendScraper() {
  console.log('\n========================================');
  console.log('  Trend Scraper — datos-psicologicos');
  console.log('========================================');

  const allItems = [];

  // 1. Reddit
  const redditPosts = await scrapeAllReddit();
  allItems.push(...redditPosts);
  console.log(`  Reddit total: ${redditPosts.length} posts`);

  // 2. YouTube (desde caché)
  const ytVideos = loadYoutubeTrends();
  allItems.push(...ytVideos);
  console.log(`  YouTube cache: ${ytVideos.length} videos`);

  // 3. Google Trends via pytrends (opcional)
  const gTrends = loadGoogleTrends();
  if (gTrends.length > 0) {
    allItems.push(...gTrends);
    console.log(`  Google Trends: ${gTrends.length} keywords`);
  } else {
    console.log(`  Google Trends: no disponible (instala pytrends: pip install pytrends)`);
  }

  if (allItems.length === 0) {
    console.warn('  ⚠  Sin datos de ninguna fuente');
    return null;
  }

  // 3. Agregar y rankear
  const { trending, allTopics } = aggregateTrends(allItems);

  const output = {
    generatedAt:  new Date().toISOString(),
    totalItems:   allItems.length,
    sources: {
      reddit:        redditPosts.length,
      youtube:       ytVideos.length,
      google_trends: gTrends.length,
    },
    trending,
    allTopics:    allTopics.map(t => ({
      topic:       t.topic,
      signal:      t.totalSignal,
      sources:     t.sources,
      hookHints:   t.hookHints.slice(0, 3),
    })),
  };

  // 4. Guardar
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log('\n  Top trending topics:');
  for (const t of trending) {
    console.log(`    ${t.rank}. ${t.topic.padEnd(22)} signal=${t.totalSignal}  [${t.sources.join('+')}]`);
  }
  console.log(`\n  Guardado en: backend/data/trends.json\n`);

  return output;
}

// Exporta para uso como módulo
module.exports = { runTrendScraper, aggregateTrends };

// Ejecutar si es llamado directamente
if (require.main === module) {
  runTrendScraper().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
