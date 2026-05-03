/**
 * concat-builder.js
 * Construye el complexFilter FFmpeg completo para renderizar el video.
 * Este es el código más técnico: cada segmento recibe sus propios filtros.
 */

const { CAMERA_MOTION_BASE, VIGNETTE_CONFIG, PUNCH_ZOOM_CONFIG } = require('./style-config');
const { getGradeFilter } = require('./color-grader');
const logger = require('../utils/logger');

const W = 1080;
const H = 1920;

/**
 * Construye el complexFilter completo para FFmpeg
 * Retorna { filterGraph, outputLabels }
 *
 * @param {Array} segments - segmentos del renderPlan
 * @param {Object} inputMap - { videoInputs: [idx], audioIdx, musicIdx, logoIdx }
 * @param {string} assFilePath - ruta del archivo ASS con subtítulos
 * @param {string} globalColorGrade - preset de color grade global
 * @returns {{ filterGraph: string, outputLabels: { video, audio } }}
 */
function buildComplexFilter(segments, inputMap, assFilePath, globalColorGrade = 'dark_psychology') {
  const videoFilters = [];
  const audioFilters = [];
  const videoLabels = [];

  // ─────────────────────────────────────────────────────────────────
  // PASO 1: Construir filtro por cada segmento
  // ─────────────────────────────────────────────────────────────────

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const videoInputIdx = inputMap.videoInputs[i] || 0;

    // Label de entrada para este segmento
    const inLabel = `${videoInputIdx}:v`;

    // Filtro del segmento
    const segmentFilter = buildSegmentFilter(seg, inLabel, i);
    const outLabel = `[v${i}]`;

    videoFilters.push(`${segmentFilter}${outLabel}`);
    videoLabels.push(`[v${i}]`);
  }

  // ─────────────────────────────────────────────────────────────────
  // PASO 2: Concatenar todos los segmentos
  // ─────────────────────────────────────────────────────────────────

  const concatFilter = `${videoLabels.join('')}concat=n=${segments.length}:v=1:a=0[cat]`;
  videoFilters.push(concatFilter);

  // ─────────────────────────────────────────────────────────────────
  // PASO 3: Aplicar color grade global
  // ─────────────────────────────────────────────────────────────────

  const gradeFilter = getGradeFilter(globalColorGrade);
  videoFilters.push(`[cat]${gradeFilter}[graded]`);

  // ─────────────────────────────────────────────────────────────────
  // PASO 4: Vignette (oscurecimiento de bordes)
  // ─────────────────────────────────────────────────────────────────

  videoFilters.push(`[graded]vignette='${VIGNETTE_CONFIG.strength}'[vignetted]`);

  // ─────────────────────────────────────────────────────────────────
  // PASO 5: Logo/Watermark (opcional)
  // ─────────────────────────────────────────────────────────────────

  let finalVideoLabel = '[vignetted]';

  if (inputMap.logoIdx !== null) {
    const logoInput = `${inputMap.logoIdx}:v`;
    const logoFilter = `[${logoInput}]scale=${VIGNETTE_CONFIG.logoScale}:-1,format=rgba,colorchannelmixer=aa=${VIGNETTE_CONFIG.logoAlpha}[wm]`;
    videoFilters.push(logoFilter);
    videoFilters.push(`[vignetted][wm]overlay=${VIGNETTE_CONFIG.logoPosition}[branded]`);
    finalVideoLabel = '[branded]';
  }

  // ─────────────────────────────────────────────────────────────────
  // PASO 6: Subtítulos
  // ─────────────────────────────────────────────────────────────────

  let subtitlesFilterApplied = false;
  if (assFilePath) {
    // Escapar la ruta para FFmpeg (Windows: reemplazar \ por /)
    const escapedPath = assFilePath.replace(/\\/g, '/');
    videoFilters.push(`${finalVideoLabel}subtitles='${escapedPath}'[out]`);
    subtitlesFilterApplied = true;
  } else {
    videoFilters.push(`${finalVideoLabel}[out]`);
    subtitlesFilterApplied = false;
  }

  // ─────────────────────────────────────────────────────────────────
  // AUDIO: pasar el audio principal sin procesar (ya normalizado)
  // ─────────────────────────────────────────────────────────────────

  const audioInputIdx = inputMap.audioIdx || 0;
  audioFilters.push(`[${audioInputIdx}:a]aformat=sample_rates=44100:channel_layouts=mono[aout]`);

  // ─────────────────────────────────────────────────────────────────
  // Construir el filtergraph completo
  // ─────────────────────────────────────────────────────────────────

  const allFilters = [...videoFilters, ...audioFilters].join(';');

  logger.debug(`[concat-builder] Built filter for ${segments.length} segments with subtitles=${subtitlesFilterApplied}`);

  return {
    filterGraph: allFilters,
    outputLabels: {
      video: '[out]',
      audio: '[aout]',
    },
    subtitlesFilterApplied,
  };
}

/**
 * Construye el filtro de un segmento individual
 * Incluye: escala, crop, pan, zoom, efectos
 *
 * @param {Object} segment - segmento del plan visual
 * @param {string} inputLabel - label de entrada (ej: "0:v")
 * @param {number} segmentIndex - índice del segmento
 * @returns {string} - filtro FFmpeg para este segmento
 */
function buildSegmentFilter(segment, inputLabel, segmentIndex) {
  let filter = `[${inputLabel}]`;

  // ─ Escala base (con margen para pan/zoom)
  const motion = CAMERA_MOTION_BASE[segment.movement] || CAMERA_MOTION_BASE['push-in-rapido'];
  const scaleW = motion.scale.includes('W') ? motion.scale.split(':')[0].replace('W', '1300') : '1300';
  const scaleH = motion.scale.includes('H') ? motion.scale.split(':')[1].replace('H', '2240') : '2240';

  filter += `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase`;

  // ─ Crop a 1080x1920 con pan sinusoidal
  const panExpr = `(W-1080)/2+${motion.panX}*sin(2*PI*t/${segment.duration})`;
  const cropExpr = `1080:1920:${panExpr}:${motion.panY}`;

  filter += `,crop=${cropExpr}`;

  // ─ Punch zoom (solo reengage/peak)
  if (segment.isPunchZoom) {
    const zoomExpr = `1+${(PUNCH_ZOOM_CONFIG.maxScale - 1)} * (t / ${segment.duration})`;
    filter += `,scale=${zoomExpr}*in_w:${zoomExpr}*in_h`;
  }

  // ─ Frame rate y formato
  filter += `,fps=30,format=yuv420p,setsar=1`;

  // ─ Trim al rango del segmento
  filter += `,trim=duration=${segment.duration.toFixed(2)},setpts=PTS-STARTPTS`;

  return filter;
}

/**
 * Valida el filtergraph antes de pasarlo a FFmpeg
 * Retorna true si es válido, false si hay problemas
 *
 * @param {string} filterGraph - el filtergraph a validar
 * @returns {boolean}
 */
function validateFilterGraph(filterGraph) {
  if (!filterGraph || filterGraph.length === 0) {
    return false;
  }

  // Validaciones básicas
  if (!filterGraph.includes('[out]')) {
    logger.warn('[concat-builder] Filter graph missing output label [out]');
    return false;
  }

  if (!filterGraph.includes('[aout]')) {
    logger.warn('[concat-builder] Filter graph missing audio output label [aout]');
    return false;
  }

  return true;
}

module.exports = {
  buildComplexFilter,
  buildSegmentFilter,
  validateFilterGraph,
};
