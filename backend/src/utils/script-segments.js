const EXPANDED_SEGMENT_KEYS = [
  'hook',
  'open_loop',
  'micro_value',
  'escalation',
  'reengage',
  'peak',
  'open_ending',
  'soft_cta',
];

const LEGACY_SEGMENT_KEYS = ['hook', 'claim', 'explanation', 'cta'];
const SEGMENT_TYPE_TO_KEY = {
  HOOK: 'hook',
  OPEN_LOOP: 'open_loop',
  MICRO_VALUE: 'micro_value',
  ESCALATION: 'escalation',
  REENGAGE: 'reengage',
  PEAK: 'peak',
  OPEN_ENDING: 'open_ending',
  SOFT_CTA: 'soft_cta',
};
const SEGMENT_KEY_TO_TYPE = Object.fromEntries(
  Object.entries(SEGMENT_TYPE_TO_KEY).map(([type, key]) => [key, type]),
);

function normalizeSegmentsToFields(script = {}) {
  if (!Array.isArray(script.segments) || script.segments.length === 0) return script;
  const next = { ...script };
  for (const segment of script.segments) {
    const type = String(segment?.type || '').trim().toUpperCase();
    const key = SEGMENT_TYPE_TO_KEY[type];
    const text = String(segment?.text || '').trim();
    if (key && text && !String(next[key] || '').trim()) {
      next[key] = text;
    }
  }
  return next;
}

function buildSegmentsFromFields(script = {}) {
  return EXPANDED_SEGMENT_KEYS
    .map((key) => {
      const text = String(script[key] || '').trim();
      if (!text) return null;
      return {
        type: SEGMENT_KEY_TO_TYPE[key],
        text,
        visualIntent: key === 'hook' ? 'punch zoom, texto impactante, fondo oscuro' : key === 'reengage' ? 'cambio brusco, tension, zoom corto' : key === 'peak' ? 'aislamiento, silueta, punch zoom' : 'zoom lento, rostro pensativo, tension',
        emotion: key === 'hook' ? 'tension' : key === 'peak' ? 'impacto' : key === 'soft_cta' ? 'cercania' : 'curiosity',
      };
    })
    .filter(Boolean);
}

function hasExpandedStructure(script = {}) {
  // Check for expanded-only keys (excluding hook which is in both formats)
  const expandedOnlyKeys = ['open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'];
  return expandedOnlyKeys.some((key) => Boolean(String(script[key] || '').trim()));
}

function ensureLegacyFields(script = {}) {
  if (!script || typeof script !== 'object') return script;
  const normalized = normalizeSegmentsToFields(script);
  const claim = normalized.claim || [normalized.micro_value].filter(Boolean).join(' ').trim();
  const explanation = normalized.explanation || [normalized.escalation, normalized.reengage, normalized.peak].filter(Boolean).join(' ').trim();
  const cta = normalized.cta || [normalized.open_ending, normalized.soft_cta].filter(Boolean).join(' ').trim();

  return {
    ...normalized,
    claim,
    explanation,
    cta,
    segments: Array.isArray(normalized.segments) && normalized.segments.length > 0 ? normalized.segments : buildSegmentsFromFields(normalized),
    structureVersion: normalized.structureVersion || (hasExpandedStructure(normalized) ? 'open_loop_escalation_v1' : 'legacy_v1'),
    hasReengage: typeof normalized.hasReengage === 'boolean' ? normalized.hasReengage : Boolean(String(normalized.reengage || '').trim()),
  };
}

function getScriptSections(script = {}) {
  const normalized = ensureLegacyFields(script);
  const keys = hasExpandedStructure(normalized) ? EXPANDED_SEGMENT_KEYS : LEGACY_SEGMENT_KEYS;

  return keys
    .map((key) => ({ key, text: String(normalized[key] || '').trim() }))
    .filter((section) => section.text);
}

function getCombinedScriptText(script = {}) {
  return getScriptSections(script).map((section) => section.text).join(' ').trim();
}

module.exports = {
  EXPANDED_SEGMENT_KEYS,
  SEGMENT_KEY_TO_TYPE,
  ensureLegacyFields,
  getCombinedScriptText,
  getScriptSections,
  hasExpandedStructure,
};
