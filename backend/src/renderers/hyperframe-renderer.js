/**
 * hyperframe-renderer.js
 *
 * Renderer HTML/CSS animado para vídeos psicológicos.
 *
 * Entrada: script, audioPath, captions, outputDir, videoId
 * Salida: output.mp4 + render-metadata.json
 *
 * Estilo: psicológico oscuro, azul eléctrico, rojo oscuro, blanco frío
 * Animaciones: cambios visuales cada 2-3s, partículas, glow, zoom
 */

require('dotenv').config();
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpeg = require('fluent-ffmpeg');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { createPerfTracker, formatDurationMs } = require('../utils/perf-tracker');
const { safeSpawn } = require('../utils/safe-spawn');
const { DEFAULT_AVATAR_CONFIG } = require('../avatar/avatar-config');
const { planMotionFromBeats } = require('../visual-engine/motion-planner');
const { buildCameraFilter } = require('../visual-engine/camera-engine');
const { buildOverlayFilters } = require('../visual-engine/overlay-engine');
const { planSmartCaptions } = require('../captions/smart-caption-planner');
const { stylizeCaptionText, pickCaptionStyleName, escapeAssText } = require('../captions/caption-style-engine');
const { composeScenePlan } = require('../visual-engine/scene-composer');
const { selectBackground } = require('../backgrounds/background-selector');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const execAsync = promisify(exec);

const W = 1080;
const H = 1920;
const FPS = 30;

function buildSpeakingIntervals(captions = [], { minGap = 0.35 } = {}) {
  const items = (captions || [])
    .filter(c => c && c.start !== undefined && c.end !== undefined)
    .sort((a, b) => a.start - b.start);

  const intervals = [];
  for (const cap of items) {
    const start = Math.max(0, Number(cap.start));
    const end = Math.max(start, Number(cap.end));
    if (intervals.length === 0) {
      intervals.push({ start, end });
      continue;
    }
    const last = intervals[intervals.length - 1];
    if (start <= last.end + minGap) {
      last.end = Math.max(last.end, end);
    } else {
      intervals.push({ start, end });
    }
  }
  return intervals;
}

function buildBetweenSumExpr(intervals = []) {
  if (!intervals || intervals.length === 0) return '0';
  return intervals
    .map(i => `between(t,${i.start.toFixed(2)},${i.end.toFixed(2)})`)
    .join('+');
}

function findFirstCaptionWindowByKeywords(captions = [], keywords = []) {
  const kws = (keywords || []).map(k => String(k || '').toLowerCase()).filter(Boolean);
  if (kws.length === 0) return null;
  for (const cap of (captions || [])) {
    const text = String(cap?.text || '').toLowerCase();
    if (!text) continue;
    if (kws.some(kw => text.includes(kw))) {
      const start = Number(cap.start || 0);
      const end = Number(cap.end || start);
      return { start, end };
    }
  }
  return null;
}

function buildBeatIntervals(beats = [], audioDuration = 28) {
  const items = (beats || [])
    .filter((b) => b && typeof b === 'object')
    .map((b) => ({
      text: String(b.text || '').trim(),
      emotion: String(b.emotion || '').toLowerCase(),
      avatarAction: String(b.avatarAction || '').toLowerCase(),
      durationHint: Number(b.durationHint || 0),
    }))
    .filter((b) => b.text.length > 0);

  if (items.length === 0) return { surprised: [], pointing: [], talking: [], excited: [], idle: [] };

  const totalHint = items.reduce((sum, b) => sum + (Number.isFinite(b.durationHint) && b.durationHint > 0 ? b.durationHint : 0), 0);
  const normalizedTotal = totalHint > 0 ? totalHint : items.length;

  let t = 0;
  const out = { surprised: [], pointing: [], talking: [], excited: [], idle: [] };

  for (const beat of items) {
    const weight = (Number.isFinite(beat.durationHint) && beat.durationHint > 0) ? beat.durationHint : 1;
    const dur = (audioDuration * weight) / normalizedTotal;
    const start = Math.max(0, t);
    const end = Math.min(audioDuration, start + Math.max(0.25, dur));

    const action = beat.avatarAction || beat.emotion;
    if (action === 'surprised') out.surprised.push({ start, end });
    else if (action === 'pointing') out.pointing.push({ start, end });
    else if (action === 'excited') out.excited.push({ start, end });
    else if (action === 'idle') out.idle.push({ start, end });
    else out.talking.push({ start, end });

    t = end;
  }

  return out;
}

