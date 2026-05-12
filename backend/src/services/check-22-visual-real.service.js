/**
 * check-22-visual-real.service.js
 * CHECK 22: Verifica que el vídeo tiene contenido visual útil, no solo fondos abstractos/colores.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Categorías de fondo pobre (solo colores/abstracto, sin contenido real)
const ABSTRACT_ONLY_CATEGORIES = new Set([
  'minimal_dark',
  'geometric_motion',
  'abstract',
  'abstract_blue',
  'particles',
  'particles_gold',
  'dark_texture',
  'gradient',
  'solid_color',
  'color_background',
  'animation_abstract',
  'motion_abstract',
  'neural_flow',
  'particle_drift',
]);

// Categorías que SÍ tienen contenido real
const REAL_CONTENT_CATEGORIES = new Set([
  'pexels',
  'pixabay',
  'real_footage',
  'city_night',
  'nature',
  'people',
  'objects',
  'scenes',
]);

/**
 * Analiza el background plan del metadata
 */
function analyzeBackgroundPlan(videoPath) {
  const videoDir = path.dirname(videoPath);
  const genMetadataPath = path.join(videoDir, 'generation-metadata.json');

  const result = {
    hasBackgroundPlan: false,
    categories: [],
    hasRealAssets: false,
    isColorFallbackOnly: false,
    diversityScore: 0,
    issues: [],
  };

  if (!fs.existsSync(genMetadataPath)) {
    result.issues.push('No generation-metadata.json found');
    return result;
  }

  try {
    const genMetadata = JSON.parse(fs.readFileSync(genMetadataPath, 'utf8'));
    const bgPlan = genMetadata.backgroundPlan;

    if (!bgPlan) {
      result.issues.push('No backgroundPlan in generation-metadata');
      return result;
    }

    result.hasBackgroundPlan = true;
    result.diversityScore = bgPlan.diversityScore || 0;

    // Analizar categorías usadas
    if (bgPlan.usedCategories && Array.isArray(bgPlan.usedCategories)) {
      result.categories = bgPlan.usedCategories;

      // Detectar si hay contenido real
      const hasRealAssets = bgPlan.usedCategories.some(cat =>
        REAL_CONTENT_CATEGORIES.has(cat) || !ABSTRACT_ONLY_CATEGORIES.has(cat)
      );
      result.hasRealAssets = hasRealAssets;

      // Detectar si es SOLO abstracto
      const allAbstractOrEmpty = bgPlan.usedCategories.every(cat =>
        ABSTRACT_ONLY_CATEGORIES.has(cat) || cat === '' || !cat
      );

      if (allAbstractOrEmpty && bgPlan.usedCategories.length > 0) {
        result.isColorFallbackOnly = true;
        result.issues.push(`Video uses only abstract/color categories: ${bgPlan.usedCategories.join(', ')}`);
      }

      // Exigir diversidad mínima
      if (result.diversityScore < 50) {
        result.issues.push(`diversityScore is low (${result.diversityScore}, min recommended: 50)`);
      }
    }

    // Analizar clips
    if (bgPlan.clipTimeline && Array.isArray(bgPlan.clipTimeline)) {
      const realClips = bgPlan.clipTimeline.filter(clip =>
        REAL_CONTENT_CATEGORIES.has(clip.category)
      );

      if (realClips.length === 0) {
        result.issues.push('No real content clips found in timeline');
      }

      // Verificar dominantColors
      const colors = bgPlan.clipTimeline
        .flatMap(clip => clip.dominantColors || [])
        .filter(c => c);

      if (colors.length > 0 && colors.every(c => ['black', 'dark_gray', 'gray', 'white'].includes(c))) {
        result.issues.push('All clips use only grayscale colors, likely abstract/minimal');
      }
    }

    return result;
  } catch (err) {
    logger.error('[CHECK_22] Error analyzing background plan:', err.message);
    result.issues.push(`Error reading metadata: ${err.message}`);
    return result;
  }
}

/**
 * Comprueba render mode
 */
function checkRenderMode(videoPath) {
  const videoDir = path.dirname(videoPath);
  const genMetadataPath = path.join(videoDir, 'generation-metadata.json');
  const renderMetadataPath = path.join(videoDir, 'render-metadata.json');

  const result = {
    renderMode: null,
    appliedToRender: false,
    issues: [],
  };

  try {
    if (fs.existsSync(genMetadataPath)) {
      const genMetadata = JSON.parse(fs.readFileSync(genMetadataPath, 'utf8'));
      result.renderMode = genMetadata.renderMode;

      if (genMetadata.backgroundPlan?.appliedToRender === false) {
        result.issues.push('Background plan was NOT applied to render (appliedToRender=false)');
      } else {
        result.appliedToRender = true;
      }
    }

    if (fs.existsSync(renderMetadataPath)) {
      const renderMetadata = JSON.parse(fs.readFileSync(renderMetadataPath, 'utf8'));
      if (renderMetadata.renderMode === 'video_use' && result.renderMode === 'dynamic_background_timeline') {
        result.issues.push('Render metadata uses old video_use mode but generation says dynamic_background_timeline');
      }
    }
  } catch (err) {
    logger.error('[CHECK_22] Error checking render mode:', err.message);
    result.issues.push(`Error reading render metadata: ${err.message}`);
  }

  return result;
}

/**
 * Ejecuta CHECK 22 completo
 */
function checkVisualNotColorFallback(videoPath) {
  const details = {
    videoPath,
    backgroundPlan: {},
    renderMode: null,
    issues: [],
  };

  logger.info('[CHECK_22] Starting visual quality validation');

  // 1. Analizar background plan
  const bgAnalysis = analyzeBackgroundPlan(videoPath);
  details.backgroundPlan = bgAnalysis;
  details.issues.push(...bgAnalysis.issues);

  if (bgAnalysis.isColorFallbackOnly) {
    logger.error('[CHECK_22] Video uses only color/abstract backgrounds');
  } else {
    logger.info('[CHECK_22] Video has real content or diverse backgrounds ✓');
  }

  // 2. Verificar render mode
  const renderAnalysis = checkRenderMode(videoPath);
  details.renderMode = renderAnalysis.renderMode;
  details.issues.push(...renderAnalysis.issues);

  // 3. Decisión final
  if (bgAnalysis.isColorFallbackOnly && bgAnalysis.diversityScore < 70) {
    logger.error('[CHECK_22] FAIL', {
      videoPath,
      reason: 'Color fallback only with low diversity',
      issues: details.issues,
    });

    return {
      ready: false,
      reason: 'CHECK_22_VISUAL_COLOR_FALLBACK_ONLY',
      details,
    };
  }

  if (details.issues.length > 0) {
    logger.warn('[CHECK_22] Issues detected:', {
      videoPath,
      issues: details.issues,
    });
  }

  logger.info('[CHECK_22] PASS', {
    videoPath,
    hasRealAssets: bgAnalysis.hasRealAssets,
    diversityScore: bgAnalysis.diversityScore,
  });

  return {
    ready: true,
    details,
  };
}

module.exports = {
  checkVisualNotColorFallback,
  analyzeBackgroundPlan,
  checkRenderMode,
  ABSTRACT_ONLY_CATEGORIES,
  REAL_CONTENT_CATEGORIES,
};
