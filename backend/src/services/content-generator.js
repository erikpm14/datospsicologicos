require('dotenv').config();
const { generateAiToolsScript } = require('../content/ai-tools/script-generator');

const LEGACY_PSYCHOLOGY_GENERATOR = () => require('../legacy/psychology/content-generator.legacy');

function isLegacyPsychologyMode() {
  const mode = String(process.env.PROJECT_MODE || '').trim().toUpperCase();
  const domain = String(process.env.CONTENT_DOMAIN || '').trim().toLowerCase();
  return mode === 'PSYCHOLOGY_LEGACY' || domain === 'psychology';
}

async function generateScript(options = {}) {
  if (isLegacyPsychologyMode()) {
    const legacy = LEGACY_PSYCHOLOGY_GENERATOR();
    return legacy.generateScript(options);
  }
  return generateAiToolsScript(options);
}

async function generateSeries(options = {}) {
  const parts = Math.max(1, parseInt(options.parts || '3', 10) || 3);
  const topic = options.topic || process.env.CONTENT_DOMAIN || 'ai_tools';
  const scripts = [];
  for (let i = 1; i <= parts; i += 1) {
    const s = await generateScript({ ...options, topic });
    scripts.push({
      ...s,
      seriesPart: i,
      seriesTotal: parts,
    });
  }
  return scripts;
}

async function generateBatch(countOrOptions = 3) {
  const count = typeof countOrOptions === 'number'
    ? countOrOptions
    : parseInt(countOrOptions.count || countOrOptions.n || '3', 10) || 3;
  const topic = typeof countOrOptions === 'object' ? countOrOptions.topic : undefined;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(await generateScript({ topic }));
  }
  return out;
}

module.exports = { generateScript, generateBatch, generateSeries };

