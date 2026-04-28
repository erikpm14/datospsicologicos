/**
 * video-renderer.js
 * Renderer mejorado:
 * - ffprobe para duración REAL del audio (sync perfecto)
 * - Pexels API para stock footage de fondo (gratis)
 * - Subtítulos por secciones sincronizados al audio real
 * - Overlay oscuro + texto grande y legible
 */

require('dotenv').config();
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { createPerfTracker, formatDurationMs } = require('../utils/perf-tracker');
const { buildStyledSubtitleBlocks, buildStyledDrawtextFilters, buildSRTContent, buildKaraokeASSFile, buildStyledASSFile } = require('./subtitle-styler');
const { getVisualStyleReference, STYLE_CLIP_KEYWORDS } = require('../utils/visual-style-system');
const { detectVoiceSegments } = require('./audio-postprocess');
const { mapSubtitlesToVoiceSegments } = require('./audio-subtitle-mapper');
const { alignWordTimestamps } = require('./word-timestamp-aligner');
const { exportVideo } = require('./export-manager');
const VIDEO_USE_SKILL = require('../../../integrations/video-use/skill-config');
const { validateAndFixAssets } = require('./asset-validator.service');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const themes = require('../templates/visual-themes.json');
const W = 1080;
const H = 1920;

// Carpeta de caché para vídeos de Pexels descargados
const CACHE_DIR = path.resolve('./assets/stock-footage');
const PEXELS_SEARCH_CACHE_PATH = path.resolve('./data/pexels-search-cache.json');
const PEXELS_SEARCH_CACHE_TTL_MS = Math.max(60_000, (parseInt(process.env.PEXELS_SEARCH_CACHE_MINUTES || '720', 10) || 720) * 60 * 1000);

// Queries por topic: array de opciones → se elige aleatoriamente para variedad
const TOPIC_QUERIES = {
  body_language:    ['person talking gestures close up', 'body language communication nonverbal', 'face expression emotion person'],
  cognitive_biases: ['brain neurons thinking close up', 'human mind decision psychology', 'person thinking contemplating'],
  relationships:    ['couple conversation emotional', 'friends talking laughing together', 'person alone reflection'],
  workplace:        ['office professional meeting focus', 'person working laptop stress', 'business decision corporate'],
  first_impressions:['handshake confident meeting', 'attractive person first impression smile', 'interview professional confident'],
  social_skills:    ['group people social interaction', 'networking crowd urban lifestyle', 'friends conversation outdoor'],
  habits:           ['morning routine person daily life', 'person running discipline motivation', 'habit formation daily routine'],
  communication:    ['two people conversation listening', 'person speaking audience', 'phone conversation connection'],
  emotions:         ['person emotional face close up', 'crying laughing expression dramatic', 'human emotion genuine reaction'],
  memory:           ['brain neurons memory recall', 'person remembering thinking nostalgia', 'abstract mind memory blur'],
  motivation:       ['person achieving goal success', 'athlete running energy determination', 'ambition focus work hard'],
  dark_psychology:  ['shadow person mysterious silhouette', 'manipulation control strings puppet', 'person stressed anxious fear'],
  self_esteem:      ['person mirror reflection confidence', 'self doubt anxiety worried person', 'confident woman man portrait'],
};

// Mapping de efectos psicológicos → queries visuales específicas
// Clip 1: visual del concepto (abstracto/metafórico)
// Clip 2: contexto real (situación cotidiana donde ocurre)
const EFFECT_QUERIES = {
  // Sesgos cognitivos
  'halo':           ['attractive confident person portrait', 'beautiful face first impression close up'],
  'anclaje':        ['price tag sale shopping consumer', 'supermarket price label consumer choice'],
  'dunning':        ['overconfident person presenting speaking', 'beginner vs expert skill gap'],
  'kruger':         ['overconfident person speaking audience', 'knowledge skill gap learning curve'],
  'confirmacion':   ['person reading news agreeing nodding', 'social media echo chamber scrolling'],
  'sesgo':          ['brain decision path choice fork', 'mental shortcut thinking fast'],
  'disponibilidad': ['news media fear headlines screen', 'person worried scared news'],
  'supervivencia':  ['success iceberg hidden failure', 'winner podium crowd selection'],
  'eleccion':       ['supermarket shelf too many options', 'person choosing overwhelmed decision'],
  'barnum':         ['horoscope personality reading stars', 'fortune teller belief mystical'],
  'mera exposicion':['familiar face recognition crowd', 'repetition memory familiarity'],
  'exposicion':     ['familiar face recognition crowd', 'repetition memory familiarity'],
  // Manipulación
  'gaslighting':    ['couple argument manipulation stress', 'person confused doubt questioning reality'],
  'priming':        ['subliminal advertising billboard city', 'word association trigger mind'],
  'darvo':          ['argument reversal blame manipulation', 'victim perpetrator role reversal'],
  'pie puerta':     ['door opening persuasion sales', 'agreement negotiation step by step'],
  'negging':        ['backhanded compliment social manipulation', 'insecurity self doubt person'],
  'neuromarketing': ['advertising brand store consumer brain', 'shopping psychology marketing'],
  // Fenómenos mentales
  'mandela':        ['false memory confusion nostalgia', 'collective memory recall brain'],
  'impostor':       ['professional anxious imposter office', 'fraud anxiety work achievement'],
  'espectador':     ['crowd urban people ignoring bystander', 'emergency ignored urban street'],
  'bystander':      ['crowd people ignoring emergency', 'urban bystander looking away'],
  'deja vu':        ['familiar place recognition blur', 'memory overlap glitch reality'],
  'pareidolia':     ['face in clouds pattern recognition', 'seeing faces objects nature'],
  'placebo':        ['medicine pill doctor patient belief', 'healing psychology mind body'],
  'pigmalion':      ['teacher student expectation mentor', 'coaching success belief performance'],
  'zeigarnik':      ['unfinished task list incomplete work', 'reminder notification incomplete loop'],
  'fomo':           ['social media envy scrolling phone', 'missing out party crowd fear'],
  // Neurociencia
  'dopamina':       ['phone notification social media reward', 'excitement reward brain pleasure'],
  'dopamine':       ['phone notification social media reward', 'excitement reward brain pleasure'],
  'cortisol':       ['stressed person anxiety pressure', 'cortisol stress hormone body'],
  'agotamiento':    ['tired exhausted person decision making', 'decision fatigue stress overwhelmed'],
  'disonancia':     ['internal conflict struggle contradiction', 'two paths decision cognitive dissonance'],
  'dolor social':   ['heartbreak emotional pain person', 'rejection loneliness hurt person'],
  'microexpresiones':['face close up micro expression detect', 'emotion reveal face split second'],
  'inconsciente':   ['underwater abstract subconscious dream', 'shadow self unconscious psychology'],
  'priming visual': ['subliminal image hidden perception', 'visual trigger association mind'],
  // Social
  'prueba social':  ['crowd following trend people group', 'social proof review rating opinion'],
  'conformidad':    ['group pressure conformity crowd', 'individual vs group peer pressure'],
  'milgram':        ['authority obedience experiment', 'following orders authority figure'],
  'asch':           ['group conformity line experiment', 'peer pressure social conformity'],
  'altruismo':      ['helping stranger kindness people', 'reciprocity give receive social'],
  'señalizacion':   ['status symbol luxury car watch', 'high status person confidence power'],
};

const CLIP_SWITCH_SECONDS = 2.5;
const REENGAGE_TARGET_SECOND = 20;
const SUBTITLE_Y = 'h*0.69';
const ASS_SUBTITLE_Y = 1320;
const RENDER_PRESET = process.env.FFMPEG_PRESET || 'veryfast';
const RENDER_CRF = parseInt(process.env.FFMPEG_CRF || '23', 10) || 23;
const PEXELS_QUERY_LIMIT = Math.max(1, parseInt(process.env.PEXELS_QUERY_LIMIT || '3', 10) || 3);
const REFERENCE_VISUAL_STYLE = getVisualStyleReference();
const TARGET_CUT_SECONDS = parseFloat(process.env.RENDER_TARGET_CUT_SECONDS || '2.35');
const MIN_CUT_SECONDS = parseFloat(process.env.RENDER_MIN_CUT_SECONDS || '1.2');
const MAX_CUT_SECONDS = parseFloat(process.env.RENDER_MAX_CUT_SECONDS || '3.0');
const OVERLAY_DURATION_SECONDS = parseFloat(process.env.RENDER_OVERLAY_DURATION_SECONDS || '1.0');

// ─────────────────────────────────────────────
//  Enriquecimiento de sectionDurations con voice segments
// ─────────────────────────────────────────────

