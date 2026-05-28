/**
 * color-grader.js
 * Presets de color grade FFmpeg portados de video-use.
 * Selecciona el preset según tema e intensidad del segmento.
 */

/**
 * Presets FFmpeg listos para usar en eq/colorbalance/curves
 */
const COLOR_GRADE_PRESETS = {
  // Subtle: sutil, para tonos más neutrales
  subtle: 'eq=contrast=1.03:saturation=0.98',

  // Neutral punch: contraste +6% para definición, sin saturación extra
  neutral_punch: 'eq=contrast=1.06:brightness=-0.01:saturation=1.02',

  // Warm cinematic: cálido, golden hour, para momentos de revelación
  warm_cinematic: 'eq=contrast=1.12:brightness=-0.02:saturation=0.88,colorbalance=rs=0.02:gs=0.0:bs=-0.03',

  // Dark depth: alto contraste + saturación moderada, estética sobria
  dark_depth: 'eq=contrast=1.18:brightness=-0.03:saturation=1.05:gamma=0.94,colorbalance=rs=-0.01:gs=-0.01:bs=0.04',
  // Legacy alias (no usar en el nuevo dominio)
  dark_psychology: 'eq=contrast=1.18:brightness=-0.03:saturation=1.05:gamma=0.94,colorbalance=rs=-0.01:gs=-0.01:bs=0.04',

  // High energy: máximo contraste + saturación + brillo, para picos emocionales
  high_energy: 'eq=contrast=1.22:brightness=-0.01:saturation=1.15:gamma=0.96',
};

/**
 * Mapa tema → preset de color grade base
 * Usado cuando VIDEO_RENDER_ENGINE=shorts en la primera activación
 */
const THEME_GRADE_MAP = {
  dark_neural: 'dark_depth',
  midnight_red: 'high_energy',
  purple_depth: 'warm_cinematic',
  clean_white: 'subtle',
  cyberpunk_blue: 'high_energy',
  mystery_black: 'dark_depth',
  _default: 'neutral_punch',
};

/**
 * Mapa segmento narrativo → intensidad → preset recomendado
 */
const SEGMENT_GRADE_OVERRIDE = {
  hook: { muy_alta: 'high_energy', alta: 'dark_depth', media: 'neutral_punch' },
  open_loop: { muy_alta: 'warm_cinematic', alta: 'neutral_punch', media: 'subtle' },
  micro_value: { muy_alta: 'high_energy', alta: 'warm_cinematic', media: 'neutral_punch' },
  escalation: { muy_alta: 'high_energy', alta: 'dark_depth', media: 'warm_cinematic' },
  reengage: { muy_alta: 'high_energy', alta: 'high_energy', media: 'dark_depth' },
  peak: { muy_alta: 'high_energy', alta: 'high_energy', media: 'warm_cinematic' },
  open_ending: { muy_alta: 'warm_cinematic', alta: 'neutral_punch', media: 'subtle' },
  soft_cta: { muy_alta: 'warm_cinematic', alta: 'warm_cinematic', media: 'subtle' },
};

/**
 * Selecciona el preset de color grade para un segmento
 * @param {string} themeId - ID del tema visual (ej: 'dark_neural')
 * @param {string} segmentKey - clave del segmento (ej: 'hook')
 * @param {string} intensity - intensidad ('muy_alta', 'alta', 'media')
 * @returns {string} - nombre del preset
 */
function selectColorGrade(themeId, segmentKey, intensity) {
  // Si hay override específico para el segmento + intensidad
  if (SEGMENT_GRADE_OVERRIDE[segmentKey] && SEGMENT_GRADE_OVERRIDE[segmentKey][intensity]) {
    return SEGMENT_GRADE_OVERRIDE[segmentKey][intensity];
  }

  // Fallback: tema base
  return THEME_GRADE_MAP[themeId] || THEME_GRADE_MAP._default;
}

/**
 * Retorna el filtro FFmpeg listo para usar en el complexFilter
 * @param {string} presetName - nombre del preset (ej: 'dark_depth')
 * @returns {string} - filtro FFmpeg
 */
function getGradeFilter(presetName) {
  return COLOR_GRADE_PRESETS[presetName] || COLOR_GRADE_PRESETS.neutral_punch;
}

/**
 * Retorna la cadena de filtros FFmpeg para todo el video
 * Aplica el mismo preset a todos los segmentos (global)
 * @param {string} themeId - ID del tema
 * @returns {string} - filtro FFmpeg
 */
function getGlobalGradeFilter(themeId) {
  const presetName = THEME_GRADE_MAP[themeId] || THEME_GRADE_MAP._default;
  return getGradeFilter(presetName);
}

module.exports = {
  COLOR_GRADE_PRESETS,
  THEME_GRADE_MAP,
  SEGMENT_GRADE_OVERRIDE,
  selectColorGrade,
  getGradeFilter,
  getGlobalGradeFilter,
};
