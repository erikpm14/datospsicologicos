/**
 * SCRIPT DIVERSITY GATE
 *
 * Screening editorial antes de TTS/render/publicación.
 * Evita guiones demasiado parecidos a vídeos publicados, rechazados o generados recientemente.
 * No sustituye Duplicate Hard Block (es última barrera).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SIMILARITY_THRESHOLD_HOOK = 0.70;
const SIMILARITY_THRESHOLD_TITLE = 0.70;
const SIMILARITY_THRESHOLD_PHRASE = 0.70;
const SIMILARITY_THRESHOLD_FULL_SCRIPT = 0.60;
const KEYWORD_OVERLAP_THRESHOLD = 0.50;

const PSYCHOLOGY_TOPICS_ALLOWED = [
  'psicología social',
  'sesgos cognitivos',
  'relaciones',
  'manipulación emocional',
  'memoria',
  'hábitos',
  'sueño',
  'ansiedad',
  'dopamina',
  'autoestima',
  'lenguaje corporal',
  'toma de decisiones',
  'soledad',
  'trauma cotidiano',
  'productividad mental',
  'miedo al rechazo',
  'comparación social',
  'procrastinación',
  'apego emocional',
  'autocontrol',
];

const BLACKLIST_PHRASES = [
  'no es debilidad',
  'tu cerebro tiene un límite',
  'tu cerebro no busca paz',
  'busca control',
  'tus emociones son más fuertes',
  'ya decidiste',
  'tu cerebro solo busca razones',
  'tu atención no falla',
  'estás saturado',
  'tu cerebro',
];

// Regla temporal: durante 10 vídeos, prohibido "tu cerebro" en hook
const TEMP_BANNED_PHRASES_IN_HOOK = ['tu cerebro'];
const TEMP_BAN_DURATION_VIDEOS = 10;

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-záéíóúñ0-9\s]/g, '');
}

function calculateStringSimilarity(str1, str2) {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const editDistance = getLevenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function getLevenshteinDistance(s1, s2) {
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

function extractKeywords(text) {
  const words = normalizeText(text)
    .split(/\s+/)
    .filter(w => w.length > 3);
  return [...new Set(words)];
}

function calculateKeywordOverlap(keywords1, keywords2) {
  if (!keywords1.length || !keywords2.length) return 0;
  const intersection = keywords1.filter(k => keywords2.includes(k));
  const union = [...new Set([...keywords1, ...keywords2])];
  return intersection.length / union.length;
}

function extractPsychologyTopic(script) {
  const scriptLower = (script.title || '').toLowerCase() + ' ' + (script.script || '').toLowerCase();
  for (const topic of PSYCHOLOGY_TOPICS_ALLOWED) {
    if (scriptLower.includes(topic)) {
      return topic;
    }
  }
  return 'unknown';
}

function extractHookPattern(hook) {
  if (!hook) return 'unknown';
  const normalized = normalizeText(hook);
  if (normalized.includes('no es')) return 'negation_pattern';
  if (normalized.includes('tu')) return 'personal_direct';
  if (normalized.includes('verdad')) return 'truth_pattern';
  if (normalized.includes('sabías')) return 'knowledge_pattern';
  if (normalized.includes('solo')) return 'exclusive_pattern';
  return 'generic';
}

function extractNarrativeStructure(script) {
  if (!script || !script.subtitleBlocks) return 'unknown';
  const blockCount = script.subtitleBlocks.length;
  const avgBlockLength = script.subtitleBlocks.reduce((sum, b) => sum + (b.text || '').length, 0) / blockCount;

  if (blockCount <= 5) return 'short_punchy';
  if (blockCount <= 10) return 'medium_balanced';
  if (avgBlockLength > 100) return 'long_detailed';
  return 'mixed';
}

function readPublishedMetadata() {
  const publishedDir = path.join(__dirname, '../../output');
  const recent = [];

  if (!fs.existsSync(publishedDir)) {
    return recent;
  }

  const dirs = fs.readdirSync(publishedDir).slice(-20); // Últimos 20 directorios
  for (const dir of dirs) {
    const metadataPath = path.join(publishedDir, dir, 'generation-metadata.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        if (metadata.script) {
          recent.push({
            videoId: dir,
            script: metadata.script,
            psychologyTopic: metadata.psychologyTopic || extractPsychologyTopic(metadata.script),
            dominantKeywords: metadata.dominantKeywords || extractKeywords(metadata.script.hook || ''),
            hookPattern: metadata.hookPattern || extractHookPattern(metadata.script.hook),
            status: 'published',
          });
        }
      } catch (err) {
        // Ignorar archivos corruptos
      }
    }
  }

  return recent;
}

function readRejectedScripts() {
  const rejectedDir = path.join(__dirname, '../../output/rejected');
  const rejected = [];

  if (!fs.existsSync(rejectedDir)) {
    return rejected;
  }

  const categories = ['duplicates', 'scripts-too-similar'];
  for (const category of categories) {
    const categoryPath = path.join(rejectedDir, category);
    if (!fs.existsSync(categoryPath)) continue;

    const dirs = fs.readdirSync(categoryPath).slice(-10);
    for (const dir of dirs) {
      const metadataPath = path.join(categoryPath, dir, 'generation-metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          if (metadata.script) {
            rejected.push({
              videoId: dir,
              script: metadata.script,
              category,
              psychologyTopic: metadata.psychologyTopic || extractPsychologyTopic(metadata.script),
              dominantKeywords: metadata.dominantKeywords || extractKeywords(metadata.script.hook || ''),
              hookPattern: metadata.hookPattern || extractHookPattern(metadata.script.hook),
              status: 'rejected',
            });
          }
        } catch (err) {
          // Ignorar
        }
      }
    }
  }

  return rejected;
}

function readRecentlyGenerated() {
  const testDir = path.join(__dirname, '../../output-fase1-test');
  const recent = [];

  if (!fs.existsSync(testDir)) {
    return recent;
  }

  const dirs = fs.readdirSync(testDir).slice(-5); // Últimos 5 generados
  for (const dir of dirs) {
    const metadataPath = path.join(testDir, dir, 'generation-metadata.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        if (metadata.script) {
          recent.push({
            videoId: dir,
            script: metadata.script,
            psychologyTopic: metadata.psychologyTopic || extractPsychologyTopic(metadata.script),
            dominantKeywords: metadata.dominantKeywords || extractKeywords(metadata.script.hook || ''),
            hookPattern: metadata.hookPattern || extractHookPattern(metadata.script.hook),
            status: 'generated',
          });
        }
      } catch (err) {
        // Ignorar
      }
    }
  }

  return recent;
}

async function checkScriptDiversity(candidateScript, options = {}) {
  const { videoId = 'unknown', verbose = false } = options;

  console.log('[SCRIPT_DIVERSITY_CHECK_STARTED]');
  logger.info(`[SCRIPT_DIVERSITY_CHECK_STARTED] videoId=${videoId}`);

  const result = {
    passed: true,
    videoId,
    reasons: [],
    scores: {
      hookSimilarity: 0,
      titleSimilarity: 0,
      fullScriptSimilarity: 0,
      primaryPhraseSimilarity: 0,
      keywordOverlap: 0,
      topicRepetition: false,
      hookPatternRepetition: false,
    },
    metadata: {
      contentAngle: candidateScript.contentAngle || 'unknown',
      psychologyTopic: extractPsychologyTopic(candidateScript),
      dominantKeywords: extractKeywords(candidateScript.hook || ''),
      hookPattern: extractHookPattern(candidateScript.hook),
      narrativeStructure: extractNarrativeStructure(candidateScript),
      diversityScore: 100,
    },
  };

  // CHECK 0: Blacklist de frases prohibidas
  const candidateHook = (candidateScript.hook || '').toLowerCase();
  const candidateTitle = (candidateScript.title || '').toLowerCase();
  const candidateBody = (candidateScript.script || '').toLowerCase();

  for (const phrase of BLACKLIST_PHRASES) {
    if (candidateHook.includes(phrase) || candidateTitle.includes(phrase)) {
      result.passed = false;
      result.reasons.push(`BLACKLIST: Frase prohibida encontrada: "${phrase}"`);
      result.metadata.diversityScore -= 25;
    }
  }

  // CHECK 0b: Regla temporal - "tu cerebro" prohibido en hook durante 10 vídeos
  if (TEMP_BANNED_PHRASES_IN_HOOK.some(phrase => candidateHook.includes(phrase))) {
    result.passed = false;
    result.reasons.push('TEMP_BAN: "tu cerebro" prohibido en hook (ban temporal por 10 vídeos)');
    result.metadata.diversityScore -= 20;
  }

  // Cargar metadata existente
  const published = readPublishedMetadata();
  const rejected = readRejectedScripts();
  const recentlyGenerated = readRecentlyGenerated();
  const allCompare = [...published, ...rejected, ...recentlyGenerated];

  if (allCompare.length === 0) {
    console.log('[SCRIPT_DIVERSITY_GATE_PASS] No prior scripts to compare against');
    logger.info('[SCRIPT_DIVERSITY_GATE_PASS] No prior scripts found');
    return result;
  }

  // CHECK 1: hookSimilarity
  for (const compare of allCompare) {
    const hookSim = calculateStringSimilarity(candidateScript.hook, compare.script.hook);
    if (hookSim >= SIMILARITY_THRESHOLD_HOOK) {
      result.passed = false;
      result.reasons.push(
        `HOOK_SIMILAR (${(hookSim * 100).toFixed(0)}%): "${compare.script.hook}" (${compare.status})`
      );
      result.scores.hookSimilarity = Math.max(result.scores.hookSimilarity, hookSim);
    }
  }

  // CHECK 2: titleSimilarity
  for (const compare of allCompare) {
    const titleSim = calculateStringSimilarity(candidateScript.title, compare.script.title);
    if (titleSim >= SIMILARITY_THRESHOLD_TITLE) {
      result.passed = false;
      result.reasons.push(
        `TITLE_SIMILAR (${(titleSim * 100).toFixed(0)}%): "${compare.script.title}" (${compare.status})`
      );
      result.scores.titleSimilarity = Math.max(result.scores.titleSimilarity, titleSim);
    }
  }

  // CHECK 3: fullScriptSimilarity
  const candidateFullScript = (candidateScript.hook + ' ' + candidateScript.title + ' ' +
    (candidateScript.script || '')).toLowerCase();

  for (const compare of allCompare) {
    const compareFullScript = (compare.script.hook + ' ' + compare.script.title + ' ' +
      (compare.script.script || '')).toLowerCase();
    const fullSim = calculateStringSimilarity(candidateFullScript, compareFullScript);

    if (fullSim >= SIMILARITY_THRESHOLD_FULL_SCRIPT) {
      result.passed = false;
      result.reasons.push(
        `SCRIPT_SIMILAR (${(fullSim * 100).toFixed(0)}%): videoId ${compare.videoId} (${compare.status})`
      );
      result.scores.fullScriptSimilarity = Math.max(result.scores.fullScriptSimilarity, fullSim);
    }
  }

  // CHECK 4: primaryPhraseSimilarity (primeras palabras del hook)
  const candidatePrimaryPhrase = candidateScript.hook?.split(' ').slice(0, 5).join(' ') || '';
  if (candidatePrimaryPhrase) {
    for (const compare of allCompare) {
      const comparePrimaryPhrase = compare.script.hook?.split(' ').slice(0, 5).join(' ') || '';
      const phraseSim = calculateStringSimilarity(candidatePrimaryPhrase, comparePrimaryPhrase);
      if (phraseSim >= SIMILARITY_THRESHOLD_PHRASE) {
        result.passed = false;
        result.reasons.push(
          `PRIMARY_PHRASE_SIMILAR (${(phraseSim * 100).toFixed(0)}%): "${comparePrimaryPhrase}" (${compare.status})`
        );
        result.scores.primaryPhraseSimilarity = Math.max(result.scores.primaryPhraseSimilarity, phraseSim);
      }
    }
  }

  // CHECK 5: dominantKeywordOverlap > 50% con últimos 3
  const candidateKeywords = result.metadata.dominantKeywords;
  const recent3 = allCompare.slice(-3);
  for (const compare of recent3) {
    const keywordOverlap = calculateKeywordOverlap(candidateKeywords, compare.dominantKeywords);
    if (keywordOverlap > KEYWORD_OVERLAP_THRESHOLD) {
      result.passed = false;
      result.reasons.push(
        `KEYWORD_OVERLAP (${(keywordOverlap * 100).toFixed(0)}%): Solapamiento con videoId ${compare.videoId} (${compare.status})`
      );
      result.scores.keywordOverlap = Math.max(result.scores.keywordOverlap, keywordOverlap);
    }
  }

  // CHECK 6: psychologyTopic igual a últimos 2 publicados
  const recentPublished = published.slice(-2);
  const candidateTopic = result.metadata.psychologyTopic;
  let topicMatchCount = 0;
  for (const compare of recentPublished) {
    if (compare.psychologyTopic === candidateTopic) {
      topicMatchCount++;
    }
  }
  if (topicMatchCount >= 2) {
    result.passed = false;
    result.reasons.push(`TOPIC_REPETITION: ${candidateTopic} es igual a los últimos 2 publicados`);
    result.scores.topicRepetition = true;
  }

  // CHECK 7: hookPattern igual a últimos 3 publicados
  const recentPublished3 = published.slice(-3);
  const candidateHookPattern = result.metadata.hookPattern;
  let hookPatternMatchCount = 0;
  for (const compare of recentPublished3) {
    if (compare.hookPattern === candidateHookPattern) {
      hookPatternMatchCount++;
    }
  }
  if (hookPatternMatchCount >= 3) {
    result.passed = false;
    result.reasons.push(`HOOK_PATTERN_REPETITION: ${candidateHookPattern} en últimos 3 publicados`);
    result.scores.hookPatternRepetition = true;
  }

  // Calcular diversity score final
  if (result.reasons.length > 0) {
    result.metadata.diversityScore = Math.max(0, 100 - result.reasons.length * 15);
  }

  // Log resultado
  if (result.passed) {
    console.log('[SCRIPT_DIVERSITY_GATE_PASS]');
    logger.info(`[SCRIPT_DIVERSITY_GATE_PASS] videoId=${videoId} diversityScore=${result.metadata.diversityScore}`);
  } else {
    console.log(`[SCRIPT_DIVERSITY_GATE_FAILED] Reasons: ${result.reasons.length}`);
    logger.info(`[SCRIPT_DIVERSITY_GATE_FAILED] videoId=${videoId}`);
    for (const reason of result.reasons) {
      logger.info(`  - ${reason}`);
    }
  }

  if (verbose) {
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
}

module.exports = {
  checkScriptDiversity,
  extractPsychologyTopic,
  extractHookPattern,
  extractNarrativeStructure,
  extractKeywords,
};