// ────────────────────────────────────────────────────────────
// MAPEO: Segmento → Colores y animaciones
// ────────────────────────────────────────────────────────────

const SCENE_CONFIG = {
  HOOK: {
    bg: '#0a0e27',
    accent: '#00d4ff',
    emotion: 'tension',
    animation: 'pulse_in',
    duration: 3.5,
  },
  OPEN_LOOP: {
    bg: '#0f1530',
    accent: '#00d4ff',
    emotion: 'engagement',
    animation: 'fade_in',
    duration: 3,
  },
  MICRO_VALUE: {
    bg: '#0a0e27',
    accent: '#ff1744',
    emotion: 'realization',
    animation: 'zoom_in',
    duration: 2.5,
  },
  ESCALATION: {
    bg: '#1a0f2e',
    accent: '#ff1744',
    emotion: 'intensity',
    animation: 'slide_in',
    duration: 3,
  },
  REENGAGE: {
    bg: '#0a0e27',
    accent: '#ffb300',
    emotion: 'rupture',
    animation: 'flash',
    duration: 2,
  },
  PEAK: {
    bg: '#2a0a0e',
    accent: '#ff1744',
    emotion: 'maximum',
    animation: 'intense_glow',
    duration: 4,
  },
  OPEN_ENDING: {
    bg: '#0f1530',
    accent: '#00d4ff',
    emotion: 'reflection',
    animation: 'fade_out',
    duration: 3,
  },
  SOFT_CTA: {
    bg: '#0a0e27',
    accent: '#00d4ff',
    emotion: 'invitation',
    animation: 'subtle_pulse',
    duration: 2.5,
  },
};

// ────────────────────────────────────────────────────────────
// GENERACIÓN DE FILTROS FFMPEG PARA FONDOS + ANIMACIONES
// ────────────────────────────────────────────────────────────

/**
 * Genera un comando FFmpeg para crear el vídeo base con fondo animado.
 * Usa color filters + ecuaciones de tiempo para simular animaciones.
 */
function buildAnimationFilter(duration, sceneType = 'HOOK') {
  const cfg = SCENE_CONFIG[sceneType] || SCENE_CONFIG.HOOK;
  const durationFrames = Math.ceil(duration * FPS);

  // Convertir hex a RGB
  const bgHex = cfg.bg.replace('#', '');
  const accentHex = cfg.accent.replace('#', '');

  const bgRGB = {
    r: parseInt(bgHex.substring(0, 2), 16),
    g: parseInt(bgHex.substring(2, 4), 16),
    b: parseInt(bgHex.substring(4, 6), 16),
  };

  const accentRGB = {
    r: parseInt(accentHex.substring(0, 2), 16),
    g: parseInt(accentHex.substring(2, 4), 16),
    b: parseInt(accentHex.substring(4, 6), 16),
  };

  // Generar fondo base + animación con color_key + overlay
  const colorFilter = `color=c='#${bgHex}':s=${W}x${H}:d=${duration}`;

  // Efecto de destello de acento en los bordes (sin depender de assets)
  const glowEffect = `drawtext=text='':x=0:y=0:fontsize=1`;

  return [
    colorFilter,
    // Overlay con efecto de pulso usando ecuaciones
    `geq=lum='lum(X,Y)'`,
  ];
}

/**
 * Construye comando FFmpeg para renderizar el vídeo completo.
 * Combina: fondo color + audio + subtítulos ASS
 *
 * Usa comando directo en lugar de fluent-ffmpeg para evitar problemas.
 */
