/**
 * duplicate-detector.service.js
 * Detección de contenido duplicado antes de publicación
 *
 * FASE 1: Comparar contra últimos 20-50 vídeos
 * - hook similarity
 * - script similarity
 * - topic + idea
 *
 * FASE 2: Si similitud > 70% → DUPLICATE_RISK
 * FASE 4: Bloquear mismo hook exacto en últimos 10
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const performanceTracker = require('./performance-tracker.service');

/**
 * Similitud de Levenshtein normalizada (0-100)
 */
function stringSimilarity(str1 = '', str2 = '') {
  const s1 = (str1 || '').toLowerCase().trim();
  const s2 = (str2 || '').toLowerCase().trim();

  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const longerLength = longer.length;

  if (longerLength === 0) return 100;

  const editDistance = _levenshteinDistance(longer, shorter);
  return Math.round((1.0 - editDistance / longerLength) * 100);
}

/**
 * Distancia de Levenshtein
 */
function _levenshteinDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

/**
 * Extraer palabras clave de un script
 */
function extractKeywords(script = {}) {
  const hook = (script.hook || '').toLowerCase();
  const topic = (script.topic || '').toLowerCase();
  const openLoop = (script.open_loop || '').toLowerCase();
  const escalation = (script.escalation || '').toLowerCase();

  const text = [hook, openLoop, escalation].join(' ');
  const words = text
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !['que', 'este', 'esta', 'pero', 'sido', 'cual', 'como', 'todo', 'algo', 'cada', 'hace'].includes(w))
    .slice(0, 20); // Top 20 palabras

  return {
    topic,
    primaryKeywords: [...new Set(words)],
    hookWords: hook.split(/\s+/).slice(0, 5),
  };
}

/**
 * Comparar dos scripts por similitud
 */
function compareScripts(script1 = {}, script2 = {}) {
  const hook1 = (script1.hook || '').toLowerCase();
  const hook2 = (script2.hook || '').toLowerCase();
  const topic1 = (script1.topic || '').toLowerCase();
  const topic2 = (script2.topic || '').toLowerCase();

  // Exact hook match
  if (hook1 === hook2 && hook1) {
    return {
      type: 'EXACT_HOOK_MATCH',
      score: 100,
      reason: 'Mismo hook exacto',
    };
  }

  // Hook similarity
  const hookSimilarity = stringSimilarity(hook1, hook2);

  // Script similarity (full text)
  const fullText1 = [
    script1.hook,
    script1.open_loop,
    script1.micro_value,
    script1.escalation,
    script1.peak,
  ]
    .filter(Boolean)
    .join(' ');
  const fullText2 = [
    script2.hook,
    script2.open_loop,
    script2.micro_value,
    script2.escalation,
    script2.peak,
  ]
    .filter(Boolean)
    .join(' ');

  const scriptSimilarity = stringSimilarity(fullText1, fullText2);

  // Topic + idea match
  const sameTopic = topic1 === topic2;
  const keywords1 = extractKeywords(script1);
  const keywords2 = extractKeywords(script2);

  const commonKeywords = keywords1.primaryKeywords.filter(k => keywords2.primaryKeywords.includes(k));
  const keywordOverlap = commonKeywords.length > 0
    ? Math.round((commonKeywords.length / Math.max(keywords1.primaryKeywords.length, keywords2.primaryKeywords.length)) * 100)
    : 0;

  // Final score
  const weights = {
    hookSimilarity: hookSimilarity * 0.3,
    scriptSimilarity: scriptSimilarity * 0.4,
    keywordOverlap: keywordOverlap * (sameTopic ? 0.4 : 0.2),
    topicMatch: sameTopic ? 10 : 0,
  };

  const finalScore = Math.round(
    Object.values(weights).reduce((a, b) => a + b, 0)
  );

  return {
    score: finalScore,
    hookSimilarity,
    scriptSimilarity,
    keywordOverlap,
    sameTopic,
    commonKeywords: commonKeywords.slice(0, 5),
    isDuplicate: finalScore > 70,
    reason: finalScore > 70 ? `Alto contenido similar (${finalScore}%)` : null,
  };
}

/**
 * FASE 1: Obtener últimos N vídeos publicados
 */
