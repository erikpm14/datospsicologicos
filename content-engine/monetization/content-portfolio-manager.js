const fs = require('fs');
const path = require('path');

const MONETIZATION_DIR = path.resolve(__dirname, '../../data/monetization');
const PORTFOLIO_PLAN_PATH = path.join(MONETIZATION_DIR, 'portfolio-plan.json');
const MONETIZATION_REPORT_PATH = path.join(MONETIZATION_DIR, 'report.json');
const STRATEGY_MEMORY_PATH = path.resolve(__dirname, '../../data/strategy/strategy-memory.json');

// Mantiene mix entre alcance, follow y monetización.
function buildPortfolioPlan(scripts = [], yppStatus = {}) {
  fs.mkdirSync(MONETIZATION_DIR, { recursive: true });

  const classifiedScripts = scripts.map((script) => {
    const portfolioRole = classifyPortfolioRole(script);
    return {
      ...script,
      portfolioRole,
      strategicRole: portfolioRole
    };
  });

  const recommendedNextBatchMix = _getRecommendedMix(yppStatus);
  const strategyMemory = _readJson(STRATEGY_MEMORY_PATH, { clusters: [] });
  const bestForMoney = [...classifiedScripts]
    .sort((a, b) => (b.monetizationPriorityScore || 0) - (a.monetizationPriorityScore || 0))[0] || null;
  const sortedByAudienceValue = [...classifiedScripts]
    .sort((a, b) => (b.audienceValueScore || 0) - (a.audienceValueScore || 0));

  const payload = {
    generatedAt: new Date().toISOString(),
    recommendedNextBatchMix,
    clusterSignals: (strategyMemory.clusters || []).map((cluster) => ({
      clusterLabel: cluster.clusterLabel,
      strategicRole: cluster.strategicRole,
      saturationRisk: cluster.saturationRisk,
      repeatabilityScore: cluster.repeatabilityScore
    })),
    scripts: classifiedScripts.map((script) => ({
      id: script.id,
      title: script.title,
      topic: script.topic,
      portfolioRole: script.portfolioRole,
      strategicRole: script.strategicRole,
      monetizationPriorityScore: script.monetizationPriorityScore,
      finalDecisionScore: script.finalDecisionScore || script.finalScore || script.totalScore
    }))
  };

  const report = {
    bestMonetizationCategory: sortedByAudienceValue[0]?.topic || '',
    worstLowValueCategory: sortedByAudienceValue[sortedByAudienceValue.length - 1]?.topic || '',
    currentYppFocus: yppStatus.recommendation?.missingMore || '',
    recommendedNextBatchMix,
    bestScriptForMoney: bestForMoney?.title || '',
    why: bestForMoney
      ? 'Combina valor comercial, follow y potencial de audiencia reutilizable.'
      : ''
  };

  fs.writeFileSync(PORTFOLIO_PLAN_PATH, JSON.stringify(payload, null, 2));
  fs.writeFileSync(MONETIZATION_REPORT_PATH, JSON.stringify(report, null, 2));
  return { portfolio: payload, report, classifiedScripts };
}

function classifyPortfolioRole(script) {
  if ((script.yppContributionScore || 0) >= 55) {
    return 'ypp_push';
  }

  if ((script.monetizationPriorityScore || 0) >= 84 && (script.followScore || 0) >= 75) {
    return 'monetization';
  }

  if ((script.retentionScore || 0) >= 90 && (script.monetizationPriorityScore || 0) < 75) {
    return 'reach';
  }

  if ((script.followScore || 0) >= 88 && (script.monetizationPriorityScore || 0) >= 76) {
    return 'hybrid';
  }

  return 'follow';
}

function _getRecommendedMix(yppStatus) {
  if (yppStatus.recommendation?.missingMore === 'views') {
    return { reach: 35, follow: 15, monetization: 20, hybrid: 10, ypp_push: 20 };
  }

  if (yppStatus.recommendation?.missingMore === 'subs') {
    return { reach: 15, follow: 30, monetization: 20, hybrid: 20, ypp_push: 15 };
  }

  return { reach: 25, follow: 20, monetization: 25, hybrid: 20, ypp_push: 10 };
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  buildPortfolioPlan,
  classifyPortfolioRole,
  PORTFOLIO_PLAN_PATH,
  MONETIZATION_REPORT_PATH
};
