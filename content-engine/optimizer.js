// Añade identidad, dolor y CTA para empujar follow.
function optimizeScript(script, idea) {
  const identityLine = _buildIdentityLine(idea);
  const painLine = _buildPainLine(idea);
  const cta = _buildCTA(idea);

  const optimizedHook = _tightenHook(script.hook, idea);
  const optimizedExplanation = [
    script.explanation,
    painLine
  ].join(' ');

  return {
    ...script,
    hook: optimizedHook,
    explanation: optimizedExplanation,
    twist: idea.twist,
    cta,
    identity: identityLine,
    pain: painLine,
    optimizedScript: [
      optimizedHook,
      script.claim,
      optimizedExplanation,
      idea.twist,
      cta
    ].join('\n')
  };
}

// Refuerza con la identidad del espectador.
function _buildIdentityLine(idea) {
  return idea.identity;
}

// Marca el dolor concreto que sostiene la retención.
function _buildPainLine(idea) {
  return idea.pain;
}

// Cierra con CTA natural según vertical.
function _buildCTA(idea) {
  if (idea.category === 'relationships') {
    return 'Si tú también lees más de lo que te dicen, sígueme.';
  }

  if (idea.category === 'mobile') {
    return 'Si tu cabeza también convierte señales pequeñas en historias grandes, sígueme.';
  }

  if (idea.category === 'habits') {
    return 'Si quieres entender por qué repites esto, sígueme.';
  }

  return 'Si te pasa justo así y quieres más, sígueme.';
}

function _tightenHook(hook, idea) {
  if (idea.category === 'mobile') {
    return `Haz esto antes de abrir ${_normalizeObject(idea.action)}.`;
  }

  if (idea.category === 'relationships') {
    return `Mira esto cuando algo pequeño te cambie el cuerpo.`;
  }

  if (idea.category === 'habits') {
    return `Fíjate en esto justo antes de volver a hacerlo.`;
  }

  return hook;
}

function _normalizeObject(action) {
  return String(action || '').replace(/\.$/, '').toLowerCase();
}

module.exports = {
  optimizeScript
};
