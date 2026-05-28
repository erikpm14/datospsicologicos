const fs = require('fs');
const path = require('path');
const { ensureLegacyFields, hasExpandedStructure } = require('./script-segments');
const { normalizeVideoInstructions } = require('./visual-style-system');

const LAST_VALID_SCRIPT_PATH = path.resolve('./data/last-valid-script.json');
const LAST_VALID_SCRIPTS_PATH = path.resolve('./data/last-valid-scripts.json');
const FALLBACK_STATE_PATH = path.resolve('./data/fallback-state.json');
const EXPANDED_REQUIRED_FIELDS = ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'];
const LEGACY_REQUIRED_FIELDS = ['hook', 'claim', 'explanation', 'cta'];
const MAX_LAST_VALID_SCRIPTS = parseInt(process.env.MAX_LAST_VALID_SCRIPTS || '8', 10) || 8;
const MAX_CONSECUTIVE_FALLBACK_REUSE = parseInt(process.env.MAX_CONSECUTIVE_FALLBACK_REUSE || '1', 10) || 1;

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim().length >= 3;
}

function normalizeScriptCandidate(scriptInput = {}) {
  return ensureLegacyFields({ ...scriptInput });
}

function buildScriptMetadata(script = {}, meta = {}) {
  return {
    id: meta.id || script.id || script.title || `script_${Date.now()}`,
    topic: meta.topic || script.topic || '',
    angle: meta.angle || script.growthContext?.angle || '',
    hookType: meta.hookType || script.growthContext?.hookType || script.selectedHookType || '',
    emotionalTrigger: meta.emotionalTrigger || script.emotionalTrigger || script.growthContext?.emotionalTrigger || '',
    generationSource: meta.generationSource || script.generationSource || '',
    createdAt: meta.createdAt || new Date().toISOString(),
  };
}

function validateGeneratedScriptSchema(scriptInput, { label = 'script', requireExpanded = true } = {}) {
  if (!scriptInput || typeof scriptInput !== 'object' || Array.isArray(scriptInput)) {
    const error = new Error(`${label}: invalid schema - expected object`);
    error.llm_schema_fail = true;
    throw error;
  }

  const script = normalizeScriptCandidate(scriptInput);
  const requiredFields = ['title', 'topic', ...(requireExpanded ? EXPANDED_REQUIRED_FIELDS : LEGACY_REQUIRED_FIELDS)];

  for (const field of requiredFields) {
    if (!nonEmptyText(script[field])) {
      const error = new Error(`${label}: invalid schema - missing ${field}`);
      error.llm_schema_fail = true;
      throw error;
    }
  }

  if (requireExpanded && !hasExpandedStructure(script)) {
    const error = new Error(`${label}: invalid schema - expanded segments missing`);
    error.llm_schema_fail = true;
    throw error;
  }

  script.structureVersion = script.structureVersion || (requireExpanded ? 'open_loop_escalation_v1' : 'legacy_v1');
  script.hasReengage = typeof script.hasReengage === 'boolean' ? script.hasReengage : Boolean(script.reengage);
  return script;
}

function getFallbackState() {
  return readJSON(FALLBACK_STATE_PATH, {
    lastUsedKey: null,
    consecutiveUses: 0,
    recentKeys: [],
  });
}

function registerFallbackUsage(type, key) {
  const state = getFallbackState();
  const normalizedKey = `${type}:${key}`;
  const consecutiveUses = state.lastUsedKey === normalizedKey ? state.consecutiveUses + 1 : 1;
  const recentKeys = [normalizedKey, ...(state.recentKeys || []).filter((entry) => entry !== normalizedKey)].slice(0, 6);

  writeJSON(FALLBACK_STATE_PATH, {
    lastUsedKey: normalizedKey,
    consecutiveUses,
    recentKeys,
    updatedAt: new Date().toISOString(),
  });
}

