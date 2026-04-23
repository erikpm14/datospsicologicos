/**
 * style-config.js
 * Configuración viral_psychology_short para shorts de psicología.
 * Define constantes de edición, timing, colores, movimientos.
 */

const SEGMENT_KEYS = ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'];

/**
 * Mapa de duraciones ideales por segmento (SEGMENT_RHYTHM_MAP escalado)
 * Estos valores se escalan proporcionalmente si la duración real del audio es distinta.
 */
const SEGMENT_DEFAULTS = {
  hook: {
    durationSeconds: 2.2,
    movement: 'push-in-rapido',
    intensity: 'muy-alta',
    transition: 'hard-cut',
    colorGrade: 'dark_psychology',
  },
  open_loop: {
    durationSeconds: 2.8,
    movement: 'zoom-lento',
    intensity: 'alta',
    transition: 'match-cut',
    colorGrade: 'dark_psychology',
  },
  micro_value: {
    durationSeconds: 3.2,
    movement: 'micro-paneo',
    intensity: 'media',
    transition: 'hard-cut',
    colorGrade: 'dark_psychology',
  },
  escalation: {
    durationSeconds: 3.4,
    movement: 'acercamiento-progresivo',
    intensity: 'alta',
    transition: 'whip-cut',
    colorGrade: 'dark_psychology',
  },
  reengage: {
    durationSeconds: 2.6,
    movement: 'zoom-agresivo',
    intensity: 'muy-alta',
    transition: 'impact-cut',
    colorGrade: 'high_energy',
  },
  peak: {
    durationSeconds: 3.6,
    movement: 'push-in-sostenido',
    intensity: 'muy-alta',
    transition: 'match-cut',
    colorGrade: 'high_energy',
  },
  open_ending: {
    durationSeconds: 3.1,
    movement: 'zoom-out-suave',
    intensity: 'media',
    transition: 'fade-cut',
    colorGrade: 'dark_psychology',
  },
  soft_cta: {
    durationSeconds: 2.7,
    movement: 'micro-acercamiento',
    intensity: 'media',
    transition: 'hard-cut',
    colorGrade: 'warm_cinematic',
  },
};

const TOTAL_SEGMENT_DURATION = Object.values(SEGMENT_DEFAULTS).reduce((sum, s) => sum + s.durationSeconds, 0);

/**
 * Colores por sección (compatibles con CSS_TO_ASS corregido en subtitle-styler.js)
 */
const SECTION_COLORS = {
  hook: '#F3F7FF',
  open_loop: '#4F7BFF',
  micro_value: '#F3F7FF',
  escalation: '#4F7BFF',
  reengage: '#FF3B30',
  peak: '#FF3B30',
  open_ending: '#4F7BFF',
  soft_cta: '#4F7BFF',
};

/**
 * Font sizes para cada sección
 */
const SECTION_FONT_SIZES = {
  hook: 140,
  open_loop: 122,
  micro_value: 120,
  escalation: 124,
  reengage: 128,
  peak: 126,
  open_ending: 118,
  soft_cta: 115,
};

/**
 * Parámetros de zoom punch (reengage + peak)
 */
const PUNCH_ZOOM_CONFIG = {
  maxScale: 1.08,      // 8% de zoom durante el segmento
  startTime: 0.0,      // desde el inicio del segmento
  easeFunction: 'linear', // sin easing, zoom lineal
};

/**
 * Parámetros de audio fades en cuts
 */
const AUDIO_FADE_CONFIG = {
  fadeInDuration: 0.03,  // 30ms
  fadeOutDuration: 0.03, // 30ms
  easeFunction: 'exp',   // exponencial para suavidad
};

/**
 * Parámetros de silencedetect para cortes naturales
 */
const SILENCE_DETECTION_CONFIG = {
  minGapMs: 400,        // gaps ≥400ms son cortes válidos
  noiseThreshold: '-30dB', // FFmpeg silencedetect threshold
  minSilenceDuration: 0.4,  // duración mínima del silencio detectado
};

/**
 * Movimiento de cámara sinusoidal base (pan X/Y)
 * Valores en píxeles desplazamiento máximo desde centro
 */
const CAMERA_MOTION_BASE = {
  'push-in-rapido': { panX: 8, panY: 0, scale: 'W+160:H+200' },
  'zoom-lento': { panX: 6, panY: 0, scale: 'W+180:H+220' },
  'micro-paneo': { panX: 12, panY: 0, scale: 'W+140:H+160' },
  'acercamiento-progresivo': { panX: 0, panY: 0, scale: 'scale(t)' }, // crece durante segmento
  'zoom-agresivo': { panX: 20, panY: 0, scale: 'W+120:H+160' },
  'push-in-sostenido': { panX: 8, panY: -4, scale: 'W+100:H+140' },
  'zoom-out-suave': { panX: 0, panY: 0, scale: 'scale(t)' }, // decrece durante segmento
  'micro-acercamiento': { panX: 5, panY: 0, scale: 'W+80:H+100' },
};

/**
 * Parámetros de clip Pexels
 */
const PEXELS_CONFIG = {
  queryLimit: 3,               // máximo 3 queries en paralelo
  searchCacheMinutes: 720,     // cache búsquedas 12 horas
  cacheSizeLimitGB: 1,         // max 1GB de clips descargados
};

/**
 * Música de fondo
 */
const MUSIC_CONFIG = {
  volumeBase: 0.15,     // volumen base sin ducking
  volumeDucked: 0.08,   // volumen reducido cuando hay voz
  fadeinDuration: 1.0,  // fade-in 1s al inicio
  fadeoutDuration: 2.0, // fade-out 2s al final
};

/**
 * Vignette y branding
 */
const VIGNETTE_CONFIG = {
  strength: 'PI/4.5',   // intensidad del vignette (oscurecimiento de bordes)
  logoScale: 180,       // ancho del logo en píxeles
  logoAlpha: 0.7,       // opacidad del logo
  logoPosition: 'W-w-24:24', // esquina superior derecha
};

/**
 * Render FFmpeg
 */
const FFMPEG_CONFIG = {
  preset: 'veryfast',
  crf: 23,
  fps: 30,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  audioBitrate: '192k',
  audioSampleRate: 44100,
};

/**
 * Detección de cortes en silences
 */
const SILENCE_CUTS_CONFIG = {
  enabled: true,
  minGap: 0.4,  // segundos
};

module.exports = {
  SEGMENT_KEYS,
  SEGMENT_DEFAULTS,
  TOTAL_SEGMENT_DURATION,
  SECTION_COLORS,
  SECTION_FONT_SIZES,
  PUNCH_ZOOM_CONFIG,
  AUDIO_FADE_CONFIG,
  SILENCE_DETECTION_CONFIG,
  CAMERA_MOTION_BASE,
  PEXELS_CONFIG,
  MUSIC_CONFIG,
  VIGNETTE_CONFIG,
  FFMPEG_CONFIG,
  SILENCE_CUTS_CONFIG,
};
