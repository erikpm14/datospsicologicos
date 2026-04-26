const fs = require('fs');
const path = require('path');

const INHERITED_PATH = path.resolve(__dirname, '../../data/similarity/inherited-signals.json');

// Transfiere señales históricas ponderadas por similitud y valor comercial.
function inheritSignals(newScripts = [], semanticMatches = [], historical = [], clusters = []) {
  fs.mkdirSync(path.dirname(INHERITED_PATH), { recursive: true });

  const historicalMap = new Map(historical.map((item) => [item.videoId, item]));
  const inherited = newScripts.map((script) => {
    const matchInfo = semanticMatches.find((item) => item.scriptId === script.id);
    const cluster = clusters.find((item) => item.clusterId === matchInfo?.inheritedFromCluster);
    const topMatches = (matchInfo?.topMatches || []).map((item) => ({
      ...item,
      source: historicalMap.get(item.videoId)
    })).filter((item) => item.source);

    const weighted = _weightedAverage(topMatches, cluster);
    return {
      scriptId: script.id,
      inheritedRealPerformanceScore: weighted.realPerformanceScore,
      inheritedMonetizationScore: weighted.monetizationOutcomeScore,
      inheritedYppContributionScore: weighted.yppContributionScore,
      inheritedAudienceValue: weighted.audienceValueScore,
      inheritedFollowPotential: weighted.followPotential,
      inheritedViralityPotential: weighted.viralityPotential,
      inheritedConfidence: weighted.inheritedConfidence,
      inheritedFromCluster: cluster?.clusterId || null,
      nearestWinningPattern: topMatches[0]?.matchReason || null,
      monetizationTransferConfidence: weighted.monetizationTransferConfidence
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    inherited
  };

  fs.writeFileSync(INHERITED_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _weightedAverage(matches, cluster) {
  if (matches.length === 0) {
    return {
      realPerformanceScore: 0,
      monetizationOutcomeScore: 0,
      yppContributionScore: cluster?.yppStrength || 0,
      audienceValueScore: cluster?.monetizationStrength || 0,
      followPotential: 0,
      viralityPotential: 0,
      inheritedConfidence: 0,
      monetizationTransferConfidence: 0
    };
  }

  let weightTotal = 0;
  let realPerformanceScore = 0;
  let monetizationOutcomeScore = 0;
  let yppContributionScore = 0;
  let audienceValueScore = 0;
  let followPotential = 0;
  let viralityPotential = 0;
  let inheritedConfidence = 0;

  matches.forEach((match) => {
    const source = match.source;
    const weight = ((match.semanticSimilarityScore / 100) * 0.55) + ((match.confidenceScore || 0) * 0.2) + ((source.realDataConfidence || 0) * 0.25);
    weightTotal += weight;
    realPerformanceScore += (source.realPerformanceScore || 0) * weight;
    monetizationOutcomeScore += (source.monetizationOutcomeScore || source.realPerformanceScore || 0) * weight;
    yppContributionScore += (source.yppContributionScore || 0) * weight;
    audienceValueScore += ((source.audienceValueScore || source.monetizationPotential || 0)) * weight;
    followPotential += ((source.followConversion || 0)) * weight;
    viralityPotential += ((source.viralityScore || 0)) * weight;
    inheritedConfidence += weight;
  });

  return {
    realPerformanceScore: Number((realPerformanceScore / weightTotal).toFixed(2)),
    monetizationOutcomeScore: Number(((monetizationOutcomeScore / weightTotal) + ((cluster?.monetizationStrength || 0) * 0.15)).toFixed(2)),
    yppContributionScore: Number(((yppContributionScore / weightTotal) + ((cluster?.yppStrength || 0) * 0.12)).toFixed(2)),
    audienceValueScore: Number(((audienceValueScore / weightTotal)).toFixed(2)),
    followPotential: Number((followPotential / weightTotal).toFixed(2)),
    viralityPotential: Number((viralityPotential / weightTotal).toFixed(2)),
    inheritedConfidence: Number(Math.min(1, inheritedConfidence / Math.max(matches.length, 1)).toFixed(2)),
    monetizationTransferConfidence: Number(Math.min(1, ((monetizationOutcomeScore / Math.max(weightTotal, 1)) / 100) * 0.7 + ((cluster?.monetizationStrength || 0) / 100) * 0.3).toFixed(2))
  };
}

module.exports = {
  inheritSignals,
  INHERITED_PATH
};
