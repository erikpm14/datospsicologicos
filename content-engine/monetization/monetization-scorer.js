const fs = require('fs');
const path = require('path');

const { getAudienceValue } = require('./audience-value-analyzer');

const MONETIZATION_DIR = path.resolve(__dirname, '../../data/monetization');
const SCORED_CONTENT_PATH = path.join(MONETIZATION_DIR, 'scored-content.json');

// Puntúa el contenido por potencial económico con datos reales si existen.
function scoreMonetizationPriority(scripts = []) {
  fs.mkdirSync(MONETIZATION_DIR, { recursive: true });

  const scored = scripts.map((script) => {
    const audienceValue = getAudienceValue(script.topic);
    const reusableAudiencePotential = _getReusableAudiencePotential(script);
    const historyScore = script.historicalSuccessScore || script.successScore || 0;
    const monetizationOutcomeScore = script.inheritedMonetizationScore || script.monetizationOutcomeScore || _estimateMonetizationOutcome(script);
    const yppContributionScore = script.inheritedYppContributionScore || script.yppContributionScore || _estimateYppContribution(script);
    const inheritedAudienceValue = script.inheritedAudienceValue || 0;
    const inheritedConfidence = script.inheritedConfidence || 0;
    const monetizationPriorityScore = Number((
      ((script.monetizationScore || 0) * 0.2) +
      ((script.followScore || 0) * 0.16) +
      ((script.retentionScore || 0) * 0.1) +
      (historyScore * 0.14) +
      (audienceValue.monetizationPotential * 0.14) +
      (reusableAudiencePotential * 0.12) +
      (monetizationOutcomeScore * 0.08) +
      (yppContributionScore * 0.04) +
      (inheritedAudienceValue * 0.01) +
      (inheritedConfidence * 10 * 0.01)
    ).toFixed(2));

    return {
      ...script,
      audienceValueScore: audienceValue.audienceValueScore,
      monetizationPotential: audienceValue.monetizationPotential,
      yppContributionPotential: audienceValue.yppContributionPotential,
      repeatAudiencePotential: audienceValue.repeatAudiencePotential,
      reusableAudiencePotential,
      monetizationOutcomeScore,
      yppContributionScore,
      inheritedAudienceValue,
      inheritedConfidence,
      monetizationPriorityScore
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    totalScripts: scored.length,
    scripts: scored
  };

  fs.writeFileSync(SCORED_CONTENT_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _getReusableAudiencePotential(script) {
  let score = 45;
  if (/(relationships|habits|decisions|money|autocontrol)/i.test(String(script.topic || ''))) score += 20;
  if (/(le pasa a quien|si tú también|te pasa)/i.test(String(script.identity || script.explanation || ''))) score += 12;
  if (/(haz esto|mira esto|fíjate)/i.test(String(script.hook || ''))) score += 8;
  if (/(miedo|control|apego|rutina|decisión|ansiedad)/i.test(String(script.pain || script.explanation || ''))) score += 10;
  return Math.min(score, 100);
}

function _estimateMonetizationOutcome(script) {
  const categoryBoost = /(relationships|habits|decisions|money)/i.test(String(script.topic || '')) ? 16 : 8;
  return Math.min(100, Math.round(((script.followScore || 0) * 0.4) + ((script.monetizationScore || 0) * 0.4) + categoryBoost));
}

function _estimateYppContribution(script) {
  return Math.min(100, Math.round(
    ((script.retentionScore || 0) * 0.35) +
    ((script.followScore || 0) * 0.25) +
    ((script.historicalSuccessScore || script.successScore || 0) * 0.2) +
    ((script.rewatchScore || 0) * 0.2)
  ));
}

module.exports = {
  scoreMonetizationPriority,
  SCORED_CONTENT_PATH
};