/**
 * Enriquece sectionDurations existente con información de voiceSegments detectados.
 * Mapea segmentos de voz globales a las secciones correspondientes.
 *
 * @param {Object} sectionDurations - {section: {start, duration, segments?}}
 * @param {Array} voiceSegments - [{start, end, duration}] globales
 * @returns {Object} sectionDurations enriquecido con voice segments
 */
function _enrichSectionDurationsWithVoiceSegments(sectionDurations, voiceSegments) {
  const enriched = { ...sectionDurations };

  for (const [section, timing] of Object.entries(enriched)) {
    if (!timing) continue;

    // Encontrar voiceSegments que caen dentro del rango de esta sección
    const sectionEnd = timing.start + timing.duration;
    const sectionSegments = voiceSegments.filter(
      (seg) => seg.start < sectionEnd && seg.end > timing.start,
    ).map((seg) => ({
      // Convertir coordenadas globales a relativas a la sección
      start: Math.max(0, seg.start - timing.start),
      end: Math.min(timing.duration, seg.end - timing.start),
    }));

    if (sectionSegments.length > 0) {
      enriched[section] = { ...timing, segments: sectionSegments };
      logger.debug(`Section '${section}': enriched with ${sectionSegments.length} voice segments`);
    }
  }

  return enriched;
}

/**
 * Convierte captions sincronizados (formato caption-sync) al formato de bloques
 * que espera buildStyledASSFile para renderización.
 * Reutiliza estilos (colores, tamaños, opacidad) de subtitle-styler.
 */
function _captionsToStyledBlocks(captions, script) {
  const { SECTION_COLORS, SECTION_FONT_SIZES, hasImpactWord } = require('./subtitle-styler');

  return captions.map((cap, idx) => {
    const section = cap.section || 'claim';
    const isImpact = hasImpactWord(cap.text);
    const isHook = section === 'hook' && idx === 0;
    const wordCount = cap.text.trim().split(/\s+/).length;

    return {
      text: cap.text,
      start: cap.start,
      end: cap.end,
      section,
      isHook,
      isImpact,
      isSingleWordBlock: wordCount === 1,
      color: SECTION_COLORS[section] || '#F3F7FF',
      fontSize: (SECTION_FONT_SIZES[section] || 120) + (isImpact ? 8 : 0),
      boxOpacity: isImpact ? '0.65' : '0.50',
      idx,
      source: cap.source,
    };
  });
}

// ─────────────────────────────────────────────
//  FFPROBE — duración real del audio
// ─────────────────────────────────────────────

function getRealAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(parseFloat(metadata.format.duration));
    });
  });
}

// ─────────────────────────────────────────────
//  PEXELS — descarga vídeo de fondo
// ─────────────────────────────────────────────

// ─── Señales emocionales → queries visuales específicas ─────────────────────
const EMOTIONAL_VISUAL_QUERIES = {
  curiosity:    ['brain neurons glowing close up', 'scientist discovery lab wonder'],
  fear:         ['dark street alone night person', 'anxious stressed person thinking'],
  awe:          ['universe stars galaxy abstract', 'lightning dramatic sky epic'],
  validation:   ['person smiling confident portrait', 'friends understanding empathy'],
  urgency:      ['clock time pressure deadline stress', 'person running hurry focus'],
  relatability: ['person phone scrolling night bed', 'tired morning coffee routine close'],
};

// Hook wording → visual query maps (captura semántica del hook)
const HOOK_VISUAL_MAP = [
  { pattern: /móvil|teléfono|phone|scroll|redes/i,  query: 'phone addiction scrolling night close up' },
  { pattern: /dormir|sueño|noche|bed|despert/i,      query: 'person lying awake bed night insomnia' },
  { pattern: /decisi[oó]n|decide|elegir|choice/i,    query: 'fork in road choice decision person confused' },
  { pattern: /cerebro|mente|mind|brain|neurona/i,    query: 'brain neurons glowing abstract psychology' },
  { pattern: /hablar|hablas|palabras|speak|talk/i,   query: 'person speaking conversation close up face' },
  { pattern: /comer|comes|comida|food|eating/i,      query: 'person eating alone stressed close up' },
  { pattern: /trabajo|trabajo|office|jefe|boss/i,    query: 'stressed office worker laptop deadline' },
  { pattern: /relaci[oó]n|pareja|love|amor/i,        query: 'couple tension argument emotional close' },
  { pattern: /miedo|fear|ansiedad|anxiety|preocup/i, query: 'person anxious alone dark room thinking' },
  { pattern: /olvid|memoria|memory|recuerdo/i,       query: 'blurry memory nostalgia person thinking close' },
  { pattern: /dolor|hurt|sufr|cry|llor/i,            query: 'person emotional pain alone close up face' },
  { pattern: /éxito|success|logr|achieve|meta/i,     query: 'person achieving goal determination focus' },
  { pattern: /manipul|control|poder|power/i,         query: 'shadow figure manipulation control strings' },
  { pattern: /sabotea|autoboicot|self-sabotage/i,    query: 'person holding themselves back self-doubt' },
  { pattern: /automátic|sin darte|sin que|involunt/i, query: 'person on autopilot routine subconscious' },
];

/**
 * Genera queries de Pexels más específicas usando hook, emotional signals y topic.
 * V2: extrae semántica real del hook para evitar búsquedas genéricas como "brain".
 *
 * Devuelve [query1, query2].
 */
function buildPexelsQueries(script) {
  const hook   = script.hook         || '';
  const topic  = script.topic        || '';
  const eTrig  = script.emotionalTrigger || '';
  const vTrig  = script.viralTrigger || '';
  const effect = (script.effectName || script.psychologicalFact || '').toLowerCase();

  const humanize = (query) => {
    const q = String(query || '').trim();
    if (!q) return 'person face close up real life';
    const styled = /(dark|shadow|silhouette|blue|red|eye|brain|moody|cinematic|dramatic)/i.test(q)
      ? q
      : `dark cinematic ${q}`;
    if (/(person|people|couple|conversation|face|portrait|office|phone|woman|man|friends|social|eye|brain|silhouette)/i.test(styled)) return styled;
    return `person real life ${styled}`;
  };

  // 1. Efecto psicológico conocido → queries específicas
  for (const [key, queries] of Object.entries(EFFECT_QUERIES)) {
    if (effect.includes(key)) {
      logger.info(`Pexels V2: effect match → "${key}"`);
      return queries.map(humanize);
    }
  }

  // 2. Hook wording → mapeo semántico directo
  const hookMatch = HOOK_VISUAL_MAP.find(m => m.pattern.test(hook));
  if (hookMatch) {
    const emotionalQuery = EMOTIONAL_VISUAL_QUERIES[eTrig]?.[0] || null;
    const q2 = emotionalQuery || (TOPIC_QUERIES[topic] ? TOPIC_QUERIES[topic][Math.floor(Math.random() * TOPIC_QUERIES[topic].length)] : 'human behavior psychology');
      logger.info(`Pexels V2: hook-match → "${hookMatch.query}" | "${q2}"`);
      return [humanize(hookMatch.query), humanize(q2)];
  }

  // 3. Emotional trigger → escena visual específica
  const emotionalScenes = EMOTIONAL_VISUAL_QUERIES[eTrig];
  if (emotionalScenes) {
    const topicOpts = TOPIC_QUERIES[topic];
    const q2 = Array.isArray(topicOpts) ? topicOpts[Math.floor(Math.random() * topicOpts.length)] : 'psychology human behavior';
      logger.info(`Pexels V2: emotional → "${emotionalScenes[0]}" | "${q2}"`);
      return [humanize(emotionalScenes[0]), humanize(q2)];
  }

  // 4. Keywords del guión (como antes, pero más selectivo)
  const keywords = (script.keywords || [])
    .map(k => k.trim().split(/\s+/).slice(0, 2).join(' '))
    .filter(Boolean);
  if (keywords.length >= 2) return [humanize(keywords[0]), humanize(keywords[1])];
  if (keywords.length === 1) {
    const topicFallback = Array.isArray(TOPIC_QUERIES[topic])
      ? TOPIC_QUERIES[topic][Math.floor(Math.random() * TOPIC_QUERIES[topic].length)]
      : 'psychology mind brain';
    return [humanize(keywords[0]), humanize(topicFallback)];
  }

  // 5. Topic fallback
  const topicOptions = TOPIC_QUERIES[topic];
  if (Array.isArray(topicOptions) && topicOptions.length >= 2) {
    const shuffled = [...topicOptions].sort(() => Math.random() - 0.5);
    return [humanize(shuffled[0]), humanize(shuffled[1])];
  }

  return ['dark cinematic blue eye close up', 'person silhouette red light dark'];
}

const STOCK_CACHE_MAX_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB

