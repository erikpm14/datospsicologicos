const fs = require('fs');
const path = require('path');

const MONETIZATION_DIR = path.resolve(__dirname, '../../data/monetization');
const AUDIENCE_VALUE_PATH = path.join(MONETIZATION_DIR, 'audience-value.json');

const CATEGORY_MAP = {
  relationships: 'relaciones',
  habits: 'habitos',
  money: 'dinero',
  social: 'social',
  cognitive: 'cognitivo',
  decisions: 'decisiones',
  mobile: 'cognitivo',
  autocontrol: 'autocontrol'
};

const CATEGORY_VALUE_LIBRARY = {
  relaciones: {
    audienceValueScore: 92,
    monetizationPotential: 94,
    yppContributionPotential: 88,
    repeatAudiencePotential: 92
  },
  habitos: {
    audienceValueScore: 89,
    monetizationPotential: 90,
    yppContributionPotential: 84,
    repeatAudiencePotential: 90
  },
  dinero: {
    audienceValueScore: 91,
    monetizationPotential: 96,
    yppContributionPotential: 86,
    repeatAudiencePotential: 83
  },
  social: {
    audienceValueScore: 78,
    monetizationPotential: 74,
    yppContributionPotential: 76,
    repeatAudiencePotential: 72
  },
  cognitivo: {
    audienceValueScore: 61,
    monetizationPotential: 56,
    yppContributionPotential: 68,
    repeatAudiencePotential: 52
  },
  decisiones: {
    audienceValueScore: 87,
    monetizationPotential: 88,
    yppContributionPotential: 82,
    repeatAudiencePotential: 84
  },
  autocontrol: {
    audienceValueScore: 90,
    monetizationPotential: 91,
    yppContributionPotential: 85,
    repeatAudiencePotential: 89
  }
};

// Asigna valor comercial real por categoría.
function analyzeAudienceValue(categories = []) {
  fs.mkdirSync(MONETIZATION_DIR, { recursive: true });

  const baseCategories = ['relaciones', 'habitos', 'dinero', 'social', 'cognitivo'];
  const allCategories = [...new Set([...baseCategories, ...categories.map((item) => _normalizeCategory(item))])];

  const categoryScores = allCategories.map((category) => ({
    category,
    ...(CATEGORY_VALUE_LIBRARY[category] || CATEGORY_VALUE_LIBRARY.cognitivo)
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    categories: categoryScores
  };

  fs.writeFileSync(AUDIENCE_VALUE_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function getAudienceValue(category) {
  const normalizedCategory = _normalizeCategory(category);
  return (CATEGORY_VALUE_LIBRARY[normalizedCategory] || CATEGORY_VALUE_LIBRARY.cognitivo);
}

function _normalizeCategory(category) {
  const raw = String(category || '').toLowerCase();
  return CATEGORY_MAP[raw] || raw || 'cognitivo';
}

module.exports = {
  analyzeAudienceValue,
  getAudienceValue,
  AUDIENCE_VALUE_PATH
};
