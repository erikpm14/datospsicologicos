const fs = require('fs');
const path = require('path');

const { PATTERNS_PATH } = require('./pattern-learner');
const { ANALYSIS_PATH } = require('./performance-analyzer');

const LEARNING_DIR = path.resolve(__dirname, '../../data/learning');
const CONFIG_PATH = path.join(LEARNING_DIR, 'config.json');
const REPORT_PATH = path.join(LEARNING_DIR, 'report.json');

// Traduce patrones en reglas accionables para el generador.
function buildAdaptiveConfig() {
  const patterns = _readJson(PATTERNS_PATH, {});
  const analysisPayload = _readJson(ANALYSIS_PATH, { analysis: [] });
  const analysis = analysisPayload.analysis || [];
  const bestVideo = [...analysis].sort((a, b) => b.successScore - a.successScore)[0] || null;

  const topThemes = patterns.topThemes || [];
  const avoidThemes = _findAvoidThemes(analysis, topThemes);
  const config = {
    generatedAt: new Date().toISOString(),
    prioritizeHookType: patterns.bestHookType || 'RELATABLE_ACTION',
    boostThemes: topThemes,
    avoidThemes,
    preferredStructures: patterns.bestStructures || [],
    preferredMicroActions: patterns.bestMicroActions || [],
    microActionRequired: true
  };

  const report = {
    bestVideoLastBatch: bestVideo ? bestVideo.videoId : '',
    bestPatternDetected: patterns.bestHookType || '',
    whatToDoNext: _buildNextAction(config)
  };

  fs.mkdirSync(LEARNING_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  return { config, report };
}

function loadAdaptiveConfig() {
  return _readJson(CONFIG_PATH, {
    prioritizeHookType: 'RELATABLE_ACTION',
    boostThemes: [],
    avoidThemes: [],
    preferredStructures: [],
    preferredMicroActions: [],
    microActionRequired: true
  });
}

function _findAvoidThemes(analysis, topThemes) {
  const grouped = new Map();

  analysis.forEach((item) => {
    const current = grouped.get(item.topic) || { total: 0, count: 0 };
    current.total += item.successScore || 0;
    current.count += 1;
    grouped.set(item.topic, current);
  });

  return [...grouped.entries()]
    .map(([topic, value]) => ({
      topic,
      average: value.total / Math.max(value.count, 1)
    }))
    .filter((item) => item.average < 70 && !topThemes.includes(item.topic))
    .sort((a, b) => a.average - b.average)
    .slice(0, 2)
    .map((item) => item.topic);
}

function _buildNextAction(config) {
  const theme = config.boostThemes[0] || 'relationships';
  const hookType = config.prioritizeHookType || 'RELATABLE_ACTION';
  return `Generar más vídeos de ${theme} usando hook ${hookType} y micro-acción visible.`;
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  buildAdaptiveConfig,
  loadAdaptiveConfig,
  CONFIG_PATH,
  REPORT_PATH
};
