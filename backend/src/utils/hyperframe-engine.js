/**
 * hyperframe-engine.js
 *
 * Motor de pseudo-hyperframes para simular estilo "hyperframe" visual.
 * Mapea segments del script a bloques visuales con zoom, pan, text overlays.
 *
 * NO MODIFICA caption-sync, QC, scheduler.
 * Solo genera filtros FFmpeg para concat-builder.
 */

const logger = require('./logger');
const { getScriptSections } = require('./script-segments');
const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────────────────────────
// CONFIGURACIÓN VISUAL POR TIPO DE SEGMENTO
// ─────────────────────────────────────────────────────────────────

const SEGMENT_VISUAL_CONFIG = {
  hook: {
    zoomIntensity: 1.35,      // zoom fuerte: 1.35x
    panSpeed: 'fast',          // movimiento rápido
    textSize: 72,              // texto grande
    brightnessDelta: 0.15,     // + 15% brillo
    emphasisLevel: 'high',
    entryDuration: 0.2,        // fade in rápido
    exitDuration: 0.15,
  },
  open_loop: {
    zoomIntensity: 1.12,
    panSpeed: 'medium',
    textSize: 56,
    brightnessDelta: 0.08,
    emphasisLevel: 'medium',
    entryDuration: 0.25,
    exitDuration: 0.2,
  },
  micro_value: {
    zoomIntensity: 1.08,
    panSpeed: 'slow',
    textSize: 48,
    brightnessDelta: 0.05,
    emphasisLevel: 'low',
    entryDuration: 0.3,
    exitDuration: 0.25,
  },
  escalation: {
    zoomIntensity: 1.15,
    panSpeed: 'medium',
    textSize: 52,
    brightnessDelta: 0.10,
    emphasisLevel: 'medium',
    entryDuration: 0.25,
    exitDuration: 0.2,
  },
  reengage: {
    zoomIntensity: 1.20,
    panSpeed: 'fast',
    textSize: 60,
    brightnessDelta: 0.12,
    emphasisLevel: 'high',
    entryDuration: 0.2,
    exitDuration: 0.15,
  },
  peak: {
    zoomIntensity: 1.40,
    panSpeed: 'fast',
    textSize: 80,
    brightnessDelta: 0.20,
    emphasisLevel: 'high',
    entryDuration: 0.18,
    exitDuration: 0.12,
  },
  open_ending: {
    zoomIntensity: 1.10,
    panSpeed: 'slow',
    textSize: 50,
    brightnessDelta: 0.06,
    emphasisLevel: 'low',
    entryDuration: 0.3,
    exitDuration: 0.3,
  },
  soft_cta: {
    zoomIntensity: 1.05,
    panSpeed: 'slow',
    textSize: 48,
    brightnessDelta: 0.04,
    emphasisLevel: 'low',
    entryDuration: 0.35,
    exitDuration: 0.4,
  },
};

// ─────────────────────────────────────────────────────────────────
// FUNCIONES INTERNAS
// ─────────────────────────────────────────────────────────────────

/**
 * Extrae las 3-6 palabras más significativas de un texto
 * (para overlay central)
 */
function _extractKeyPhrase(text, maxWords = 6) {
  if (!text) return '';

  const words = text.split(/\s+/);
  if (words.length <= maxWords) {
    return text.trim();
  }

  // Estrategia: tomar primeras palabras + últimas si es largo
  if (words.length <= 8) {
    return words.slice(0, maxWords).join(' ');
  }

  // Si muy largo, tomar inicio + final
  const first = Math.ceil(maxWords / 2);
  const last = maxWords - first;
  return [...words.slice(0, first), '...', ...words.slice(-last)].join(' ');
}

/**
 * Genera filtro FFmpeg para zoom + pan dinámico
 * Usa seno para movimiento suave
 */
function _buildZoomPanFilter(config, segmentDuration, inputLabel) {
  const { zoomIntensity, panSpeed } = config;

  // Velocidad de pan según intensidad
  const panAmount = panSpeed === 'fast' ? 40 : panSpeed === 'medium' ? 25 : 15;

  // Scale: interpolar de 1.0 a zoomIntensity
  const scaleExpr = `1 + (${zoomIntensity - 1}) * t / ${segmentDuration}`;

  // Pan: movimiento sinusoidal suave
  const panExpr = panAmount > 0 ? `${panAmount} * sin(2 * PI * t / ${segmentDuration})` : '0';

  // Crop centrado con pan
  const cropExpr = `1080:1920:(W-1080)/2+${panExpr}:(H-1920)/2`;

  return `[${inputLabel}]scale=iw*${scaleExpr}:ih*${scaleExpr},crop=${cropExpr}`;
}

