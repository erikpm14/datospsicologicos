/**
 * remotion-renderer.js
 *
 * Renderer principal para VIDEOSIA Visual Engine 2.0
 * Convierte datos de VIDEOSIA a VideoPlan y renderiza con Remotion
 *
 * Input: script, audioPath, audioDuration, captions, wordBoundaries, etc.
 * Output: output.mp4 + render-metadata.json
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { executeRemotionRender } = require('../utils/remotion-executor');

const REMOTION_PROJECT_ROOT = path.resolve(__dirname, '../../../remotion-video');
const REMOTION_ENABLED = process.env.REMOTION_RENDERER_ENABLED === 'true';
const REMOTION_TEMPLATE_DEFAULT = process.env.REMOTION_TEMPLATE_DEFAULT || 'avatar_explainer';
const REMOTION_CONCURRENCY = parseInt(process.env.REMOTION_CONCURRENCY || '4', 10);
const REMOTION_FALLBACK_VIDEO_USE = process.env.REMOTION_FALLBACK_VIDEO_USE === 'true';

/**
 * Convertir datos VIDEOSIA a VideoPlan
 */
function scriptToVideoPlan(options = {}) {
  const {
    script = {},
    audioPath,
    audioDuration = 30,
    captions = [],
    wordBoundaries = [],
    sectionDurations = {},
    themeId,
    bgStyle,
  } = options;

  // Crear escenas desde el script
  const scenes = script.subtitleBlocks?.length > 0
    ? createScenesFromScript(script, audioDuration)
    : [];

  // Enriquecer captions con word boundaries
  const enrichedCaptions = captions.map((cap) => ({
    ...cap,
    effect: getEffectBySection(cap.section),
  }));

  // Convertir audioPath a ruta absoluta para Remotion render context
  // Remotion no puede resolver URLs en render context, necesita rutas completas
  let resolvedAudioPath = audioPath;
  if (audioPath && !path.isAbsolute(audioPath)) {
    resolvedAudioPath = path.resolve(audioPath).replace(/\\/g, '/');
  }

  return {
    videoId: script.id || `videosia_${Date.now()}`,
    createdAt: new Date().toISOString(),
    durationSeconds: Math.round(audioDuration),
    fps: 30,
    format: 'shorts_9_16',
    template: REMOTION_TEMPLATE_DEFAULT,
    styleProfile: {
      mood: 'cinematic',
      energy: 'high',
      visualDensity: 'medium-high',
      colorMode: 'dark-premium',
    },
    audio: {
      voiceoverPath: null,  // Audio handling deferred to post-processing; Remotion render focuses on video generation
      musicPath: null,
      voiceoverVolume: 0.95,
      musicVolume: 0.15,
    },
    avatar: {
      enabled: process.env.AVATAR_ENABLED === 'true',
      characterId: 'default_videosia',
      position: 'bottom-right',
      scale: 1.15,
      expressionMode: 'beat_based',
      lipSyncMode: 'word_boundaries_basic',
      enableMicroMovement: true,
      enableEyeMovement: false,
    },
    scenes,
    captions: enrichedCaptions,
    wordBoundaries,
    metadata: {
      topic: script.topic,
      hook: script.hook,
      cta: script.cta || script.soft_cta,
      hashtags: script.hashtags || [],
      contentType: 'explainer',
      abVariant: script.abVariantId,
    },
  };
}

/**
 * Crear escenas desde estructura del script
 */
function createScenesFromScript(script, duration) {
  const sections = ['hook', 'claim', 'revelation', 'cta'];
  const segmentDuration = duration / sections.length;

  return sections.map((section, idx) => ({
    id: `scene_${section}`,
    start: idx * segmentDuration,
    end: (idx + 1) * segmentDuration,
    type: section,
    text: script[section] || '',
    avatarExpression: getExpressionBySection(section),
    visualIntent: getVisualIntentBySection(section),
  }));
}

function getExpressionBySection(section) {
  const map = {
    hook: 'surprised',
    claim: 'speaking',
    revelation: 'thinking',
    cta: 'excited',
  };
  return map[section] || 'speaking';
}

function getVisualIntentBySection(section) {
  const map = {
    hook: 'stop_scroll',
    claim: 'maintain_attention',
    revelation: 'build_tension',
    cta: 'release',
  };
  return map[section] || 'maintain_attention';
}

function getEffectBySection(section) {
  const map = {
    hook: 'bounce_in',
    claim: 'fade_in',
    revelation: 'scale_in',
    cta: 'slide_in',
  };
  return map[section] || 'fade_in';
}

/**
 * Renderizar con Remotion
 * Escribe video-plan.json y llama a remotion CLI
 */
