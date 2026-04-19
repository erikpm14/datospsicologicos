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
const { buildStyledSubtitleBlocks, buildStyledDrawtextFilters, buildSRTContent } = require('./subtitle-styler');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const themes = require('../templates/visual-themes.json');
const W = 1080;
const H = 1920;

// Carpeta de caché para vídeos de Pexels descargados
const CACHE_DIR = path.resolve('./assets/stock-footage');

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

// Split screen layout (formato viral 2025-2026)
const H_TOP = 1100; // parte superior: contenido psicología (57%)
const H_BOT = 820;  // parte inferior: satisfying content (43%)
// H_TOP + H_BOT = 1920 = H

// Queries para la parte inferior satisfying — máxima retención
const SATISFYING_QUERIES = [
  'carpet cleaning satisfying asmr',
  'pressure washing cleaning satisfying',
  'kinetic sand cutting asmr close up',
  'soap cutting satisfying asmr',
  'power washing floor satisfying',
  'sand art drawing satisfying',
  'clay sculpting satisfying close up',
  'woodworking crafting satisfying',
  'cleaning dirty surface satisfying',
  'ice scraping satisfying asmr',
  'slime pressing satisfying close up',
  'tile grouting cleaning satisfying',
];

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

  // 1. Efecto psicológico conocido → queries específicas
  for (const [key, queries] of Object.entries(EFFECT_QUERIES)) {
    if (effect.includes(key)) {
      logger.info(`Pexels V2: effect match → "${key}"`);
      return queries;
    }
  }

  // 2. Hook wording → mapeo semántico directo
  const hookMatch = HOOK_VISUAL_MAP.find(m => m.pattern.test(hook));
  if (hookMatch) {
    const emotionalQuery = EMOTIONAL_VISUAL_QUERIES[eTrig]?.[0] || null;
    const q2 = emotionalQuery || (TOPIC_QUERIES[topic] ? TOPIC_QUERIES[topic][Math.floor(Math.random() * TOPIC_QUERIES[topic].length)] : 'human behavior psychology');
    logger.info(`Pexels V2: hook-match → "${hookMatch.query}" | "${q2}"`);
    return [hookMatch.query, q2];
  }

  // 3. Emotional trigger → escena visual específica
  const emotionalScenes = EMOTIONAL_VISUAL_QUERIES[eTrig];
  if (emotionalScenes) {
    const topicOpts = TOPIC_QUERIES[topic];
    const q2 = Array.isArray(topicOpts) ? topicOpts[Math.floor(Math.random() * topicOpts.length)] : 'psychology human behavior';
    logger.info(`Pexels V2: emotional → "${emotionalScenes[0]}" | "${q2}"`);
    return [emotionalScenes[0], q2];
  }

  // 4. Keywords del guión (como antes, pero más selectivo)
  const keywords = (script.keywords || [])
    .map(k => k.trim().split(/\s+/).slice(0, 2).join(' '))
    .filter(Boolean);
  if (keywords.length >= 2) return [keywords[0], keywords[1]];
  if (keywords.length === 1) {
    const topicFallback = Array.isArray(TOPIC_QUERIES[topic])
      ? TOPIC_QUERIES[topic][Math.floor(Math.random() * TOPIC_QUERIES[topic].length)]
      : 'psychology mind brain';
    return [keywords[0], topicFallback];
  }

  // 5. Topic fallback
  const topicOptions = TOPIC_QUERIES[topic];
  if (Array.isArray(topicOptions) && topicOptions.length >= 2) {
    const shuffled = [...topicOptions].sort(() => Math.random() - 0.5);
    return [shuffled[0], shuffled[1]];
  }

  return ['psychology brain mind', 'human behavior emotion person'];
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

  try {
    logger.info(`Fetching Pexels video | query: "${query}" | page: ${page}`);
    const res = await axios.get('https://api.pexels.com/videos/search', {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      params: { query, per_page: 10, page, orientation: 'portrait', size: 'medium' },
      timeout: 15000,
    });

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
    if (fs.existsSync(cachedPath)) {
      logger.info(`Using cached Pexels video: pexels_${chosen.id}.mp4`);
      return cachedPath;
    }

    logger.info(`Downloading Pexels video ${chosen.id}: "${query}" p${page}`);
    const writer = fs.createWriteStream(cachedPath);
    let downloadOk = false;
    try {
      const download = await axios.get(file.link, { responseType: 'stream', timeout: 90000 });
      download.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', () => { downloadOk = true; resolve(); });
        writer.on('error', reject);
        download.data.on('error', reject);
      });
    } catch (dlErr) {
      // Elimina el archivo parcial para que no quede cacheado corrupto
      try { fs.unlinkSync(cachedPath); } catch {}
      throw dlErr;
    }

    logger.info(`Saved: pexels_${chosen.id}.mp4`);
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
  const page1 = Math.floor(Math.random() * 3) + 1;  // páginas 1-3
  const page2 = Math.floor(Math.random() * 3) + 1;  // páginas 1-3 (query diferente garantiza variedad)

  logger.info(`Pexels queries | clip1: "${query1}" | clip2: "${query2}"`);

  const [clip1, clip2] = await Promise.all([
    getPexelsVideo(script, bgStyle, page1, bgStyle === 'satisfying' ? null : query1),
    getPexelsVideo(script, bgStyle, page2, bgStyle === 'satisfying' ? null : query2),
  ]);

  const clips = [clip1, clip2].filter(Boolean);
  // Dedup: si los dos apuntan al mismo archivo cacheado, usar solo uno
  if (clips.length === 2 && clips[0] === clips[1]) return [clips[0]];
  return clips;
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

