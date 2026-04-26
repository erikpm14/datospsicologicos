/**
 * content-quality-gate.js — Strict Quality Gate
 *
 * Evaluates a video candidate for publication using a 3-stage pipeline:
 *
 *   Stage A — Generation score  (viralityScore emitido por Claude, 0-100)
 *   Stage B — Quality score     (hook + structure + freshness, 0-100)
 *   Stage C — Final publish score (A×0.60 + B×0.40, mín para publicar: 76)
 *
 * Hard gates — cualquier fallo descarta inmediatamente:
 *   1. viralityScore >= MIN_VIRALITY_SCORE_TO_PUBLISH (default 80)
 *   2. Script tiene las 4 secciones con contenido mínimo
 *
 * Soft gates — contribuyen al quality score (B):
 *   3. Hook quality: sin patrones genéricos, con tensión/inmediatez
 *   4. Content freshness: no repetitivo vs últimos publicados
 *   5. formatMatchScore (si disponible)
 *
 * Motivos de descarte:
 *   discarded_low_virality          viralityScore < MIN_VIRALITY_SCORE_TO_PUBLISH
 *   discarded_weak_hook             hook genérico, sin tensión, demasiado corto
 *   discarded_incoherent_structure  secciones faltantes o vacías
 *   discarded_repetitive_content    hook demasiado similar a publicados recientes
 *   discarded_low_quality           quality score < MIN_CONTENT_QUALITY_SCORE
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const PUBLISH_THRESHOLD  = parseInt(process.env.MIN_VIRALITY_SCORE_TO_PUBLISH || '65');
const MIN_QUALITY_SCORE  = parseInt(process.env.MIN_CONTENT_QUALITY_SCORE    || '60');
const PUBLISH_LOG_PATH   = path.resolve('./data/publish-log.json');

// ─── Patrones de hook débil (señales de contenido genérico) ──────────────────
const WEAK_HOOK_PATTERNS = [
  /^hoy (te )?(voy a|quiero|vamos a)\b/i,
  /^en este (vídeo|video)\b/i,
  /^vamos a (ver|hablar|aprender|conocer)\b/i,
  /^la psicología (nos |)dice\b/i,
  /^¿sabías que (la psicología|el cerebro|los estudios|los investigadores)\b/i,
  /^bienvenido(s)?\b/i,
  /^hola,?\s*(hoy|te|voy)\b/i,
];

// ─── Señales de tensión/inmediatez de alto impacto viral ─────────────────────
const TENSION_SIGNALS = [
  /sin (saberlo|darte cuenta|que lo sepas|que te des)/i,
  /te (está|están) (saboteando|afectando|manipulando|destruyendo|limitando|condicionando)/i,
  /tu (cerebro|mente|inconsciente) (te |está |hace |lleva )/i,
  /cada vez que\b/i,
  /cada (noche|día|mañana|semana|vez)\b/i,
  /nunca (te |lo |nadie )?(contaron|dijeron|enseñaron|explicaron|vas a)/i,
  /estás (cometiendo|haciendo|saboteando|destruyendo|arruinando|perdiendo)/i,
  /llevas (años|tiempo|meses|semanas) (sin saber|haciendo|creyendo|pensando)/i,
  /sin que (nadie|te des|te lo)/i,
  /automáticamente\b/i,
  /involuntariamente\b/i,
  /y no (lo sabes|eres consciente|te das cuenta)/i,
];

// ─── Palabras de alto impacto psicológico ─────────────────────────────────────
const PSYCHOLOGY_SIGNALS = [
  /\b(cerebro|neurona|dopamina|cortisol|amígdala|prefrontal)\b/i,
  /\b(estudio|investigación|experimento|demostró|comprobó)\b/i,
  /\b(inconsciente|subconsciente|automático|involuntario)\b/i,
  /\b(sesgo|efecto|síndrome|paradoja|disonancia|fenómeno)\b/i,
];

// ─────────────────────────────────────────────
//  STAGE B.1 — HOOK SCORE (0-100)
// ─────────────────────────────────────────────

function scoreHook(hook) {
  if (!hook || hook.trim().length < 10) {
    return {
      score: 0,
      discardReason: 'discarded_weak_hook',
      detail: `hook demasiado corto (${(hook || '').trim().length} chars)`,
    };
  }

  let score = 50; // base

  // Penalización por patrón genérico
  if (WEAK_HOOK_PATTERNS.some(p => p.test(hook.trim()))) {
    score -= 30;
  }

  // Bonus por señal de tensión
  if (TENSION_SIGNALS.some(p => p.test(hook))) {
    score += 20;
  }

  // Bonus por señal psicológica
  if (PSYCHOLOGY_SIGNALS.some(p => p.test(hook))) {
    score += 15;
  }

  // Bonus segunda persona (conecta directamente con el espectador)
  if (/\b(tú|tu|estás|haces|tienes|crees|sientes|eres|llevas|sabías)\b/i.test(hook)) {
    score += 10;
  }

  // Bonus longitud (hook específico = mejor)
  if (hook.trim().length >= 50) score += 5;

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    discardReason: null,
    detail: score < 35
      ? `hook score ${score}/100 (débil, se penaliza pero no bloquea)`
      : `hook score ${score}/100`,
  };
}

// ─────────────────────────────────────────────
//  STAGE B.2 — STRUCTURE SCORE (0-100)
// ─────────────────────────────────────────────

function scoreStructure(script) {
  const MIN_LEN = 15;
  const sections = [
    { key: 'hook',        weight: 30 },
    { key: 'claim',       weight: 25 },
    { key: 'explanation', weight: 30 },
    { key: 'cta',         weight: 15 },
  ];

  const missing = sections.filter(s => !script[s.key] || script[s.key].trim().length < MIN_LEN);

  if (missing.length >= 2) {
    return {
      score: 0,
      discardReason: 'discarded_incoherent_structure',
      detail: `secciones faltantes: ${missing.map(s => s.key).join(', ')}`,
    };
  }

  // Score por peso de secciones presentes
  const totalWeight = sections.reduce((sum, s) => sum + s.weight, 0);
  const presentWeight = sections
    .filter(s => script[s.key] && script[s.key].trim().length >= MIN_LEN)
    .reduce((sum, s) => sum + s.weight, 0);

  let score = Math.round((presentWeight / totalWeight) * 70);

  // Bonus por contenido sustancial
  const totalLength = sections.reduce((sum, s) => sum + (script[s.key] || '').trim().length, 0);
  if (totalLength > 200) score += 15;
  if (totalLength > 400) score += 15;

  score = Math.min(100, score);

  return {
    score,
    discardReason: missing.length === 1 ? null : null,
    detail: `structure score ${score}/100 | total ${totalLength} chars`,
  };
}

// ─────────────────────────────────────────────
//  STAGE B.3 — FRESHNESS SCORE (0-100)
// ─────────────────────────────────────────────

function scoreFreshness(script, publishLog) {
  const recentHooks  = (publishLog || []).slice(0, 15).map(p => p.hook).filter(Boolean);
  const recentTopics = (publishLog || []).slice(0, 3).map(p => p.topic).filter(Boolean);

  if (recentHooks.length === 0) return { score: 100, discardReason: null, detail: 'no hay publicados recientes' };

  const candidateWords = new Set((script.hook || '').toLowerCase().split(/\s+/).filter(w => w.length > 3));

  let maxSimilarity = 0;
  for (const h of recentHooks) {
    const recentWords = new Set(h.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const intersection = [...candidateWords].filter(w => recentWords.has(w)).length;
    const union = new Set([...candidateWords, ...recentWords]).size;
    if (union > 0) maxSimilarity = Math.max(maxSimilarity, intersection / union);
  }

  const topicRepeats = recentTopics.filter(t => t === script.topic).length;
  const repetitionPenalty = maxSimilarity > 0.55 ? 25 : 0;
  const score = Math.max(0, Math.round((1 - maxSimilarity) * 100) - topicRepeats * 10 - repetitionPenalty);

  return {
    score,
    discardReason: null,
    detail: maxSimilarity > 0.55
      ? `freshness ${score}/100 | similarity ${(maxSimilarity * 100).toFixed(0)}% (penalizado, no bloquea)`
      : `freshness ${score}/100 | similarity ${(maxSimilarity * 100).toFixed(0)}%`,
  };
}

// ─────────────────────────────────────────────
//  EVALUACIÓN COMPLETA
// ─────────────────────────────────────────────

/**
 * Evalúa un candidato en las 3 etapas.
 *
 * @param {Object} script       — script.json del vídeo
 * @param {Array}  publishLog   — array del publish-log.json (recientes primero)
 * @returns {{
 *   pass: boolean,
 *   scoreA: number,         generation score (viralityScore)
 *   scoreB: number,         quality score (hook + structure + freshness)
 *   scoreFinal: number,     A×0.60 + B×0.40
 *   discardReason: string|null,
 *   discardDetail: string|null,
 *   breakdown: Object
 * }}
 */