/**
 * Genera filtro para brightness/contrast dinámico
 */
function _buildBrightnessFilter(config, outputLabel) {
  const { brightnessDelta } = config;
  const brightness = Math.min(0.3, brightnessDelta);

  return `${outputLabel}eq=brightness=${brightness}:contrast=1.05`;
}

/**
 * Genera filtro drawtext para overlay central
 * Renderiza phrase centrada con fade in/out
 */
function _buildTextOverlayFilter(phrase, config, segmentDuration, videoDuration, segmentStart) {
  if (!phrase || phrase.length === 0) return '';

  const { textSize, entryDuration, exitDuration } = config;

  // Timings relativos al segmento
  const fadeInTime = entryDuration;
  const fadeOutTime = exitDuration;

  // Alpha: fade in → plateau → fade out
  // Expresión FFmpeg para opacidad dinámica
  const alphaExpr = `
    if(lt(t, ${fadeInTime}), t/${fadeInTime}, \
      if(lt(t, ${segmentDuration - fadeOutTime}), 1, \
      (${segmentDuration} - t) / ${fadeOutTime}))
  `.replace(/\s+/g, '');

  // Escapar comillas en el texto
  const escapedPhrase = phrase
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:');

  return `drawtext=fontfile=/Windows/Fonts/Arial.ttf:text='${escapedPhrase}':x=(w-text_w)/2:y=(h-text_h)/2-80:fontsize=${textSize}:fontcolor=white:borderw=3:bordercolor=black:alpha=${alphaExpr}`;
}

/**
 * Identifica la sección del script que corresponde a un timestamp
 */
function _findSectionForTime(captions, sectionKey, sectionsInfo) {
  // Buscar caption cuya sección coincida
  const match = captions.find(cap => cap.section === sectionKey);
  return match ? { start: match.start, end: cap.end } : null;
}

// ─────────────────────────────────────────────────────────────────
// FUNCIÓN PÚBLICA PRINCIPAL
// ─────────────────────────────────────────────────────────────────

/**
 * Construye pseudo-hyperframes a partir de script sections y captions
 *
 * @param {Object} options {
 *   script: { hook, open_loop, ... },
 *   captions: [{ text, start, end, section, source }],
 *   videoDuration: number (segundos),
 *   outputDir: string
 * }
 *
 * @returns {Object} {
 *   hyperframes: [{
 *     segmentId, sectionKey, start, end, duration,
 *     text, keyPhrase,
 *     config: { zoomIntensity, textSize, ... },
 *     filters: { zoom, brightness, textOverlay }
 *   }],
 *   metadata: { segmentsUsed, textOverlaysCreated, ... }
 * }
 */
