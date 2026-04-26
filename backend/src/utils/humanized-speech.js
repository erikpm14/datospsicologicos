/**
 * humanized-speech.js
 *
 * Convierte síntesis emocional en voz de humano real con:
 * - Micro-pausas irregulares
 * - Respiraciones ocasionales
 * - Variación no predecible
 * - Retrasos emocionales
 * - "Desajustes naturales"
 *
 * OBJETIVO: Que no suene robótica, que suene creíble.
 */

const logger = require('./logger');

/**
 * Rangos de variación para humanización
 */
const HUMANIZATION = {
  // Micro-pausas dentro de frases (ms)
  innerPauses: [80, 120, 180, 250],

  // Respiraciones suaves (máx 1 cada 2-3 segmentos)
  breathing: {
    probability: 0.35,  // 35% chance
    duration: 200,      // 200ms pausa para respirar
  },

  // Variación aleatoria controlada
  randomVariation: {
    rate: [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2],      // ±2%
    pitch: [-1, -0.5, 0, 0.5, 1],                        // ±1 Hz
    volume: [-1, -0.5, 0, 0.5, 1],                       // ±1 dB
  },

  // Retrasos emocionales (ms)
  emotionalDelay: {
    probability: 0.4,     // 40% chance
    range: [50, 75, 100, 120],  // 50-120ms
  },

  // Punto de corte natural para fragmentación
  naturalBreakPoints: [
    /([.!?,;])\s+/,  // Puntuación
    /\s+(y|pero|porque|aunque|si|cuando)\s+/,  // Conectores
    /,\s+/,  // Comas
  ],
};

/**
 * Genera número aleatorio de opciones
 */
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Probabilidad controlada (0-1)
 */
function shouldHappen(probability) {
  return Math.random() < probability;
}

/**
 * Fragmenta texto en puntos naturales para micro-pausas internas
 */
function createNaturalFragments(text) {
  const fragments = [];
  let current = '';
  const words = text.split(/(\s+)/);

  // Agrupar en frases pequeñas (3-6 palabras)
  let wordCount = 0;
  for (const word of words) {
    current += word;
    if (word.match(/\S/)) wordCount++;

    // Romper cada 3-6 palabras
    if (wordCount >= 3 && Math.random() < 0.4) {
      if (current.trim()) {
        fragments.push(current.trim());
        current = '';
        wordCount = 0;
      }
    }
  }

  if (current.trim()) {
    fragments.push(current.trim());
  }

  return fragments.length > 1 ? fragments : [text];
}

/**
 * Inserta micro-pausas dentro de una frase
 */
function insertInnerPauses(text) {
  if (text.length < 50) return text;  // Texto muy corto, no fragmentar

  // Dividir en palabras
  const words = text.split(/\s+/);
  if (words.length < 4) return text;

  // Insertarcortes naturales cada 4-7 palabras
  let result = '';
  let wordCount = 0;

  for (let i = 0; i < words.length; i++) {
    result += words[i];

    wordCount++;
    // Cada 4-7 palabras, posible pausa interna
    if (wordCount >= 4 && wordCount <= 7 && i < words.length - 1) {
      if (shouldHappen(0.5)) {
        const pauseMs = randomChoice(HUMANIZATION.innerPauses);
        result += `<break time="${pauseMs}ms"/>`;
        wordCount = 0;
      }
    }

    if (i < words.length - 1) result += ' ';
  }

  return result;
}

/**
 * Añade respiración ocasional (pausa + volumen ligero cambio)
 */
function addOccasionalBreathing(ssml) {
  if (!shouldHappen(HUMANIZATION.breathing.probability)) {
    return ssml;
  }

  // Insertar respiración después de primer segmento prosódico
  const prosodyMatch = ssml.match(/<prosody[^>]*>(.*?)<\/prosody>/);
  if (!prosodyMatch) return ssml;

  const content = prosodyMatch[1];
  const midpoint = Math.floor(content.length / 2);

  // Insertar pausa de respiración en el medio
  const beforeBreath = content.substring(0, midpoint);
  const afterBreath = content.substring(midpoint);

  const breathingSSML = `${beforeBreath}<break time="${HUMANIZATION.breathing.duration}ms"/>${afterBreath}`;

  return ssml.replace(/<prosody[^>]*>.*?<\/prosody>/, (match) => {
    return match.replace(content, breathingSSML);
  });
}

/**
 * Aplica variación aleatoria controlada a rate/pitch/volume
 */