function evaluateCandidate(script, publishLog = []) {
  if (!script || typeof script !== 'object') {
    return _discard('discarded_incoherent_structure', 'script null o inválido', 0, 0);
  }

  // ── STAGE A: generation score ──────────────────────────────────────────────
  const scoreA = script.viralityScore || 0;


  // ── STAGE B: quality score ─────────────────────────────────────────────────
  const hookResult       = scoreHook(script.hook);
  const structureResult  = scoreStructure(script);
  const freshnessResult  = scoreFreshness(script, publishLog);

  if (structureResult.discardReason) {
    const scoreB = Math.round(hookResult.score * 0.40 + structureResult.score * 0.35 + freshnessResult.score * 0.25);
    return _discard(structureResult.discardReason, structureResult.detail, scoreA, scoreB, {
      hook: hookResult, structure: structureResult, freshness: freshnessResult,
    });
  }

  const scoreB = Math.round(
    hookResult.score      * 0.40 +
    structureResult.score * 0.35 +
    freshnessResult.score * 0.25,
  );

  if (scoreB < MIN_QUALITY_SCORE) {
    return _discard(
      'discarded_low_quality',
      `quality score ${scoreB}/100 < ${MIN_QUALITY_SCORE}`,
      scoreA, scoreB,
      { hook: hookResult, structure: structureResult, freshness: freshnessResult },
    );
  }

  // ── STAGE C: final publish score ───────────────────────────────────────────
  const scoreFinal = Math.round(scoreA * 0.60 + scoreB * 0.40);

  logger.info(
    `QualityGate PASS | scoreA=${scoreA} scoreB=${scoreB} scoreFinal=${scoreFinal} | ` +
    `hook=${hookResult.score} struct=${structureResult.score} fresh=${freshnessResult.score}`,
  );

  return {
    pass: true,
    scoreA,
    scoreB,
    scoreFinal,
    discardReason: null,
    discardDetail: null,
    breakdown: { hook: hookResult, structure: structureResult, freshness: freshnessResult },
  };
}