async function renderWithRemotion(options = {}) {
  const {
    outputPath,
    videoPlan,
  } = options;

  const outputDir = path.dirname(outputPath);
  const videoPlanjsonPath = path.join(outputDir, 'video-plan.json');
  const propsFilePath = path.join(outputDir, 'remotion-props.json');

  // Escribir video-plan.json
  fs.writeFileSync(videoPlanjsonPath, JSON.stringify(videoPlan, null, 2));
  logger.info(`[remotion-renderer] Wrote video-plan.json to ${videoPlanjsonPath}`);

  // Write props to file for Windows compatibility (avoids quote escaping issues)
  const propsData = { videoPlan };
  fs.writeFileSync(propsFilePath, JSON.stringify(propsData, null, 2));
  logger.info(`[remotion-renderer] Wrote props to ${propsFilePath}`);

  const compositionId = 'VideosiaShort';

  logger.info(`[remotion-renderer] Rendering with Remotion...`);
  logger.info(`[REMOTION_EXEC_RESOLVED] remotionProjectDir=${REMOTION_PROJECT_ROOT}`);
  logger.info(`[REMOTION_RENDER_START] compositionId=${compositionId}, outputPath=${outputPath}`);

  try {
    // Convert all paths to forward slashes for Remotion CLI on Windows
    // Remotion expects paths with / separators regardless of platform
    // Entry point must be the file that contains registerRoot()
    const remotionEntryPoint = path.join(REMOTION_PROJECT_ROOT, 'src/Root.tsx').replace(/\\/g, '/');
    const outputPathForCli = path.resolve(outputPath).replace(/\\/g, '/');
    const propsFilePathForCli = path.resolve(propsFilePath).replace(/\\/g, '/');

    const cmdArgs = [
      'render',
      remotionEntryPoint,
      compositionId,
      outputPathForCli,
      `--props=${propsFilePathForCli}`,
    ];

    await executeRemotionRender(REMOTION_PROJECT_ROOT, cmdArgs, {
      timeout: 300000,
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Remotion render completed but no output file found at ${outputPath}`);
    }

    logger.info(`[REMOTION_RENDER_SUCCESS] outputPath=${outputPath}`);

    return {
      success: true,
      outputPath,
      renderer: 'remotion',
      videoPlanjsonPath,
    };
  } catch (error) {
    logger.error(`[remotion-renderer] Render failed: ${error.message}`);
    throw error;
  }
}

/**
 * Renderizar vídeo principal (entrada desde video-processor)
 */
async function renderVideoWithRemotion(options = {}) {
  const {
    script,
    audioPath,
    audioDuration,
    outputPath,
    captions,
    wordBoundaries,
    sectionDurations,
    themeId,
    bgStyle,
  } = options;

  const outputDir = path.dirname(outputPath);

  logger.info(`[remotion-renderer] Starting render job for videoId=${script?.id}`);

  try {
    // Step 1: Crear VideoPlan
    const videoPlan = scriptToVideoPlan({
      script,
      audioPath,
      audioDuration,
      captions,
      wordBoundaries,
      sectionDurations,
      themeId,
      bgStyle,
    });

    logger.debug(`[remotion-renderer] Created VideoPlan: ${videoPlan.videoId}`);

    // Step 2: Renderizar con Remotion
    const renderResult = await renderWithRemotion({
      outputPath,
      videoPlan,
    });

    // Step 3: Escribir metadata
    // Determinar si hay contenido visual real (no fallback)
    const hasRealContent = videoPlan.captions.length > 0 || videoPlan.scenes.length > 0;
    const hasVisibleElements = hasRealContent || videoPlan.avatar.enabled;

    const renderMetadata = {
      renderer: 'remotion',
      engineVersion: 'videosia-visual-engine-2.0',
      compositionId: 'VideosiaShort',
      template: REMOTION_TEMPLATE_DEFAULT,
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: videoPlan.durationSeconds,
      remotionEnabled: true,
      avatarEnabled: videoPlan.avatar.enabled,
      hasKineticCaptions: videoPlan.captions.length > 0,
      hasCameraMotion: true,
      hasProgressBar: true,
      visualSceneCount: videoPlan.scenes.length,
      captionsCount: videoPlan.captions.length,
      emphasizedWordsCount: videoPlan.captions.reduce(
        (sum, cap) => sum + (cap.emphasis?.length || 0),
        0
      ),
      visibleVisuals: hasVisibleElements,
      visualFallbackUsed: !hasRealContent,
      renderMode: 'remotion',
      videoPlanjsonPath: renderResult.videoPlanjsonPath,
      renderedAt: new Date().toISOString(),
    };

    const renderMetadataPath = path.join(outputDir, 'render-metadata.json');
    fs.writeFileSync(renderMetadataPath, JSON.stringify(renderMetadata, null, 2));

    logger.info(`[remotion-renderer] Render successful: ${script?.id}`);

    return {
      success: true,
      renderMode: 'remotion',
      fallbackUsed: false,
      outputPath,
    };
  } catch (error) {
    logger.error(`[remotion-renderer] Render failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  renderVideoWithRemotion,
  scriptToVideoPlan,
  REMOTION_ENABLED,
};
