/**
 * duplicate-hard-block.service.js
 *
 * BLOQUEO DURO CENTRALIZADO CONTRA DUPLICADOS
 * Compara candidatos contra últimos 15-20 vídeos publicados.
 * Normaliza texto para comparar contenido real, no solo exactitud.
 *
 * Usado obligatoriamente por:
 * - getPublishableCandidates()
 * - manual late publish
 * - late publish recovery
 * - fallback publish
 * - publish:dry-run
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Normalizar texto para comparación de duplicados
 * Quita tildes, emojis, signos de puntuación, normaliza espacios
 */
function normalizeText(text) {
  if (!text) return '';

  return text
    .toLowerCase()
    // Normalizar caracteres acentuados
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Quitar emojis
    .replace(/[^\w\s\-]/g, ' ')
    // Quitar URLs
    .replace(/https?:\/\/\S+/g, ' ')
    // Quitar signos de puntuación múltiples
    .replace(/[^\w\s]/g, ' ')
    // Normalizar espacios
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcular similitud entre dos textos (simple Levenshtein-like metric)
 * Retorna 0-100
 */
function calculateTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;

  const a = normalizeText(text1);
  const b = normalizeText(text2);

  if (a === b) return 100;

  // Levenshtein distance
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;

  const dp = Array(b.length + 1)
    .fill(0)
    .map(() => Array(a.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[0][i] = i;
  for (let j = 0; j <= b.length; j++) dp[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j][i] = Math.min(
        dp[j][i - 1] + 1,
        dp[j - 1][i] + 1,
        dp[j - 1][i - 1] + cost
      );
    }
  }

  const distance = dp[b.length][a.length];
  const similarity = ((maxLen - distance) / maxLen) * 100;
  return Math.max(0, Math.min(100, similarity));
}

/**
 * Extract primary phrase (first N words)
 */
function extractPrimaryPhrase(text, wordCount = 15) {
  if (!text) return '';
  return normalizeText(text)
    .split(/\s+/)
    .slice(0, wordCount)
    .join(' ');
}

/**
 * Compare candidate against a single published script
 * Returns { matched: boolean, reason: string, similarity: number }
 */
function compareScripts(candidateScript, publishedScript) {
  const results = {
    matched: false,
    matchReasons: [],
    similarities: {},
  };

  if (!candidateScript || !publishedScript) {
    return results;
  }

  const candidateHook = candidateScript.hook || '';
  const publishedHook = publishedScript.hook || '';
  const candidateTitle = candidateScript.title || '';
  const publishedTitle = publishedScript.title || '';
  const candidateFullScript = candidateScript.fullScript || '';
  const publishedFullScript = publishedScript.fullScript || '';

  // REGLA 1: Hook exacto o muy similar
  const hookSimilarity = calculateTextSimilarity(candidateHook, publishedHook);
  results.similarities.hook = hookSimilarity;

  if (hookSimilarity >= 75) {
    results.matched = true;
    results.matchReasons.push(`hook_similarity=${hookSimilarity.toFixed(1)}%`);
  }

  // REGLA 2: Title exacto o similar
  if (candidateTitle && publishedTitle) {
    const titleSimilarity = calculateTextSimilarity(candidateTitle, publishedTitle);
    results.similarities.title = titleSimilarity;

    if (titleSimilarity >= 75) {
      results.matched = true;
      results.matchReasons.push(`title_similarity=${titleSimilarity.toFixed(1)}%`);
    }
  }

  // REGLA 3: Primeras 15-25 palabras del script
  const candidatePrimary = extractPrimaryPhrase(candidateFullScript, 20);
  const publishedPrimary = extractPrimaryPhrase(publishedFullScript, 20);

  if (candidatePrimary && publishedPrimary) {
    const primarySimilarity = calculateTextSimilarity(candidatePrimary, publishedPrimary);
    results.similarities.primaryPhrase = primarySimilarity;

    if (primarySimilarity >= 70) {
      results.matched = true;
      results.matchReasons.push(`primary_phrase_similarity=${primarySimilarity.toFixed(1)}%`);
    }
  }

  // REGLA 4: Script completo (muy agresivo)
  if (candidateFullScript && publishedFullScript) {
    const scriptSimilarity = calculateTextSimilarity(candidateFullScript, publishedFullScript);
    results.similarities.fullScript = scriptSimilarity;

    if (scriptSimilarity >= 72) {
      results.matched = true;
      results.matchReasons.push(`full_script_similarity=${scriptSimilarity.toFixed(1)}%`);
    }
  }

  // REGLA 5: Misma frase base fuerte
  // "Tu cerebro tiene un límite" / "tu cerebro tiene un limite"
  const candidateNorm = normalizeText(candidateHook);
  const publishedNorm = normalizeText(publishedHook);

  if (
    candidateNorm.includes('tu cerebro tiene un limite') &&
    publishedNorm.includes('tu cerebro tiene un limite')
  ) {
    results.matched = true;
    results.matchReasons.push('exact_phrase_base_match');
  }

  return results;
}

