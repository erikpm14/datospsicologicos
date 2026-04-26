const { loadAdaptiveConfig } = require('./learning/adaptive-config');

// Construye el hook inicial con foco en acción inmediata.
function _buildHook(idea, adaptiveConfig) {
  const hookMap = {
    RELATABLE_ACTION: [
      `Mira esto cuando ${_cleanEnding(_lowercaseFirst(idea.action))}.`,
      `Fíjate en esto la próxima vez que ${_cleanEnding(_lowercaseFirst(idea.action))}.`
    ],
    OPEN_LOOP: [
      `Haz esto antes de ${_normalizeSentence(idea.action)}.`,
      `Antes de ${_normalizeSentence(idea.action)}, mira esto.`
    ],
    DIRECT_COMMAND: [
      `Haz esto con ${_extractObject(idea.action)}.`,
      `Lee esto antes de volver a ${_normalizeVerb(idea.action)}.`
    ]
  };

  const preferredHookType = adaptiveConfig.prioritizeHookType || 'RELATABLE_ACTION';
  const availableHooks = hookMap[preferredHookType] || hookMap.RELATABLE_ACTION;
  const hook = availableHooks[Math.abs(_hash(`${idea.id}-${preferredHookType}`)) % availableHooks.length];
  return { hook, hookType: preferredHookType };
}

// El claim cuenta la escena y deja visible la micro-acción.
function _buildClaim(idea) {
  return [
    idea.situation,
    idea.action,
    idea.microAction
  ].join(' ');
}

function _buildTwist(idea) {
  return idea.twist;
}

// Crea la base estructural del vídeo antes de optimizarlo.
function generateScript(idea) {
  const adaptiveConfig = loadAdaptiveConfig();
  const hookData = _buildHook(idea, adaptiveConfig);
  const hook = hookData.hook;
  const claim = _buildClaim(idea);
  const explanation = `${idea.microAction} ${idea.identity}`;
  const twist = _buildTwist(idea);
  const structureType = _buildStructureType(hookData.hookType, adaptiveConfig);
  const microActionType = _buildMicroActionType(idea.microAction, adaptiveConfig);

  return {
    id: idea.id,
    title: idea.title,
    topic: idea.category,
    ideaId: idea.id,
    hook,
    microAction: idea.microAction,
    claim,
    explanation,
    twist,
    cta: '',
    psychologicalFact: twist,
    viralTrigger: 'identificacion',
    emotionalTrigger: 'validation',
    hookType: hookData.hookType,
    microActionType,
    structureType,
    structure: {
      hook,
      microAction: idea.microAction,
      explanation,
      twist
    }
  };
}

function _extractObject(action) {
  const parts = String(action || '').split(' ');
  return parts.slice(-2).join(' ');
}

function _lowercaseFirst(value) {
  if (!value) return '';
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function _hash(value) {
  return String(value).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function _buildStructureType(hookType, adaptiveConfig) {
  if ((adaptiveConfig.preferredStructures || []).includes('ACTION_TO_TWIST')) {
    return 'ACTION_TO_TWIST';
  }

  if (hookType === 'OPEN_LOOP') {
    return 'OPEN_LOOP_TO_REFRAME';
  }

  return 'ACTION_TO_TWIST';
}

function _buildMicroActionType(microAction, adaptiveConfig) {
  const normalized = String(microAction || '').toLowerCase();

  if ((adaptiveConfig.preferredMicroActions || []).includes('REPEAT_CHECK') || /otra vez|varias veces|relees|recreas|buscando conversaciones/.test(normalized)) {
    return 'REPEAT_CHECK';
  }

  if (/haz|mira|lee/.test(normalized)) {
    return 'DO_IT_NOW';
  }

  if (/deslizas|bloqueas|subes el volumen|abres/.test(normalized)) {
    return 'SCREEN_ACTION';
  }

  return 'PHYSICAL_GESTURE';
}

function _normalizeSentence(value) {
  return _cleanEnding(String(value || '').toLowerCase());
}

function _normalizeVerb(value) {
  return _cleanEnding(String(value || '').toLowerCase());
}

function _cleanEnding(value) {
  return String(value || '').replace(/\.+$/, '');
}

module.exports = {
  generateScript
};
