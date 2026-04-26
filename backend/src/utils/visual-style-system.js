const VISUAL_STYLE_REFERENCE = {
  palette: {
    baseBlack: '#05070B',
    deepBlack: '#000000',
    electricBlue: '#4F7BFF',
    cyanGlow: '#58B8FF',
    neuralBlue: '#1E3F8F',
    dangerRed: '#FF3B30',
    darkCrimson: '#8E1020',
    coldWhite: '#F3F7FF',
  },
  lighting: 'oscura, dramatica, contraluz duro, glow electrico dirigido, sombras marcadas',
  composition: 'single focus, sujeto dominante a la derecha o centrado, texto respirando a la izquierda, primeros planos y siluetas, profundidad negativa',
  visualElements: ['cerebro luminoso', 'ojo humano extremo', 'silueta aislada', 'pareja en tension', 'rostro medio en sombra', 'particulas suspendidas'],
  typography: 'sans condensada, bold, mayusculas, blanco frio con acentos azul electrico y rojo alerta',
  contrast: 'alto contraste, fondo negro limpio, sujeto brillante recortado, acentos cromaticos minimos',
  emotion: 'misterio psicologico, obsesion, tension contenida, intriga oscura',
  cameraMotion: 'zoom lento constante, push-in suave, micro paneo lateral, cambio de plano cada 2-3 segundos',
  effects: 'glow ligero, particulas sutiles, neblina tenue, ruido cinematografico muy fino',
};

const SEGMENT_VISUAL_MAP = {
  hook: 'primer plano de cerebro luminoso o rostro inquietante',
  open_loop: 'ojo humano extremo o gesto suspendido en sombra',
  micro_value: 'detalle simbolico del mecanismo mental en glow azul',
  escalation: 'silueta humana o tension social en contraluz',
  reengage: 'cambio brusco a plano mas cercano con rojo alerta',
  peak: 'escena humana real de conflicto, pareja o decision',
  open_ending: 'figura sola alejandose en oscuridad con particulas',
  soft_cta: 'rostro o silueta frontal con espacio negativo para cierre',
};

const STYLE_CLIP_KEYWORDS = [
  'glowing brain dark background',
  'blue eye close up dark',
  'person silhouette red light',
  'couple argument silhouette blue light',
  'moody face close up shadow',
  'dark cinematic person thinking',
];

const SEGMENT_RHYTHM_MAP = {
  hook: { durationSeconds: 2.2, shotType: 'primer plano', intensity: 'alta', movement: 'push-in rapido', transition: 'hard cut', beat: 'scroll-stop inmediato' },
  open_loop: { durationSeconds: 2.8, shotType: 'plano detalle', intensity: 'alta', movement: 'zoom lento continuo', transition: 'match cut', beat: 'curiosidad sostenida' },
  micro_value: { durationSeconds: 3.2, shotType: 'plano medio', intensity: 'media', movement: 'micro paneo lateral', transition: 'cut limpio', beat: 'primer pago de valor' },
  escalation: { durationSeconds: 3.4, shotType: 'plano abierto', intensity: 'media-alta', movement: 'acercamiento progresivo', transition: 'cut ritmico', beat: 'tension creciente' },
  reengage: { durationSeconds: 2.6, shotType: 'primer plano', intensity: 'muy alta', movement: 'zoom agresivo', transition: 'whip cut', beat: 'ruptura de patron' },
  peak: { durationSeconds: 3.6, shotType: 'plano medio', intensity: 'maxima', movement: 'push-in sostenido', transition: 'impact cut', beat: 'impacto emocional' },
  open_ending: { durationSeconds: 3.1, shotType: 'plano abierto', intensity: 'media', movement: 'zoom out suave', transition: 'cut limpio', beat: 'eco mental' },
  soft_cta: { durationSeconds: 2.7, shotType: 'plano detalle', intensity: 'media', movement: 'micro acercamiento', transition: 'hold corto', beat: 'cierre abierto' },
};

const SHOT_VARIATION_ORDER = ['primer plano', 'plano medio', 'plano detalle', 'plano abierto'];

function getVisualStyleReference() {
  return VISUAL_STYLE_REFERENCE;
}

function buildSceneVisualPrompt(segment, script = {}) {
  const base = SEGMENT_VISUAL_MAP[segment] || 'figura humana en oscuridad cinematografica';
  const topicHint = script.topic ? `, relacionado con ${script.topic}` : '';
  return `${base}${topicHint}, fondo negro o muy oscuro, contraste alto, azul electrico y rojo oscuro como acentos, zoom lento, iluminacion dramatica, sensacion de misterio psicologico`;
}