async function renderVideo({ script, audioPath, audioDuration, outputPath, themeId, wordBoundaries, sectionDurations, bgStyle }) {
  const theme = themes.themes.find((t) => t.id === themeId) || themes.themes[0];
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // 1. Duración REAL del audio (no estimada)
  const realDuration = await getRealAudioDuration(audioPath);
  logger.info(`Real audio duration: ${realDuration.toFixed(2)}s (estimated was ${audioDuration}s)`);

  // 2. Descarga clips en paralelo: psychology (top) + satisfying (bottom)
  const [bgVideos, satisfyingClip] = await Promise.all([
    getPexelsVideos(script, bgStyle),
    getPexelsVideo(script, 'satisfying'),
  ]);

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

  // Construir bloques de subtítulo una sola vez (mismos bloques para todos los paths)
  // Modo automático: EXACT si hay wordBoundaries, SEGMENTED si hay sectionDurations, PROPORTIONAL si no
  const blocks = buildStyledSubtitleBlocks(script, realDuration, wordBoundaries || [], sectionDurations || null);
  logger.info(
    `Subtitles: ${blocks.length} blocks | mode=${
      (wordBoundaries || []).length >= 4 ? 'EXACT' :
      sectionDurations ? 'SEGMENTED' : 'PROPORTIONAL'
    }`
  );

  // Guardar SRT en el directorio del vídeo (útil para debug y posibles usos futuros)
  try {
    const { buildSRTContent: _bsrt } = require('./subtitle-styler');
    fs.writeFileSync(path.join(outputDir, 'subtitles.srt'), _bsrt(blocks), 'utf8');
  } catch {}

  // 5a. SPLIT SCREEN (formato viral por defecto): top=psicología, bottom=satisfying
  if (bgVideos.length > 0 && satisfyingClip) {
    // Subtítulos V2 en la mitad superior: y = h*0.43 ≈ 825px (dentro de los 1100px superiores)
    const drawtextFilter = buildStyledDrawtextFilters(blocks, 'h*0.43', theme);
    logger.info(`Rendering | Theme: ${theme.name} | Background: split-screen | Subtitles: ${blocks.length} blocks`);
    try {
      return await renderWithSplitScreen({
        topClip: bgVideos[0],
        botClip: satisfyingClip,
        audioPath, musicPath, realDuration,
        drawtextFilter, outputPath, theme,
        logoPath: hasLogo ? logoPath : null,
      });
    } catch (splitErr) {
      logger.warn(`Split screen failed (${splitErr.message.slice(0, 80)}) — falling back to pexels bg`);
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
  }

  // 5b. Fallback: fondo Pexels estándar (2 clips o 1)
  const drawtextFilter = buildStyledDrawtextFilters(blocks, 'h*0.72', theme);
  const clipInfo = bgVideos.length === 2 ? '2 clips (cinematic cut)' : bgVideos.length === 1 ? '1 clip' : 'gradient';
  logger.info(`Rendering | Theme: ${theme.name} | Background: ${clipInfo} | Subtitles: ${blocks.length} blocks`);

  if (bgVideos.length > 0) {
    try {
      return await renderWithPexelsBg({ bgVideos, audioPath, musicPath, realDuration, drawtextFilter, outputPath, theme, logoPath: hasLogo ? logoPath : null });
    } catch (pexelsErr) {
      logger.warn(`Pexels render failed (${pexelsErr.message.slice(0, 80)}) — falling back to gradient`);
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
  }

  // 5c. Último fallback: fondo animado con gradiente
  return renderWithGradientBg({ audioPath, musicPath, realDuration, drawtextFilter, outputPath, theme, logoPath: hasLogo ? logoPath : null });
}

// ─── Con vídeo(s) de Pexels — pipeline cinematográfico ───────────────────────
//
// Con 2 clips: concatena con corte directo en el 45% del video.
// Color grade: eq (contraste + saturación) + vignette para look cinematográfico.
// Sustitución de colorchannelmixer plano por grade real.

function renderWithPexelsBg({ bgVideos, audioPath, musicPath, realDuration, drawtextFilter, outputPath, theme, logoPath }) {
  return new Promise((resolve, reject) => {
    const twoClips = bgVideos.length >= 2;
    let cmd = ffmpeg();

    if (twoClips) {
      // Clip 1: primeros ~30% del video (hook) — corte rítmico en transición hook→claim
      const d1 = parseFloat((realDuration * 0.30).toFixed(2));
      // Clip 2: resto + pequeño buffer (la salida está limitada por -t realDuration)
      const d2 = parseFloat((realDuration * 0.60).toFixed(2));
      cmd = cmd.input(bgVideos[0]).inputOptions(['-stream_loop -1', `-t ${d1}`, '-vsync cfr']);
      cmd = cmd.input(bgVideos[1]).inputOptions(['-stream_loop -1', `-t ${d2}`, '-vsync cfr']);
    } else {
      cmd = cmd.input(bgVideos[0]).inputOptions(['-stream_loop -1', `-t ${realDuration}`, '-vsync cfr']);
    }

    // Inputs de audio
    const audioIdx = twoClips ? 2 : 1;
    cmd = cmd.input(audioPath);
    const hasMusic = musicPath && fs.existsSync(musicPath);
    if (hasMusic) cmd = cmd.input(musicPath);
    if (logoPath) cmd = cmd.input(logoPath);
    const logoIdx = audioIdx + (hasMusic ? 2 : 1);
    const musicIdx = audioIdx + 1;

    // ── Pipeline de vídeo ──────────────────────────────────────────────────
    // 1. Scale + crop a 9:16 cada clip
    // 2. Si 2 clips: concat (corte directo cinematográfico)
    // 3. Color grade: eq (contraste +15%, saturación +30%, leve darken)
    // 4. Vignette para look cinematic
    // 5. Logo watermark (opcional)
    // 6. Subtítulos

    let videoFilter = '';

    if (twoClips) {
      videoFilter =
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30[v0];` +
        `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30[v1];` +
        `[v0][v1]concat=n=2:v=1:a=0[cat];` +
        `[cat]eq=contrast=1.25:brightness=0.02:saturation=1.5:gamma=1.08[graded];` +
        `[graded]vignette='PI/4'[vig];`;
    } else {
      videoFilter =
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30[v0];` +
        `[v0]eq=contrast=1.25:brightness=0.02:saturation=1.5:gamma=1.08[graded];` +
        `[graded]vignette='PI/4'[vig];`;
    }

    if (logoPath) {
      videoFilter +=
        `[${logoIdx}:v]scale=180:-1,format=rgba,colorchannelmixer=aa=0.7[wm];` +
        `[vig][wm]overlay=W-w-24:24[branded];` +
        `[branded]${drawtextFilter}[vout]`;
    } else {
      videoFilter += `[vig]${drawtextFilter}[vout]`;
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
        '-c:v libx264', '-preset fast', '-crf 22',
        '-pix_fmt yuv420p', '-r 30',
        '-c:a aac', '-b:a 192k', '-ar 44100',
        `-t ${realDuration}`, '-movflags +faststart',
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

// ─── Split screen (formato viral) — top: psicología, bottom: satisfying ──────
//
// Layout: 1080×1100 (top, 57%) + 1080×820 (bottom, 43%) = 1080×1920
// Top clip: stock footage de psicología con audio y color grade
// Bottom clip: satisfying content sin audio, en bucle
// Subtítulos: dentro de la mitad superior (y ≈ 825px)

function renderWithSplitScreen({ topClip, botClip, audioPath, musicPath, realDuration, drawtextFilter, outputPath, theme, logoPath }) {
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
        `[vig][wm]overlay=W-w-24:24[branded];` +
        `[branded]${drawtextFilter}[vout]`;
    } else {
      videoFilter += `[vig]${drawtextFilter}[vout]`;
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
        '-c:v libx264', '-preset fast', '-crf 22',
        '-pix_fmt yuv420p', '-r 30',
        '-c:a aac', '-b:a 192k', '-ar 44100',
        `-t ${realDuration}`, '-movflags +faststart',
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

function renderWithGradientBg({ audioPath, musicPath, realDuration, drawtextFilter, outputPath, theme, logoPath }) {
  return new Promise((resolve, reject) => {
    const c1 = hexToRgb(theme.background.colors[0]);
    const c2 = hexToRgb(theme.background.colors[theme.background.colors.length - 1]);

    // Gradiente animado — pulso suave de luminosidad
    // Pulso de luminosidad más lento y sutil (período 6s en lugar de 4/3s)
    const rExpr = `lerp(${c1.r},${c2.r},Y/H)+10*sin(2*PI*T/6)`;
    const gExpr = `lerp(${c1.g},${c2.g},Y/H)+7*sin(2*PI*T/6)`;
    const bExpr = `lerp(${c1.b},${c2.b},Y/H)+14*sin(2*PI*T/5)`;

    const hasMusic = musicPath && fs.existsSync(musicPath);
    let cmd = ffmpeg();

    cmd = cmd
      .input(`color=black:s=${W}x${H}:r=30`)
      .inputFormat('lavfi')
      .inputOptions([`-t ${realDuration}`]);
    cmd = cmd.input(audioPath);
    if (hasMusic) cmd = cmd.input(musicPath);
    if (logoPath) cmd = cmd.input(logoPath);
    const logoIdx = hasMusic ? 3 : 2;

    let videoFilter =
      `[0:v]geq=r='${rExpr}':g='${gExpr}':b='${bExpr}'[bg];` +
      `[bg]vignette='PI/4'[vig];`;

    if (logoPath) {
      videoFilter +=
        `[${logoIdx}:v]scale=180:-1,format=rgba,colorchannelmixer=aa=0.7[wm];` +
        `[vig][wm]overlay=W-w-24:24[branded];` +
        `[branded]${drawtextFilter}[vout]`;
    } else {
      videoFilter += `[vig]${drawtextFilter}[vout]`;
    }

    let audioFilter = '';
    if (hasMusic) {
      audioFilter =
        `;[2:a]volume=0.15,` +
        `afade=t=in:st=0:d=1,` +
        `afade=t=out:st=${Math.max(0, realDuration - 2)}:d=2[music];` +
        `[1:a][music]amix=inputs=2:duration=first:normalize=0[aout]`;
    }

    cmd
      .complexFilter(videoFilter + audioFilter)
      .outputOptions([
        '-map [vout]',
        hasMusic ? '-map [aout]' : '-map 1:a',
        '-c:v libx264', '-preset fast', '-crf 22',
        '-pix_fmt yuv420p', '-r 30',
        '-c:a aac', '-b:a 192k', '-ar 44100',
        `-t ${realDuration}`, '-movflags +faststart',
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

function hexToRgb(hex) {
  const n = parseInt((hex || '#0a0a1a').replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

module.exports = { renderVideo, getRealAudioDuration };