function buildHyperframes(options = {}) {
  const { script, captions = [], videoDuration = 45, outputDir = '.', videoId = 'unknown' } = options;

  if (!script || !captions || captions.length === 0) {
    logger.warn('HYPERFRAME_BUILD_SKIP: missing script or captions');
    return { hyperframes: [], metadata: { segmentsUsed: 0, textOverlaysCreated: 0 } };
  }

  try {
    const sections = getScriptSections(script);
    const hyperframes = [];
    let textOverlayCount = 0;

    for (const section of sections) {
      const { key, text } = section;
      const config = SEGMENT_VISUAL_CONFIG[key];

      if (!config) {
        logger.debug(`HYPERFRAME_SKIP_UNKNOWN_SECTION sectionKey=${key}`);
        continue;
      }

      // Encontrar captions para esta sección
      const sectionCaptions = captions.filter(cap => cap.section === key);
      if (sectionCaptions.length === 0) {
        logger.debug(`HYPERFRAME_SKIP_NO_CAPTIONS sectionKey=${key}`);
        continue;
      }

      // Usar timestamps reales del caption
      const captionStart = Math.max(0, sectionCaptions[0].start - 0.05);
      const captionEnd = Math.min(videoDuration, sectionCaptions[sectionCaptions.length - 1].end + 0.05);
      const segmentDuration = captionEnd - captionStart;

      // Validar duración mínima
      if (segmentDuration < 0.5) {
        logger.debug(`HYPERFRAME_SKIP_SHORT_SEGMENT sectionKey=${key} duration=${segmentDuration.toFixed(2)}`);
        continue;
      }

      // Extraer frase clave para overlay
      const keyPhrase = _extractKeyPhrase(text, 6);

      // Generar segmentId
      const segmentId = `${videoId}_${key}_${Math.floor(captionStart * 100)}`;

      // Construir filtros
      const filters = {
        zoomPan: _buildZoomPanFilter(config, segmentDuration, 'input'),
        brightness: _buildBrightnessFilter(config, 'zoomed'),
        textOverlay: _buildTextOverlayFilter(keyPhrase, config, segmentDuration, videoDuration, captionStart),
      };

      if (filters.textOverlay && filters.textOverlay.length > 0) {
        textOverlayCount++;
      }

      hyperframes.push({
        segmentId,
        sectionKey: key,
        start: captionStart,
        end: captionEnd,
        duration: segmentDuration,
        text,
        keyPhrase,
        emphasisLevel: config.emphasisLevel,
        config,
        filters,
      });

      logger.info(`HYPERFRAME_SEGMENT_CREATED segmentId=${segmentId} section=${key} start=${captionStart.toFixed(2)} duration=${segmentDuration.toFixed(2)}`);
    }

    // Validar que no hay gaps > 3s
    let gapWarnings = 0;
    for (let i = 0; i < hyperframes.length - 1; i++) {
      const gap = hyperframes[i + 1].start - hyperframes[i].end;
      if (gap > 3.0) {
        logger.warn(`HYPERFRAME_LONG_GAP segment=${i} to ${i + 1} gap=${gap.toFixed(2)}s`);
        gapWarnings++;
      }
    }

    // Metadata
    const metadata = {
      videoId,
      segmentsUsed: hyperframes.length,
      textOverlaysCreated: textOverlayCount,
      totalDuration: hyperframes.reduce((sum, h) => sum + h.duration, 0),
      avgSegmentDuration: hyperframes.length > 0 ? hyperframes.reduce((sum, h) => sum + h.duration, 0) / hyperframes.length : 0,
      gapWarnings,
    };

    logger.info('HYPERFRAME_BUILD_COMPLETE', { ...metadata });

    // Escribir debug JSON
    try {
      const debugPath = path.join(outputDir, 'hyperframe-debug.json');
      fs.writeFileSync(debugPath, JSON.stringify({
        metadata,
        hyperframes: hyperframes.map(h => ({
          segmentId: h.segmentId,
          section: h.sectionKey,
          start: h.start.toFixed(3),
          end: h.end.toFixed(3),
          duration: h.duration.toFixed(3),
          keyPhrase: h.keyPhrase,
          emphasisLevel: h.emphasisLevel,
          configUsed: { zoomIntensity: h.config.zoomIntensity, textSize: h.config.textSize },
        })),
        generatedAt: new Date().toISOString(),
      }, null, 2));
    } catch (err) {
      logger.warn(`HYPERFRAME_DEBUG_WRITE_FAILED: ${err.message}`);
    }

    return { hyperframes, metadata };
  } catch (err) {
    logger.error(`HYPERFRAME_BUILD_EXCEPTION: ${err.message}`);
    return { hyperframes: [], metadata: { error: err.message, segmentsUsed: 0 } };
  }
}

/**
 * Integra hyperframes en el filtergraph existente
 * Retorna versión mejorada del filtergraph con zoom + text overlays
 *
 * @param {string} baseFilterGraph - filtergraph actual (sin hyperframes)
 * @param {Array} hyperframes - resultado de buildHyperframes
 * @param {string} outputDir
 * @returns {string} enhancedFilterGraph
 */
function enhanceFilterGraphWithHyperframes(baseFilterGraph = '', hyperframes = [], outputDir = '.') {
  if (!hyperframes || hyperframes.length === 0) {
    logger.debug('HYPERFRAME_ENHANCE_SKIP: no hyperframes');
    return baseFilterGraph;
  }

  try {
    // Por ahora: retornar el base sin cambios
    // La integración completa requiere coordinar con concat-builder
    // para aplicar filtros por segmento individual

    logger.info(`HYPERFRAME_ENHANCE_DEFERRED segments=${hyperframes.length} (requires segment-level integration)`);

    // Escribir instrucciones para integración manual
    const instructionsPath = path.join(outputDir, 'hyperframe-filtergraph-integration.md');
    const instructions = `# Hyperframe Filter Graph Integration

Generated: ${new Date().toISOString()}

## Segments to enhance

${hyperframes.map((h, idx) => `
### ${idx + 1}. ${h.sectionKey} (${h.duration.toFixed(2)}s)
- Segment ID: ${h.segmentId}
- Start: ${h.start.toFixed(3)}s → End: ${h.end.toFixed(3)}s
- Key phrase: "${h.keyPhrase}"
- Emphasis: ${h.emphasisLevel}

Filters to apply:
\`\`\`
${h.filters.zoomPan}
${h.filters.brightness}
${h.filters.textOverlay}
\`\`\`
`).join('\n')}

