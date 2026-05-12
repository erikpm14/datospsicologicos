/**
 * BACKGROUND DIVERSITY SERVICE
 *
 * Sistema de rotación y diversidad visual para evitar fondos repetidos.
 * Mantiene historial de assets usados, implementa scoring de diversidad,
 * y selecciona fondos para maximizar variedad visual.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Categorías visuales permitidas
const VISUAL_CATEGORIES = {
  abstract: { label: 'Abstract neural/energy', penalty: 0 },
  dark_texture: { label: 'Dark textured', penalty: 0 },
  particles: { label: 'Particle effects', penalty: 0 },
  city_night: { label: 'City night/urban', penalty: 0 },
  human_silhouette: { label: 'Human silhouette', penalty: 0 },
  social_scenes: { label: 'Social/people scenes', penalty: 0 },
  emotional_portrait: { label: 'Emotional portrait', penalty: 0 },
  nature_moody: { label: 'Nature/moody', penalty: 0 },
  glitch_digital: { label: 'Glitch/digital', penalty: 0 },
  minimal_dark: { label: 'Minimal dark motion', penalty: 0 },
  psychology_symbolic: { label: 'Psychology symbolic', penalty: 0 },
  geometric_motion: { label: 'Geometric motion', penalty: 0 },
  document_textural: { label: 'Document/textural', penalty: 0 },
  neutral_cinematic: { label: 'Neutral cinematic', penalty: 0 },
};

// Assets de fondo disponibles (configuración global)
const BACKGROUND_ASSETS = [
  {
    assetId: 'bg_abstract_purple_001',
    category: 'abstract',
    dominantColors: ['purple', 'pink'],
    motionType: 'neural_flow',
    description: 'Purple neural network abstract',
  },
  {
    assetId: 'bg_abstract_blue_001',
    category: 'abstract',
    dominantColors: ['blue', 'cyan'],
    motionType: 'neural_flow',
    description: 'Blue neural network abstract',
  },
  {
    assetId: 'bg_particles_gold_001',
    category: 'particles',
    dominantColors: ['gold', 'black'],
    motionType: 'particle_drift',
    description: 'Gold particles on dark background',
  },
  {
    assetId: 'bg_geometric_motion_001',
    category: 'geometric_motion',
    dominantColors: ['white', 'black'],
    motionType: 'geometric_transform',
    description: 'Geometric shapes in motion',
  },
  {
    assetId: 'bg_dark_texture_001',
    category: 'dark_texture',
    dominantColors: ['gray', 'black'],
    motionType: 'subtle_texture',
    description: 'Dark textured background',
  },
  {
    assetId: 'bg_city_night_001',
    category: 'city_night',
    dominantColors: ['blue', 'black'],
    motionType: 'cinematic_pan',
    description: 'City skyline night lights',
  },
  {
    assetId: 'bg_minimal_dark_001',
    category: 'minimal_dark',
    dominantColors: ['black', 'dark_gray'],
    motionType: 'slow_motion',
    description: 'Minimal dark motion',
  },
  {
    assetId: 'bg_psychology_symbolic_001',
    category: 'psychology_symbolic',
    dominantColors: ['red', 'purple'],
    motionType: 'symbolic_animation',
    description: 'Psychology symbolic imagery',
  },
];

// Ruta del archivo de estado
const STATE_FILE = path.resolve(__dirname, '../../data/background-usage-state.json');

function ensureStateDir() {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadUsageState() {
  try {
    ensureStateDir();
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    logger.warn(`[BACKGROUND_STATE_LOAD_FAILED] ${err.message}`);
  }

  return {
    recentBackgrounds: [], // Array of { assetId, category, videoId, timestamp }
    categoryUsageHistory: {},
    colorUsageHistory: {},
    nextRotationIndex: 0,
  };
}

function saveUsageState(state) {
  try {
    ensureStateDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.error(`[BACKGROUND_STATE_SAVE_FAILED] ${err.message}`);
  }
}

function calculateColorDiversity(newColors, recentColors) {
  if (!recentColors || recentColors.length === 0) return 100;

  let matchScore = 0;
  for (const color of newColors) {
    if (recentColors.includes(color)) {
      matchScore += 20;
    }
  }

  return Math.max(0, 100 - matchScore);
}

function calculateCategoryDiversity(newCategory, state) {
  const recent = state.recentBackgrounds.slice(0, 5);

  if (recent.length === 0) return 100;

  // Penalizar si la misma categoría fue usada recientemente
  const categoryMatches = recent.filter(bg => bg.category === newCategory).length;

  if (categoryMatches === 0) return 100;
  if (categoryMatches === 1) return 70;
  if (categoryMatches >= 2) return 30;

  return 50;
}

function calculateNoveltyScore(assetId, state) {
  const recent = state.recentBackgrounds.slice(0, 10);

  // Penalizar uso muy reciente del mismo asset exacto
  const exactMatch = recent.find(bg => bg.assetId === assetId);
  if (exactMatch) return 10; // Very low score

  return 100;
}

function calculateBackgroundScore(asset, state) {
  const colorDiversity = calculateColorDiversity(
    asset.dominantColors,
    state.recentBackgrounds.slice(0, 3).flatMap(bg => {
      const a = BACKGROUND_ASSETS.find(x => x.assetId === bg.assetId);
      return a ? a.dominantColors : [];
    })
  );

  const categoryDiversity = calculateCategoryDiversity(asset.category, state);
  const noveltyScore = calculateNoveltyScore(asset.assetId, state);

  // Tempor penalty para purple/pink abstract (veto temporal)
  let temporalPenalty = 0;
  if (asset.category === 'abstract' && asset.dominantColors.includes('purple')) {
    temporalPenalty = 60; // Strong penalty for repeated purple abstract
  }

  const finalScore =
    colorDiversity * 0.3 +
    categoryDiversity * 0.3 +
    noveltyScore * 0.4 -
    temporalPenalty;

  return {
    colorDiversity,
    categoryDiversity,
    noveltyScore,
    temporalPenalty,
    finalScore: Math.max(0, finalScore),
  };
}

function selectBackground(videoId, options = {}) {
  console.log('[BACKGROUND_SELECTION_STARTED]');
  logger.info('[BACKGROUND_SELECTION_STARTED]');

  try {
    ensureStateDir();
    const state = loadUsageState();

    // Score each available asset
    const scoredAssets = BACKGROUND_ASSETS.map(asset => ({
      ...asset,
      ...calculateBackgroundScore(asset, state),
    })).sort((a, b) => b.finalScore - a.finalScore);

    // Select top candidate
    const selected = scoredAssets[0];

    if (!selected) {
      logger.error('[BACKGROUND_SELECTION_FAILED] No assets available');
      return { success: false, reason: 'no_assets' };
    }

    const diversityScore = selected.finalScore;

    // Check diversity threshold
    const diversityPass = diversityScore >= 40; // Threshold
    if (!diversityPass) {
      console.log(`[BACKGROUND_DIVERSITY_LOW] score=${diversityScore.toFixed(1)}`);
      logger.warn(`[BACKGROUND_DIVERSITY_LOW] score=${diversityScore.toFixed(1)}`);
    } else {
      console.log('[BACKGROUND_DIVERSITY_PASS]');
      logger.info('[BACKGROUND_DIVERSITY_PASS]');
    }

    // Update state
    state.recentBackgrounds.unshift({
      assetId: selected.assetId,
      category: selected.category,
      videoId,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 20
    state.recentBackgrounds = state.recentBackgrounds.slice(0, 20);

    // Update category usage
    state.categoryUsageHistory[selected.category] =
      (state.categoryUsageHistory[selected.category] || 0) + 1;

    // Update color usage
    for (const color of selected.dominantColors) {
      state.colorUsageHistory[color] =
        (state.colorUsageHistory[color] || 0) + 1;
    }

    saveUsageState(state);

    console.log('[BACKGROUND_SELECTION_COMPLETED]');
    logger.info(`[BACKGROUND_SELECTION_COMPLETED] assetId=${selected.assetId} category=${selected.category} score=${diversityScore.toFixed(1)}`);

    return {
      success: true,
      selected: {
        assetId: selected.assetId,
        category: selected.category,
        dominantColors: selected.dominantColors,
        motionType: selected.motionType,
        description: selected.description,
      },
      scoring: {
        colorDiversity: selected.colorDiversity,
        categoryDiversity: selected.categoryDiversity,
        noveltyScore: selected.noveltyScore,
        temporalPenalty: selected.temporalPenalty,
        diversityScore: diversityScore.toFixed(1),
      },
      candidates: scoredAssets.slice(0, 3).map(a => ({
        assetId: a.assetId,
        category: a.category,
        score: a.finalScore.toFixed(1),
      })),
    };
  } catch (err) {
    logger.error(`[BACKGROUND_SELECTION_ERROR] ${err.message}`);
    return { success: false, reason: 'exception', error: err.message };
  }
}

function getRecentUsageStats() {
  try {
    const state = loadUsageState();

    return {
      lastUsedAssets: state.recentBackgrounds.slice(0, 5).map(bg => ({
        assetId: bg.assetId,
        category: bg.category,
        videoId: bg.videoId,
        timestamp: bg.timestamp,
      })),
      categoryStats: state.categoryUsageHistory,
      colorStats: state.colorUsageHistory,
      totalRecorded: state.recentBackgrounds.length,
    };
  } catch (err) {
    logger.error(`[BACKGROUND_STATS_ERROR] ${err.message}`);
    return null;
  }
}

function applyBackgroundRotation(script, backgroundPlan) {
  /**
   * Aplica plan de rotación de fondo al script
   * Modifica el script para incluir rotación dentro del vídeo
   */
  if (!backgroundPlan || !backgroundPlan.selectedAssets) {
    return script;
  }

  // Agregar información de fondo al script
  return {
    ...script,
    backgroundPlan: {
      ...backgroundPlan,
      rotationApplied: true,
    },
  };
}