function readSearchCache() {
  try {
    if (!fs.existsSync(PEXELS_SEARCH_CACHE_PATH)) return {};
    return JSON.parse(fs.readFileSync(PEXELS_SEARCH_CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeSearchCache(cache) {
  try {
    const dir = path.dirname(PEXELS_SEARCH_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PEXELS_SEARCH_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {}
}

function pruneStockFootageCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const files = fs.readdirSync(CACHE_DIR)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => {
        const full = path.join(CACHE_DIR, f);
        const stat = fs.statSync(full);
        return { full, size: stat.size, mtime: stat.mtimeMs };
      });

    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    if (totalBytes <= STOCK_CACHE_MAX_BYTES) return;

    // Borra los más antiguos hasta bajar del límite
    files.sort((a, b) => a.mtime - b.mtime);
    let freed = 0;
    for (const f of files) {
      if (totalBytes - freed <= STOCK_CACHE_MAX_BYTES) break;
      try { fs.unlinkSync(f.full); } catch {}
      freed += f.size;
      logger.info(`Stock cache pruned: ${path.basename(f.full)} (${Math.round(f.size / 1024 / 1024)}MB freed)`);
    }
    logger.info(`Stock cache: ${Math.round((totalBytes - freed) / 1024 / 1024)}MB after pruning`);
  } catch (err) {
    logger.warn(`Stock cache prune error: ${err.message}`);
  }
}

async function getPexelsVideo(script, bgStyle, forcePage = null, forceQuery = null) {
  if (!process.env.PEXELS_API_KEY || process.env.PEXELS_API_KEY === 'RELLENAR') {
    logger.warn('PEXELS_API_KEY no configurada — usando fondo animado');
    return null;
  }

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Modo satisfying: usa queries de fruta/ASMR aleatorias
  const query = bgStyle === 'satisfying'
    ? SATISFYING_QUERIES[Math.floor(Math.random() * SATISFYING_QUERIES.length)]
    : (forceQuery || buildPexelsQueries(script)[0]);
  const page = forcePage !== null ? forcePage : Math.floor(Math.random() * 4) + 1;
  const perf = createPerfTracker('pexels-fetch', { query, page });
  const cacheKey = `${query}__${page}`;
  const searchCache = readSearchCache();
  const cachedEntry = searchCache[cacheKey];

  if (cachedEntry && (Date.now() - new Date(cachedEntry.cachedAt).getTime()) < PEXELS_SEARCH_CACHE_TTL_MS) {
    const cachedPath = path.join(CACHE_DIR, `pexels_${cachedEntry.id}.mp4`);
    if (fs.existsSync(cachedPath)) {
      logger.info(`Pexels cache hit | query="${query}" | file=pexels_${cachedEntry.id}.mp4 | total=${formatDurationMs(perf.snapshot().totalMs)}`);
      return cachedPath;
    }
  }

  try {
    perf.start('search');
    logger.info(`Fetching Pexels video | query: "${query}" | page: ${page}`);
    const res = await axios.get('https://api.pexels.com/videos/search', {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      params: { query, per_page: 10, page, orientation: 'portrait', size: 'medium' },
      timeout: 15000,
    });
    const searchPhase = perf.end({ source: 'api' });
    logger.info(`Pexels search done | query="${query}" | ${formatDurationMs(searchPhase.durationMs)}`);

    const videos = (res.data.videos || []).filter((v) => v.duration >= 10);

    // Sin resultados: reintenta con query de topic aleatorio
    if (!videos.length) {
      const topicOpts = TOPIC_QUERIES[script.topic];
      const fallbackQuery = Array.isArray(topicOpts)
        ? topicOpts[Math.floor(Math.random() * topicOpts.length)]
        : (topicOpts || 'psychology mind brain');
      logger.warn(`No results for "${query}", falling back to "${fallbackQuery}"`);
      const fallback = await axios.get('https://api.pexels.com/videos/search', {
        headers: { Authorization: process.env.PEXELS_API_KEY },
        params: { query: fallbackQuery, per_page: 10, orientation: 'portrait' },
        timeout: 15000,
      });
      videos.push(...(fallback.data.videos || []).filter((v) => v.duration >= 10));
    }

    if (!videos.length) return null;

    // Elige un vídeo aleatorio de los resultados
    const chosen = videos[Math.floor(Math.random() * videos.length)];
    const file = chosen.video_files
      .filter((f) => f.file_type === 'video/mp4')
      .sort((a, b) => b.height - a.height)[0];

    if (!file?.link) return null;

    // Cachea por ID de Pexels — nunca descarga el mismo vídeo dos veces
    const cachedPath = path.join(CACHE_DIR, `pexels_${chosen.id}.mp4`);
    searchCache[cacheKey] = { id: chosen.id, link: file.link, cachedAt: new Date().toISOString() };
    writeSearchCache(searchCache);
    if (fs.existsSync(cachedPath)) {
      logger.info(`Using cached Pexels video: pexels_${chosen.id}.mp4 | total=${formatDurationMs(perf.snapshot().totalMs)}`);
      return cachedPath;
    }

    logger.info(`Downloading Pexels video ${chosen.id}: "${query}" p${page}`);
    perf.start('download');
    const writer = fs.createWriteStream(cachedPath);
    try {
      const download = await axios.get(file.link, { responseType: 'stream', timeout: 90000 });
      download.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        download.data.on('error', reject);
      });
    } catch (dlErr) {
      // Elimina el archivo parcial para que no quede cacheado corrupto
      try { fs.unlinkSync(cachedPath); } catch {}
      throw dlErr;
    }

    const downloadPhase = perf.end({ id: chosen.id, cachedPath });
    logger.info(`Saved: pexels_${chosen.id}.mp4 | download=${formatDurationMs(downloadPhase.durationMs)} | total=${formatDurationMs(perf.snapshot().totalMs)}`);
    pruneStockFootageCache();
    return cachedPath;
  } catch (err) {
    logger.error(`Pexels fetch failed: ${err.message}`);
    // Último recurso: usa cualquier vídeo ya cacheado
    const anycached = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.mp4'));
    if (anycached.length) {
      const pick = anycached[Math.floor(Math.random() * anycached.length)];
      logger.warn(`Fallback to cached: ${pick}`);
      return path.join(CACHE_DIR, pick);
    }
    return null;
  }
}

/**
 * Descarga 2 clips temáticamente distintos de Pexels.
 * Clip 1: visual del concepto (abstracto/metafórico)
 * Clip 2: contexto real donde ocurre el efecto
 * Queries diferentes + páginas diferentes → máxima variedad visual.
 */
async function getPexelsVideos(script, bgStyle) {
  const [query1, query2] = buildPexelsQueries(script);
  const extraKeywords = Array.isArray(script.videoInstructions?.clipKeywords)
    ? script.videoInstructions.clipKeywords.slice(0, 2)
    : [];
  const queries = [...new Set([query1, query2, ...extraKeywords, ...STYLE_CLIP_KEYWORDS].filter(Boolean))].slice(0, PEXELS_QUERY_LIMIT);

  logger.info(`Pexels single-focus queries | ${queries.map((q) => `"${q}"`).join(' | ')}`);

  const clips = (await Promise.all(
    queries.map((query, index) => getPexelsVideo(script, bgStyle, (index % 3) + 1, query)),
  )).filter(Boolean);

  return [...new Set(clips)];
}

// ─────────────────────────────────────────────
//  SUBTÍTULOS — basados en duración REAL
// ─────────────────────────────────────────────

/**
 * Divide el texto en bloques de ~3 palabras con timing sincronizado.
 *
 * Prioridad:
 *  1. wordBoundaries exactos de TTS → usa timestamps reales palabra por palabra
 *  2. Proporcional por wordcount usando realDuration (de ffprobe, exacto)
 *
 * @param {Object} script
 * @param {number} realDuration    - duración real del audio (ffprobe)
 * @param {Array}  wordBoundaries  - [{word, start, duration}] de Edge TTS
 */
function buildSubtitleBlocks(script, realDuration, wordBoundaries) {
  const WORDS_PER_BLOCK = 3;

  // ── MODO 1: word boundaries exactos de TTS ──────────────────────────────────
  if (wordBoundaries && wordBoundaries.length >= 4) {
    logger.info(`Subtitles: EXACT mode | ${wordBoundaries.length} boundaries`);
    const blocks = [];
    for (let i = 0; i < wordBoundaries.length; i += WORDS_PER_BLOCK) {
      const slice = wordBoundaries.slice(i, i + WORDS_PER_BLOCK);
      const first = slice[0];
      const last  = slice[slice.length - 1];
      blocks.push({
        text:   slice.map(b => b.word).join(' '),
        start:  parseFloat(first.start.toFixed(3)),
        end:    parseFloat((last.start + last.duration + 0.05).toFixed(3)),
        isHook: i === 0,
      });
    }
    return blocks;
  }

  // ── MODO 2: proporcional por palabras usando duración REAL (ffprobe) ─────────
  logger.info(`Subtitles: PROPORTIONAL mode | realDuration=${realDuration.toFixed(2)}s`);
  const SECTION_KEYS = ['hook', 'claim', 'explanation', 'cta'];
  const PAUSES = { hook: 0.6, claim: 0.35, explanation: 0.35, cta: 0.0 };

  const sections = SECTION_KEYS
    .map(key => ({ key, text: (script[key] || '').trim(), pause: PAUSES[key] }))
    .filter(s => s.text);

  const totalWords = sections.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
  // Reservar ~15% del tiempo para las pausas naturales entre secciones
  const speechDuration = realDuration * 0.88;

  const blocks = [];
  let cur = 0;

  for (const s of sections) {
    const sWords = s.text.split(/\s+/);
    const sectionDur = speechDuration * (sWords.length / totalWords);
    const numBlocks  = Math.ceil(sWords.length / WORDS_PER_BLOCK);
    const blockDur   = sectionDur / numBlocks;

    for (let i = 0; i < numBlocks; i++) {
      const chunk = sWords.slice(i * WORDS_PER_BLOCK, (i + 1) * WORDS_PER_BLOCK).join(' ');
      blocks.push({
        text:   chunk,
        start:  parseFloat((cur + i * blockDur).toFixed(3)),
        end:    parseFloat((cur + (i + 1) * blockDur).toFixed(3)),
        isHook: s.key === 'hook' && i === 0,
      });
    }

    cur += sectionDur + s.pause;
  }

  return blocks;
}

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\u2019')
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/ /g, '\\ ');   // escapa espacios para evitar split en Windows
}