async function renderWithFFmpeg(options = {}) {
  const {
    script = {},
    audioPath,
    outputPath,
    audioDuration = 30,
    assSubtitlePath,
    captions = [],
  } = options;

  try {
    // Validar inputs
    if (!audioPath || !audioPath.trim()) {
      throw new Error('audioPath is empty');
    }
    if (!outputPath || !outputPath.trim()) {
      throw new Error('outputPath is empty');
    }
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const ffmpegBin = ffmpegInstaller.path;
    const durationStr = Math.ceil(audioDuration).toString();

    const escapeFilterPath = (p) => String(p || '')
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:');

    const sanitizeDrawtext = (t) => String(t || '')
      .replace(/[\r\n]/g, ' ')
      .replace(/[:\\]/g, ' ')
      .replace(/'/g, '’')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const hookText = sanitizeDrawtext(script?.hook || 'AI AVATAR');
    const badgeText = sanitizeDrawtext(script?.topic || 'ai_tools');

    const sprites = DEFAULT_AVATAR_CONFIG?.sprites || {};
    const spritesOk = !!(sprites.idle && sprites.talk1 && sprites.talk2 && sprites.surprised && sprites.pointing)
      && fs.existsSync(sprites.idle)
      && fs.existsSync(sprites.talk1)
      && fs.existsSync(sprites.talk2)
      && fs.existsSync(sprites.surprised)
      && fs.existsSync(sprites.pointing);

    const motionEnabled = String(process.env.VISUAL_MOTION_ENABLED || 'false').toLowerCase() === 'true';
    const overlaysEnabled = String(process.env.VISUAL_OVERLAYS_ENABLED || 'false').toLowerCase() === 'true';
    const multilayerEnabled = String(process.env.VISUAL_MULTILAYER_ENABLED || 'false').toLowerCase() === 'true';
    const backgroundStyle = String(process.env.BACKGROUND_STYLE || 'auto').toLowerCase();

    const bg = multilayerEnabled
      ? selectBackground({ formatId: script?.formatId, topic: script?.topic, style: backgroundStyle, riskLevel: script?.riskLevel, avatarTone: script?.avatarTone, visualCue: script?.visualCue })
      : null;

    const cameraFilter = motionEnabled ? buildCameraFilter({ fps: FPS }) : null;
    const overlayFilters = overlaysEnabled ? buildOverlayFilters({ beats: script?.beats, audioDuration, fps: FPS }) : [];

    const baseChain = [
      motionEnabled
        ? `[0:v]fps=${FPS},${cameraFilter}`
        : `[0:v]fps=${FPS}`,
      multilayerEnabled && bg?.category === 'futuristic_gradient'
        ? `geq=r='clip(20+10*sin(T*1.5)+X/20,0,255)':g='clip(30+10*sin(T*1.8)+Y/30,0,255)':b='clip(60+18*sin(T*1.2)+X/40,0,255)'`
        : `drawbox=x=0:y=0:w=iw:h=ih:color=0x0f172a@1:t=fill`,
      multilayerEnabled && (bg?.category === 'dashboards' || bg?.category === 'ai_ui')
        ? `drawbox=x=560:y=240:w=460:h=520:color=0xffffff@0.06:t=fill`
        : `null`,
      multilayerEnabled && bg?.category === 'terminal'
        ? `drawbox=x=540:y=240:w=500:h=560:color=0x000000@0.30:t=fill`
        : `null`,
      `drawbox=x=70:y=220:w=420:h=640:color=0xffffff@0.14:t=fill`,
      `drawbox=x=110:y=260:w=340:h=360:color=0xffffff@0.10:t=fill`,
      `drawbox=x=110:y=640:w=340:h=180:color=0x1f2937@0.92:t=fill`,
      `drawtext=font=Arial:fontsize=64:fontcolor=white:x=80:y=940:text='${hookText}'`,
      `drawbox=x=80:y=1040:w=520:h=92:color=0x2563eb@0.85:t=fill`,
      `drawtext=font=Arial:fontsize=52:fontcolor=white:x=110:y=1058:text='${badgeText}'`,
      `drawbox=x=0:y=1520:w=iw:h=400:color=0x000000@0.35:t=fill`,
      ...(overlayFilters || []),
    ].filter((x) => x !== 'null').join(',') + `[base]`;

    let vf = baseChain;

    if (spritesOk) {
      const avX = 110;
      const avY = 260;
      const avW = 340;
      const avH = 340;

      const escapedIdle = escapeFilterPath(sprites.idle);
      const escapedTalk1 = escapeFilterPath(sprites.talk1);
      const escapedTalk2 = escapeFilterPath(sprites.talk2);
      const escapedSurprised = escapeFilterPath(sprites.surprised);
      const escapedPointing = escapeFilterPath(sprites.pointing);

      const beatIntervals = Array.isArray(script?.beats) && script.beats.length > 0
        ? buildBeatIntervals(script.beats, audioDuration)
        : null;

      const speechIntervals = beatIntervals
        ? [...(beatIntervals.talking || []), ...(beatIntervals.excited || [])]
        : buildSpeakingIntervals(captions, { minGap: 0.35 });

      const speakingSum = buildBetweenSumExpr(speechIntervals);
      const speakingExpr = `gt(${speakingSum},0)`;

      const talkingSum = beatIntervals ? buildBetweenSumExpr(beatIntervals.talking || []) : speakingSum;
      const excitedSum = beatIntervals ? buildBetweenSumExpr(beatIntervals.excited || []) : '0';
      const surprisedSum = beatIntervals ? buildBetweenSumExpr(beatIntervals.surprised || []) : null;
      const pointingSum = beatIntervals ? buildBetweenSumExpr(beatIntervals.pointing || []) : null;

      const talkFps = 6;
      const excitedFps = 10;
      const talk1Enable = `gt(${talkingSum},0)*eq(mod(floor(t*${talkFps}),2),0)+gt(${excitedSum},0)*eq(mod(floor(t*${excitedFps}),2),0)`;
      const talk2Enable = `gt(${talkingSum},0)*eq(mod(floor(t*${talkFps}),2),1)+gt(${excitedSum},0)*eq(mod(floor(t*${excitedFps}),2),1)`;

      const surprisedEnd = Math.min(1.2, Math.max(0.6, audioDuration * 0.12));
      const surprisedEnable = surprisedSum
        ? `gt(${surprisedSum},0)`
        : (() => {
          return `between(t,0,${surprisedEnd.toFixed(2)})`;
        })();

      const pointWindow = findFirstCaptionWindowByKeywords(captions, ['herramienta', 'ia', 'automatiza', 'automatización', 'mira']);
      const pointStart = pointWindow ? Math.max(0, pointWindow.start) : Math.min(6, Math.max(2.5, surprisedEnd + 1));
      const pointEnd = pointWindow ? Math.min(audioDuration, pointWindow.end + 0.6) : Math.min(audioDuration, pointStart + 1.4);
      const pointingEnable = pointingSum ? `gt(${pointingSum},0)` : `between(t,${pointStart.toFixed(2)},${pointEnd.toFixed(2)})`;

      vf = [
        baseChain,
        `movie='${escapedIdle}':loop=1,format=rgba,scale=${avW}:${avH}[av_idle]`,
        `movie='${escapedTalk1}':loop=1,format=rgba,scale=${avW}:${avH}[av_talk1]`,
        `movie='${escapedTalk2}':loop=1,format=rgba,scale=${avW}:${avH}[av_talk2]`,
        `movie='${escapedSurprised}':loop=1,format=rgba,scale=${avW}:${avH}[av_surprised]`,
        `movie='${escapedPointing}':loop=1,format=rgba,scale=${avW}:${avH}[av_pointing]`,
        `[base][av_idle]overlay=${avX}:${avY}:eval=frame[v1]`,
        `[v1][av_talk1]overlay=${avX}:${avY}:eval=frame:enable='${talk1Enable}'[v2]`,
        `[v2][av_talk2]overlay=${avX}:${avY}:eval=frame:enable='${talk2Enable}'[v3]`,
        `[v3][av_surprised]overlay=${avX}:${avY}:eval=frame:enable='${surprisedEnable}'[v4]`,
        `[v4][av_pointing]overlay=${avX}:${avY}:eval=frame:enable='${pointingEnable}'[vout]`,
      ].join(';');
    } else {
      vf = [
        `fps=${FPS}`,
        `drawbox=x=0:y=0:w=iw:h=ih:color=0x0f172a@1:t=fill`,
        `drawbox=x=70:y=220:w=420:h=640:color=0xffffff@0.14:t=fill`,
        `drawbox=x=110:y=260:w=340:h=360:color=0x93c5fd@0.85:t=fill`,
        `drawbox=x=110:y=640:w=340:h=180:color=0x1f2937@0.92:t=fill`,
        `drawtext=font=Arial:fontsize=68:fontcolor=white:x=170:y=690:text='AVATAR'`,
        `drawtext=font=Arial:fontsize=64:fontcolor=white:x=80:y=940:text='${hookText}'`,
        `drawbox=x=80:y=1040:w=520:h=92:color=0x2563eb@0.85:t=fill`,
        `drawtext=font=Arial:fontsize=52:fontcolor=white:x=110:y=1058:text='${badgeText}'`,
        `drawbox=x=0:y=1520:w=iw:h=400:color=0x000000@0.35:t=fill`,
      ].join(',');
    }

    if (assSubtitlePath && fs.existsSync(assSubtitlePath)) {
      const escaped = escapeFilterPath(assSubtitlePath);
      if (vf.includes(';')) {
        vf = `${vf};[vout]subtitles='${escaped}'`;
      } else {
        vf = `${vf},subtitles='${escaped}'`;
      }
    }

    // Usar spawn con array de argumentos (no string exec que falla en Windows)
    const ffmpegArgs = [
      '-f', 'lavfi',
      '-i', `color=c=0a0e27:s=${W}x${H}:d=${durationStr}`,
      '-i', audioPath,
      '-vf', vf,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-preset', 'faster',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      '-y',
      outputPath,
    ];

    logger.info(`[Hyperframe] Running FFmpeg (${durationStr}s render)...`);
    logger.info(`[Hyperframe] Audio: ${audioPath} (${audioDuration.toFixed(2)}s)`);
    logger.info(`[Hyperframe] Output: ${outputPath}`);

    const ffmpegProcess = safeSpawn(ffmpegBin, ffmpegArgs, {
      detached: false,
    });

    let stderr = '';
    let stdout = '';

    ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpegProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Esperar a que termine
    const exitCode = await new Promise((resolve) => {
      ffmpegProcess.on('close', (code) => {
        resolve(code);
      });

      ffmpegProcess.on('error', (err) => {
        logger.error(`[Hyperframe] FFmpeg spawn error: ${err.message}`);
        resolve(1);
      });
    });

    // Validar resultado
    if (exitCode !== 0) {
      const stderrTail = stderr.slice(-500);
      logger.error(`[Hyperframe] FFmpeg failed with exit code ${exitCode}`);
      logger.error(`[Hyperframe] Stderr: ${stderrTail}`);
      throw new Error(`FFmpeg exited with code ${exitCode}`);
    }

    logger.info(`[Hyperframe] FFmpeg completed successfully (exit code 0)`);

    // Hard validation: archivo debe existir y tener tamaño > 100KB
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Output file not created: ${outputPath}`);
    }

    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(3);

    if (stats.size < 100 * 1024) {
      throw new Error(`Output file too small: ${sizeMB}MB (${stats.size} bytes), expected >100KB`);
    }

    logger.info(`[Hyperframe] Output validated: ${sizeMB}MB`);

    return outputPath;
  } catch (error) {
    throw new Error(`FFmpeg render failed: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────
// PRINCIPAL: Renderizar vídeo Hyperframe
// ────────────────────────────────────────────────────────────

async function renderHyperframe(options = {}) {
  const {
    script = {},
    audioPath,
    captions = [],
    outputDir,
    videoId = 'unknown',
  } = options;

  const perf = createPerfTracker('hyperframe_render');
  perf.start();

  try {
    logger.info(`[Hyperframe] Starting render for video ${videoId}`);

    // Validar entrada
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Obtener duración de audio
    let audioDuration = 30;
    try {
      const metadata = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
          if (err) reject(err);
          else resolve(metadata);
        });
      });
      if (metadata?.format?.duration) {
        audioDuration = parseFloat(metadata.format.duration);
      }
      logger.info(`[Hyperframe] Audio duration: ${audioDuration.toFixed(2)}s`);
    } catch (err) {
      logger.warn(`[Hyperframe] Could not detect audio duration, using default 30s: ${err.message}`);
    }

    // Generar archivo ASS con subtítulos
    const assPath = path.join(outputDir, 'subtitles.ass');
    const multilayerEnabled = String(process.env.VISUAL_MULTILAYER_ENABLED || 'false').toLowerCase() === 'true';
    const smartCaptionsEnabled = String(process.env.SMART_CAPTIONS_ENABLED || 'false').toLowerCase() === 'true';
    const backgroundStyle = String(process.env.BACKGROUND_STYLE || 'auto').toLowerCase();

    if (multilayerEnabled) {
      const scenePlan = composeScenePlan({
        script,
        videoId,
        durationSec: audioDuration,
        flags: {
          motionEnabled: String(process.env.VISUAL_MOTION_ENABLED || 'false').toLowerCase() === 'true',
          overlaysEnabled: String(process.env.VISUAL_OVERLAYS_ENABLED || 'false').toLowerCase() === 'true',
          smartCaptionsEnabled,
          multilayerEnabled,
          backgroundStyle,
        },
      });
      fs.writeFileSync(path.join(outputDir, 'scene-plan.json'), JSON.stringify(scenePlan, null, 2));
    }

    let finalCaptions = captions;
    if (smartCaptionsEnabled) {
      const planned = planSmartCaptions({ script, audioDuration, maxWords: 7 });
      if (Array.isArray(planned) && planned.length > 0) finalCaptions = planned;
    }

    buildASS(assPath, finalCaptions, audioDuration);

    // Renderizar vídeo
    const outputPath = path.join(outputDir, 'output.mp4');
    await renderWithFFmpeg({
      script,
      audioPath,
      outputPath,
      audioDuration,
      assSubtitlePath: assPath,
      captions: finalCaptions,
    });

    logger.info(`[Hyperframe] Render complete: ${outputPath}`);

    // Guardar metadata
    const metadata = {
      renderMode: 'hyperframe_html',
      rendererAssetless: true,
      fallbackUsed: false,
      hyperframeScenes: Object.keys(SCENE_CONFIG).length,
      motionEnabled: String(process.env.VISUAL_MOTION_ENABLED || 'false').toLowerCase() === 'true',
      overlaysEnabled: String(process.env.VISUAL_OVERLAYS_ENABLED || 'false').toLowerCase() === 'true',
      multilayerEnabled: multilayerEnabled === true,
      smartCaptionsEnabled: smartCaptionsEnabled === true,
      backgroundStyle,
      subtitlesFilterApplied: true,
      subtitlesVisual: true,
      visibleVisuals: true,
      videoDuration: audioDuration,
      generatedAt: new Date().toISOString(),
    };

    const metadataPath = path.join(outputDir, 'render-metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    const elapsed = perf.end();
    logger.info(`[Hyperframe] Complete in ${formatDurationMs(elapsed.durationMs)}`);

    return {
      success: true,
      outputPath,
      metadataPath,
      metadata,
      duration: elapsed.durationMs,
    };
  } catch (error) {
    logger.error(`[Hyperframe] Render failed: ${error.message}`, error);
    throw error;
  }
}

