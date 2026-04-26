const fs = require('fs');
const path = require('path');

const TRACKING_DIR = path.resolve(__dirname, '../../data/tracking');
const AB_SLOT_LINKS_PATH = path.join(TRACKING_DIR, 'ab-slot-links.json');

function linkAbVariantToSlot(input = {}) {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const script = input.script || {};
  const slotTracking = script.slotTracking || input.slotTracking || {};
  const variantId = script.abVariantId || input.variantId || null;
  const abExperimentId = script.abExperimentId || input.abExperimentId || null;

  if (!variantId && !abExperimentId) {
    return null;
  }

  const existing = _readJson(AB_SLOT_LINKS_PATH, { generatedAt: null, totalLinks: 0, links: [] });
  const record = {
    batchId: slotTracking.batchId || input.batchId || null,
    slotId: slotTracking.slotId || input.slotId || null,
    recommendedCandidateId: slotTracking.recommendedCandidateId || input.recommendedCandidateId || null,
    recommendedCandidateTitle: slotTracking.recommendedCandidateTitle || input.recommendedCandidateTitle || null,
    executedCandidateId: script.id || input.executedCandidateId || null,
    executedCandidateTitle: script.title || input.executedCandidateTitle || null,
    abExperimentId,
    variantId,
    variantRole: input.variantRole || (variantId === 'v_a' ? 'control' : variantId === 'v_b' ? 'test' : 'variant'),
    belongsToSameSlot: input.belongsToSameSlot !== false,
    subslotId: input.subslotId || (slotTracking.slotId && variantId ? `${slotTracking.slotId}_${variantId}` : null),
    linkType: input.linkType || (variantId && slotTracking.slotId ? 'shared_slot_experiment' : 'variant_without_slot'),
    linkedAt: input.linkedAt || new Date().toISOString()
  };

  const links = [
    ...(existing.links || []).filter((item) => !(item.abExperimentId === record.abExperimentId && item.variantId === record.variantId && item.slotId === record.slotId)),
    record
  ];

  const payload = {
    generatedAt: new Date().toISOString(),
    totalLinks: links.length,
    links
  };

  fs.writeFileSync(AB_SLOT_LINKS_PATH, JSON.stringify(payload, null, 2));
  return record;
}

function getAbSlotLinks() {
  return _readJson(AB_SLOT_LINKS_PATH, { links: [] });
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  linkAbVariantToSlot,
  getAbSlotLinks,
  AB_SLOT_LINKS_PATH
};