function getRecentPublishedVideos(limit = 30) {
  try {
    const performanceData = performanceTracker.loadPerformanceData();
    const videos = (performanceData.videos || [])
      .filter(v => v.youtubeId) // Solo publicados
      .slice(-limit) // Últimos N
      .reverse(); // Más recientes primero

    return videos.map(v => ({
      videoId: v.videoId,
      hook: v.hook,
      topic: v.topic,
      pattern_used: v.pattern_used,
      publishedAt: v.publishedAt,
      youtubeId: v.youtubeId,
    }));
  } catch (err) {
    logger.warn(`Failed to load recent videos: ${err.message}`);
    return [];
  }
}

/**
 * FASE 1 + 2: Detectar duplicados
 */
function detectDuplicate(newScript, options = {}) {
  const { limit = 30, hookExactMatchLimit = 10, similarityThreshold = 70 } = options;

  const results = {
    isDuplicate: false,
    duplicateRisks: [],
    exactHookMatches: [],
    warnings: [],
    similarityScore: 0,
    blockedReason: null,
  };

  const recentVideos = getRecentPublishedVideos(limit);

  if (recentVideos.length === 0) {
    logger.info('No recent videos to compare against');
    return results;
  }

  const newHook = (newScript.hook || '').toLowerCase();
  const newTopic = (newScript.topic || '').toLowerCase();

  // FASE 4: Check exact hook matches in last 10
  const recentHooks = recentVideos.slice(0, hookExactMatchLimit);
  for (const recentVideo of recentHooks) {
    const recentHook = (recentVideo.hook || '').toLowerCase();
    if (newHook === recentHook && newHook) {
      results.exactHookMatches.push({
        videoId: recentVideo.videoId,
        youtubeId: recentVideo.youtubeId,
        hook: recentVideo.hook,
        publishedAt: recentVideo.publishedAt,
        daysAgo: Math.round((new Date() - new Date(recentVideo.publishedAt)) / 86400000),
      });
    }
  }

  if (results.exactHookMatches.length > 0) {
    results.isDuplicate = true;
    results.blockedReason = `EXACT_HOOK_MATCH: mismo hook en últimos ${hookExactMatchLimit} vídeos`;
    return results;
  }

  // FASE 1: Compare against all recent videos
  for (const recentVideo of recentVideos) {
    const comparison = compareScripts(newScript, {
      hook: recentVideo.hook,
      topic: recentVideo.topic,
      open_loop: '', // No disponible en datos históricos
      micro_value: '',
      escalation: '',
      peak: '',
    });

    if (comparison.isDuplicate) {
      results.duplicateRisks.push({
        videoId: recentVideo.videoId,
        youtubeId: recentVideo.youtubeId,
        hook: recentVideo.hook,
        topic: recentVideo.topic,
        similarity: comparison.score,
        reason: comparison.reason,
        publishedAt: recentVideo.publishedAt,
        daysAgo: Math.round((new Date() - new Date(recentVideo.publishedAt)) / 86400000),
      });
    }

    // Track highest similarity
    if (comparison.score > results.similarityScore) {
      results.similarityScore = comparison.score;
    }
  }

  // If highest similarity > threshold
  if (results.similarityScore > similarityThreshold) {
    results.isDuplicate = true;
    results.blockedReason = `SIMILARITY_THRESHOLD: ${results.similarityScore}% > ${similarityThreshold}%`;
  }

  // Warnings (70-90% similar but not blocked)
  if (results.similarityScore > 60 && results.similarityScore <= similarityThreshold) {
    results.warnings.push(`DUPLICATE_WARNING: Alto contenido similar (${results.similarityScore}%)`);
  }

  return results;
}

/**
 * Logging helper
 */
function logDuplicateDetection(scriptId, detection) {
  if (detection.isDuplicate) {
    logger.error(`[DUPLICATE_BLOCKED] scriptId=${scriptId} reason=${detection.blockedReason} exactMatches=${detection.exactHookMatches.length} similarityRisks=${detection.duplicateRisks.length}`);
  } else if (detection.warnings.length > 0) {
    logger.warn(`[DUPLICATE_WARNING] scriptId=${scriptId} similarity=${detection.similarityScore}% warnings=${detection.warnings.join(',')}`);
  } else {
    logger.debug(`[DUPLICATE_CHECK_PASS] scriptId=${scriptId} similarity=${detection.similarityScore}%`);
  }
}

module.exports = {
  stringSimilarity,
  compareScripts,
  extractKeywords,
  getRecentPublishedVideos,
  detectDuplicate,
  logDuplicateDetection,
};
