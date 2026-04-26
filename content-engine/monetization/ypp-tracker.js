const fs = require('fs');
const path = require('path');

const MONETIZATION_DIR = path.resolve(__dirname, '../../data/monetization');
const YPP_STATUS_PATH = path.join(MONETIZATION_DIR, 'ypp-status.json');

// Estima el progreso hacia YPP usando real-data first.
function trackYppStatus(analysis = [], monetizationScripts = []) {
  fs.mkdirSync(MONETIZATION_DIR, { recursive: true });

  const estimatedSubscribers = Math.round(320 + analysis.reduce((sum, item) => sum + ((item.metrics?.follows || item.followScore || 0) * 1.2), 0));
  const estimatedShortsViews90d = Math.round(analysis.reduce((sum, item) => sum + (item.metrics?.views || 0), 0) * 7.5);
  const gapTo1000Subs = Math.max(0, 1000 - estimatedSubscribers);
  const gapTo10MShortViews = Math.max(0, 10000000 - estimatedShortsViews90d);
  const avgMonetizationPriority = monetizationScripts.length === 0
    ? 0
    : monetizationScripts.reduce((sum, item) => sum + (item.monetizationPriorityScore || 0), 0) / monetizationScripts.length;
  const avgRealConfidence = analysis.length === 0
    ? 0
    : analysis.reduce((sum, item) => sum + (item.realDataConfidence || 0), 0) / analysis.length;
  const momentumScore = Math.min(100, Math.round(
    ((estimatedSubscribers / 1000) * 30) +
    ((estimatedShortsViews90d / 10000000) * 35) +
    ((avgMonetizationPriority / 100) * 25) +
    (avgRealConfidence * 10)
  ));
  const yppReadinessScore = Math.min(100, Math.round(
    ((estimatedSubscribers / 1000) * 35) +
    ((estimatedShortsViews90d / 10000000) * 35) +
    ((avgMonetizationPriority / 100) * 20) +
    (avgRealConfidence * 10)
  ));

  const payload = {
    generatedAt: new Date().toISOString(),
    estimatedSubscribers,
    estimatedShortsViews90d,
    gapTo1000Subs,
    gapTo10MShortViews,
    momentumScore,
    yppReadinessScore,
    recommendation: _buildRecommendation({
      gapTo1000Subs,
      gapTo10MShortViews,
      avgMonetizationPriority,
      monetizationScripts
    })
  };

  fs.writeFileSync(YPP_STATUS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _buildRecommendation(context) {
  const missingMore = context.gapTo1000Subs > (context.gapTo10MShortViews / 10000) ? 'subs' : 'views';
  const bestType = [...context.monetizationScripts]
    .sort((a, b) => (b.monetizationPriorityScore || 0) - (a.monetizationPriorityScore || 0))[0];

  return {
    missingMore,
    audienceQuality: context.avgMonetizationPriority >= 80 ? 'audiencia útil' : 'volumen con valor irregular',
    prioritize: bestType
      ? `Prioriza ${bestType.topic} con rol ${bestType.portfolioRole || 'hybrid'} para acercarte antes a YPP.`
      : 'Prioriza contenido híbrido con follow fuerte y valor comercial.'
  };
}

module.exports = {
  trackYppStatus,
  YPP_STATUS_PATH
};
