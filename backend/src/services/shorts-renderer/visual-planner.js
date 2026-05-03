/**
 * visual-planner.js
 * Planificador visual: asigna clips Pexels a cada segmento narrativo.
 * Usa SEGMENT_DEFAULTS para duraciones y movimientos.
 */

const { SEGMENT_KEYS, SEGMENT_DEFAULTS, TOTAL_SEGMENT_DURATION, PUNCH_ZOOM_CONFIG, VIRAL_PACING } = require('./style-config');
const { filterGapsForSegment } = require('./silence-detector');
const logger = require('../utils/logger');

/**
 * Construye el plan visual: qué clip va en qué segmento, con qué movimiento
 *
 * @param {Object} script - guión con estructura expandida (hook, open_loop, etc.)
 * @param {Array<string>} bgVideos - rutas a clips Pexels descargados
 * @param {number} realDuration - duración real del audio (ffprobe)
 * @param {Array<number>} silenceCuts - timestamps de gaps detectados
 * @returns {Array<SegmentPlan>} - plan de segmentos con clip asignado, movimiento, etc.
 */
function buildVisualPlan(script, bgVideos, realDuration, silenceCuts = []) {
  if (!bgVideos || bgVideos.length === 0) {
    logger.warn('[visual-planner] No background videos available, using fallback');
    bgVideos = []; // fallback será manejo del render-executor
  }

  // Calcular duración de cada segmento en el script expandido
  const expandedSegments = SEGMENT_KEYS.filter(key => script[key]);

  if (expandedSegments.length === 0) {
    logger.warn('[visual-planner] No expanded segments in script, falling back to simple structure');
    expandedSegments.push('hook', 'claim', 'explanation', 'cta');
  }

  // Escalar duraciones: si SEGMENT_DEFAULTS suma 23.6s pero realDuration es 50s
  // cada segmento se escala proporcionalmente
  const scaleFactor = realDuration / TOTAL_SEGMENT_DURATION;
  logger.info(`[visual-planner] Duration scale factor: ${scaleFactor.toFixed(2)}x`);

  const segmentPlan = [];
  let currentTime = 0;

  for (let i = 0; i < expandedSegments.length; i++) {
    const segmentKey = expandedSegments[i];
    const defaults = SEGMENT_DEFAULTS[segmentKey] || SEGMENT_DEFAULTS.hook;
    const scaledDuration = defaults.durationSeconds * scaleFactor;
    const startTime = currentTime;
    const endTime = currentTime + scaledDuration;

    // Asignar clip (round-robin, variado)
    const clipIndex = i % Math.max(1, bgVideos.length);
    const clipPath = bgVideos[clipIndex] || null;

    // Offset dentro del clip para variar (no siempre empezar en t=0)
    const clipOffset = computeClipOffset(clipIndex, bgVideos.length, i);

    // Determinar si este segmento recibe punch zoom
    const isPunchZoom = segmentKey === 'reengage' || segmentKey === 'peak';

    // Filtrar silencios que caen dentro de este segmento
    const gapsInSegment = filterGapsForSegment(silenceCuts, startTime, endTime);

    const plan = {
      key: segmentKey,
      startTime,
      endTime,
      duration: scaledDuration,
      clipPath,
      clipOffset,
      movement: defaults.movement,
      transition: defaults.transition,
      colorGrade: defaults.colorGrade,
      intensity: defaults.intensity,
      isPunchZoom,
      silenceCuts: gapsInSegment,
    };

    segmentPlan.push(plan);
    currentTime = endTime;

    logger.debug(`[visual-planner] Segment ${segmentKey} | ${startTime.toFixed(1)}-${endTime.toFixed(1)}s | clip=${clipIndex} | movement=${defaults.movement}`);
  }

  logger.info(`[visual-planner] Created plan for ${segmentPlan.length} segments`);

  return segmentPlan;
}

/**
 * Calcula un offset inicial dentro de un clip para evitar repetición
 * Clips dinámicos (índice bajo) arrancan desde el inicio
 * Clips estáticos (índice alto) arrancan con offset progresivo
 *
 * @param {number} clipIndex - índice del clip
 * @param {number} totalClips - número total de clips
 * @param {number} segmentIndex - índice del segmento
 * @returns {number} - offset en segundos
 */
function computeClipOffset(clipIndex, totalClips, segmentIndex) {
  if (totalClips <= 1) return 0;

  // Los clips "dinámicos" (primeros) arrancan en t=0
  if (clipIndex === 0) return 0;

  // Los clips "estáticos" (últimos) tienen offset progresivo
  // Para evitar que se noten como repetidos
  const offsetPerSegment = 2.5; // segundos por segmento
  return (segmentIndex * offsetPerSegment) % 10;
}

/**
 * Determina si un segmento debe recibir punch zoom
 * @param {string} segmentKey - clave del segmento
 * @returns {boolean}
 */
function needsPunchZoom(segmentKey) {
  return segmentKey === 'reengage' || segmentKey === 'peak';
}

/**
 * Valida que el plan visual cumpla con restricciones de viralidad:
 * - Cada segmento entre 1.5-3 segundos
 * - Cambios visuales cada 2-3 segundos
 * - Duración total 15-25 segundos
 */
function validateViralPacing(segmentPlan, realDuration) {
  const violations = [];

  // Validar duración total
  if (realDuration < VIRAL_PACING.minDuration / 1000) {
    violations.push(`Duration too short: ${realDuration}s < ${VIRAL_PACING.minDuration / 1000}s (min)`);
  }
  if (realDuration > VIRAL_PACING.maxDuration / 1000) {
    violations.push(`Duration too long: ${realDuration}s > ${VIRAL_PACING.maxDuration / 1000}s (max)`);
  }

  // Validar duración de segmentos
  segmentPlan.forEach((segment, idx) => {
    const durationMs = segment.duration * 1000;
    if (durationMs > VIRAL_PACING.maxSegmentDuration) {
      violations.push(`Segment ${idx} (${segment.key}) too long: ${segment.duration}s > ${VIRAL_PACING.maxSegmentDuration / 1000}s`);
    }
    if (durationMs < VIRAL_PACING.minSegmentDuration) {
      violations.push(`Segment ${idx} (${segment.key}) too short: ${segment.duration}s < ${VIRAL_PACING.minSegmentDuration / 1000}s`);
    }
  });

  // Log violations si existen
  if (violations.length > 0) {
    logger.warn(`[viral-pacing] Violations detected: ${violations.join(' | ')}`);
  } else {
    logger.info(`[viral-pacing] ✓ All constraints met | ${segmentPlan.length} segments | ${realDuration.toFixed(1)}s duration`);
  }

  return {
    valid: violations.length === 0,
    violations,
    conformance: {
      segmentCount: segmentPlan.length,
      totalDuration: realDuration,
      avgSegmentDuration: (realDuration / segmentPlan.length).toFixed(2),
    },
  };
}

module.exports = {
  buildVisualPlan,
  computeClipOffset,
  needsPunchZoom,
  validateViralPacing,
};
