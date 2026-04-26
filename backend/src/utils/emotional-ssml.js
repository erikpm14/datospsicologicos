/**
 * emotional-ssml.js
 *
 * Genera SSML emocional para síntesis de voz que suene natural e íntima.
 * Cada segmento (hook, open_loop, escalation, reengage, peak, cierre)
 * obtiene su propia configuración de:
 * - rate (velocidad)
 * - pitch (tono)
 * - volume (volumen)
 * - pausas estratégicas
 */

const logger = require('./logger');
const {
  humanizeSSML,
  getHumanizationInfo,
  applyRandomVariation,
  getEmotionalDelay,
} = require('./humanized-speech');

/**
 * Configuración emocional por sección
 * - rate: -30 a +30 (porcentaje, negativo = más lento)
 * - pitch: -20 a +20 (Hz, positivo = más alto)
 * - volume: +0dB a +10dB (más volumen)
 * - breakBefore: pausa antes de la sección
 * - breakAfter: pausa después de la sección
 * - style: "intimate", "urgent", "thoughtful", "climactic"
 */
const EMOTIONAL_PROFILES = {
  hook: {
    rate: -5,        // Ligeramente más lento para captar atención
    pitch: 0,
    volume: '+3dB',  // Un poco más fuerte
    breakBefore: 0,
    breakAfter: 200, // Pausa después para dejar impresión
    style: 'intimate',
    fragmentSize: 'auto',
  },
  open_loop: {
    rate: -10,       // Más lento = más reflectivo
    pitch: 0,
    volume: '0dB',
    breakBefore: 150,
    breakAfter: 100,
    style: 'thoughtful',
    fragmentSize: 'auto',
  },
  micro_value: {
    rate: -3,
    pitch: 5,        // Ligeramente más alto = revelación
    volume: '+2dB',
    breakBefore: 100,
    breakAfter: 80,
    style: 'intimate',
    fragmentSize: 'auto',
  },
  escalation: {
    rate: 0,         // Normal/ligeramente acelerado
    pitch: 0,
    volume: '+1dB',
    breakBefore: 80,
    breakAfter: 120,
    style: 'urgent',
    fragmentSize: 'medium',
  },
  reengage: {
    rate: -8,        // Más lento = énfasis
    pitch: 10,       // Más alto = cambio emocional
    volume: '+4dB',  // Más volumen = impacto
    breakBefore: 300, // Pausa larga = anticipación
    breakAfter: 200,
    style: 'climactic',
    fragmentSize: 'short',
  },
  peak: {
    rate: -4,
    pitch: 8,
    volume: '+5dB',  // Máximo volumen
    breakBefore: 200,
    breakAfter: 150,
    style: 'climactic',
    fragmentSize: 'short',
  },
  open_ending: {
    rate: -12,       // Más lento = reflexivo
    pitch: -5,       // Más bajo = cierre
    volume: '0dB',
    breakBefore: 100,
    breakAfter: 100,
    style: 'thoughtful',
    fragmentSize: 'auto',
  },
  soft_cta: {
    rate: -10,       // Muy lento = suave
    pitch: -3,
    volume: '-2dB',  // Más suave = invitación
    breakBefore: 150,
    breakAfter: 0,
    style: 'intimate',
    fragmentSize: 'auto',
  },
};

/**
 * Detecta palabras clave que merecen énfasis emocional
 */
const EMPHASIS_KEYWORDS = [
  'duele', 'duelen', 'amor', 'rechazo', 'abandono',
  'solo', 'sola', 'miedo', 'ansiedad', 'validación',
  'importa', 'importas', 'real', 'verdad', 'mentira',
  'siempre', 'nunca', 'jamás', 'sufre', 'sufres',
];

/**
 * Fragmenta un texto en partes para síntesis más natural
 * Busca puntos de pausa (comas, "y") para dividir
 */
function fragmentText(text, maxLen = 150) {
  if (text.length <= maxLen) return [text];

  const fragments = [];
  let current = '';

  // Buscar puntos de corte naturales: punto, coma, "y"
  const sentences = text.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    if (current.length + sentence.length <= maxLen) {
      current += (current ? ' ' : '') + sentence;
    } else {
      if (current) fragments.push(current);
      current = sentence;
    }
  }

  if (current) fragments.push(current);

  return fragments.length > 0 ? fragments : [text];
}

/**
 * Aplica énfasis a una palabra si es keyword emocional
 */
function emphasizeKeywords(text) {
  let emphasized = text;

  for (const keyword of EMPHASIS_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    emphasized = emphasized.replace(regex, (match) => {
      return `<emphasis level="moderate">${match}</emphasis>`;
    });
  }

  return emphasized;
}

/**
 * Construye SSML para un segmento con emocionalidad Y humanización
 * @param {string} text - Texto a sintetizar
 * @param {string} sectionKey - hook, open_loop, escalation, etc.
 * @param {boolean} addEmphasis - Si agregar énfasis a keywords
 * @param {boolean} humanize - Si aplicar humanización (imperfección controlada)
 * @returns {string} SSML con configuración emocional + humanización
 */