function findSystemFont() {
  // Windows system fonts — Impact es el estándar viral de shorts
  const candidates = [
    'C:/Windows/Fonts/impact.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', // Linux fallback
    '/System/Library/Fonts/Helvetica.ttc', // macOS fallback
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function buildDrawtextFilters(blocks, yPos = 'h*0.72') {
  const fontFile = findSystemFont();
  const FADE = 0.08; // fade más rápido = snap viral

  // En Windows, FFmpeg necesita el colon del drive letter escapado como \:
  const fontPath = fontFile
    ? fontFile.replace(/\\/g, '/').replace(/^([A-Z]):/, '$1\\:')
    : null;

  return blocks.map((block) => {
    const t = `between(t,${block.start},${block.end})`;
    const fontSize = block.isHook ? 112 : 90;
    const color    = block.isHook ? 'yellow' : 'white';

    const fontPart = fontPath
      ? `fontfile='${fontPath}':fontsize=${fontSize}`
      : `fontsize=${fontSize}`;

    // Alpha con pop: aparece de golpe (0→1 en FADE), desaparece igual de rápido.
    // NOTA: expresiones con comas deben ir entre comillas simples en FFmpeg filtergraph.
    const alphaExpr =
      `if(lt(t-${block.start},${FADE}),(t-${block.start})/${FADE},` +
      `if(gt(t,${block.end}-${FADE}),(${block.end}-t)/${FADE},1))`;

    // Hook: borde amarillo fino + sombra más fuerte para mayor impacto visual
    // Resto: borde blanco fino + sombra estándar
    const borderColor = block.isHook ? 'black' : 'black';
    const borderW     = block.isHook ? 10 : 7;
    const boxOpacity  = block.isHook ? '0.65' : '0.50';
    const boxPad      = block.isHook ? 22 : 16;

    return (
      `drawtext=${fontPart}:` +
      `text=${escapeDrawtext(block.text)}:` +
      `fontcolor=${color}:` +
      `alpha='${alphaExpr}':` +
      `shadowcolor=black@1.0:shadowx=5:shadowy=5:` +
      `bordercolor=${borderColor}:borderw=${borderW}:` +
      `x=(w-text_w)/2:y=${yPos}:` +
      `box=1:boxcolor=black@${boxOpacity}:boxborderw=${boxPad}:` +
      `enable='${t}'`
    );
  }).join(',');
}

// ─────────────────────────────────────────────
//  RENDER PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Devuelve el filtro de subtítulos a usar en FFmpeg:
 * - Si hay ASS karaoke: subtitles filter (palabras amarillas progresivas)
 * - Fallback: drawtext blocks (comportamiento anterior)
 */
function buildSubtitleFilter(assPath, drawtextFilter) {
  if (assPath && fs.existsSync(assPath)) {
    // Escapar ruta para FFmpeg filtergraph en Windows: C:\... → C\:/...
    const esc = assPath.replace(/\\/g, '/').replace(/^([A-Z]):/, '$1\\:');
    return `subtitles='${esc}'`;
  }
  return drawtextFilter;
}

function _buildScriptText(script = {}) {
  const sections = ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'];
  return sections
    .map(key => (script[key] || '').trim())
    .filter(Boolean)
    .join(' ');
}

function writeRenderMetadata(outputDir, data = {}) {
  try {
    fs.writeFileSync(path.join(outputDir, 'render-metadata.json'), JSON.stringify({
      updatedAt: new Date().toISOString(),
      ...data,
    }, null, 2));
  } catch {}
}

function readRenderMetadata(outputDir) {
  try {
    const metadataPath = path.join(outputDir, 'render-metadata.json');
    if (!fs.existsSync(metadataPath)) return null;
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    return null;
  }
}

function formatOverlayToken(value = '') {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(' ')
    .toUpperCase();
}

function buildOverlayEvents(script, renderSegments = []) {
  const phrases = [
    script.effectName,
    script.psychologicalFact,
    script.viralTrigger,
    script.emotionalTrigger,
    ...(script.keywords || []),
  ]
    .map(formatOverlayToken)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 4);

  if (phrases.length === 0 || renderSegments.length === 0) return [];

  const preferredSegments = renderSegments.filter((segment) => segment.isPunchZoom || segment.isHookSegment);
  const sourceSegments = preferredSegments.length > 0 ? preferredSegments : renderSegments;

  return sourceSegments.slice(0, phrases.length).map((segment, index) => ({
    text: phrases[index],
    start: parseFloat((segment.start + 0.08).toFixed(3)),
    end: parseFloat((Math.min(segment.start + OVERLAY_DURATION_SECONDS, segment.start + segment.duration - 0.08)).toFixed(3)),
  })).filter((event) => event.end > event.start + 0.12);
}

function buildOverlayFilter(events = []) {
  const fontFile = findSystemFont();
  const fontPath = fontFile
    ? fontFile.replace(/\\/g, '/').replace(/^([A-Z]):/, '$1\\:')
    : null;

  return events.map((event) => {
    const fontPart = fontPath
      ? `fontfile='${fontPath}':fontsize=58`
      : 'fontsize=58';
    return (
      `drawtext=${fontPart}:` +
      `text=${escapeDrawtext(event.text)}:` +
      `fontcolor=0xF3F7FFFF:` +
      `bordercolor=0x000000FF:borderw=5:` +
      `shadowcolor=black@0.95:shadowx=3:shadowy=3:` +
      `x=(w-text_w)/2:y=h*0.14:` +
      `box=1:boxcolor=black@0.42:boxborderw=20:` +
      `enable='between(t,${event.start},${event.end})'`
    );
  }).join(',');
}

function buildRenderSegments(realDuration, blocks = [], sectionDurations = null) {
  const anchors = [0];

  if (sectionDurations) {
    for (const timing of Object.values(sectionDurations)) {
      if (typeof timing?.start === 'number') anchors.push(timing.start);
    }
  }

  for (const block of blocks) {
    if (block.isHook || block.isImpact || ['reengage', 'peak'].includes(block.section)) {
      anchors.push(block.start);
    }
  }

  for (let t = TARGET_CUT_SECONDS; t < realDuration; t += TARGET_CUT_SECONDS) {
    anchors.push(t);
  }

  const sorted = [...new Set(
    anchors
      .map((value) => parseFloat(Math.max(0, Math.min(realDuration, value)).toFixed(2)))
      .filter((value) => value >= 0 && value < realDuration)
  )].sort((a, b) => a - b);

  if (sorted[sorted.length - 1] !== parseFloat(realDuration.toFixed(2))) {
    sorted.push(parseFloat(realDuration.toFixed(2)));
  }

  const segments = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    const duration = parseFloat((end - start).toFixed(2));
    if (duration < MIN_CUT_SECONDS && segments.length > 0) {
      segments[segments.length - 1].end = end;
      segments[segments.length - 1].duration = parseFloat((end - segments[segments.length - 1].start).toFixed(2));
      continue;
    }
    if (duration > MAX_CUT_SECONDS) {
      const cuts = Math.ceil(duration / TARGET_CUT_SECONDS);
      const subDuration = duration / cuts;
      for (let j = 0; j < cuts; j++) {
        const subStart = parseFloat((start + subDuration * j).toFixed(2));
        const subEnd = parseFloat((Math.min(end, start + subDuration * (j + 1))).toFixed(2));
        segments.push({ start: subStart, end: subEnd, duration: parseFloat((subEnd - subStart).toFixed(2)) });
      }
      continue;
    }
    segments.push({ start, end, duration });
  }

  return segments.map((segment, index) => {
    const matchingBlock = blocks.find((block) => block.start <= segment.start + 0.2 && block.end >= segment.start);
    const section = matchingBlock?.section || 'claim';
    return {
      ...segment,
      section,
      clipOffset: parseFloat(((index * 1.35) % 6).toFixed(2)),
      isHookSegment: matchingBlock?.isHook === true || section === 'hook',
      isPunchZoom: matchingBlock?.isImpact === true || ['hook', 'reengage', 'peak'].includes(section),
    };
  });
}