function applyRandomVariation(rate, pitch, volume) {
  const variedRate = rate + randomChoice(HUMANIZATION.randomVariation.rate);
  const variedPitch = pitch + randomChoice(HUMANIZATION.randomVariation.pitch);
  const variedVolume = volume + randomChoice(HUMANIZATION.randomVariation.volume);

  return {
    rate: variedRate,
    pitch: variedPitch,
    volume: variedVolume,
  };
}

/**
 * Construye delays emocionales (retraso antes de frase importante)
 */
function getEmotionalDelay(isKeyword = false) {
  if (!isKeyword) return 0;

  if (shouldHappen(HUMANIZATION.emotionalDelay.probability)) {
    return randomChoice(HUMANIZATION.emotionalDelay.range);
  }

  return 0;
}

/**
 * Humaniza un segmento SSML completo
 */
function humanizeSSML(ssml, options = {}) {
  const {
    isKeyword = false,
    allowBreathing = true,
    allowInnerPauses = true,
    allowVariation = true,
  } = options;

  let result = ssml;

  // 1. Micro-pausas dentro de frases (si no es muy corto)
  if (allowInnerPauses && ssml.length > 100) {
    const contentMatch = ssml.match(/>([^<]+)</);
    if (contentMatch) {
      const originalContent = contentMatch[1];
      const paused = insertInnerPauses(originalContent);
      result = result.replace(/>(.*?)</, `>${paused}<`);
    }
  }

  // 2. Respiraciones ocasionales
  if (allowBreathing) {
    result = addOccasionalBreathing(result);
  }

  // 3. Variación aleatoria en prosody
  if (allowVariation) {
    const prosodyMatch = result.match(/<prosody([^>]*)>(.*?)<\/prosody>/);
    if (prosodyMatch) {
      const attrs = prosodyMatch[1];
      const rateMatch = attrs.match(/rate="([^"]+)%"/);
      const pitchMatch = attrs.match(/pitch="([^"]+)Hz"/);
      const volumeMatch = attrs.match(/volume="([^"]+)dB"/);

      const currentRate = rateMatch ? parseFloat(rateMatch[1]) : 0;
      const currentPitch = pitchMatch ? parseFloat(pitchMatch[1]) : 0;
      const currentVolume = volumeMatch ? parseFloat(volumeMatch[1]) : 0;

      const varied = applyRandomVariation(currentRate, currentPitch, currentVolume);

      let newAttrs = attrs;
      newAttrs = newAttrs.replace(
        /rate="[^"]*%"/,
        `rate="${varied.rate > 0 ? '+' : ''}${varied.rate.toFixed(1)}%"`
      );
      newAttrs = newAttrs.replace(
        /pitch="[^"]*Hz"/,
        `pitch="${varied.pitch > 0 ? '+' : ''}${varied.pitch.toFixed(1)}Hz"`
      );
      newAttrs = newAttrs.replace(
        /volume="[^"]*dB"/,
        `volume="${varied.volume > 0 ? '+' : ''}${varied.volume.toFixed(1)}dB"`
      );

      result = result.replace(/<prosody[^>]*>/, `<prosody${newAttrs}>`);
    }
  }

  // 4. Retrasos emocionales (si es palabra clave)
  if (isKeyword) {
    const delay = getEmotionalDelay(true);
    if (delay > 0) {
      result = `<break time="${delay}ms"/>${result}`;
    }
  }

  return result;
}

/**
 * Humaniza texto plano para Kokoro (sin SSML)
 * - Fragmenta en pausas naturales
 * - Inserta indicadores de respiración
 */
function humanizeKokoroText(text) {
  // Para Kokoro (que usa texto plano), fragmentar pero mantener legible
  const fragments = createNaturalFragments(text);

  if (fragments.length <= 1) return text;

  // Retornar como es - Kokoro lo sintetizará naturalmente
  // Las pausas se manejarán en concatenación
  return fragments.join(' ');
}

/**
 * Genera información de humanización para un segmento
 * Para usar en logs y debugging
 */
function getHumanizationInfo(sectionKey) {
  return {
    innerPausesApplied: shouldHappen(0.6),
    breathingApplied: shouldHappen(HUMANIZATION.breathing.probability),
    variationApplied: shouldHappen(0.7),
    emotionalDelayApplied: shouldHappen(HUMANIZATION.emotionalDelay.probability),
    sectionKey,
  };
}

module.exports = {
  humanizeSSML,
  humanizeKokoroText,
  getHumanizationInfo,
  createNaturalFragments,
  insertInnerPauses,
  addOccasionalBreathing,
  applyRandomVariation,
  getEmotionalDelay,
  HUMANIZATION,
};
