/**
 * export-manager.js
 *
 * Gestiona la exportación automática de vídeos finales para revisión manual.
 * - Crea estructura de carpetas por fecha
 * - Genera nombres inteligentes basados en hook
 * - Copia vídeo + metadata + descripción
 * - Solo exporta vídeos válidos (whisper, word_timestamps, etc)
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { collectVideoPerformance } = require('./analytics-collector.service');
const { analyzePerformance } = require('./performance-analyzer.service');

const EXPORTS_BASE = path.resolve('./exports');

/**
 * Normaliza slug: lowercase, sin tildes, máximo 6 palabras
 */
function generateHookSlug(hookText = '') {
  if (!hookText || typeof hookText !== 'string') return 'hook';

  return hookText
    .toLowerCase()
    .trim()
    // Quitar tildes
    .replace(/á/g, 'a')
    .replace(/é/g, 'e')
    .replace(/í/g, 'i')
    .replace(/ó/g, 'o')
    .replace(/ú/g, 'u')
    .replace(/ñ/g, 'n')
    // Quitar símbolos especiales
    .replace(/[¿?¡!,;:'"]/g, '')
    // Espacios múltiples → underscore
    .replace(/\s+/g, '_')
    // Máximo 6 palabras (divide por underscore y toma primeros 6)
    .split('_')
    .slice(0, 6)
    .join('_')
    // Eliminar underscores al inicio/fin
    .replace(/^_+|_+$/g, '');
}

/**
 * Validar que un vídeo es exportable
 */
function isExportableVideo(metadata = {}) {
  const rules = {
    duration: metadata.duration >= 25,
    renderMode: metadata.renderMode === 'video_use',
    subtitleTiming: metadata.subtitleTimingMode === 'word_timestamps',
    wordEngine: metadata.wordAlignmentEngine === 'whisper',
    qcPass: metadata.qcPass === true,
  };

  return Object.values(rules).every(v => v);
}

/**
 * Obtener ruta de carpeta por fecha
 */
function getDateFolder() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return path.join(EXPORTS_BASE, `${year}-${month}-${day}`);
}

/**
 * Obtener nombre de archivo con timestamp
 */
function getExportFilename(hookText = '') {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const slug = generateHookSlug(hookText);

  return `${hours}-${minutes}__${slug}`;
}

/**
 * Exportar vídeo (copia + metadata + descripción)
 */
async function exportVideo(videoPath, metadata = {}) {
  try {
    // 1. Validar que sea exportable
    if (!isExportableVideo(metadata)) {
      logger.warn('ExportManager: video no cumple criterios de export', {
        duration: metadata.duration,
        renderMode: metadata.renderMode,
        subtitleTiming: metadata.subtitleTimingMode,
        wordEngine: metadata.wordAlignmentEngine,
        qcPass: metadata.qcPass,
      });
      return null;
    }

    // 2. Crear carpeta de fecha si no existe
    const dateFolder = getDateFolder();
    if (!fs.existsSync(dateFolder)) {
      fs.mkdirSync(dateFolder, { recursive: true });
    }

    // 3. Generar nombre base
    const filename = getExportFilename(metadata.hook);

    // 4. Copiar vídeo
    const videoExportPath = path.join(dateFolder, `${filename}.mp4`);
    fs.copyFileSync(videoPath, videoExportPath);
    logger.info(`ExportManager: exported video → ${path.relative(EXPORTS_BASE, videoExportPath)}`);

    // 5. Crear JSON metadata
    const jsonExportPath = path.join(dateFolder, `${filename}.json`);
    const jsonContent = {
      id: metadata.videoId,
      hook: metadata.hook,
      hookType: metadata.hookType || 'observable',
      topic: metadata.topic,
      emotionalTrigger: metadata.emotionalTrigger,
      viralTrigger: metadata.viralTrigger,
      duration: metadata.duration,
      viralityScore: metadata.viralityScore,
      formatScore: metadata.formatScore,
      emotionalImpactScore: metadata.emotionalImpactScore || 0,
      publishSlot: metadata.publishSlot || 'unknown',
      createdAt: metadata.createdAt || new Date().toISOString(),
      renderMode: metadata.renderMode,
      subtitleTimingMode: metadata.subtitleTimingMode,
      wordAlignmentEngine: metadata.wordAlignmentEngine,
      segmentsUsed: metadata.segmentsUsed,
      qcPass: metadata.qcPass,
      exportedAt: new Date().toISOString(),
    };
    fs.writeFileSync(jsonExportPath, JSON.stringify(jsonContent, null, 2));
    logger.info(`ExportManager: exported metadata → ${path.relative(EXPORTS_BASE, jsonExportPath)}`);

    // 6. Crear TXT descripción
    const txtExportPath = path.join(dateFolder, `${filename}.txt`);
    const txtContent = `HOOK:
${metadata.hook}

TOPIC:
${metadata.topic}

SCRIPT:
${metadata.fullScript || '(no script)'}

SCORE:
Virality:     ${metadata.viralityScore}/100
Format:       ${metadata.formatScore}/100
Emotional:    ${metadata.emotionalImpactScore || 'N/A'}

METADATA:
Duration:     ${metadata.duration}s
Render:       ${metadata.renderMode}
Subtitles:    ${metadata.subtitleTimingMode}
Word Engine:  ${metadata.wordAlignmentEngine}
QC Pass:      ${metadata.qcPass ? '✅ YES' : '❌ NO'}
Created:      ${metadata.createdAt || new Date().toISOString()}
`;
    fs.writeFileSync(txtExportPath, txtContent);
    logger.info(`ExportManager: exported description → ${path.relative(EXPORTS_BASE, txtExportPath)}`);

    // Recolectar performance data para ML
    const collectionResult = collectVideoPerformance(jsonExportPath);
    if (collectionResult && collectionResult.shouldAnalyze) {
      logger.info(`ExportManager: triggering performance analysis (${collectionResult.totalVideos} videos collected)`);
      const insightsResult = analyzePerformance();
      if (insightsResult) {
        logger.info('ExportManager: performance analysis complete', {
          videos: insightsResult.totalVideosAnalyzed,
          topHook: insightsResult.topHooks[0]?.hook,
          topTopic: insightsResult.topTopics[0]?.topic,
        });
      }
    }

    return {
      success: true,
      folder: dateFolder,
      filename,
      videoPath: videoExportPath,
      metadataPath: jsonExportPath,
      descriptionPath: txtExportPath,
    };
  } catch (err) {
    logger.error('ExportManager: export failed', { error: err.message, videoPath, metadata });
    return null;
  }
}

/**
 * Limpiar exports viejos (opcional)
 */
function cleanOldExports(daysToKeep = 30) {
  try {
    const now = Date.now();
    const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

    if (!fs.existsSync(EXPORTS_BASE)) return;

    const folders = fs.readdirSync(EXPORTS_BASE);
    for (const folder of folders) {
      const folderPath = path.join(EXPORTS_BASE, folder);
      const stat = fs.statSync(folderPath);

      if (now - stat.mtimeMs > maxAge) {
        // Folder es más viejo que daysToKeep
        logger.info(`ExportManager: removing old export folder → ${folder}`);
        fs.rmSync(folderPath, { recursive: true });
      }
    }
  } catch (err) {
    logger.warn('ExportManager: cleanup failed', { error: err.message });
  }
}

module.exports = {
  exportVideo,
  generateHookSlug,
  isExportableVideo,
  getDateFolder,
  getExportFilename,
  cleanOldExports,
};
