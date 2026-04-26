/**
 * analyze-patterns.js
 * Envía los datos de viral-research.json a Claude para extraer patrones
 * accionables y actualiza automáticamente:
 *   - backend/src/services/content-generator.js  (INSIGHTS en el system prompt)
 *   - backend/src/templates/psychology-hooks.json (nuevos hooks basados en datos reales)
 *   - backend/data/insights.json                  (reporte completo para referencia)
 *
 * Uso: node scripts/analyze-patterns.js
 */

const path = require('path');
const { createRequire } = require('module');

// Require apuntando al backend
const backendRequire = createRequire(path.join(__dirname, '../backend/package.json'));

// dotenv desde backend
backendRequire('dotenv').config({
  path: path.join(__dirname, '../backend/.env'),
});

// dependencias del backend
const AnthropicModule = backendRequire('@anthropic-ai/sdk');

// core
const fs = require('fs');

const Anthropic = AnthropicModule.default || AnthropicModule;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RESEARCH_PATH = path.join(__dirname, '../backend/data/viral-research.json');
const INSIGHTS_PATH = path.join(__dirname, '../backend/data/insights.json');
const HOOKS_PATH = path.join(__dirname, '../backend/src/templates/psychology-hooks.json');
const GENERATOR_PATH = path.join(__dirname, '../backend/src/services/content-generator.js');

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function extractClaudeText(msg) {
  if (!msg || !Array.isArray(msg.content)) return '';
  return msg.content
    .filter((item) => item && item.type === 'text')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function safeParseClaudeJson(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Respuesta vacía o no textual de Claude');
  }

  let text = raw.trim();

  // quitar fences markdown
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  text = text.replace(/\s*```$/i, '');

  // intento directo
  try {
    return JSON.parse(text);
  } catch (_) {
    // seguimos
  }

  // extraer bloque principal JSON
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (err) {
      throw new Error(`JSON inválido tras extraer bloque principal: ${err.message}\nRAW:\n${text}`);
    }
  }

  throw new Error(`No se encontró JSON válido en la respuesta:\n${text}`);
}

async function askClaudeForJson(prompt, maxTokens = 2000) {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = extractClaudeText(msg);
  return safeParseClaudeJson(raw);
}

// ─────────────────────────────────────────────
//  1. ANÁLISIS GENERAL DE PATRONES
// ─────────────────────────────────────────────

async function analyzePatterns(research) {
  console.log('🧠  Claude analizando patrones de viralidad...');

  const { summary, hookPatternPerformance, durationPerformance, topWords, top20Videos } = research;

  const prompt = `Eres un experto en contenido viral de psicología en español para TikTok/YouTube Shorts. Analiza estos datos reales y extrae insights accionables.

## DATOS
- Vídeos analizados: ${summary.totalVideosAnalyzed}
- Período: ${summary.dateRange.from} a ${summary.dateRange.to}
- Vistas promedio: ${summary.avgViews.toLocaleString()}
- Engagement promedio: ${summary.avgEngagement}%

## HOOKS
${JSON.stringify(hookPatternPerformance, null, 2)}

## DURACIÓN
${JSON.stringify(durationPerformance.avgEngagementByBucket, null, 2)}
Distribución: ${JSON.stringify(durationPerformance.distribution, null, 2)}

## TOP WORDS
${topWords.slice(0, 20).map((w) => `"${w.word}" x${w.count}`).join(', ')}

## TOP 10 VÍDEOS
${top20Videos
  .slice(0, 10)
  .map(
    (v, i) =>
      `${i + 1}. [${v.views.toLocaleString()} views | ${v.engagementRate}% eng | ${v.durationSec}s | ${v.hookPattern}] "${v.title}"`
  )
  .join('\n')}

## REGLAS
- Devuelve SOLO JSON válido
- Sin markdown
- Sin texto extra
- Sé breve
- Máximo 3 bestHookPatterns
- Máximo 5 topicsRanking
- Máximo 5 newHookSuggestions
- basedOn: máximo 12 palabras
- explanation y reason: máximo 20 palabras
- promptImprovements: máximo 3 frases cortas

## JSON
{
  "keyFindings": [
    "hallazgo 1",
    "hallazgo 2",
    "hallazgo 3"
  ],
  "bestHookPatterns": [
    {
      "pattern": "nombre",
      "explanation": "por qué funciona",
      "template": "plantilla",
      "example": "ejemplo"
    }
  ],
  "wordsToAvoid": ["palabra1", "palabra2"],
  "powerWords": ["palabra1", "palabra2"],
  "optimalDuration": {
    "seconds": 30,
    "reasoning": "por qué"
  },
  "topicsRanking": [
    { "topic": "nombre", "reason": "motivo corto" }
  ],
  "promptImprovements": "2-3 frases cortas",
  "newHookSuggestions": [
    {
      "text": "hook",
      "topic": "body_language|cognitive_biases|relationships|workplace|first_impressions|social_skills|habits|communication|emotions|memory|motivation|dark_psychology|self_esteem",
      "emotionalTrigger": "curiosity|fear|awe|validation|urgency|controversy",
      "estimatedScore": 85,
      "basedOn": "referencia corta"
    }
  ]
}`;

  return askClaudeForJson(prompt, 4500);
}

// ─────────────────────────────────────────────
//  2. ANÁLISIS DE TÍTULOS — ESTRUCTURA LINGÜÍSTICA
// ─────────────────────────────────────────────

async function analyzeTitleStructure(top20Videos) {
  console.log('🔤  Analizando estructura lingüística de títulos...');

  const titles = top20Videos
    .slice(0, 20)
    .map((v, i) => `${i + 1}. [${v.views.toLocaleString()} views] "${v.title}"`)
    .join('\n');

  const prompt = `Analiza los títulos de los 20 vídeos de psicología más virales en español. Identifica patrones lingüísticos precisos.

${titles}

Responde SOLO JSON válido. Sin markdown. Sin bloques \`\`\`. Sin texto antes ni después.

{
  "openingFormulas": [
    { "formula": "cómo empieza", "frequency": 5, "example": "ejemplo real" }
  ],
  "numberUsage": {
    "percentage": 60,
    "insight": "qué tipo de números funcionan más"
  },
  "emotionalWordPatterns": [
    { "word": "nunca", "context": "cuándo y cómo se usa", "impact": "alto|medio|bajo" }
  ],
  "questionVsStatement": {
    "questions": 30,
    "statements": 70,
    "bestPerforming": "questions|statements",
    "insight": "por qué"
  },
  "avgTitleLength": {
    "words": 9,
    "insight": "qué longitud funciona mejor"
  },
  "forbiddenPhrases": ["frases que NO aparecen en vídeos virales"],
  "mustHaveElements": ["elementos que casi siempre están presentes"]
}`;

  return askClaudeForJson(prompt, 1800);
}

// ─────────────────────────────────────────────
//  3. ACTUALIZAR PSYCHOLOGY-HOOKS.JSON
// ─────────────────────────────────────────────

function updateHooksFile(insights) {
  const hooksData = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf8'));
  const existing = new Set(hooksData.hooks.map((h) => h.text.toLowerCase()));

  const newHooks = (insights.newHookSuggestions || [])
    .filter((h) => h && h.text && !existing.has(h.text.toLowerCase()))
    .map((h, i) => ({
      id: `hook_ai_${String(hooksData.hooks.length + i + 1).padStart(3, '0')}`,
      text: h.text,
      topic: h.topic,
      emotionalTrigger: h.emotionalTrigger,
      estimatedScore: h.estimatedScore,
      source: 'viral_research',
      basedOn: h.basedOn,
    }));

  if (newHooks.length > 0) {
    hooksData.hooks.push(...newHooks);
    fs.writeFileSync(HOOKS_PATH, JSON.stringify(hooksData, null, 2));
    console.log(`✅  Añadidos ${newHooks.length} nuevos hooks basados en datos reales`);
  } else {
    console.log('ℹ️   Sin hooks nuevos que añadir (ya existen o no hay sugerencias)');
  }

  return newHooks.length;
}

// ─────────────────────────────────────────────
//  4. ACTUALIZAR CONTENT-GENERATOR.JS
// ─────────────────────────────────────────────

function updateContentGenerator(insights, titleAnalysis) {
  const content = fs.readFileSync(GENERATOR_PATH, 'utf8');

  const powerWords = (insights.powerWords || []).slice(0, 12).join(', ');
  const avoidWords = (insights.wordsToAvoid || []).join(', ');
  const topPatterns = (insights.bestHookPatterns || [])
    .slice(0, 3)
    .map((p) => `  • ${p.pattern}: "${p.template}" — ${p.explanation}`)
    .join('\n');

  const topTopics = (insights.topicsRanking || [])
    .slice(0, 5)
    .map((t, i) => `  ${i + 1}. ${t.topic}: ${t.reason}`)
    .join('\n');

  const titleInsights = titleAnalysis
    ? `\nESTRUCTURA DE TÍTULOS VIRALES (datos reales):
  • Preguntas vs afirmaciones: ${titleAnalysis.questionVsStatement?.bestPerforming} rinden más
  • Elementos obligatorios: ${(titleAnalysis.mustHaveElements || []).join(', ')}
  • Longitud óptima: ~${titleAnalysis.avgTitleLength?.words} palabras`
    : '';

  const insightsBlock = `
════════════════════════════════════════
INSIGHTS DE INVESTIGACIÓN VIRAL (datos reales de YouTube)
Actualizado: ${new Date().toISOString().slice(0, 10)}
════════════════════════════════════════
PATRONES DE HOOK MÁS EFECTIVOS (por engagement real):
${topPatterns}

TOPICS CON MAYOR RENDIMIENTO:
${topTopics}

PALABRAS DE ALTO IMPACTO COMPROBADAS:
${powerWords}

PALABRAS A EVITAR (baja retención):
${avoidWords}

DURACIÓN ÓPTIMA: ${insights.optimalDuration?.seconds}s — ${insights.optimalDuration?.reasoning}
${titleInsights}

MEJORAS BASADAS EN DATOS:
${insights.promptImprovements}`;

  const marker = '════════════════════════════════════════\nINSIGHTS DE INVESTIGACIÓN VIRAL';
  const endMarker = '════════════════════════════════════════\nFORMATO DE RESPUESTA';

  let updated;
  if (content.includes(marker)) {
    const start = content.indexOf(marker) - 1;
    const end = content.indexOf(endMarker);
    updated = content.slice(0, start) + insightsBlock + '\n\n' + content.slice(end);
  } else {
    updated = content.replace(
      '════════════════════════════════════════\nFORMATO DE RESPUESTA',
      insightsBlock + '\n\n════════════════════════════════════════\nFORMATO DE RESPUESTA'
    );
  }

  fs.writeFileSync(GENERATOR_PATH, updated);
  console.log('✅  content-generator.js actualizado con insights reales');
}

// ─────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(RESEARCH_PATH)) {
    console.error('❌  No existe viral-research.json. Ejecuta primero: node scripts/viral-research.js');
    process.exit(1);
  }

  const research = JSON.parse(fs.readFileSync(RESEARCH_PATH, 'utf8'));
  console.log(`📂  Datos cargados: ${research.summary.totalVideosAnalyzed} vídeos | generados el ${research.generatedAt.slice(0, 10)}\n`);

  const [insights, titleAnalysis] = await Promise.all([
    analyzePatterns(research),
    analyzeTitleStructure(research.top20Videos),
  ]);

  const fullReport = {
    generatedAt: new Date().toISOString(),
    basedOnResearch: research.generatedAt,
    insights,
    titleAnalysis,
  };

  fs.writeFileSync(INSIGHTS_PATH, JSON.stringify(fullReport, null, 2));
  console.log(`\n💾  Insights guardados en: ${INSIGHTS_PATH}`);

  console.log('\n🔧  Aplicando mejoras al sistema...');
  const newHooksCount = updateHooksFile(insights);
  updateContentGenerator(insights, titleAnalysis);

  console.log('\n' + '═'.repeat(60));
  console.log('📊  RESUMEN DE HALLAZGOS');
  console.log('═'.repeat(60));
  console.log('\n🎯  Hallazgos clave:');
  (insights.keyFindings || []).forEach((f) => console.log(`   • ${f}`));

  console.log('\n🏆  Patrones de hook más efectivos:');
  (insights.bestHookPatterns || [])
    .slice(0, 3)
    .forEach((p) => console.log(`   • ${p.pattern}: "${p.template}"`));

  console.log('\n⚡  Palabras de alto impacto:', (insights.powerWords || []).join(', '));
  console.log(`\n✅  ${newHooksCount} nuevos hooks añadidos al sistema`);
  console.log('\n🚀  Sistema actualizado. Genera un nuevo vídeo para probar los cambios:');
  console.log('   POST http://localhost:3001/api/videos/generate');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});