function resolveShotType(segment, previousShotType = null) {
  const preferred = SEGMENT_RHYTHM_MAP[segment]?.shotType || 'plano medio';
  if (!previousShotType || preferred !== previousShotType) return preferred;
  const currentIndex = SHOT_VARIATION_ORDER.indexOf(preferred);
  return SHOT_VARIATION_ORDER[(currentIndex + 1) % SHOT_VARIATION_ORDER.length];
}

function buildTimelineScenes(script = {}, existingScenes = []) {
  const sceneMap = new Map(existingScenes.map((scene) => [scene?.segment, scene]).filter(([segment]) => Boolean(segment)));
  let cursor = 0;
  let previousShotType = null;

  return ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'].map((segment) => {
    const existing = sceneMap.get(segment) || {};
    const rhythm = SEGMENT_RHYTHM_MAP[segment];
    const shotType = resolveShotType(segment, previousShotType);
    previousShotType = shotType;
    const startSeconds = Number(cursor.toFixed(1));
    const endSeconds = Number((cursor + rhythm.durationSeconds).toFixed(1));
    cursor = endSeconds;

    return {
      ...existing,
      segment,
      timing: `${startSeconds}-${endSeconds}s`,
      startSeconds,
      endSeconds,
      durationSeconds: rhythm.durationSeconds,
      shotType,
      framing: shotType,
      intensity: rhythm.intensity,
      movement: rhythm.movement,
      transition: rhythm.transition,
      emphasis: rhythm.beat,
      syncCue: segment === 'reengage' || segment === 'peak' ? 'acercamiento en frase clave' : 'movimiento continuo con remate en palabra fuerte',
      visual: buildSceneVisualPrompt(segment, script),
      cut: existing.cut || rhythm.transition,
    };
  });
}

function buildUnifiedVideoStyle(script = {}) {
  return {
    theme: 'psicologia oscura / mente humana / comportamiento',
    colorPalette: 'negro absoluto, azul electrico, azul neon frio, rojo oscuro, blanco frio',
    visualStyle: 'cinematografico, minimalista, alto contraste, single focus',
    lighting: VISUAL_STYLE_REFERENCE.lighting,
    cameraMotion: VISUAL_STYLE_REFERENCE.cameraMotion,
    effects: VISUAL_STYLE_REFERENCE.effects,
    composition: VISUAL_STYLE_REFERENCE.composition,
    emotionalTone: VISUAL_STYLE_REFERENCE.emotion,
    consistencyRules: [
      'una sola escena principal por segmento',
      'fondo siempre oscuro o casi negro',
      'usar azul electrico como color dominante y rojo solo para tension o reengage',
      'priorizar cerebros, ojos, siluetas y escenas humanas reconocibles',
      'evitar stock luminoso, lifestyle genérico o composiciones planas',
    ],
    clipKeywords: [...new Set([...(script.keywords || []), ...STYLE_CLIP_KEYWORDS])].slice(0, 8),
  };
}

function normalizeVideoInstructions(script = {}, existingInstructions = {}) {
  const base = buildUnifiedVideoStyle(script);
  const scenes = Array.isArray(existingInstructions?.scenes) ? existingInstructions.scenes : [];
  const timelineScenes = buildTimelineScenes(script, scenes);

  return {
    ...existingInstructions,
    singleFocus: true,
    rhythmRule: 'cambio visual cada 2-3 segundos, sin escenas estaticas ni repeticiones consecutivas de encuadre',
    visualStyle: [
      'estetica cinematografica oscura',
      'fondo negro o casi negro',
      'alto contraste con azul electrico dominante',
      'acento rojo oscuro solo para tension',
      'single focus constante sin overlays complejos',
      'cambio de plano cada 2-3 segundos',
      'zoom progresivo y movimiento suave',
    ],
    subtitleStyle: 'tipografia condensada bold, blanco frio con acentos azul electrico y rojo oscuro, subtitulos grandes y sincronizados',
    audioStyle: {
      ...(existingInstructions?.audioStyle || {}),
      voice: 'voz clara y con ritmo',
      pauses: ['hook', 'reengage', 'peak'],
    },
    timeline: timelineScenes.map((scene) => ({
      segment: scene.segment,
      timing: scene.timing,
      durationSeconds: scene.durationSeconds,
      shotType: scene.shotType,
      intensity: scene.intensity,
      movement: scene.movement,
      transition: scene.transition,
    })),
    scenes: timelineScenes,
    style: base,
    clipKeywords: [...new Set([...(existingInstructions?.clipKeywords || []), ...base.clipKeywords, ...STYLE_CLIP_KEYWORDS])].slice(0, 10),
  };
}

module.exports = {
  getVisualStyleReference,
  buildSceneVisualPrompt,
  buildUnifiedVideoStyle,
  normalizeVideoInstructions,
  STYLE_CLIP_KEYWORDS,
};