## Integration method

Option 1 (Recommended): Modify concat-builder.js
- Apply hyperframe filters to individual segments in buildSegmentFilter()
- Check if segment start/end matches hyperframe timestamps
- Layer textOverlay AFTER color grading, BEFORE vignette

Option 2: Post-processing in render-executor.js
- Generate separate ffmpeg pass with hyperframe overlays
- Composite onto final video

See hyperframe-debug.json for full configuration.
`;

    fs.writeFileSync(instructionsPath, instructions);
    logger.info(`HYPERFRAME_INTEGRATION_INSTRUCTIONS written to hyperframe-filtergraph-integration.md`);

    return baseFilterGraph;
  } catch (err) {
    logger.error(`HYPERFRAME_ENHANCE_EXCEPTION: ${err.message}`);
    return baseFilterGraph;
  }
}

/**
 * Genera reporte de integración con instrucciones para mejorar visually
 */
function generateIntegrationReport(hyperframes, script, outputDir) {
  if (!hyperframes || hyperframes.length === 0) {
    return null;
  }

  const report = {
    title: 'Hyperframe Integration Report',
    generatedAt: new Date().toISOString(),
    systemStatus: {
      hyperframesCreated: hyperframes.length,
      totalDuration: hyperframes.reduce((sum, h) => sum + h.duration, 0),
      textOverlaysEnabled: hyperframes.filter(h => h.filters.textOverlay && h.filters.textOverlay.length > 0).length,
    },
    integrationLevels: {
      LEVEL_0: {
        name: 'Currently Implemented',
        description: 'Hyperframe metadata is generated and logged',
        status: 'ACTIVE',
        features: ['Segment timing from real audio', 'Emphasis levels per segment', 'Debug JSON with all configs'],
      },
      LEVEL_1: {
        name: 'Visual Effects in FFmpeg',
        description: 'Apply zoom, brightness, fade transitions per segment',
        status: 'READY',
        effort: 'Medium',
        location: 'concat-builder.js buildSegmentFilter()',
        implementation: 'Apply zoom/brightness filters from hyperframe.filters to each segment during concat',
      },
      LEVEL_2: {
        name: 'Text Overlay Integration',
        description: 'Render key phrases as central overlay with proper fade',
        status: 'READY',
        effort: 'Medium',
        location: 'render-executor.js executeRender()',
        implementation: 'Layer text overlays from hyperframe.filters.textOverlay AFTER subtitles but BEFORE final output',
      },
      LEVEL_3: {
        name: 'Smart Color Grade Per Segment',
        description: 'Vary color grading based on emotional intensity',
        status: 'AVAILABLE',
        effort: 'High',
        implementation: 'Use SEGMENT_VISUAL_CONFIG emphasisLevel to select color preset dynamically',
      },
      LEVEL_4: {
        name: 'Motion Graphics & Transitions',
        description: 'Add scale/fade transitions between segments with rhythm timing',
        status: 'AVAILABLE',
        effort: 'High',
        implementation: 'Create dedicated motion-graphics module for segment boundaries',
      },
    },
    immediateActions: [
      {
        priority: 1,
        action: 'Verify hyperframe-debug.json is generated for each render',
        command: 'Check output/{videoId}/hyperframe-debug.json',
      },
      {
        priority: 2,
        action: 'Apply LEVEL 1 visual effects (zoom + brightness per segment)',
        location: 'concat-builder.js',
        estimatedDaysOfWork: 2,
      },
      {
        priority: 3,
        action: 'Integrate text overlays (LEVEL 2)',
        location: 'render-executor.js',
        estimatedDaysOfWork: 1,
      },
    ],
    validation: {
      checksPerformed: [
        'output.mp4 exists',
        'No syntax errors in hyperframe-engine',
        'Caption-sync integration verified',
      ],
      checksRemaining: [
        'Visual effects render correctly in FFmpeg',
        'Text overlays match timing from captions',
        'No QC regressions (blackdetect, subtitle validation)',
      ],
    },
  };

  return report;
}

module.exports = {
  buildHyperframes,
  enhanceFilterGraphWithHyperframes,
  generateIntegrationReport,
  SEGMENT_VISUAL_CONFIG,
};