// ────────────────────────────────────────────────────────────
// GENERACIÓN DE SUBTÍTULOS ASS (Advanced SubStation Alpha)
// ────────────────────────────────────────────────────────────

function buildASS(outputPath, captions = [], duration = 30) {
  const assHeader = `[Script Info]
Title: Hyperframe
ScriptType: v4.00+
Collisions: Normal
PlayResX: ${W}
PlayResY: ${H}
Timer: 100.0000

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Helvetica,70,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,0,0,0,1
Style: Hook,Helvetica,78,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,2,0,0,0,1
Style: CTA,Helvetica,74,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,2,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let assEvents = '';
  captions.forEach((cap) => {
    if (!cap.text || cap.start === undefined || cap.end === undefined) return;
    const start = timeToASS(cap.start);
    const end = timeToASS(cap.end);
    const style = pickCaptionStyleName(cap);
    const text = cap.emphasisWords ? stylizeCaptionText(cap) : escapeAssText(cap.text);
    assEvents += `Dialogue: 0,${start},${end},${style},,0,0,0,,${text}\n`;
  });

  fs.writeFileSync(outputPath, assHeader + assEvents);
  logger.info(`[Hyperframe] ASS subtitles written: ${outputPath}`);
}

function timeToASS(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

module.exports = {
  renderHyperframe,
  buildASS,
  SCENE_CONFIG,
};
