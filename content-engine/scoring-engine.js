// Calcula la puntuación final del script.
function scoreScript(script) {
  const retentionScore = _scoreRetention(script);
  const rewatchScore = _scoreRewatch(script);
  const followScore = _scoreFollow(script);
  const monetizationScore = _scoreMonetization(script);
  const totalScore = Math.round(
    (retentionScore * 0.32) +
    (rewatchScore * 0.23) +
    (followScore * 0.2) +
    (monetizationScore * 0.25)
  );

  return {
    ...script,
    retentionScore,
    rewatchScore,
    followScore,
    monetizationScore,
    totalScore
  };
}

// Hook corto + acción + dolor visible.
function _scoreRetention(script) {
  let score = 45;
  if (_hasShortHook(script.hook)) score += 15;
  if (_hasAction(script.claim)) score += 15;
  if (_hasAction(script.microAction)) score += 10;
  if (_containsPain(script.explanation)) score += 15;
  return Math.min(score, 100);
}

// Giro y recontextualización.
function _scoreRewatch(script) {
  let score = 40;
  if (_hasTwist(script.twist)) score += 30;
  if (_containsContrast(script.twist)) score += 20;
  if (_containsRecontext(script.optimizedScript)) score += 10;
  return Math.min(score, 100);
}

// Identidad + dolor + CTA.
function _scoreFollow(script) {
  let score = 35;
  if (_containsIdentity(script.identity)) score += 25;
  if (_containsPain(script.pain)) score += 20;
  if (_hasCTA(script.cta)) score += 20;
  return Math.min(score, 100);
}

// Temas y framing con valor comercial.
function _scoreMonetization(script) {
  let score = 28;
  if (_containsTopic(script.topic, ['relationships', 'habits', 'decisions', 'money', 'autocontrol'])) score += 30;
  if (_containsPain(script.explanation)) score += 15;
  if (_containsCTAForSeries(script.cta)) score += 10;
  if (_containsPracticalFrame(script.claim)) score += 10;
  if (_containsReusableNeed(script.explanation)) score += 12;
  return Math.min(score, 100);
}

function _hasShortHook(hook) {
  const words = String(hook || '').trim().split(/\s+/).filter(Boolean).length;
  return words >= 6 && words <= 12;
}

function _hasAction(text) {
  return /(mira|lees|escuchas|abres|bloqueas|deslizas|escribes|borras|preguntas|apagas|vuelves|haces)/i.test(String(text || ''));
}

function _containsPain(text) {
  return /(miedo|duele|ansiedad|inseguridad|duda|agotado|calma|control|temiste|apego|vacío)/i.test(String(text || ''));
}

function _hasTwist(text) {
  return /(no .*;|no .*\.|cambia|significa|inventaste|leyendo tu herida|reaccionas a)/i.test(String(text || ''));
}

function _containsContrast(text) {
  return /(no .* cambia|no .* estás|la misma|no .*;.*)/i.test(String(text || ''));
}

function _containsRecontext(text) {
  return /(no estás|no reaccionas|no falló|no recuerdas)/i.test(String(text || ''));
}

function _containsIdentity(text) {
  return /(le pasa a quien|si tú también|te pasa justo así)/i.test(String(text || ''));
}

function _hasCTA(text) {
  return /(sígueme)/i.test(String(text || ''));
}

function _containsTopic(topic, allowedTopics) {
  return allowedTopics.includes(topic);
}

function _containsCTAForSeries(text) {
  return /(sígueme|quieres más)/i.test(String(text || ''));
}

function _containsPracticalFrame(text) {
  return /(haz esto|mira|fíjate)/i.test(String(text || ''));
}

function _containsReusableNeed(text) {
  return /(rutina|relación|decisión|control|hábito|apego|productividad)/i.test(String(text || ''));
}

module.exports = {
  scoreScript
};
