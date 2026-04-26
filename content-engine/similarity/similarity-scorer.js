// Puntúa similitud semántica de forma explicable.
function scoreSimilarity(script, historical) {
  const explainability = {
    topicSimilarity: _binary(script.topic, historical.category, 22),
    hookTypeSimilarity: _binary(script.hookType, historical.hookType, 14),
    narrativeStructureSimilarity: _binary(script.structureType, historical.structureType, 12),
    monetizationIntentSimilarity: _monetizationIntent(script, historical),
    audienceValueSimilarity: _audienceSimilarity(script, historical),
    hookTextSimilarity: _textSimilarity(script.hook, historical.hook || historical.title, 12),
    titleSimilarity: _textSimilarity(script.title, historical.title, 8),
    microActionSimilarity: _textSimilarity(script.microAction, historical.microAction || historical.title, 10),
    portfolioRoleSimilarity: _binary(script.portfolioRole, historical.portfolioRole, 5),
    abVariantSimilarity: _binary(script.abVariantId, historical.abVariantId, 3),
    growthContextSimilarity: _growthSimilarity(script, historical)
  };

  const semanticSimilarityScore = Number(Object.values(explainability).reduce((sum, value) => sum + value, 0).toFixed(2));
  const confidenceScore = Number(Math.min(
    1,
    (
      (semanticSimilarityScore / 100) * 0.7 +
      (historical.realDataConfidence || 0) * 0.3
    )
  ).toFixed(2));

  return {
    semanticSimilarityScore,
    confidenceScore,
    explainability
  };
}

function _binary(a, b, weight) {
  if (!a || !b) return 0;
  return String(a).toLowerCase() === String(b).toLowerCase() ? weight : 0;
}

function _textSimilarity(a, b, weight) {
  const setA = _tokenize(a);
  const setB = _tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size;
  return Number(((intersection / union) * weight).toFixed(2));
}

function _monetizationIntent(script, historical) {
  const a = _intentTokens(script);
  const b = _intentTokens(historical);
  if (a.size === 0 || b.size === 0) return 0;
  const matches = [...a].filter((token) => b.has(token)).length;
  return Number(((matches / Math.max(a.size, b.size)) * 8).toFixed(2));
}

function _audienceSimilarity(script, historical) {
  const categories = ['relationships', 'habits', 'decisions', 'money', 'autocontrol', 'attention', 'emotions', 'mobile'];
  const scriptAudience = categories.filter((item) => String(`${script.topic} ${script.explanation} ${script.pain}`).toLowerCase().includes(item.replace('_', ' ')));
  const historicalAudience = categories.filter((item) => String(`${historical.category} ${historical.title} ${historical.hook}`).toLowerCase().includes(item.replace('_', ' ')));
  if (scriptAudience.length === 0 || historicalAudience.length === 0) return 0;
  const matches = scriptAudience.filter((item) => historicalAudience.includes(item)).length;
  return Number(((matches / Math.max(scriptAudience.length, historicalAudience.length)) * 4).toFixed(2));
}

function _growthSimilarity(script, historical) {
  let score = 0;
  if (script.viralTrigger && historical.viralTrigger && script.viralTrigger === historical.viralTrigger) score += 2;
  if (script.emotionalTrigger && historical.emotionalTrigger && script.emotionalTrigger === historical.emotionalTrigger) score += 2;
  if (script.hookType && historical.hookType && script.hookType === historical.hookType) score += 2;
  return score;
}

function _intentTokens(item) {
  const text = `${item.topic || ''} ${item.pain || ''} ${item.explanation || ''} ${item.category || ''} ${item.hook || ''}`.toLowerCase();
  const tokens = ['relationships', 'habits', 'decisions', 'money', 'autocontrol', 'attention', 'emotions', 'validation', 'fear', 'control', 'productivity', 'apego'];
  return new Set(tokens.filter((token) => text.includes(token.toLowerCase())));
}

function _tokenize(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 3)
  );
}

module.exports = {
  scoreSimilarity
};