async function renderVideo({ script, audioPath, audioDuration, outputPath, themeId, wordBoundaries, sectionDurations, bgStyle, forceCaptionSync = false }) {
  const theme = themes.themes.find((t) => t.id === themeId) || themes.themes[0];
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const perf = createPerfTracker('video-render', { outputPath, topic: script.topic || null });

  // 1. Duración del audio (usar estimación si ffprobe falla o devuelve valores absurdos)
  perf.start('audio_probe');
  let realDuration = audioDuration;
  try {
    const probedDuration = await getRealAudioDuration(audioPath);
    // Sanity check: si ffprobe devuelve > 2x la estimación, probablemente el WAV tiene headers corruptos
    if (probedDuration > 0 && probedDuration <= audioDuration * 2) {
      realDuration = probedDuration;
    } else {
      logger.warn(`Audio ffprobe returned ${probedDuration.toFixed(2)}s (estimated ${audioDuration}s) — using estimate`);
    }
  } catch (err) {
    logger.warn(`Audio probe failed: ${err.message} — using estimated duration ${audioDuration}s`);
  }
  const probePhase = perf.end({ realDuration });
  logger.info(`Audio duration: ${realDuration.toFixed(2)}s (estimated was ${audioDuration}s)`);
  logger.info(`Render phase audio_probe done in ${formatDurationMs(probePhase.durationMs)}`);

  // 1.5. Detectar segmentos de voz reales usando silencedetect
  let voiceSegments = [];
  let subtitleTimingMode = 'estimated_fallback';
  try {
    perf.start('voice_segment_detection');
    voiceSegments = await detectVoiceSegments(audioPath, outputDir, { noiseThreshold: -35, minDuration: 0.15 });
    const detectionPhase = perf.end({ segmentCount: voiceSegments.length });
    if (voiceSegments.length > 0) {
      subtitleTimingMode = 'audio_detected';
      logger.info(`Voice segments detected: ${voiceSegments.length} regions | phase done in ${formatDurationMs(detectionPhase.durationMs)}`);
    } else {
      logger.warn(`Voice segment detection returned empty, using estimated fallback`);
    }
  } catch (detErr) {
    logger.warn(`Voice segment detection failed: ${detErr.message} — using estimated fallback`);
  }

  // 2. Descarga clips en paralelo: single-focus, sin split-screen
  perf.start('background_fetch');
  let bgVideos = await getPexelsVideos(script, bgStyle);
  if (bgVideos.length === 0) {
    const previousRender = readRenderMetadata(outputDir);
    const reusableClipPaths = (previousRender?.clipPaths || []).filter((clipPath) => fs.existsSync(clipPath));
    if (reusableClipPaths.length > 0) {
      bgVideos = [...new Set(reusableClipPaths)];
      logger.info(`Render: reusing ${bgVideos.length} previous clipPaths from render-metadata.json`);
    }
  }
  const bgPhase = perf.end({ clipCount: bgVideos.length });
  logger.info(`Render phase background_fetch done in ${formatDurationMs(bgPhase.durationMs)} | clips=${bgVideos.length}`);
  writeRenderMetadata(outputDir, {
    requestedVisualMode: 'single_focus_pexels',
    fetchedClipCount: bgVideos.length,
    clipPaths: bgVideos,
    subtitleSafeY: SUBTITLE_Y,
    assSubtitleY: ASS_SUBTITLE_Y,
    subtitleTimingMode,
    voiceSegmentsDetected: voiceSegments.length,
    renderWarnings: [],
  });

  // 3. Música de fondo
  const musicDir = path.resolve('./assets/music');
  let musicPath = null;
  if (fs.existsSync(musicDir)) {
    const tracks = fs.readdirSync(musicDir).filter((f) => /\.(mp3|wav|aac)$/i.test(f));
    if (tracks.length) musicPath = path.join(musicDir, tracks[Math.floor(Math.random() * tracks.length)]);
  }

  // 4. Logo watermark
  const logoPath = path.resolve('./assets/logo_dato_psicologico.png');
  const hasLogo = fs.existsSync(logoPath);

  // Enriquecer sectionDurations con voiceSegments detectados si está disponible
  let enrichedSectionDurations = sectionDurations;
  if (voiceSegments.length > 0 && sectionDurations) {
    enrichedSectionDurations = _enrichSectionDurationsWithVoiceSegments(sectionDurations, voiceSegments);
  }

  // PRO: Alinear word-level timestamps desde Whisper (máxima precisión)
  perf.start('word_timestamp_align');
  let wordTimestamps = [];
  let wordAlignmentEngine = 'none';
  let wordTimestampWarnings = [];
  try {
    const alignment = await alignWordTimestamps(audioPath, _buildScriptText(script), voiceSegments);
    wordTimestamps = alignment.words || [];
    wordAlignmentEngine = alignment.engine;
    wordTimestampWarnings = alignment.warnings || [];
    if (wordTimestamps.length > 0) {
      logger.info(`Word timestamps: ${wordTimestamps.length} words | engine=${wordAlignmentEngine}`);
    } else {
      logger.info(`Word timestamps: no timestamps available | engine=${wordAlignmentEngine}`);
    }
  } catch (err) {
    logger.warn(`Word timestamp alignment failed: ${err.message}`);
    wordTimestampWarnings.push('alignment_failed');
  }
  const wordAlignPhase = perf.end();

  // ═════════════════════════════════════════════════════════════
  // CAPTION_SYNC — corrección de drift cuando Whisper no disponible
  // Construye captions basados en audio final real (voice_proc.mp3)
  // ═════════════════════════════════════════════════════════════
  let syncedCaptions = null;
  const whisperActive = !forceCaptionSync && wordTimestamps.length >= 10;

  try {
    perf.start('caption_sync');
    const { buildCaptionsFromFinalAudio } = require('../utils/caption-sync');
    const { getScriptSections } = require('../utils/script-segments');

    syncedCaptions = await buildCaptionsFromFinalAudio({
      finalAudioPath: audioPath,
      scriptSegments: getScriptSections(script),
      videoId: script.videoId || script.id || path.basename(outputDir),
      outputDir,
    });

    perf.end({
      captionCount: syncedCaptions.length,
      source: syncedCaptions[0]?.source || 'unknown',
      forced: forceCaptionSync,
    });

    logger.info(`CaptionSync: ${syncedCaptions.length} captions generated | source=${syncedCaptions[0]?.source}${forceCaptionSync ? ' | forced=true' : ''}`);
  } catch (err) {
    logger.warn(`CaptionSync: ${err.message} — fallback to existing subtitle system`);
    syncedCaptions = null;
  }

  if (!whisperActive && !syncedCaptions) {
    try {
      fs.unlinkSync(path.join(outputDir, 'captions-debug.json'));
    } catch (err) {
      void err;
    }
  }

  // Construir bloques de subtítulo (fallback drawtext si no hay karaoke)
  perf.start('subtitle_build');
  let blocks;
  let subtitleMode = 'PROPORTIONAL';

  // ÁRBOL DE DECISIÓN DE SUBTÍTULOS
  if (whisperActive) {
    // 1. Whisper disponible — timing perfecto desde timestamps de palabras
    subtitleMode = 'WORD_TIMESTAMPS';
    subtitleTimingMode = 'word_timestamps';
    blocks = buildStyledSubtitleBlocks(script, realDuration, wordBoundaries || [], enrichedSectionDurations || null, wordTimestamps);
  } else if (syncedCaptions && syncedCaptions.length > 0) {
    // 2. NUEVO: Caption-sync disponible — timing basado en audio final real
    subtitleMode = 'CAPTION_SYNC';
    subtitleTimingMode = syncedCaptions[0].source === 'final-audio-speech-segment'
      ? 'caption_sync_speech' // silencedetect sobre audio real
      : 'caption_sync_fallback'; // distribución uniforme fallback
    blocks = _captionsToStyledBlocks(syncedCaptions, script);
  } else if ((wordBoundaries || []).length >= 4) {
    // 3. Edge TTS con word boundaries — karaoke mode
    subtitleMode = 'KARAOKE';
    subtitleTimingMode = 'word_boundaries';
    blocks = buildStyledSubtitleBlocks(script, realDuration, wordBoundaries || [], enrichedSectionDurations || null, wordTimestamps);
  } else {
    // 4. Fallback: Kokoro sin Whisper, sin caption-sync
    if (enrichedSectionDurations) {
      subtitleMode = 'SEGMENTED';
    }
    blocks = buildStyledSubtitleBlocks(script, realDuration, wordBoundaries || [], enrichedSectionDurations || null, wordTimestamps);
  }

  const renderSegments = buildRenderSegments(realDuration, blocks, sectionDurations || null);
  const overlayEvents = buildOverlayEvents(script, renderSegments);
  logger.info(`Subtitles: ${blocks.length} blocks | mode=${subtitleMode}`);

  // Guardar SRT
  try {
    fs.writeFileSync(path.join(outputDir, 'subtitles.srt'), buildSRTContent(blocks), 'utf8');
  } catch {}

  // Generar ASS: karaoke si hay word boundaries (Edge TTS), styled si no (Kokoro)
  let assPath = null;
  const assFilePath = path.join(outputDir, 'subtitles.ass');
  if ((wordBoundaries || []).length >= 4) {
    try {
      buildKaraokeASSFile(wordBoundaries, assFilePath, ASS_SUBTITLE_Y);
      assPath = assFilePath;
      logger.info(`Karaoke ASS: generated | ${wordBoundaries.length} words | y=${ASS_SUBTITLE_Y}`);
    } catch (assErr) {
      logger.warn(`Karaoke ASS failed: ${assErr.message} — trying styled ASS`);
    }
  }
  if (!assPath && blocks.length > 0) {
    try {
      buildStyledASSFile(blocks, assFilePath, ASS_SUBTITLE_Y);
      assPath = assFilePath;
      logger.info(`Styled ASS: generated | ${blocks.length} blocks | mode=${subtitleMode}`);
    } catch (assErr) {
      logger.warn(`Styled ASS failed: ${assErr.message} — using drawtext fallback`);
    }
  }
  const subtitlePhase = perf.end({ subtitleMode, blocks: blocks.length, hasAss: Boolean(assPath) });
  logger.info(`Render phase subtitle_build done in ${formatDurationMs(subtitlePhase.durationMs)} | mode=${subtitleMode}`);

  const overlayFilter = buildOverlayFilter(overlayEvents);
  const drawtextFilterFull = buildStyledDrawtextFilters(blocks, SUBTITLE_Y, theme);
  const subtitleFilterFull = [buildSubtitleFilter(assPath, drawtextFilterFull), overlayFilter].filter(Boolean).join(',');
  const clipInfo = bgVideos.length > 0 ? `${bgVideos.length} clips single-focus` : 'gradient';
  logger.info(`Rendering | Theme: ${theme.name} | Background: ${clipInfo} | Subtitles: ${subtitleMode} | VisualStyle=${REFERENCE_VISUAL_STYLE.emotion}`);

  // ═══════════════════════════════════════════════════════════════
  // ASSET VALIDATION — ANTES DE FFMPEG
  // Valida que TODOS los clips existen. Si falta alguno:
  // 1. Intenta redownloadear
  // 2. Si no va, reemplaza con asset local válido
  // 3. Si no hay válido, BLOQUEA render (no permite color=black)
  // ═══════════════════════════════════════════════════════════════
  if (bgVideos.length > 0) {
    const validatedClips = await validateAndFixAssets(bgVideos, script, outputDir, script.videoId);
    if (!validatedClips || validatedClips.length === 0) {
      logger.error(`RENDER_BLOCKED_MISSING_VISUAL_ASSET videoId=${script.videoId} | No valid visual assets available. Cannot render Pexels video.`);
      throw new Error('RENDER_BLOCKED_MISSING_VISUAL_ASSET');
    }
    if (validatedClips.length !== bgVideos.length) {
      logger.warn(`ASSET_COUNT_CHANGED original=${bgVideos.length} validated=${validatedClips.length}`);
    }
    bgVideos = validatedClips;
  }

  if (bgVideos.length > 0) {
    try {
      perf.start('ffmpeg_render');
      const result = await renderWithPexelsBg({ bgVideos, audioPath, musicPath, realDuration, renderSegments, subtitleFilter: subtitleFilterFull, outputPath, theme, logoPath: hasLogo ? logoPath : null });
      const renderPhase = perf.end({ mode: 'video_use' });
      writeRenderMetadata(outputDir, {
        videoUseStyle: VIDEO_USE_SKILL.id,
        requestedVisualMode: 'single_focus_pexels',
        fetchedClipCount: bgVideos.length,
        clipPaths: bgVideos,
        renderMode: 'video_use',
        usedGradientFallback: false,
        visibleVisuals: bgVideos.length > 0,
        hasSubtitles: blocks.length > 0,
        duration: parseFloat(realDuration.toFixed(2)),
        segmentsUsed: renderSegments.length,
        overlayEvents: overlayEvents.length,
        subtitleSafeY: SUBTITLE_Y,
        assSubtitleY: ASS_SUBTITLE_Y,
        subtitleTimingMode,
        voiceSegmentsDetected: voiceSegments.length,
        wordTimestampsCount: wordTimestamps.length,
        wordAlignmentEngine: wordAlignmentEngine,
        subtitleBlocksCount: blocks.length,
        alignmentWarnings: wordTimestampWarnings,
        renderWarnings: [],
      });
      logger.info(`Render phase ffmpeg_render done in ${formatDurationMs(renderPhase.durationMs)} | total=${formatDurationMs(perf.snapshot().totalMs)}`);
      return result;
    } catch (pexelsErr) {
      // CRÍTICO: Si assets están bloqueados, no permitir fallback a gradient
      if (pexelsErr.message?.includes('RENDER_BLOCKED_MISSING_VISUAL_ASSET')) {
        logger.error(`RENDER_BLOCKED_MISSING_VISUAL_ASSET videoId=${script.videoId} — No fallback allowed. Assets are required but missing and unreplaceable.`);
        throw new Error('RENDER_BLOCKED_MISSING_VISUAL_ASSET');
      }

      perf.fail(pexelsErr, { mode: 'pexels' });
      logger.warn(`Pexels render failed (${pexelsErr.message.slice(0, 80)}) — falling back to gradient`);
      writeRenderMetadata(outputDir, {
        videoUseStyle: VIDEO_USE_SKILL.id,
        requestedVisualMode: 'single_focus_pexels',
        fetchedClipCount: bgVideos.length,
        clipPaths: bgVideos,
        renderMode: 'video_use',
        usedGradientFallback: true,
        visibleVisuals: false,
        subtitleSafeY: SUBTITLE_Y,
        assSubtitleY: ASS_SUBTITLE_Y,
        subtitleTimingMode,
        voiceSegmentsDetected: voiceSegments.length,
        wordTimestampsCount: wordTimestamps.length,
        wordAlignmentEngine: wordAlignmentEngine,
        subtitleBlocksCount: blocks.length,
        alignmentWarnings: wordTimestampWarnings,
        renderWarnings: [`pexels_render_failed:${pexelsErr.message.slice(0, 160)}`],
      });
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
  }

  // 5b. Último fallback: gradiente animado (sin subtítulos para evitar timeout)
  perf.start('ffmpeg_render');
  const result = await renderWithGradientBg({ audioPath, musicPath, realDuration, subtitleFilter: '', outputPath, theme, logoPath: hasLogo ? logoPath : null });
  const renderPhase = perf.end({ mode: 'gradient' });
  writeRenderMetadata(outputDir, {
    videoUseStyle: VIDEO_USE_SKILL.id,
    requestedVisualMode: 'single_focus_pexels',
    fetchedClipCount: bgVideos.length,
    clipPaths: bgVideos,
    renderMode: 'video_use',
    usedGradientFallback: true,
    visibleVisuals: false,
    hasSubtitles: blocks.length > 0,
    duration: parseFloat(realDuration.toFixed(2)),
    segmentsUsed: renderSegments.length,
    overlayEvents: overlayEvents.length,
    subtitleSafeY: SUBTITLE_Y,
    assSubtitleY: ASS_SUBTITLE_Y,
    subtitleTimingMode,
    voiceSegmentsDetected: voiceSegments.length,
    wordTimestampsCount: wordTimestamps.length,
    wordAlignmentEngine: wordAlignmentEngine,
    subtitleBlocksCount: blocks.length,
    alignmentWarnings: wordTimestampWarnings,
    renderWarnings: bgVideos.length > 0 ? ['gradient_fallback_after_pexels_failure'] : ['no_pexels_assets_available'],
  });
  logger.info(`Render phase ffmpeg_render done in ${formatDurationMs(renderPhase.durationMs)} | total=${formatDurationMs(perf.snapshot().totalMs)}`);

  // 6. EXPORT: Exportar vídeo para revisión manual
  try {
    const metadata = {
      videoId: script.videoId || 'unknown',
      hook: script.hook || '',
      topic: script.topic || '',
      emotionalTrigger: script.emotionalTrigger || 'validation',
      viralTrigger: script.viralTrigger || 'identificacion',
      fullScript: [script.hook, script.open_loop, script.micro_value, script.escalation, script.reengage, script.peak, script.open_ending, script.soft_cta].filter(Boolean).join(' '),
      duration: parseFloat(realDuration.toFixed(2)),
      viralityScore: script.viralityScore || 0,
      formatScore: script.formatScore || 0,
      emotionalImpactScore: script.emotionalImpactScore || 0,
      createdAt: new Date().toISOString(),
      renderMode: 'video_use',
      subtitleTimingMode: subtitleTimingMode,
      wordAlignmentEngine: wordAlignmentEngine,
      segmentsUsed: renderSegments.length,
      qcPass: true, // Si llegó aquí, pasó QC
    };

    const exportResult = await exportVideo(result, metadata);
    if (exportResult) {
      logger.info(`Export: video saved to ${exportResult.filename} in exports/${new Date().toISOString().split('T')[0]}`);
    } else {
      logger.warn('Export: video does not meet export criteria (whisper/word_timestamps required)');
    }
  } catch (exportErr) {
    logger.error(`Export: failed to export video - ${exportErr.message}`);
  }

  // 🎬 RENDER COMPLETE — Abrir carpeta automáticamente
  if (result && fs.existsSync(outputPath)) {
    await _openOutputFolder(outputPath);
  }

  return result;
}

// ─── Con vídeo(s) de Pexels — pipeline cinematográfico ───────────────────────
//
// Con 2 clips: concatena con corte directo en el 45% del video.
// Color grade: eq (contraste + saturación) + vignette para look cinematográfico.
// Sustitución de colorchannelmixer plano por grade real.

function renderWithPexelsBg({ bgVideos, audioPath, musicPath, realDuration, renderSegments, subtitleFilter, outputPath, theme, logoPath }) {
  return new Promise((resolve, reject) => {
    // Windows has 32KB command line limit. For complex renders with many segments,
    // we need to bypass fluent-ffmpeg entirely and use concatdemux.
    // Fallback to gradient to avoid ENAMETOOLONG errors
    try {
      const tmpDir = path.join(path.dirname(outputPath), '.tmp');
      fs.mkdirSync(tmpDir, { recursive: true });

      // Create concat demuxer file for input videos
      const segments = Array.isArray(renderSegments) && renderSegments.length > 0
        ? renderSegments
        : buildRenderSegments(realDuration, [], null);

      // For segments > 1 with complex filters, Windows often hits the 32KB limit.
      // Solution: use most impactful segment (isPunchZoom > isHookSegment > first)
      let selectedSegment = segments[0];
      if (segments.length > 1) {
        const punchZoomSegment = segments.find(s => s.isPunchZoom);
        const hookSegment = segments.find(s => s.isHookSegment);
        selectedSegment = punchZoomSegment || hookSegment || segments[0];
        logger.info(`Pexels multi-segment: ${segments.length} segments → using selected (isPunch=${selectedSegment.isPunchZoom}, isHook=${selectedSegment.isHookSegment})`);
      }

      // Single effective segment - can proceed
      let cmd = ffmpeg();
      const clipPath = bgVideos[0];
      const clipOffset = Math.max(0, selectedSegment.clipOffset || 0);
      cmd = cmd.input(clipPath).inputOptions(['-stream_loop -1', `-t ${Math.max(selectedSegment.duration + clipOffset + 0.4, 1.4)}`, '-vsync cfr']);

      cmd = cmd.input(audioPath);
      const hasMusic = musicPath && fs.existsSync(musicPath);
      if (hasMusic) cmd = cmd.input(musicPath);
      if (logoPath) cmd = cmd.input(logoPath);
      const logoIdx = (hasMusic ? 3 : 2);
      const musicIdx = 2;
      const audioIdx = 1;

      const segment = selectedSegment;
      const segDur = segment.duration;
      const segStart = segment.start;
      const hitsReengage = segStart <= REENGAGE_TARGET_SECOND && (segStart + segDur) >= REENGAGE_TARGET_SECOND;
      const baseBoost = segment.isPunchZoom ? 140 : segment.isHookSegment ? 90 : 0;
      const scaledW = hitsReengage ? W + 320 : W + 220 + baseBoost;
      const scaledH = hitsReengage ? H + 420 : H + 320 + baseBoost;
      const panX = hitsReengage ? 26 : segment.isPunchZoom ? 22 : 14;
      const panY = hitsReengage ? 18 : segment.isPunchZoom ? 14 : 8;

      let videoFilter =
        `[0:v]trim=start=${clipOffset}:duration=${segDur},setpts=PTS-STARTPTS,` +
        `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H}:` +
        `x='max(0,min(iw-${W},(iw-${W})/2+${panX}*sin(2*PI*t/${Math.max(segDur, 1.2)})))':` +
        `y='max(0,min(ih-${H},(ih-${H})/2+${panY}*cos(2*PI*t/${Math.max(segDur, 1.2)})))',` +
        `fps=30,format=yuv420p,setsar=1[v0];` +
        `[v0]eq=contrast=1.24:brightness=-0.01:saturation=1.10:gamma=0.96[graded];` +
        `[graded]vignette='PI/4'[vig];`;

      if (logoPath) {
        videoFilter +=
          `[${logoIdx}:v]scale=180:-1,format=rgba,colorchannelmixer=aa=0.7[wm];` +
          `[vig][wm]overlay=W-w-24:24[branded];`;
        videoFilter += subtitleFilter ? `[branded]${subtitleFilter}[vout]` : `[branded]setsar=1[vout]`;
      } else {
        videoFilter += subtitleFilter ? `[vig]${subtitleFilter}[vout]` : `[vig]setsar=1[vout]`;
      }

      let fullFilter = videoFilter;
      if (hasMusic) {
        fullFilter +=
          `;[${musicIdx}:a]volume=0.15,` +
          `afade=t=in:st=0:d=1,` +
          `afade=t=out:st=${Math.max(0, realDuration - 2)}:d=2[music];` +
          `[${audioIdx}:a][music]amix=inputs=2:duration=first:normalize=0[aout]`;
      }

      cmd
        .complexFilter(fullFilter)
        .outputOptions([
          '-map [vout]',
          hasMusic ? '-map [aout]' : `-map ${audioIdx}:a`,
          '-c:v libx264', `-profile:v high`, `-level 4.0`,
          `-preset ${RENDER_PRESET}`, `-crf ${RENDER_CRF}`,
          '-pix_fmt yuv420p', '-r 30',
          '-c:a aac', '-b:a 192k', '-ar 44100',
          '-shortest', '-movflags +faststart',
        ])
        .output(outputPath)
        .on('start', (c) => logger.debug(`FFmpeg: ${c.slice(0, 100)}...`))
        .on('progress', (p) => p.percent && logger.debug(`FFmpeg: ${p.percent.toFixed(0)}%`))
        .on('end', () => { logger.info(`Video rendered (single-focus): ${outputPath}`); resolve(outputPath); })
        .on('error', (err, _s, stderr) => {
          logger.error(`FFmpeg error: ${err.message}`);
          if (stderr) logger.error(stderr.slice(-800));
          reject(err);
        })
        .run();
    } catch (err) {
      if (err.message === 'MULTI_SEGMENT_FALLBACK') {
        reject(new Error('RENDER_FALLBACK_GRADIENT'));
      } else {
        reject(err);
      }
    }
  });
}

// ─── Split screen (formato viral) — top: psicología, bottom: satisfying ──────
//
// Layout: 1080×1100 (top, 57%) + 1080×820 (bottom, 43%) = 1080×1920
// Top clip: stock footage de psicología con audio y color grade
// Bottom clip: satisfying content sin audio, en bucle
// Subtítulos: dentro de la mitad superior (y ≈ 825px)

function renderWithSplitScreen({ topClip, botClip, audioPath, musicPath, realDuration, subtitleFilter, outputPath, theme, logoPath }) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg();

    // Input 0: clip de psicología (parte superior), en bucle
    cmd = cmd.input(topClip).inputOptions(['-stream_loop -1', `-t ${realDuration}`, '-vsync cfr']);
    // Input 1: satisfying content (parte inferior), en bucle — solo vídeo, sin audio
    cmd = cmd.input(botClip).inputOptions(['-stream_loop -1', `-t ${realDuration}`, '-vsync cfr']);

    const audioIdx = 2;
    cmd = cmd.input(audioPath);
    const hasMusic = musicPath && fs.existsSync(musicPath);
    if (hasMusic) cmd = cmd.input(musicPath);
    if (logoPath) cmd = cmd.input(logoPath);
    const musicIdx = audioIdx + 1;
    const logoIdx  = audioIdx + (hasMusic ? 2 : 1);

    // Pipeline:
    // 1. Scale top clip ligeramente más grande → lento paneo sinusoidal (movimiento constante)
    // 2. Scale + crop bot clip a 1080×H_BOT
    // 3. vstack → 1080×1920
    // 4. Color grade global + vignette
    // 5. Logo (opcional)
    // 6. Subtítulos (posicionados en mitad superior)
    const topW = W + 40;
    const topH = H_TOP + 40;
    let videoFilter =
      `[0:v]scale=${topW}:${topH}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H_TOP}:x='(iw-${W})/2+20*sin(PI*t/15)':y='(ih-${H_TOP})/2',fps=30[top];` +
      `[1:v]scale=${W}:${H_BOT}:force_original_aspect_ratio=increase,crop=${W}:${H_BOT},fps=30[bot];` +
      `[top][bot]vstack=inputs=2[stacked];` +
      `[stacked]eq=contrast=1.25:brightness=0.02:saturation=1.5:gamma=1.08[graded];` +
      `[graded]vignette='PI/4'[vig];`;

    if (logoPath) {
      videoFilter +=
        `[${logoIdx}:v]scale=180:-1,format=rgba,colorchannelmixer=aa=0.7[wm];` +
        `[vig][wm]overlay=W-w-24:24[branded];`;
      videoFilter += subtitleFilter ? `[branded]${subtitleFilter}[vout]` : `[branded]setsar=1[vout]`;
    } else {
      videoFilter += subtitleFilter ? `[vig]${subtitleFilter}[vout]` : `[vig]setsar=1[vout]`;
    }

    let audioFilter = '';
    if (hasMusic) {
      audioFilter =
        `;[${musicIdx}:a]volume=0.15,` +
        `afade=t=in:st=0:d=1,` +
        `afade=t=out:st=${Math.max(0, realDuration - 2)}:d=2[music];` +
        `[${audioIdx}:a][music]amix=inputs=2:duration=first:normalize=0[aout]`;
    }

    cmd
      .complexFilter(videoFilter + audioFilter)
      .outputOptions([
        '-map [vout]',
        hasMusic ? '-map [aout]' : `-map ${audioIdx}:a`,
        '-c:v libx264', `-profile:v high`, `-level 4.0`,
        '-preset fast', '-crf 22',
        '-pix_fmt yuv420p', '-r 30',
        '-c:a aac', '-b:a 192k', '-ar 44100',
        '-shortest', '-movflags +faststart',
      ])
      .output(outputPath)
      .on('start', (c) => logger.debug(`FFmpeg: ${c.slice(0, 100)}...`))
      .on('progress', (p) => p.percent && logger.debug(`FFmpeg: ${p.percent.toFixed(0)}%`))
      .on('end', () => { logger.info(`Video rendered (split-screen): ${outputPath}`); resolve(outputPath); })
      .on('error', (err, _s, stderr) => {
        logger.error(`FFmpeg split error: ${err.message}`);
        if (stderr) logger.error(stderr.slice(-800));
        reject(err);
      })
      .run();
  });
}

