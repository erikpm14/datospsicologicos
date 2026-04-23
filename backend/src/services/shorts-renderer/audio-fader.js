/**
 * audio-fader.js
 * Genera filtros FFmpeg para fades de audio en cuts + ducking de música.
 * Los fades de 30ms previenen clicks auditivos en cada corte.
 */

const { AUDIO_FADE_CONFIG, MUSIC_CONFIG } = require('./style-config');

/**
 * Genera filtros afade para cada segmento de audio
 * Cada segmento recibe: fade-out 30ms al final + fade-in 30ms al inicio del siguiente
 *
 * @param {Array<number>} segmentEnds - timestamps en segundos del final de cada segmento
 * @param {number} totalDuration - duración total del audio
 * @returns {string} - cadena de filtros afade para FFmpeg
 */
function buildAudioFadeFilters(segmentEnds, totalDuration) {
  const fades = [];

  for (let i = 0; i < segmentEnds.length; i++) {
    const endTime = segmentEnds[i];

    if (i < segmentEnds.length - 1) {
      // Fade-out al final del segmento actual
      const fadeOutStart = Math.max(0, endTime - AUDIO_FADE_CONFIG.fadeOutDuration);
      fades.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${AUDIO_FADE_CONFIG.fadeOutDuration}`);

      // Fade-in al inicio del siguiente segmento
      const nextSegmentStart = segmentEnds[i + 1];
      if (nextSegmentStart < totalDuration) {
        fades.push(`afade=t=in:st=${nextSegmentStart.toFixed(2)}:d=${AUDIO_FADE_CONFIG.fadeInDuration}`);
      }
    }
  }

  if (fades.length === 0) {
    return ''; // sin fades si no hay cortes
  }

  // Concatenar todos los fades con comas
  return fades.join(',');
}

/**
 * Genera el filtro de ducking dinámico de música
 * La música se baja cuando hay voz, sube en silencios
 *
 * Usa sidechain approximation: la música siempre está a volumen bajo
 * durante el video (música está en canal separado, no en el audio principal)
 *
 * @param {number} totalDuration - duración total del video
 * @returns {string} - filtro FFmpeg de volumen/fade para música
 */
function buildMusicDuckingFilter(totalDuration) {
  // La música entra suave, sale suave, con volumen reducido durante todo
  // Fade-in 1s al inicio
  const fadeInEnd = Math.min(1.0, totalDuration * 0.2);
  // Fade-out 2s al final
  const fadeOutStart = Math.max(0, totalDuration - MUSIC_CONFIG.fadeoutDuration);

  const filters = [];

  // Volume base a 15% (para que la voz domine)
  filters.push(`volume=${MUSIC_CONFIG.volumeBase}`);

  // Fade-in al inicio
  filters.push(`afade=t=in:st=0:d=${MUSIC_CONFIG.fadeinDuration}`);

  // Fade-out al final
  if (fadeOutStart > 0 && fadeOutStart < totalDuration) {
    filters.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${MUSIC_CONFIG.fadeoutDuration}`);
  }

  return filters.join(',');
}

/**
 * Genera el filtro amix para mezclar audio principal + música
 * La música ya tiene su volumen reducido por ducking
 *
 * @returns {string} - filtro FFmpeg amix
 */
function buildAudioMixFilter() {
  // amix: mezcla dos canales de audio
  // inputs=2: audio principal + música
  // duration=first: mantiene la duración del primero (audio principal)
  // normalize=0: no normaliza (ya está normalizado en post-process)
  return 'amix=inputs=2:duration=first:normalize=0';
}

/**
 * Calcula los timestamps de final de segmento a partir de un RenderPlan
 * @param {Array} segments - array de segmentos del RenderPlan
 * @returns {Array<number>} - timestamps de final de cada segmento
 */
function extractSegmentEnds(segments) {
  return segments.map(seg => seg.endTime);
}

module.exports = {
  buildAudioFadeFilters,
  buildMusicDuckingFilter,
  buildAudioMixFilter,
  extractSegmentEnds,
};