function pickEmergencyVariant(decision = {}) {
  const topic = decision.nextTopic || 'ai_tools';
  const state = getFallbackState();
  const variants = [
    {
      id: 'agent_inbox',
      effectName: 'AGENTE DE INBOX',
      hook: 'Este agente te limpia el inbox solo',
      open_loop: 'Y lo mejor: no necesitas tocar nada.',
      micro_value: 'Regla simple: clasifica, resume y crea una tarea.',
      escalation: 'Entra un email. Se resume. Se guarda en Notion. Y se manda un aviso a Telegram. Todo automÃ¡tico.',
      reengage: 'Y cuando te das cuenta, ya estÃ¡ hecho.',
      peak: 'El truco es separar entrada, reglas y salida. AsÃ­ lo reutilizas para cualquier proceso.',
      open_ending: 'Y esto escala a soporte, leads y facturas.',
      soft_cta: 'Â¿QuÃ© parte de tu trabajo automatizarÃ­as hoy?',
      viralTrigger: 'utilidad',
      emotionalTrigger: 'curiosity',
    },
    {
      id: 'nocode_webhook',
      effectName: 'WEBHOOK + IA',
      hook: 'Un webhook y esta IA hace el resto',
      open_loop: 'En serio: es un cambio de juego.',
      micro_value: 'Paso 1: capturas el evento. Paso 2: decides con IA. Paso 3: ejecutas la acciÃ³n.',
      escalation: 'Ejemplo: llega un formulario. Se valida. Se genera respuesta. Se crea un ticket. Y se notifica por Slack.',
      reengage: 'Y no tienes que escribir cÃ³digo si no quieres.',
      peak: 'Si puedes describir el workflow, lo puedes automatizar.',
      open_ending: 'Lo siguiente es aÃ±adir memoria y herramientas.',
      soft_cta: 'Â¿Lo harÃ­as con n8n, Make o Zapier?',
      viralTrigger: 'utilidad',
      emotionalTrigger: 'surprise',
    },
    {
      id: 'auto_channel',
      effectName: 'CANAL AUTOMÃTICO',
      hook: 'AsÃ­ se monta un canal automÃ¡tico con IA',
      open_loop: 'Y no es magia: es pipeline.',
      micro_value: 'Idea â†’ guion â†’ voz â†’ captions â†’ render. Todo por lotes.',
      escalation: 'Un generador crea 10 guiones. El worker renderiza. Y guardas los que pasan QC. Luego publicas manualmente.',
      reengage: 'En una tarde lo dejas montado.',
      peak: 'La clave es el control de slots y anti-duplicados para no repetir ideas.',
      open_ending: 'DespuÃ©s, le metes overlays y un avatar real.',
      soft_cta: 'Â¿Quieres que te pase la estructura base?',
      viralTrigger: 'curiosity',
      emotionalTrigger: 'anticipation',
    },
  ];

  const blockedKey = state.consecutiveUses >= MAX_CONSECUTIVE_FALLBACK_REUSE ? state.lastUsedKey : null;
  const preferred = variants.find((variant) => blockedKey !== `emergency:${topic}:${variant.id}`) || variants[0];
  return { topic, variant: preferred };
}

function buildEmergencyScript({ topic, reason = 'llm_failure', decision = {} } = {}) {
  const picked = pickEmergencyVariant({ ...decision, nextTopic: topic || decision.nextTopic });
  const resolvedTopic = picked.topic;
  const { variant } = picked;

  const beats = [
    { text: variant.hook, emotion: 'surprised', avatarAction: 'surprised', visualCue: 'Hook', emphasisWords: ['IA'], durationHint: 1.8 },
    { text: variant.open_loop, emotion: 'explaining', avatarAction: 'talking', visualCue: 'Open loop', emphasisWords: [], durationHint: 2.4 },
    { text: variant.micro_value, emotion: 'explaining', avatarAction: 'talking', visualCue: 'Paso clave', emphasisWords: ['regla'], durationHint: 4.0 },
    { text: variant.escalation, emotion: 'pointing', avatarAction: 'pointing', visualCue: 'Mira esto', emphasisWords: ['mira', 'automatiza'], durationHint: 4.8 },
    { text: variant.reengage, emotion: 'explaining', avatarAction: 'talking', visualCue: 'Reenganche', emphasisWords: [], durationHint: 2.4 },
    { text: variant.peak, emotion: 'warning', avatarAction: 'pointing', visualCue: 'Insight', emphasisWords: ['solo'], durationHint: 3.2 },
    { text: variant.open_ending, emotion: 'explaining', avatarAction: 'talking', visualCue: 'Cierre', emphasisWords: [], durationHint: 2.6 },
    { text: variant.soft_cta, emotion: 'excited', avatarAction: 'excited', visualCue: 'CTA', emphasisWords: ['hoy'], durationHint: 2.2 },
  ].filter((b) => typeof b.text === 'string' && b.text.trim().length > 0);

  const script = ensureLegacyFields({
    title: `emergency_${resolvedTopic}_${variant.id}_${Date.now()}`,
    topic: resolvedTopic,
    effectName: variant.effectName,
    psychologicalFact: `${variant.effectName}: un truco simple para automatizar tareas reales en minutos.`,
    hook: variant.hook,
    open_loop: variant.open_loop,
    micro_value: variant.micro_value,
    escalation: variant.escalation,
    reengage: variant.reengage,
    peak: variant.peak,
    open_ending: variant.open_ending,
    soft_cta: variant.soft_cta,
    viralTrigger: variant.viralTrigger,
    emotionalTrigger: variant.emotionalTrigger,
    keywords: ['human reaction', 'phone checking', 'thinking person'],
    hashtags: ['#ia', '#automatizacion', '#shorts'],
    structureVersion: 'open_loop_escalation_v1',
    hasReengage: true,
    fullScript: [variant.hook, variant.open_loop, variant.micro_value, variant.escalation, variant.reengage, variant.peak, variant.open_ending, variant.soft_cta].join(' '),
    beats,
    targetAudience: 'creadores y builders de automatización/IA',
    visualStyle: 'avatar_explainer',
    videoInstructions: normalizeVideoInstructions({
      topic: resolvedTopic,
      keywords: ['human reaction', 'phone checking', 'thinking person'],
      hook: variant.hook,
      open_loop: variant.open_loop,
      micro_value: variant.micro_value,
      escalation: variant.escalation,
      reengage: variant.reengage,
      peak: variant.peak,
      open_ending: variant.open_ending,
      soft_cta: variant.soft_cta,
    }),
    emergencyFallback: true,
    emergencyFallbackReason: reason,
    emergencyVariantId: variant.id,
  });

  return script;
}