// ─── Con fondo animado (sin Pexels) ──────────────────────────────────────────

function renderWithGradientBg({ audioPath, musicPath, realDuration, subtitleFilter, outputPath, theme, logoPath }) {
  return new Promise((resolve, reject) => {
    // CRITICAL: Ensure theme is safe (never null, never dark colors)
    const safeTheme = getSafeTheme(theme);
    const c1 = hexToRgb(safeTheme.background.colors[0]);
    const bgColor = `#${c1.r.toString(16).padStart(2, '0')}${c1.g.toString(16).padStart(2, '0')}${c1.b.toString(16).padStart(2, '0')}`;

    const hasMusic = musicPath && fs.existsSync(musicPath);
    let cmd = ffmpeg();

    // CRITICAL FIX: Use duration in lavfi source to ensure proper video generation
    cmd = cmd
      .input(`color=c=${bgColor}:s=${W}x${H}:r=30:d=${realDuration}`)
      .inputFormat('lavfi');
    cmd = cmd.input(audioPath);
    if (hasMusic) cmd = cmd.input(musicPath);
    if (logoPath) cmd = cmd.input(logoPath);
    const logoIdx = hasMusic ? 3 : 2;
    const audioIdx = 1;

    // Filtergraph: vignette + subtitles (if present)
    let videoFilter = `[0:v]vignette='PI/4',format=yuv420p[vig];`;

    if (logoPath) {
      videoFilter +=
        `[${logoIdx}:v]scale=180:-1,format=rgba,colorchannelmixer=aa=0.7[wm];` +
        `[vig][wm]overlay=W-w-24:24[branded];`;
      videoFilter += subtitleFilter ? `[branded]${subtitleFilter}[vout]` : `[branded]setsar=1[vout]`;
    } else {
      videoFilter += subtitleFilter ? `[vig]${subtitleFilter}[vout]` : `[vig]setsar=1[vout]`;
    }

    let audioFilter = '';
    if (hasMusic) {
      audioFilter =
        `;[2:a]volume=0.15,` +
        `afade=t=in:st=0:d=1,` +
        `afade=t=out:st=${Math.max(0, realDuration - 2)}:d=2[music];` +
        `[${audioIdx}:a][music]amix=inputs=2:duration=first:normalize=0[aout]`;
    }

    cmd
      .complexFilter(videoFilter + audioFilter)
      .outputOptions([
        '-map [vout]',
        hasMusic ? '-map [aout]' : `-map ${audioIdx}:a`,
        '-c:v libx264', `-profile:v high`, `-level 4.0`,
        `-preset ${RENDER_PRESET}`, `-crf ${RENDER_CRF}`,
        '-pix_fmt yuv420p', '-r 30',
        '-c:a aac', '-b:a 192k', '-ar 44100',
        '-shortest', // Sync with shortest stream
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('start', (c) => logger.debug(`FFmpeg: ${c.slice(0, 100)}...`))
      .on('progress', (p) => p.percent && logger.debug(`FFmpeg: ${p.percent.toFixed(0)}%`))
      .on('end', () => { logger.info(`Video rendered: ${outputPath}`); resolve(outputPath); })
      .on('error', (err, _s, stderr) => {
        logger.error(`FFmpeg error: ${err.message}`);
        if (stderr) logger.error(stderr.slice(-800));
        reject(err);
      })
      .run();
  });
}

function calculateLuminance(hex) {
  const color = hexToRgb(hex);
  // Relative luminance formula (WCAG)
  const [r, g, b] = [color.r, color.g, color.b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getSafeTheme(theme) {
  // Si theme es null/undefined o background está vacío, crear tema seguro
  if (!theme || !theme.background || !theme.background.colors || theme.background.colors.length === 0) {
    logger.info('RENDER_GRADIENT_SAFE_THEME_USED=true | reason=theme_missing');
    return {
      name: 'fallback_safe',
      background: {
        colors: ['#1a3a4a'], // visible dark blue-gray
      },
    };
  }

  const originalColor = theme.background.colors[0];
  const luminance = calculateLuminance(originalColor);

  // Si color es muy oscuro (< 0.25 luminancia), reemplazar
  if (luminance < 0.25) {
    logger.warn(`DARK_FALLBACK_COLOR_REPLACED oldColor=${originalColor} newColor=#1a3a4a | luminance=${luminance.toFixed(3)}`);
    return {
      ...theme,
      background: {
        ...theme.background,
        colors: ['#1a3a4a'],
      },
    };
  }

  return theme;
}

function hexToRgb(hex) {
  const n = parseInt((hex || '#1a3a4a').replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

async function _openOutputFolder(outputPath) {
  /**
   * Abre la carpeta del vídeo en el explorador.
   * Windows: start explorer <folder>
   * macOS: open <folder>
   * Linux: xdg-open <folder>
   */
  try {
    const { execSync } = require('child_process');
    const folderPath = path.dirname(outputPath);

    if (!fs.existsSync(folderPath)) {
      logger.warn(`Output folder not found: ${folderPath}`);
      return;
    }

    const platform = process.platform;
    if (platform === 'win32') {
      execSync(`start explorer "${folderPath}"`, { stdio: 'ignore' });
    } else if (platform === 'darwin') {
      execSync(`open "${folderPath}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${folderPath}"`, { stdio: 'ignore' });
    }

    logger.info(`RENDER_COMPLETE_FOLDER_OPENED videoId=${path.basename(folderPath)}`);
  } catch (err) {
    logger.warn(`Failed to open output folder: ${err.message}`);
  }
}

module.exports = { renderVideo, getRealAudioDuration };