function validateBackgroundDiversity(script, recentVideoBackgrounds) {
  /**
   * Valida que un script tenga suficiente diversidad visual
   * Retorna { valid, reason, score }
   */
  if (!script || !script.backgroundPlan) {
    return { valid: false, reason: 'no_background_plan' };
  }

  const { primaryCategory, diversityScore } = script.backgroundPlan;

  if (diversityScore < 30) {
    return {
      valid: false,
      reason: 'low_diversity_score',
      score: diversityScore,
    };
  }

  return { valid: true, score: diversityScore };
}

function generateBackgroundTimeline(videoId, videoDurationSeconds = 15) {
  /**
   * Genera timeline de rotación interna de fondos
   * Selecciona 3-6 clips, cada uno durando 2-4 segundos
   * Evita repeticiones dentro del mismo vídeo
   * Retorna plan de clips con transiciones
   */
  console.log('[INTERNAL_BACKGROUND_ROTATION_STARTED]');
  logger.info('[INTERNAL_BACKGROUND_ROTATION_STARTED]');

  try {
    const state = loadUsageState();

    // Determinar número de clips (3-6)
    const minClips = 3;
    const maxClips = 6;
    const numClips = Math.floor(Math.random() * (maxClips - minClips + 1)) + minClips;

    // Duración promedio por clip
    const avgClipDuration = videoDurationSeconds / numClips;

    if (avgClipDuration < 2 || avgClipDuration > 4) {
      logger.warn(`[INTERNAL_BACKGROUND_ROTATION_DURATION_WARNING] avgClipDuration=${avgClipDuration.toFixed(2)}s`);
    }

    // Seleccionar assets para timeline
    const selectedAssetIds = new Set();
    const usedCategories = new Set();
    const clipTimeline = [];

    let currentTime = 0;

    for (let i = 0; i < numClips; i++) {
      // Score assets para diversidad dentro del vídeo
      const availableAssets = BACKGROUND_ASSETS.filter(asset => {
        // No repetir asset exacto en el mismo vídeo
        if (selectedAssetIds.has(asset.assetId)) return false;
        // Diversificar categorías (máximo 2 clips de la misma categoría por vídeo)
        const categoryCount = Array.from(usedCategories).filter(c => c === asset.category).length;
        if (categoryCount >= 2) return false;
        return true;
      });

      if (availableAssets.length === 0) {
        logger.warn(`[INTERNAL_BACKGROUND_ROTATION_FALLBACK] No more diverse assets available`);
        console.log('[INTERNAL_BACKGROUND_ROTATION_FALLBACK]');
        break;
      }

      // Score y seleccionar mejor asset para esta posición
      const scoredAssets = availableAssets.map(asset => ({
        ...asset,
        positionScore: calculateBackgroundScore(asset, state).finalScore,
      })).sort((a, b) => b.positionScore - a.positionScore);

      const selectedAsset = scoredAssets[0];

      // Duración variable (2-4 segundos)
      const clipDuration = 2 + Math.random() * 2;
      const endTime = Math.min(currentTime + clipDuration, videoDurationSeconds);

      // Seleccionar transición
      const transitions = ['cut', 'fade', 'zoom', 'pan'];
      const transition = i === 0 ? 'cut' : transitions[Math.floor(Math.random() * transitions.length)];

      clipTimeline.push({
        assetId: selectedAsset.assetId,
        category: selectedAsset.category,
        start: parseFloat(currentTime.toFixed(2)),
        end: parseFloat(endTime.toFixed(2)),
        duration: parseFloat((endTime - currentTime).toFixed(2)),
        transition,
        dominantColors: selectedAsset.dominantColors,
        motionType: selectedAsset.motionType,
      });

      console.log(`[BACKGROUND_CLIP_SELECTED] ${i + 1}/${numClips} | ${selectedAsset.assetId} | ${selectedAsset.category}`);
      logger.info(`[BACKGROUND_CLIP_SELECTED] clip=${i + 1} assetId=${selectedAsset.assetId} duration=${(endTime - currentTime).toFixed(2)}s`);

      selectedAssetIds.add(selectedAsset.assetId);
      usedCategories.add(selectedAsset.category);
      currentTime = endTime;

      if (currentTime >= videoDurationSeconds) break;
    }

    // FIX: Si el último clip no cubre hasta videoDurationSeconds, extender el último clip
    if (clipTimeline.length > 0) {
      const lastClip = clipTimeline[clipTimeline.length - 1];
      if (lastClip.end < videoDurationSeconds) {
        lastClip.end = parseFloat(videoDurationSeconds.toFixed(2));
        lastClip.duration = parseFloat((lastClip.end - lastClip.start).toFixed(2));
        logger.info(`[BACKGROUND_CLIP_EXTENDED] Last clip extended from ${lastClip.end - lastClip.duration} to ${videoDurationSeconds}s`);
        console.log(`[BACKGROUND_CLIP_EXTENDED] Last clip extended to ${videoDurationSeconds}s`);
      }
    }

    // Calcular diversidad de timeline
    const uniqueCategories = Array.from(usedCategories).length;
    const uniqueAssets = selectedAssetIds.size;
    const diversityScore = (uniqueCategories / 3) * 100; // Max 3 categories ideal

    const plan = {
      videoId,
      generatedAt: new Date().toISOString(),
      videoDuration: videoDurationSeconds,
      numClips: clipTimeline.length,
      clipTimeline,
      selectedAssets: Array.from(selectedAssetIds),
      usedCategories: Array.from(usedCategories),
      diversityScore: Math.min(100, parseFloat(diversityScore.toFixed(1))),
      transitionTypes: [...new Set(clipTimeline.map(c => c.transition))],
    };

    console.log(`[BACKGROUND_TIMELINE_CREATED] clips=${clipTimeline.length} categories=${uniqueCategories} assets=${uniqueAssets} score=${plan.diversityScore}`);
    logger.info(`[BACKGROUND_TIMELINE_CREATED] ${clipTimeline.length} clips, diversity=${plan.diversityScore}`);

    console.log('[INTERNAL_BACKGROUND_ROTATION_APPLIED]');
    logger.info('[INTERNAL_BACKGROUND_ROTATION_APPLIED]');

    return {
      success: true,
      plan,
    };
  } catch (err) {
    logger.error(`[INTERNAL_BACKGROUND_ROTATION_ERROR] ${err.message}`);
    return {
      success: false,
      reason: 'exception',
      error: err.message,
    };
  }
}

module.exports = {
  selectBackground,
  generateBackgroundTimeline,
  getRecentUsageStats,
  applyBackgroundRotation,
  validateBackgroundDiversity,
  loadUsageState,
  saveUsageState,
  VISUAL_CATEGORIES,
  BACKGROUND_ASSETS,
};