function saveLastValidScript(script, meta = {}) {
  const normalized = normalizeScriptCandidate(script);
  const metadata = buildScriptMetadata(normalized, meta);
  const payload = {
    updatedAt: new Date().toISOString(),
    metadata,
    script: normalized,
  };
  writeJSON(LAST_VALID_SCRIPT_PATH, payload);

  const history = readJSON(LAST_VALID_SCRIPTS_PATH, []);
  const compact = history.filter((entry) => entry?.metadata?.id !== metadata.id);
  compact.unshift(payload);
  writeJSON(LAST_VALID_SCRIPTS_PATH, compact.slice(0, MAX_LAST_VALID_SCRIPTS));
}

function scoreFallbackCandidate(entry, context = {}, state = getFallbackState()) {
  let score = 0;
  if (!entry?.metadata || !entry?.script) return -999;
  if (context.topic && entry.metadata.topic === context.topic) score += 5;
  if (context.angle && entry.metadata.angle && entry.metadata.angle === context.angle) score += 2;
  if (context.hookType && entry.metadata.hookType && entry.metadata.hookType === context.hookType) score += 1;
  if (context.emotionalTrigger && entry.metadata.emotionalTrigger && entry.metadata.emotionalTrigger === context.emotionalTrigger) score += 1;

  const ageHours = Math.max(0, (Date.now() - new Date(entry.metadata.createdAt || 0).getTime()) / 36e5);
  score -= Math.min(ageHours / 24, 1.5);

  const recentPenaltyKey = `last-valid-script:${entry.metadata.id}`;
  if (state.lastUsedKey === recentPenaltyKey && state.consecutiveUses >= MAX_CONSECUTIVE_FALLBACK_REUSE) {
    score -= 20;
  } else if ((state.recentKeys || []).includes(recentPenaltyKey)) {
    score -= 2;
  }

  return score;
}

function loadLastValidScript(context = {}) {
  const history = readJSON(LAST_VALID_SCRIPTS_PATH, []);
  const fallback = readJSON(LAST_VALID_SCRIPT_PATH, null);
  const candidates = history.length > 0 ? history : (fallback ? [fallback] : []);
  if (candidates.length === 0) return null;

  const state = getFallbackState();
  const ranked = candidates
    .map((entry) => ({ entry, score: scoreFallbackCandidate(entry, context, state) }))
    .sort((a, b) => b.score - a.score);

  const chosen = ranked[0]?.entry;
  if (!chosen?.script) return null;

  const metadata = chosen.metadata || buildScriptMetadata(chosen.script);
  return ensureLegacyFields({
    ...chosen.script,
    reusedLastValidScript: true,
    reusedAt: new Date().toISOString(),
    lastValidMetadata: metadata,
  });
}

module.exports = {
  validateGeneratedScriptSchema,
  buildEmergencyScript,
  saveLastValidScript,
  loadLastValidScript,
  registerFallbackUsage,
  buildScriptMetadata,
};
