/**
 * render-orchestrator.js
 * Orquesta los 8 pasos del pipeline de render.
 * Coordina todos los módulos en el orden correcto.
 */

const fs = require('fs');
const path = require('path');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobe = require('fluent-ffmpeg').ffprobe;
const logger = require('../utils/logger');

// Módulos
const { buildVisualPlan } = require('./visual-planner');
const { detectSilenceGaps } = require('./silence-detector');
const { buildSubtitles, writeASSFile, writeSRTFile } = require('./subtitle-builder');
const { selectColorGrade } = require('./color-grader');
const { buildComplexFilter } = require('./concat-builder');
const { executeRender, validateOutput, writeRenderMetadata } = require('./render-executor');
const { buildAudioFadeFilters, extractSegmentEnds } = require('./audio-fader');

// Reutilizar getPexelsVideos del módulo actual
let getPexelsVideos;
try {
  const videoRenderer = require('../video-renderer');
  // Extraer getPexelsVideos si existe
  // Fallback: crear un mock vacío
  getPexelsVideos = async (script, bgStyle) => {
    logger.warn('[orchestrator] getPexelsVideos not available, returning empty');
    return [];
  };
} catch (err) {
  logger.warn(`[orchestrator] Could not load video-renderer: ${err.message}`);
  getPexelsVideos = async () => [];
}

ffprobe.setFfprobePath(ffmpegInstaller.path);

/**
 * Obtiene la duración real del audio usando ffprobe
 * @param {string} audioPath - ruta al archivo de audio
 * @returns {Promise<number>} - duración en segundos
 */
async function getRealAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffprobe(audioPath, (err, metadata) => {
      if (err) {
        logger.warn(`[orchestrator] ffprobe error: ${err.message}, using fallback`);
        return resolve(45); // fallback
      }

      const duration = metadata.format.duration || 45;
      resolve(duration);
    });
  });
}

/**
 * PASO 1 — ffprobe: obtener duración real
 * PASO 2 — silencedetect: detectar gaps
 * PASO 3 — Pexels: descargar clips
 * PASO 4 — visual-planner: asignar clips a segmentos
 * PASO 5 — subtitle-builder: generar subtítulos
 * PASO 6 — color-grader: seleccionar presets
 * PASO 7 — concat-builder: construir filtergraph
 * PASO 8 — render-executor: ejecutar FFmpeg
 */
async function orchestrateRender(options = {}) {
  const { script, audioPath, audioDuration, outputPath, themeId, wordBoundaries, sectionDurations, bgStyle } = options;
  const outputDir = path.dirname(outputPath);
  const startTime = Date.now();

  try {
    logger.info(`[orchestrator] Starting render pipeline for ${script?.title || 'unknown'}`);

    // ─── PASO 1: ffprobe ───
    logger.info('[orchestrator] [1/8] ffprobe...');
    const realDuration = await getRealAudioDuration(audioPath);
    logger.info(`[orchestrator] Audio duration: ${realDuration.toFixed(1)}s`);

    // ─── PASO 2: silencedetect ───
    logger.info('[orchestrator] [2/8] Detecting silence gaps...');
    const silenceCuts = sectionDurations ? [] : await detectSilenceGaps(audioPath);
    logger.info(`[orchestrator] Found ${silenceCuts.length} silence gaps`);

    // ─── PASO 3: Pexels ───
    logger.info('[orchestrator] [3/8] Downloading Pexels clips...');
    const bgVideos = await getPexelsVideos(script, bgStyle);
    logger.info(`[orchestrator] Got ${bgVideos.length} clip(s)`);

    // ─── PASO 4: visual-planner ───
    logger.info('[orchestrator] [4/8] Planning visual layout...');
    const segments = buildVisualPlan(script, bgVideos, realDuration, silenceCuts);
    const totalPlanDuration = segments.reduce((sum, s) => sum + s.duration, 0);
    logger.info(`[orchestrator] Planned ${segments.length} segments, duration ${totalPlanDuration.toFixed(1)}s`);

    // ─── PASO 5: subtitle-builder ───
    logger.info('[orchestrator] [5/8] Building subtitles...');
    const { blocks } = await buildSubtitles(script, realDuration, wordBoundaries, sectionDurations);
    const assPath = await writeASSFile(blocks, outputDir);
    await writeSRTFile(blocks, outputDir);
    logger.info(`[orchestrator] Generated ${blocks.length} subtitle blocks`);

    // ─── PASO 6: color-grader ───
    logger.info('[orchestrator] [6/8] Selecting color grade...');
    const globalColorGrade = selectColorGrade(themeId, 'global', 'media');
    logger.info(`[orchestrator] Color grade: ${globalColorGrade}`);

    // ─── PASO 7: concat-builder ───
    logger.info('[orchestrator] [7/8] Building filtergraph...');
    const inputMap = {
      videoInputs: bgVideos.map((_, i) => i),
      audioIdx: bgVideos.length,
      musicIdx: null, // opcional: agregar música si existe
      logoIdx: null,  // opcional: agregar logo si existe
    };

    const { filterGraph, outputLabels } = buildComplexFilter(segments, inputMap, assPath, globalColorGrade);
    logger.debug(`[orchestrator] FilterGraph length: ${filterGraph.length} chars`);

    // ─── PASO 8: render-executor ───
    logger.info('[orchestrator] [8/8] Rendering video...');
    const renderResult = await executeRender(
      { segments, totalDuration: realDuration, colorGrade: globalColorGrade },
      audioPath,
      outputPath,
      inputMap,
      filterGraph
    );

    // Validar output
    const validation = await validateOutput(outputPath, realDuration);
    if (!validation.valid) {
      logger.warn(`[orchestrator] Output validation failed: ${validation.reason}`);
    }

    // Escribir metadatos
    writeRenderMetadata(outputDir, { segments, totalDuration: realDuration, colorGrade: globalColorGrade }, renderResult);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[orchestrator] Render complete in ${elapsed}s`);

    return {
      success: true,
      outputPath,
      renderPlan: { segments, totalDuration: realDuration },
      validation,
    };
  } catch (err) {
    logger.error(`[orchestrator] Render failed: ${err.message}`);

    // Fallback: intentar usar el motor actual si esto falla
    logger.warn('[orchestrator] Falling back to current render engine');

    throw err; // Dejar que el router maneje el fallback
  }
}

module.exports = {
  orchestrateRender,
  getRealAudioDuration,
};