/**
 * FUNCIÓN PRINCIPAL: shouldBlockDuplicate()
 *
 * Compara candidato contra últimos 15-20 vídeos publicados.
 * Retorna { blocked: boolean, reason: string, matchedVideoId: string, similarities: object }
 */
function shouldBlockDuplicate(candidateScript, recentPublishedVideos = []) {
  const videoId = candidateScript.videoId || candidateScript.id || 'unknown';

  if (!candidateScript || !recentPublishedVideos || recentPublishedVideos.length === 0) {
    logger.debug(`[DUPLICATE_CHECK] ${videoId} no recent videos to compare`);
    return {
      blocked: false,
      reason: 'insufficient_history',
      matchedVideoId: null,
      similarities: {},
    };
  }

  logger.info(`[DUPLICATE_CHECK_STARTED] videoId=${videoId} comparing against ${recentPublishedVideos.length} published videos`);

  const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './backend/output-fase1-test');

  for (const pubVideo of recentPublishedVideos) {
    const prevScriptPath = path.join(OUTPUT_DIR, pubVideo.videoId, 'script.json');

    if (!fs.existsSync(prevScriptPath)) {
      continue;
    }

    let publishedScript;
    try {
      publishedScript = JSON.parse(fs.readFileSync(prevScriptPath, 'utf8'));
    } catch (err) {
      logger.warn(`[DUPLICATE_CHECK] cannot read script for ${pubVideo.videoId}: ${err.message}`);
      continue;
    }

    const comparison = compareScripts(candidateScript, publishedScript);

    if (comparison.matched) {
      logger.error(
        `[DUPLICATE_BLOCKED] videoId=${videoId} ` +
          `matched_with=${pubVideo.videoId} (youtubeId=${pubVideo.youtubeId}) ` +
          `reasons=[${comparison.matchReasons.join(', ')}]`
      );

      return {
        blocked: true,
        reason: 'DUPLICATE_CONTENT_HARD_BLOCKED',
        matchedVideoId: pubVideo.videoId,
        youtubeIdMatched: pubVideo.youtubeId,
        matchReasons: comparison.matchReasons,
        similarities: comparison.similarities,
      };
    } else {
      // Log detail for debugging (debug level)
      logger.debug(
        `[DUPLICATE_COMPARE] candidate=${videoId.substring(0, 8)}... vs published=${pubVideo.videoId.substring(0, 8)}... ` +
          `hook_sim=${(comparison.similarities.hook || 0).toFixed(0)}% ` +
          `title_sim=${(comparison.similarities.title || 0).toFixed(0)}% ` +
          `primary_sim=${(comparison.similarities.primaryPhrase || 0).toFixed(0)}%`
      );
    }
  }

  logger.info(`[DUPLICATE_PASSED] videoId=${videoId} no duplicates found`);

  return {
    blocked: false,
    reason: 'duplicate_check_pass',
    matchedVideoId: null,
    similarities: {},
  };
}

/**
 * Get last N published videos from publish-log
 */
function getRecentPublishedVideos(count = 20) {
  const publishLogPath = path.resolve('./data/publish-log.json');

  if (!fs.existsSync(publishLogPath)) {
    return [];
  }

  try {
    const publishLog = JSON.parse(fs.readFileSync(publishLogPath, 'utf8'));
    const published = publishLog.published || [];

    // Devolver últimos N únicos (por videoId)
    const seen = new Set();
    const result = [];

    for (const entry of published) {
      if (!seen.has(entry.videoId)) {
        result.push(entry);
        seen.add(entry.videoId);
        if (result.length >= count) break;
      }
    }

    return result;
  } catch (err) {
    logger.warn(`[DUPLICATE_CHECK] cannot read publish-log: ${err.message}`);
    return [];
  }
}

module.exports = {
  shouldBlockDuplicate,
  normalizeText,
  calculateTextSimilarity,
  compareScripts,
  getRecentPublishedVideos,
  extractPrimaryPhrase,
};