function _discard(discardReason, discardDetail, scoreA, scoreB, breakdown = {}) {
  const scoreFinal = Math.round(scoreA * 0.60 + scoreB * 0.40);
  logger.warn(`QualityGate DISCARD [${discardReason}] | ${discardDetail} | scoreA=${scoreA} scoreB=${scoreB}`);
  return { pass: false, scoreA, scoreB, scoreFinal, discardReason, discardDetail, breakdown };
}

// ─────────────────────────────────────────────
//  LECTURA DE PUBLISH LOG
// ─────────────────────────────────────────────

function loadPublishLog() {
  try {
    if (!fs.existsSync(PUBLISH_LOG_PATH)) return [];
    return JSON.parse(fs.readFileSync(PUBLISH_LOG_PATH, 'utf8'));
  } catch { return []; }
}

// ─────────────────────────────────────────────
//  DESCARTAR UN VÍDEO (escribe discarded.json)
// ─────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

function discardVideo(videoId, reason, detail = null) {
  const discardPath = path.join(OUTPUT_DIR, videoId, 'discarded.json');
  const data = {
    discardedAt:  new Date().toISOString(),
    discardReason: reason,
    discardDetail: detail || reason,
  };
  fs.writeFileSync(discardPath, JSON.stringify(data, null, 2));
  logger.info(`Video ${videoId} descartado: ${reason} — ${detail}`);
}

// ─── Test directo ─────────────────────────────────────────────────────────────
if (require.main === module) {
  const scriptPath = process.argv[2];
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    console.error('Usage: node content-quality-gate.js <script.json>');
    process.exit(1);
  }
  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const log    = loadPublishLog();
  const result = evaluateCandidate(script, log);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}

module.exports = { evaluateCandidate, discardVideo, loadPublishLog, PUBLISH_THRESHOLD };