function buildEmotionalSSML(text, sectionKey = 'hook', addEmphasis = true, humanize = true) {
  if (!text || text.trim().length === 0) {
    return '';
  }

  const profile = EMOTIONAL_PROFILES[sectionKey] || EMOTIONAL_PROFILES.hook;
  const fragmentos = fragmentText(text);
  let ssml = '';

  // Retraso emocional opcional (palabra clave = sección que empieza con palabra importante)
  const isKeywordSection = ['reengage', 'peak'].includes(sectionKey);
  if (humanize && isKeywordSection) {
    const delay = getEmotionalDelay(true);
    if (delay > 0) {
      ssml += `<break time="${delay}ms"/>`;
    }
  }

  // Pausa ANTES
  if (profile.breakBefore > 0) {
    ssml += `<break time="${profile.breakBefore}ms"/>`;
  }

  // Variación aleatoria si humanizar
  let rateValue = profile.rate;
  let pitchValue = profile.pitch;
  let volumeValue = parseInt(profile.volume) || 0;

  if (humanize) {
    const varied = applyRandomVariation(rateValue, pitchValue, volumeValue);
    rateValue = varied.rate;
    pitchValue = varied.pitch;
    volumeValue = varied.volume;
  }

  // Contenido con rate y pitch variado
  let rateAttr = rateValue !== 0 ? ` rate="${rateValue > 0 ? '+' : ''}${rateValue.toFixed(1)}%"` : '';
  let pitchAttr = pitchValue !== 0 ? ` pitch="${pitchValue > 0 ? '+' : ''}${pitchValue.toFixed(1)}Hz"` : '';
  let volumeAttr = volumeValue !== 0 ? ` volume="${volumeValue > 0 ? '+' : ''}${volumeValue}dB"` : '';

  ssml += `<prosody${rateAttr}${pitchAttr}${volumeAttr}>`;

  // Procesar fragmentos
  for (let i = 0; i < fragmentos.length; i++) {
    let fragment = fragmentos[i].trim();

    if (addEmphasis) {
      fragment = emphasizeKeywords(fragment);
    }

    ssml += fragment;

    // Pausa entre fragmentos con variación si humanizar
    if (i < fragmentos.length - 1) {
      if (humanize) {
        const pauseOptions = [80, 120, 180];
        const pause = pauseOptions[Math.floor(Math.random() * pauseOptions.length)];
        ssml += `<break time="${pause}ms"/>`;
      } else {
        ssml += `<break time="80ms"/>`;
      }
    }
  }

  ssml += '</prosody>';

  // Pausa DESPUÉS
  if (profile.breakAfter > 0) {
    ssml += `<break time="${profile.breakAfter}ms"/>`;
  }

  // Aplicar humanización final al SSML completo
  if (humanize) {
    ssml = humanizeSSML(ssml, {
      isKeyword: isKeywordSection,
      allowBreathing: true,
      allowInnerPauses: true,
      allowVariation: false,  // Ya aplicada arriba
    });

    // Log de humanización
    const humanInfo = getHumanizationInfo(sectionKey);
    if (humanInfo.breathingApplied || humanInfo.emotionalDelayApplied) {
      logger.debug(
        `Humanized [${sectionKey}]: breathing=${humanInfo.breathingApplied} | ` +
        `delay=${humanInfo.emotionalDelayApplied} | innerPauses=${humanInfo.innerPausesApplied}`
      );
    }
  }

  return ssml;
}

/**
 * Construye SSML completo para todo el script con emocionalidad
 */
function buildCompleteEmotionalSSML(script) {
  const sections = [
    { key: 'hook', text: script.hook },
    { key: 'open_loop', text: script.open_loop },
    { key: 'micro_value', text: script.micro_value },
    { key: 'escalation', text: script.escalation },
    { key: 'reengage', text: script.reengage },
    { key: 'peak', text: script.peak },
    { key: 'open_ending', text: script.open_ending },
    { key: 'soft_cta', text: script.soft_cta },
  ];

  let ssml = '<speak>';

  for (const section of sections) {
    if (section.text && section.text.trim().length > 0) {
      const sectionSSML = buildEmotionalSSML(section.text, section.key, true);
      if (sectionSSML) {
        ssml += sectionSSML;
      }
    }
  }

  ssml += '</speak>';

  return ssml;
}

/**
 * Aplica variación leve aleatoria al rate para sonar más natural
 * ±2% de variación controlada
 */
function addRandomVariation(rate) {
  const variation = (Math.random() - 0.5) * 4; // ±2%
  return rate + variation;
}

module.exports = {
  buildEmotionalSSML,
  buildCompleteEmotionalSSML,
  emphasizeKeywords,
  fragmentText,
  addRandomVariation,
  EMOTIONAL_PROFILES,
  EMPHASIS_KEYWORDS,
};
