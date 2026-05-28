/**
 * Utilities para procesamiento de captions
 */

import { CaptionBlock, WordBoundary } from '../types/video-plan';

/**
 * Agrupar palabras en bloques para mejor legibilidad
 * Agrupa 2-3 palabras por bloque
 */
export function groupWordsIntoCaptions(
  text: string,
  startTime: number,
  endTime: number,
  wordsPerBlock: number = 3
): CaptionBlock[] {
  const words = text.split(/\s+/).filter(Boolean);
  const duration = endTime - startTime;
  const blockDuration = duration / Math.ceil(words.length / wordsPerBlock);

  const blocks: CaptionBlock[] = [];

  for (let i = 0; i < words.length; i += wordsPerBlock) {
    const blockWords = words.slice(i, i + wordsPerBlock);
    const blockIndex = Math.floor(i / wordsPerBlock);
    const blockStart = startTime + blockIndex * blockDuration;
    const blockEnd = Math.min(blockStart + blockDuration, endTime);

    blocks.push({
      id: `caption_${blockIndex}`,
      text: blockWords.join(' '),
      start: blockStart,
      end: blockEnd,
      section: 'claim',
      effect: 'fade_in',
    });
  }

  return blocks;
}

/**
 * Detect emphasis words (scientific, emotional, action, revelation)
 */
const EMPHASIS_WORDS_SCIENTIFIC = [
  'cerebro', 'neurona', 'dopamina', 'cortisol', 'inconsciente', 'automáticamente',
  'involuntariamente', 'estudio', 'demostró', 'comprobado', 'prefrontal', 'amígdala',
  'efecto', 'sesgo', 'síndrome', 'paradoja', 'disonancia',
];

const EMPHASIS_WORDS_EMOTIONAL = [
  'duele', 'duelen', 'dolor', 'sufres', 'sufre', 'sufrimiento',
  'validación', 'validado', 'importas', 'importa',
  'rechazo', 'abandono', 'solos', 'solo', 'miedo', 'ansiedad',
  'conexión', 'desconexión', 'ruptura', 'pérdida',
];

const EMPHASIS_WORDS_ACTION = [
  'manipulando', 'manipular', 'manipula', 'manipulan',
  'saboteado', 'sabotea', 'sabotean', 'saboteador',
  'falla', 'fallando', 'fallan', 'fracasa', 'fracasan',
  'atrapado', 'atrapada', 'atrapados', 'atrapadas',
  'controla', 'controlan', 'control',
];

const EMPHASIS_WORDS_REVELATION = [
  'secreto', 'oculto', 'oculta', 'escondido', 'escondida',
  'nadie', 'nunca', 'jamás', 'siempre',
  'verdad', 'realidad', 'lo que', 'la verdad',
];

const ALL_EMPHASIS_WORDS = [
  ...EMPHASIS_WORDS_SCIENTIFIC,
  ...EMPHASIS_WORDS_EMOTIONAL,
  ...EMPHASIS_WORDS_ACTION,
  ...EMPHASIS_WORDS_REVELATION,
];

export function detectEmphasisWords(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  return words.filter(
    (word) =>
      ALL_EMPHASIS_WORDS.includes(word.toLowerCase())
  );
}

/**
 * Enriquecer captions con información de énfasis
 */
export function enrichCaptionsWithEmphasis(captions: CaptionBlock[]): CaptionBlock[] {
  return captions.map((cap) => ({
    ...cap,
    emphasis: cap.emphasis || detectEmphasisWords(cap.text),
  }));
}

/**
 * Mapear word boundaries a captions
 * Útil para lip-sync o efectos de palabra
 */
export function mapWordBoundariesToCaptions(
  captions: CaptionBlock[],
  wordBoundaries: WordBoundary[]
): CaptionBlock[] {
  return captions.map((cap) => {
    const wordsInCaption = cap.text.split(/\s+/).filter(Boolean);
    const capBoundaries = wordBoundaries.filter(
      (wb) => wb.startTime >= cap.start && wb.endTime <= cap.end
    );

    return {
      ...cap,
      emphasis: cap.emphasis || capBoundaries.map((wb) => wb.word),
    };
  });
}
