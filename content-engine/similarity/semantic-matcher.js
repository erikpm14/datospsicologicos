const fs = require('fs');
const path = require('path');

const { scoreSimilarity } = require('./similarity-scorer');

const MATCHES_PATH = path.resolve(__dirname, '../../data/similarity/semantic-matches.json');
const REPORT_PATH = path.resolve(__dirname, '../../data/similarity/similarity-report.json');

// Encuentra matches semánticos útiles para transferencia.
function findSemanticMatches(newScripts = [], historical = [], clusters = []) {
  fs.mkdirSync(path.dirname(MATCHES_PATH), { recursive: true });

  const matches = newScripts.map((script) => {
    const scored = historical.map((item) => {
      const similarity = scoreSimilarity(script, item);
      return {
        videoId: item.videoId,
        title: item.title,
        category: item.category,
        semanticSimilarityScore: similarity.semanticSimilarityScore,
        confidenceScore: similarity.confidenceScore,
        explainability: similarity.explainability,
        matchReason: _buildReason(similarity.explainability),
        inheritedSignalsAvailable: _getInheritedSignalsAvailable(item)
      };
    }).sort((a, b) => b.semanticSimilarityScore - a.semanticSimilarityScore);

    const cluster = clusters.find((item) =>
      item.clusterId === _getPreferredClusterId(script) ||
      item.clusterLabel.includes(String(script.topic || '').toLowerCase())
    );
    const topMatches = scored.slice(0, 3);
    const best = topMatches[0];

    return {
      scriptId: script.id,
      title: script.title,
      topMatches,
      matchScore: best?.semanticSimilarityScore || 0,
      matchReason: best?.matchReason || 'no_semantic_match',
      inheritedSignalsAvailable: topMatches.some((item) => item.inheritedSignalsAvailable),
      inheritedFromCluster: cluster?.clusterId || null
    };
  });

  const report = {
    newScriptsAnalyzed: newScripts.length,
    exactMatches: 0,
    semanticMatches: matches.filter((item) => item.matchScore >= 24).length,
    highConfidenceSemanticMatches: matches.filter((item) => item.matchScore >= 36).length,
    clustersCreated: clusters.length,
    scriptsWithInheritedSignals: matches.filter((item) => item.inheritedSignalsAvailable).length,
    averageConfidence: Number((matches.reduce((sum, item) => sum + ((item.topMatches[0]?.confidenceScore) || 0), 0) / Math.max(matches.length, 1)).toFixed(2)),
    decisionImpact: 'La decisión puede usar herencia semántica cuando no hay match exacto.'
  };

  fs.writeFileSync(MATCHES_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), matches }, null, 2));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return { matches, report };
}

function _getPreferredClusterId(script) {
  const text = `${script.topic || ''} ${script.title || ''} ${script.hook || ''} ${script.microAction || ''}`.toLowerCase();
  if (/mensaje|chat|hora|audio|notificacion/.test(text)) return 'cluster_relationship_messages';
  if (/dormir|movil|video|scroll|pantalla/.test(text)) return 'cluster_mobile_distraction';
  if (/habito|alarma|cafe|rutina|productividad/.test(text)) return 'cluster_habits_selfcontrol';
  if (/compra|menu|decision|carrito/.test(text)) return 'cluster_daily_decisions';
  if (/emocion|amigdala|control/.test(text)) return 'cluster_emotion_control';
  return `cluster_${String(script.topic || 'general').toLowerCase()}`;
}

function _buildReason(explainability) {
  return Object.entries(explainability)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key)
    .join(', ');
}

function _getInheritedSignalsAvailable(item) {
  return Boolean(
    item.realPerformanceScore ||
    item.monetizationOutcomeScore ||
    item.yppContributionScore ||
    item.realDataConfidence
  );
}

module.exports = {
  findSemanticMatches,
  MATCHES_PATH,
  REPORT_PATH
};
