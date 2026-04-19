/**
 * fruit-drama-renderer.js
 *
 * Renderiza un episodio de drama de frutas:
 *  - Descarga imágenes de Pexels por fruta + emoción
 *  - Genera audio por línea (Edge TTS con voces distintas)
 *  - Render por escena: imagen + Ken Burns (zoompan) + subtítulo + nombre personaje
 *  - Concatena todo en un MP4 vertical 1080×1920
 */

require('dotenv').config();
const ffmpegInstaller  = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpeg  = require('fluent-ffmpeg');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const logger  = require('../utils/logger');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const W = 1080;
const H = 1920;
const FPS = 25;

// Cache de imágenes de frutas
const FRUIT_CACHE = path.resolve('./assets/fruits');

// ────────────────────────────────────────────────────────────
//  PEXELS — imagen de fruta por emoción
// ────────────────────────────────────────────────────────────

const EMOTION_QUERIES = {
  neutral:    '',
  surprised:  'close up',
  angry:      'red close up',
  crying:     'wet drops close up',
  laughing:   'bright colorful',
  suspicious: 'shadow dark',
  loving:     'heart red',
  disgusted:  'rotten',
  scared:     'dark shadow',
  confident:  'bright vibrant',
};

async function getFruitImage(fruitPexelsQuery, emotion) {
  if (!process.env.PEXELS_API_KEY || process.env.PEXELS_API_KEY === 'RELLENAR') {
    return null;
  }

  if (!fs.existsSync(FRUIT_CACHE)) fs.mkdirSync(FRUIT_CACHE, { recursive: true });

  const emotionExtra = EMOTION_QUERIES[emotion] || '';
  const query   = `${fruitPexelsQuery} ${emotionExtra}`.trim();
  const cacheKey = query.replace(/\s+/g, '_').replace(/[^a-z0-9_]/gi, '');
  const cachedPath = path.join(FRUIT_CACHE, `${cacheKey}.jpg`);

  if (fs.existsSync(cachedPath)) return cachedPath;

  try {
    const res = await axios.get('https://api.pexels.com/v1/search', {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      params:  { query, per_page: 10, orientation: 'portrait' },
      timeout: 10000,
    });
    const photos = res.data.photos || [];
    if (!photos.length) return null;

    const photo   = photos[Math.floor(Math.random() * Math.min(photos.length, 5))];
    const imgUrl  = photo.src.large2x || photo.src.large || photo.src.original;

    const imgRes = await axios.get(imgUrl, { responseType: 'stream', timeout: 30000 });
    const writer = fs.createWriteStream(cachedPath);
    imgRes.data.pipe(writer);
    await new Promise((res, rej) => { writer.on('finish', res); writer.on('error', rej); });

    logger.info(`Fruit image cached: ${cacheKey}.jpg`);
    return cachedPath;
  } catch (err) {
    logger.warn(`Pexels fruit image failed: ${err.message}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
//  EDGE TTS — audio por línea de diálogo
// ────────────────────────────────────────────────────────────

async function synthesizeLine(text, voice, outputPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text);
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outputPath);
    audioStream.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    audioStream.on('error', reject);
  });
}

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, meta) => {
      if (err) return reject(err);
      resolve(parseFloat(meta.format.duration));
    });
  });
}

// ────────────────────────────────────────────────────────────
//  RENDER ESCENA — imagen + Ken Burns + texto
// ────────────────────────────────────────────────────────────

const KEN_BURNS_MODES = ['zoom_in_center', 'zoom_in_topleft', 'zoom_in_topright', 'pan_right', 'pan_left'];

function buildKenBurnsFilter(mode, duration) {
  const frames = Math.ceil(duration * FPS);
  const speed  = 0.0006;
  // Usar \, en lugar de comillas simples para evitar conflictos con fontfile='...'
  switch (mode) {
    case 'zoom_in_topleft':
      return `zoompan=z=min(zoom+${speed}\\,1.5):x=0:y=0:d=${frames}:s=${W}x${H}:fps=${FPS}`;
    case 'zoom_in_topright':
      return `zoompan=z=min(zoom+${speed}\\,1.5):x=iw-iw/zoom:y=0:d=${frames}:s=${W}x${H}:fps=${FPS}`;
    case 'pan_right':
      // on = output frame number; 8px/s at 25fps = 0.32px/frame
      return `zoompan=z=1.3:x=iw/2-(iw/zoom/2)+on*0.32:y=ih/2-(ih/zoom/2):d=${frames}:s=${W}x${H}:fps=${FPS}`;
    case 'pan_left':
      return `zoompan=z=1.3:x=iw/2-(iw/zoom/2)-on*0.32:y=ih/2-(ih/zoom/2):d=${frames}:s=${W}x${H}:fps=${FPS}`;
    default: // zoom_in_center
      return `zoompan=z=min(zoom+${speed}\\,1.5):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${frames}:s=${W}x${H}:fps=${FPS}`;
  }
}

function escapeText(t) {
  return t
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\u2019')   // right single quote (Unicode) — no escaping needed
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/%/g, '\\%')
    .replace(/ /g, '\\ ');    // CRÍTICO: escapa espacios para evitar split en Windows
}

function findSystemFont() {
  const candidates = [
    'C:/Windows/Fonts/impact.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function getFontPart() {
  const f = findSystemFont();
  if (!f) return '';
  // Usar forward slashes; la comilla simple protege el colon en el parser de FFmpeg
  const p = f.replace(/\\/g, '/');
  return `fontfile='${p}':`;
}

function renderScene({ imagePath, audioDuration, speakerName, dialogueLine, kbMode, outputPath }) {
  return new Promise((resolve, reject) => {
    const kbFilter    = buildKenBurnsFilter(kbMode, audioDuration + 0.1);
    const fontPart    = getFontPart();
    const speakerEsc  = escapeText(speakerName.toUpperCase());
    const dialogueEsc = escapeText(dialogueLine);
    const isA         = ['Fresa','Cereza','Naranja','Mango','Melocotón'].includes(speakerName);
    const nameColor   = isA ? '0xff69b4' : '0x00cfff';

    // Usar -vf (simple filter, una sola entrada/salida)
    // IMPORTANTE: scale explícito después de zoompan para que h/w sean conocidos en drawbox/drawtext
    // (la versión de FFmpeg del bundler no propaga dimensiones desde zoompan)
    const boxY      = Math.round(H * 0.78);  // 1497
    const boxH      = Math.round(H * 0.22);  // 422
    const nameY     = Math.round(H * 0.79);  // 1516
    const dialogueY = Math.round(H * 0.85);  // 1632

    const vf =
      `scale=${W * 2}:${H * 2},setsar=1,` +
      `${kbFilter},` +
      `scale=${W}:${H},` +
      `colorchannelmixer=rr=0.5:gg=0.5:bb=0.5,` +
      `drawbox=x=0:y=${boxY}:w=${W}:h=${boxH}:color=black@0.7:t=fill,` +
      `drawtext=${fontPart}text=${speakerEsc}:fontcolor=${nameColor}:fontsize=42:` +
        `x=(w-text_w)/2:y=${nameY}:bordercolor=black:borderw=4,` +
      `drawtext=${fontPart}text=${dialogueEsc}:fontcolor=white:fontsize=58:` +
        `x=(w-text_w)/2:y=${dialogueY}:bordercolor=black@0.9:borderw=8:` +
        `box=1:boxcolor=black@0.3:boxborderw=12`;

    ffmpeg()
      .input(imagePath)
      .inputOptions(['-loop', '1', '-framerate', String(FPS), '-t', String(audioDuration + 0.5)])
      .outputOptions([
        '-vf', vf,
        '-an',
        '-c:v libx264', '-preset ultrafast', '-crf 24',
        '-pix_fmt yuv420p', `-r ${FPS}`,
        `-t ${audioDuration + 0.1}`,
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err, _s, stderr) => {
        logger.error(`Scene render error: ${err.message}`);
        if (stderr) logger.error(stderr.slice(-800));
        reject(err);
      })
      .run();
  });
}

// Combina vídeo de escena + audio de línea
function mergeSceneAudio(videoPath, audioPath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-map 0:v', '-map 1:a',
        '-c:v copy', '-c:a aac', '-b:a 192k',
        `-t ${duration + 0.1}`,
        '-shortest',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// ────────────────────────────────────────────────────────────
//  PANTALLA DE TEXTO (hook inicial y cliffhanger final)
// ────────────────────────────────────────────────────────────

function renderTextCard({ text, duration, color = 'white', outputPath, isHook = false }) {
  return new Promise((resolve, reject) => {
    const fontPart = getFontPart();
    const escaped  = escapeText(text);
    const fontSize = isHook ? 78 : 68;

    const vf =
      `drawbox=x=0:y=0:w=iw:h=ih:color=0x1a0533@1:t=fill,` +
      `drawtext=${fontPart}text=${escaped}:fontcolor=${color}:fontsize=${fontSize}:` +
        `x=(w-text_w)/2:y=(h-text_h)/2:bordercolor=black@0.9:borderw=8`;

    // Fondo gradiente negro → violeta
    ffmpeg()
      .input(`color=black:s=${W}x${H}:r=${FPS}`).inputFormat('lavfi').inputOptions([`-t ${duration}`])
      .outputOptions([
        '-vf', vf,
        '-an',
        '-c:v libx264', '-preset ultrafast', '-crf 24',
        '-pix_fmt yuv420p', `-r ${FPS}`, `-t ${duration}`,
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// ────────────────────────────────────────────────────────────
//  CONCATENAR CLIPS
// ────────────────────────────────────────────────────────────

function concatClips(clipPaths, outputPath) {
  return new Promise((resolve, reject) => {
    if (clipPaths.length === 0) return reject(new Error('No clips to concat'));

    const listFile = outputPath.replace('.mp4', '_list.txt');
    fs.writeFileSync(listFile, clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));

    ffmpeg()
      .input(listFile).inputOptions(['-f concat', '-safe 0'])
      .outputOptions([
        '-c:v libx264', '-preset fast', '-crf 22',
        '-c:a aac', '-b:a 192k',
        '-pix_fmt yuv420p', `-r ${FPS}`,
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end', () => { try { fs.unlinkSync(listFile); } catch {} resolve(outputPath); })
      .on('error', reject)
      .run();
  });
}

// Añadir música de fondo al vídeo final
function addBackgroundMusic(videoPath, musicPath, outputPath, videoDuration) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(musicPath)
      .complexFilter(
        `[1:a]volume=0.12,afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, videoDuration - 2)}:d=2[music];` +
        `[0:a][music]amix=inputs=2:duration=first:normalize=0[aout]`
      )
      .outputOptions(['-map 0:v', '-map [aout]', '-c:v copy', '-c:a aac', '-b:a 192k', '-movflags +faststart'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// ────────────────────────────────────────────────────────────
//  PIPELINE PRINCIPAL
// ────────────────────────────────────────────────────────────

/**
 * Renderiza un episodio completo de fruit drama.
 * @param {{ script: Object, outputPath: string, workDir: string }} opts
 */
async function renderFruitDrama({ script, outputPath, workDir }) {
  fs.mkdirSync(workDir, { recursive: true });

  const pair   = script.pair;
  const scenes = script.scenes || [];
  const clips  = [];
  let totalDuration = 0;

  // ── 1. Pantalla de hook inicial (1.5s)
  const hookCardPath = path.join(workDir, 'hook_card.mp4');
  await renderTextCard({
    text:       script.hook,
    duration:   2,
    color:      'yellow',
    outputPath: hookCardPath,
    isHook:     true,
  });
  clips.push(hookCardPath);
  totalDuration += 2;

  // ── 2. Escenas de diálogo
  for (let i = 0; i < scenes.length; i++) {
    const scene   = scenes[i];
    const isA     = scene.speaker === pair.a.name;
    const fruit   = isA ? pair.a : pair.b;
    const kbMode  = KEN_BURNS_MODES[i % KEN_BURNS_MODES.length];

    logger.info(`FruitDrama scene ${i + 1}/${scenes.length}: ${scene.speaker} - "${scene.line}"`);

    // Audio de la línea
    const audioPath  = path.join(workDir, `scene_${i}_audio.mp3`);
    await synthesizeLine(scene.line, fruit.voice, audioPath);
    const audioDur   = await getAudioDuration(audioPath);
    const sceneDur   = Math.max(audioDur + 0.3, scene.durationHint || 3);

    // Imagen de la fruta
    let imagePath = await getFruitImage(fruit.pexels, scene.emotion);

    // Fallback: color sólido si no hay imagen
    if (!imagePath) {
      const fallbackPath = path.join(workDir, `scene_${i}_bg.png`);
      // Genera un fondo de color sólido con FFmpeg
      await new Promise((res, rej) => {
        const color = isA ? '#3d0020' : '#002040';
        ffmpeg()
          .input(`color=${color}:s=${W}x${H}:r=${FPS}`).inputFormat('lavfi').inputOptions(['-t 0.04'])
          .outputOptions(['-vframes 1'])
          .output(fallbackPath)
          .on('end', res).on('error', rej).run();
      });
      imagePath = fallbackPath;
    }

    // Render vídeo de la escena (sin audio)
    const sceneVideoPath   = path.join(workDir, `scene_${i}_video.mp4`);
    await renderScene({
      imagePath,
      audioDuration: sceneDur,
      speakerName:   scene.speaker,
      dialogueLine:  scene.line,
      kbMode,
      outputPath:    sceneVideoPath,
    });

    // Merge vídeo + audio
    const sceneFinalPath = path.join(workDir, `scene_${i}_final.mp4`);
    await mergeSceneAudio(sceneVideoPath, audioPath, sceneFinalPath, sceneDur);

    clips.push(sceneFinalPath);
    totalDuration += sceneDur;
  }

  // ── 3. Pantalla de cliffhanger final (3s)
  if (script.cliffhanger) {
    const cliffPath = path.join(workDir, 'cliffhanger.mp4');
    await renderTextCard({
      text:       script.cliffhanger,
      duration:   3,
      color:      '#ff69b4',
      outputPath: cliffPath,
    });
    clips.push(cliffPath);
    totalDuration += 3;

    if (script.nextEpisodeHook) {
      const nextPath = path.join(workDir, 'next_ep.mp4');
      await renderTextCard({
        text:       `👉 ${script.nextEpisodeHook}`,
        duration:   2,
        color:      'white',
        outputPath: nextPath,
      });
      clips.push(nextPath);
      totalDuration += 2;
    }
  }

  // ── 4. Concatenar todo
  const concatPath = path.join(workDir, 'concat.mp4');
  await concatClips(clips, concatPath);

  // ── 5. Música de fondo (si existe)
  const musicDir = path.resolve('./assets/music');
  if (fs.existsSync(musicDir)) {
    const tracks = fs.readdirSync(musicDir).filter(f => /\.(mp3|wav|aac)$/i.test(f));
    if (tracks.length) {
      const musicPath = path.join(musicDir, tracks[Math.floor(Math.random() * tracks.length)]);
      await addBackgroundMusic(concatPath, musicPath, outputPath, totalDuration);
      logger.info(`FruitDrama: added background music`);
    } else {
      fs.copyFileSync(concatPath, outputPath);
    }
  } else {
    fs.copyFileSync(concatPath, outputPath);
  }

  logger.info(`FruitDrama rendered: ${outputPath} | ${totalDuration.toFixed(1)}s`);
  return { outputPath, duration: totalDuration };
}

module.exports = { renderFruitDrama };
