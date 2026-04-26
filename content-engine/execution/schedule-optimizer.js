const fs = require('fs');
const path = require('path');

const EXECUTION_DIR = path.resolve(__dirname, '../../data/execution');
const SCHEDULE_PLAN_PATH = path.join(EXECUTION_DIR, 'schedule-plan.json');

function optimizeSchedule(inputs = {}) {
  fs.mkdirSync(EXECUTION_DIR, { recursive: true });

  const nextBatchPlan = inputs.nextBatchPlan || _readJson(path.resolve(__dirname, '../../data/strategy/next-batch-plan.json'), {});
  const strategyFeedback = inputs.strategyFeedback || _readJson(path.join(EXECUTION_DIR, 'strategy-feedback.json'), {});
  const businessMode = inputs.businessMode || { currentBusinessMode: nextBatchPlan.currentBusinessMode || 'balanced_growth' };
  const roleSequence = _buildRoleSequence(nextBatchPlan.batchComposition || {}, businessMode.currentBusinessMode);
  const orderedSlots = _orderSlots(nextBatchPlan.slotBySlotPlan || [], roleSequence);
  const clusterSpacingRules = _buildClusterSpacingRules(strategyFeedback, orderedSlots);

  const payload = {
    currentBusinessMode: businessMode.currentBusinessMode || 'balanced_growth',
    recommendedScheduleWindow: _scheduleWindow(orderedSlots.length, businessMode.currentBusinessMode),
    spacingBetweenPosts: _spacingBetweenPosts(businessMode.currentBusinessMode),
    idealOrderByRole: roleSequence,
    roleSequence: orderedSlots.map((slot) => slot.targetRole),
    clusterSpacingRules,
    whyThisSchedule: _whyThisSchedule(businessMode.currentBusinessMode, orderedSlots, clusterSpacingRules)
  };

  fs.writeFileSync(SCHEDULE_PLAN_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _buildRoleSequence(composition, mode) {
  if (mode === 'ypp_views_priority') return _trimSequence(['reach', 'follow', 'reach', 'monetization', 'hybrid', 'ypp_push'], composition);
  if (mode === 'monetization_priority') return _trimSequence(['reach', 'follow', 'monetization', 'hybrid', 'monetization', 'ypp_push'], composition);
  if (mode === 'ypp_subs_priority') return _trimSequence(['reach', 'follow', 'hybrid', 'follow', 'monetization', 'ypp_push'], composition);
  return _trimSequence(['reach', 'hybrid', 'follow', 'monetization', 'ypp_push'], composition);
}

function _trimSequence(sequence, composition) {
  const available = Object.entries(composition).reduce((acc, [role, count]) => ({ ...acc, [role]: count }), {});
  const result = [];
  sequence.forEach((role) => {
    if ((available[role] || 0) > 0) {
      result.push(role);
      available[role] -= 1;
    }
  });
  Object.entries(available).forEach(([role, count]) => {
    for (let index = 0; index < count; index += 1) result.push(role);
  });
  return result;
}

function _orderSlots(slots, roleSequence) {
  const remaining = [...slots];
  return roleSequence.map((role, index) => {
    let slotIndex = remaining.findIndex((slot) => slot.targetRole === role);
    if (slotIndex === -1 && remaining.length > 0) slotIndex = 0;
    const slot = remaining.splice(slotIndex, 1)[0] || {
      slot: index + 1,
      targetRole: role,
      recommendedCluster: '',
      preferredHookType: 'challenge',
      preferredMicroAction: 'REPEAT_CHECK'
    };
    return {
      ...slot,
      slot: index + 1
    };
  });
}

function _buildClusterSpacingRules(strategyFeedback, slots) {
  const highSaturation = (strategyFeedback.clusterAdjustments || [])
    .filter((cluster) => cluster.saturationRiskDelta >= 6)
    .map((cluster) => cluster.clusterLabel);
  const rules = [];
  if (highSaturation.length > 0) {
    rules.push(`Separar al menos 2 slots entre ${highSaturation.join(', ')}.`);
  }
  rules.push('No publicar dos reach del mismo cluster seguidos.');
  rules.push('Colocar follow después de reach cuando el slot de captación abra audiencia nueva.');
  rules.push('Reservar monetization o hybrid tras un slot de alto alcance.');
  if (_hasRepeatedCluster(slots)) {
    rules.push('Descansar el cluster repetido al menos un intervalo adicional.');
  }
  return rules;
}

function _hasRepeatedCluster(slots) {
  for (let index = 1; index < slots.length; index += 1) {
    if (_slug(slots[index - 1].recommendedCluster) === _slug(slots[index].recommendedCluster)) {
      return true;
    }
  }
  return false;
}

function _scheduleWindow(slotCount, mode) {
  if (mode === 'monetization_priority') return `${Math.max(2, slotCount)} días`;
  return `${Math.max(1, Math.ceil(slotCount / 2))} días`;
}

function _spacingBetweenPosts(mode) {
  if (mode === 'ypp_views_priority') return '4 horas';
  if (mode === 'monetization_priority') return '6 horas';
  if (mode === 'ypp_subs_priority') return '5 horas';
  return '5 horas';
}

function _whyThisSchedule(mode, orderedSlots, rules) {
  const sequence = orderedSlots.map((slot) => `${slot.slot}:${slot.targetRole}`).join(' > ');
  return `Modo ${mode}. La secuencia ${sequence} evita choques de cluster y usa ${rules.length} reglas para captación primero y valor comercial después.`;
}

function _slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  optimizeSchedule,
  SCHEDULE_PLAN_PATH
};
