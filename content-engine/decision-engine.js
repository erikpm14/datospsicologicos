const fs = require('fs');
const path = require('path');

const { generateIdeas } = require('./idea-generator');
const { generateScript } = require('./script-generator');
const { optimizeScript } = require('./optimizer');
const { scoreScript } = require('./scoring-engine');
const { collectMetrics } = require('./learning/metrics-collector');
const { analyzePerformance } = require('./learning/performance-analyzer');
const { learnPatterns } = require('./learning/pattern-learner');
const { buildAdaptiveConfig } = require('./learning/adaptive-config');
const { analyzeAudienceValue } = require('./monetization/audience-value-analyzer');
const { scoreMonetizationPriority } = require('./monetization/monetization-scorer');
const { trackYppStatus } = require('./monetization/ypp-tracker');
const { buildPortfolioPlan } = require('./monetization/content-portfolio-manager');
const { runRealLearningCycle } = require('./integrations/historical-sync.service');
const { buildStrategyMemory } = require('./strategy/strategy-memory');
const { optimizePortfolio } = require('./strategy/portfolio-optimizer');
const { routeBusinessGoal } = require('./strategy/business-goal-router');
const { planNextBatch } = require('./strategy/batch-planner');
const { trackBatchExecution } = require('./execution/batch-execution-tracker');
const { analyzeBatchOutcome } = require('./execution/batch-outcome-analyzer');
const { applyStrategyFeedback } = require('./execution/strategy-feedback-loop');
const { optimizeSchedule } = require('./execution/schedule-optimizer');
const { persistPlannedSlots } = require('./tracking/slot-lineage-manager');
const { linkSlotResults } = require('./tracking/slot-result-linker');
const { validateExecutionTrace } = require('./tracking/execution-trace-validator');
const { buildSlotVsResultReport } = require('./tracking/slot-vs-result-report');

const DATA_DIR = path.resolve(__dirname, '../data/content');
const IDEAS_PATH = path.join(DATA_DIR, 'ideas.json');
const SCRIPTS_PATH = path.join(DATA_DIR, 'scripts.json');
const BEST_SCRIPT_PATH = path.join(DATA_DIR, 'best-script.json');
const LEARNING_ANALYSIS_PATH = path.resolve(__dirname, '../data/metrics/analysis.json');
const LEARNING_PATTERNS_PATH = path.resolve(__dirname, '../data/learning/patterns.json');
const MONETIZATION_REPORT_PATH = path.resolve(__dirname, '../data/monetization/report.json');
const SCHEDULE_PLAN_PATH = path.resolve(__dirname, '../data/execution/schedule-plan.json');

function generateBestScript(options = {}) {
  _ensureDataDir();

  const ideas = generateIdeas(options);
  const shortlistedIdeas = ideas.slice(0, options.shortlistSize || 6).map((idea, index) => ({
    ...idea,
    selected: true,
    selectionRank: index + 1
  }));

  const provisionalScripts = shortlistedIdeas.map((idea) => {
    const baseScript = generateScript(idea);
    return optimizeScript(baseScript, idea);
  });
  const realCycle = runRealLearningCycle(provisionalScripts);

  const scripts = shortlistedIdeas.map((idea, index) => {
    const optimizedScript = provisionalScripts[index];
    return _applyHistoricalLearning(
      _mergeInheritedSignals(scoreScript(optimizedScript), realCycle.inherited.inherited, realCycle.semantic.matches),
      realCycle.normalized.normalized
    );
  });

  const monetizationScored = scoreMonetizationPriority(scripts).scripts.map((script) => _applyDecisionWeights(script));
  const strategyCycle = runLearningCycle(monetizationScored);
  const portfolioReport = _readJson(MONETIZATION_REPORT_PATH, {});
  const schedulePlan = _readJson(SCHEDULE_PLAN_PATH, {});
  const sortedScripts = monetizationScored
    .map((script) => _applySchedulingWeights(script, strategyCycle.nextBatchPlan, schedulePlan))
    .sort((a, b) => b.finalDecisionScore - a.finalDecisionScore);
  const bestScript = selectBestScript(sortedScripts, portfolioReport);

  _writeJson(IDEAS_PATH, {
    generatedAt: new Date().toISOString(),
    totalIdeas: ideas.length,
    shortlistedIdeas
  });

  _writeJson(SCRIPTS_PATH, {
    generatedAt: new Date().toISOString(),
    totalScripts: sortedScripts.length,
    scripts: sortedScripts
  });

  _writeJson(BEST_SCRIPT_PATH, {
    generatedAt: new Date().toISOString(),
    bestScript
  });

  return _toPipelineScript(bestScript);
}

function selectBestScript(scripts, portfolioReport = {}) {
  const selected = [...scripts].sort((a, b) => {
    const scoreA = a.finalDecisionScore || a.finalScore || a.totalScore;
    const scoreB = b.finalDecisionScore || b.finalScore || b.totalScore;
    return scoreB - scoreA;
  })[0] || null;

  if (!selected) return null;

  return {
    ...selected,
    decisionReason: {
      whyThisWinsForMonetization: `Gana por combinar prioridad monetizable ${selected.monetizationPriorityScore}, performance real ${selected.realPerformanceScore || 0} y audiencia útil en ${selected.topic}.`,
      whyNotOnlyForViews: 'No se elige solo por views. Se pondera conversión útil, confianza del dato real y contribución YPP.',
      portfolioRole: selected.portfolioRole || portfolioReport.recommendedNextBatchMix || 'hybrid'
    },
    semanticMatchUsed: Boolean(selected.semanticMatchUsed),
    semanticMatchConfidence: selected.semanticMatchConfidence || 0,
    inheritedSignalsUsed: Boolean(selected.inheritedSignalsUsed),
    inheritedFromCluster: selected.inheritedFromCluster || null,
    nearestWinningPattern: selected.nearestWinningPattern || null,
    monetizationTransferConfidence: selected.monetizationTransferConfidence || 0
  };
}

function runLearningCycle(videos = []) {
  const realSync = runRealLearningCycle(videos);
  const metrics = collectMetrics(videos);
  const analysis = analyzePerformance(videos);
  const audienceValue = analyzeAudienceValue(videos.map((video) => video.topic));
  const realMatchMap = new Map(realSync.matchingReport.matched.map((item) => [item.contentId, item.realVideoId]));
  const enrichedVideos = videos.map((video) => {
    const realRecord = realSync.normalized.normalized.find((item) => item.videoId === video.id || item.videoId === realMatchMap.get(video.id));
    return _mergeInheritedSignals(
      _mergeVideoWithReal(video, realRecord),
      realSync.inherited.inherited,
      realSync.semantic.matches
    );
  });
  const monetizationScored = scoreMonetizationPriority(enrichedVideos).scripts.map((script) => ({
    ..._applyDecisionWeights(script),
    portfolioRole: script.portfolioRole || 'hybrid',
    strategicRole: script.strategicRole || script.portfolioRole || _inferStrategicRole(script)
  }));
  const analysisWithMonetization = _mergeAnalysisWithMonetization(analysis.analysis, monetizationScored, realSync.normalized.normalized);

  _writeJson(LEARNING_ANALYSIS_PATH, {
    generatedAt: analysis.generatedAt,
    source: analysis.source,
    totalVideos: analysisWithMonetization.length,
    analysis: analysisWithMonetization
  });

  const patterns = learnPatterns();
  const adaptive = buildAdaptiveConfig();
  const ypp = trackYppStatus(analysisWithMonetization, monetizationScored);
  const portfolio = buildPortfolioPlan(monetizationScored, ypp);
  const baseStrategyMemory = buildStrategyMemory({
    clusters: realSync.clusters,
    patterns,
    inheritedSignals: realSync.inherited,
    scoredContent: { scripts: monetizationScored },
    yppStatus: ypp,
    analysis: { analysis: analysisWithMonetization },
    normalizedRealMetrics: realSync.normalized
  });
  const baseBusinessMode = routeBusinessGoal({
    yppStatus: ypp,
    monetizationReport: portfolio.report,
    strategyMemory: baseStrategyMemory
  });
  const basePortfolioBalance = optimizePortfolio(baseStrategyMemory, baseBusinessMode);
  const baseNextBatchPlan = planNextBatch({
    strategyMemory: baseStrategyMemory,
    businessMode: baseBusinessMode,
    portfolioBalance: basePortfolioBalance,
    candidates: monetizationScored
  });
  const batchExecution = trackBatchExecution({
    batchPlan: baseNextBatchPlan,
    normalizedRealMetrics: realSync.normalized,
    strategyMemory: baseStrategyMemory
  });
  const batchOutcome = analyzeBatchOutcome({
    batchExecution,
    normalizedRealMetrics: realSync.normalized,
    strategyMemory: baseStrategyMemory
  });
  const strategyFeedback = applyStrategyFeedback({
    strategyMemory: baseStrategyMemory,
    batchPlan: baseNextBatchPlan,
    batchExecution,
    batchOutcome
  });
  const strategyMemory = buildStrategyMemory({
    clusters: realSync.clusters,
    patterns,
    inheritedSignals: realSync.inherited,
    scoredContent: { scripts: monetizationScored },
    yppStatus: ypp,
    analysis: { analysis: analysisWithMonetization },
    normalizedRealMetrics: realSync.normalized,
    executionFeedback: strategyFeedback
  });
  const businessMode = routeBusinessGoal({
    yppStatus: ypp,
    monetizationReport: portfolio.report,
    strategyMemory,
    batchOutcome,
    strategyFeedback
  });
  const portfolioBalance = optimizePortfolio(strategyMemory, businessMode, {
    batchOutcome,
    strategyFeedback
  });
  const nextBatchPlan = planNextBatch({
    strategyMemory,
    businessMode,
    portfolioBalance,
    batchOutcome,
    strategyFeedback,
    candidates: monetizationScored
  });
  const schedulePlan = optimizeSchedule({
    nextBatchPlan,
    strategyMemory,
    businessMode,
    batchOutcome,
    strategyFeedback,
    candidates: monetizationScored
  });
  persistPlannedSlots(nextBatchPlan, { schedulePlan, businessMode });
  linkSlotResults();
  validateExecutionTrace();
  buildSlotVsResultReport();

  return {
    realSync,
    metrics,
    analysis: { ...analysis, analysis: analysisWithMonetization },
    audienceValue,
    monetizationScored,
    patterns,
    adaptive,
    ypp,
    portfolio,
    batchExecution,
    batchOutcome,
    strategyFeedback,
    strategyMemory,
    businessMode,
    portfolioBalance,
    nextBatchPlan,
    schedulePlan
  };
}

function _toPipelineScript(script) {
  return {
    title: script.title,
    topic: script.topic,
    hook: script.hook,
    claim: script.claim,
    explanation: `${script.explanation} ${script.twist}`.trim(),
    cta: script.cta,
    psychologicalFact: script.psychologicalFact,
    viralTrigger: script.viralTrigger,
    emotionalTrigger: script.emotionalTrigger,
    viralityScore: script.finalDecisionScore || script.finalScore || script.totalScore,
    retentionScore: script.retentionScore,
    rewatchScore: script.rewatchScore,
    followScore: script.followScore,
    monetizationScore: script.monetizationScore,
    monetizationPriorityScore: script.monetizationPriorityScore || 0,
    successScore: script.historicalSuccessScore || 0,
    realPerformanceScore: script.realPerformanceScore || 0,
    yppContributionScore: script.yppContributionScore || 0,
    dataSourceType: script.dataSourceType || 'fallback',
    realDataConfidence: script.realDataConfidence || 0,
    semanticMatchUsed: Boolean(script.semanticMatchUsed),
    semanticMatchConfidence: script.semanticMatchConfidence || 0,
    inheritedSignalsUsed: Boolean(script.inheritedSignalsUsed),
    inheritedFromCluster: script.inheritedFromCluster || null,
    nearestWinningPattern: script.nearestWinningPattern || null,
    monetizationTransferConfidence: script.monetizationTransferConfidence || 0,
    strategicRole: script.strategicRole || script.portfolioRole || 'hybrid',
    batchPriorityScore: script.batchPriorityScore || 0,
    recommendedBatchSlot: script.recommendedBatchSlot || null,
    recommendedScheduleFit: script.recommendedScheduleFit || 0,
    schedulerWeight: script.schedulerWeight || 0,
    decisionReason: script.decisionReason,
    optimizedScript: script.optimizedScript
  };
}

function _applyHistoricalLearning(script, normalizedRealMetrics = []) {
  const analysisPayload = _readJson(LEARNING_ANALYSIS_PATH, { analysis: [] });
  const patterns = _readJson(LEARNING_PATTERNS_PATH, {});
  const analysis = analysisPayload.analysis || [];
  const matchedReal = normalizedRealMetrics.find((item) => item.videoId === script.id || _slug(item.title) === _slug(script.title));

  const themeSuccess = _averageSuccess(analysis, 'topic', script.topic, 'successScore');
  const hookSuccess = _averageSuccess(analysis, 'hookType', script.hookType, 'successScore');
  const microSuccess = _averageSuccess(analysis, 'microActionType', script.microActionType, 'successScore');
  const monetizationHistory = _averageSuccess(analysis, 'topic', script.topic, 'monetizationOutcomeScore');
  const realPerformanceScore = matchedReal?.realPerformanceScore || script.inheritedRealPerformanceScore || _averageSuccess(analysis, 'topic', script.topic, 'realPerformanceScore');
  const yppContributionScore = matchedReal?.yppContributionScore || script.inheritedYppContributionScore || _averageSuccess(analysis, 'topic', script.topic, 'yppContributionScore');
  const realDataConfidence = matchedReal?.realDataConfidence || script.inheritedConfidence || 0;
  const patternBoost = _calculatePatternBoost(script, patterns);
  const inheritedSuccess = script.inheritedRealPerformanceScore || 0;
  const historicalSuccessScore = Number(((((themeSuccess + hookSuccess + microSuccess) / 3) * 0.7 + inheritedSuccess * 0.3) || 0).toFixed(2));
  const finalScore = Number(((script.totalScore * 0.36) + (historicalSuccessScore * 0.18) + ((script.inheritedMonetizationScore || monetizationHistory) * 0.14) + (realPerformanceScore * 0.12) + (yppContributionScore * 0.06) + ((script.inheritedAudienceValue || 0) * 0.04) + (realDataConfidence * 10) + patternBoost).toFixed(2));

  return {
    ...script,
    dataSourceType: matchedReal ? 'real_exact' : script.semanticMatchUsed ? 'real_semantic' : 'fallback',
    realDataConfidence,
    patternBoost,
    monetizationHistory,
    realPerformanceScore,
    yppContributionScore,
    historicalSuccessScore,
    finalScore
  };
}

function _applyDecisionWeights(script) {
  const extraordinaryViralPotential = (script.retentionScore >= 95 && script.rewatchScore >= 90) ? 8 : 0;
  const batchPriorityScore = Number((
    ((script.monetizationPriorityScore || 0) * 0.35) +
    ((script.yppContributionScore || 0) * 0.2) +
    ((script.followScore || 0) * 0.15) +
    ((script.realPerformanceScore || 0) * 0.15) +
    ((script.semanticMatchConfidence || 0) * 10 * 0.15)
  ).toFixed(2));
  const finalDecisionScore = Number((
    ((script.finalScore || script.totalScore) * 0.24) +
    ((script.monetizationPriorityScore || 0) * 0.28) +
    ((script.realPerformanceScore || 0) * 0.12) +
    ((script.followScore || 0) * 0.1) +
    ((script.retentionScore || 0) * 0.08) +
    ((script.rewatchScore || 0) * 0.05) +
    ((script.audienceValueScore || 0) * 0.07) +
    ((script.yppContributionScore || 0) * 0.06) +
    ((script.inheritedMonetizationScore || 0) * 0.04) +
    ((script.semanticMatchConfidence || 0) * 10 * 0.03) +
    ((script.realDataConfidence || 0) * 10) +
    extraordinaryViralPotential
  ).toFixed(2));

  return {
    ...script,
    strategicRole: script.strategicRole || script.portfolioRole || _inferStrategicRole(script),
    batchPriorityScore,
    extraordinaryViralPotential,
    finalDecisionScore
  };
}

function _applySchedulingWeights(script, nextBatchPlan = {}, schedulePlan = {}) {
  const role = script.strategicRole || script.portfolioRole || 'hybrid';
  const scoredSlots = (nextBatchPlan.slotBySlotPlan || []).map((slot) => {
    const clusterText = `${slot.recommendedCluster || ''} ${script.inheritedFromCluster || ''} ${script.topic || ''}`.toLowerCase();
    let fitScore = 0;
    if (slot.recommendedCandidateId === script.id) fitScore += 40;
    if (slot.targetRole === role) fitScore += 18;
    if (clusterText.includes(String(script.topic || '').toLowerCase())) fitScore += 12;
    if (clusterText.includes(String(script.inheritedFromCluster || '').toLowerCase())) fitScore += 10;
    return {
      ...slot,
      fitScore
    };
  }).filter((slot) => slot.fitScore > 0);
  const bestSlot = scoredSlots.sort((a, b) => (b.fitScore + (b.batchPriorityScore || 0) * 0.1) - (a.fitScore + (a.batchPriorityScore || 0) * 0.1))[0];
  const sequenceIndex = (schedulePlan.idealOrderByRole || []).indexOf(script.strategicRole || script.portfolioRole || 'hybrid');
  const schedulerWeight = Number((((bestSlot?.fitScore || 0) * 0.18) + (sequenceIndex >= 0 ? Math.max(0, 8 - sequenceIndex) : 0)).toFixed(2));

  return {
    ...script,
    recommendedBatchSlot: bestSlot?.slot || null,
    recommendedScheduleFit: bestSlot ? Number(Math.min(100, (bestSlot.fitScore || 0) + 20).toFixed(2)) : 0,
    schedulerWeight,
    finalDecisionScore: Number(((script.finalDecisionScore || 0) + schedulerWeight).toFixed(2))
  };
}

function _inferStrategicRole(script) {
  if ((script.yppContributionScore || 0) >= 55) return 'ypp_push';
  if ((script.monetizationPriorityScore || 0) >= 78) return 'monetization';
  if ((script.followScore || 0) >= 88) return 'follow';
  if ((script.retentionScore || 0) >= 92) return 'reach';
  return 'hybrid';
}

function _mergeInheritedSignals(script, inheritedSignals, semanticMatches) {
  const inherited = inheritedSignals.find((item) => item.scriptId === script.id) || {};
  const semantic = semanticMatches.find((item) => item.scriptId === script.id) || {};
  return {
    ...script,
    inheritedRealPerformanceScore: inherited.inheritedRealPerformanceScore || 0,
    inheritedMonetizationScore: inherited.inheritedMonetizationScore || 0,
    inheritedYppContributionScore: inherited.inheritedYppContributionScore || 0,
    inheritedAudienceValue: inherited.inheritedAudienceValue || 0,
    inheritedFollowPotential: inherited.inheritedFollowPotential || 0,
    inheritedViralityPotential: inherited.inheritedViralityPotential || 0,
    inheritedConfidence: inherited.inheritedConfidence || 0,
    semanticMatchUsed: (semantic.matchScore || 0) >= 24,
    semanticMatchConfidence: semantic.topMatches?.[0]?.confidenceScore || 0,
    inheritedSignalsUsed: (inherited.inheritedConfidence || 0) > 0,
    inheritedFromCluster: inherited.inheritedFromCluster || semantic.inheritedFromCluster || null,
    nearestWinningPattern: inherited.nearestWinningPattern || semantic.matchReason || null,
    monetizationTransferConfidence: inherited.monetizationTransferConfidence || 0,
    strategicRole: script.portfolioRole || 'hybrid'
  };
}

function _mergeVideoWithReal(video, realRecord) {
  if (!realRecord) return video;
  return {
    ...video,
    topic: video.topic || realRecord.category,
    hookType: video.hookType || realRecord.hookType,
    dataSourceType: realRecord.dataSourceType,
    realDataConfidence: realRecord.realDataConfidence,
    realPerformanceScore: realRecord.realPerformanceScore,
    yppContributionScore: realRecord.yppContributionScore,
    monetizationOutcomeScore: realRecord.monetizationOutcomeScore,
    views: realRecord.views,
    likes: realRecord.likes,
    comments: realRecord.comments,
    shares: realRecord.shares
  };
}

function _mergeAnalysisWithMonetization(analysis, monetizationScored, normalizedRealMetrics) {
  const monetizationMap = new Map(monetizationScored.map((item) => [item.id, item]));
  const realMap = new Map(normalizedRealMetrics.map((item) => [item.videoId, item]));
  return analysis.map((item) => {
    const monetization = monetizationMap.get(item.videoId) || {};
    const realRecord = realMap.get(item.videoId) || {};
    return {
      ...item,
      dataSourceType: realRecord.dataSourceType || item.dataSourceType,
      realDataConfidence: realRecord.realDataConfidence ?? item.realDataConfidence ?? 0,
      realPerformanceScore: realRecord.realPerformanceScore ?? item.realPerformanceScore ?? 0,
      monetizationOutcomeScore: monetization.monetizationOutcomeScore || item.monetizationOutcomeScore || 0,
      audienceValueScore: monetization.audienceValueScore || 0,
      monetizationPotential: monetization.monetizationPotential || 0,
      repeatAudiencePotential: monetization.repeatAudiencePotential || 0,
      yppContributionScore: monetization.yppContributionScore || realRecord.yppContributionScore || item.yppContributionScore || 0,
      portfolioRole: monetization.portfolioRole || item.portfolioRole || '',
      strategicRole: monetization.strategicRole || item.strategicRole || '',
      batchPriorityScore: monetization.batchPriorityScore || 0
    };
  });
}

function _averageSuccess(analysis, field, value, scoreField) {
  const matches = analysis.filter((item) => item[field] === value);
  if (matches.length === 0) return 0;
  return matches.reduce((sum, item) => sum + (item[scoreField] || 0), 0) / matches.length;
}

function _calculatePatternBoost(script, patterns) {
  let boost = 0;
  if (patterns.bestHookType && patterns.bestHookType === script.hookType) boost += 5;
  if ((patterns.topThemes || []).includes(script.topic)) boost += 6;
  if ((patterns.bestMicroActions || []).includes(script.microActionType)) boost += 4;
  if ((patterns.bestStructures || []).includes(script.structureType)) boost += 4;
  if ((patterns.monetizationWinningCategories || []).includes(script.topic)) boost += 8;
  if ((patterns.yppWinningCategories || []).includes(script.topic)) boost += 6;
  if ((patterns.valuableAudiencePatterns || []).includes(script.hookType)) boost += 5;
  if ((patterns.winningClusters || []).some((cluster) => (script.inheritedFromCluster || '').includes(cluster))) boost += 4;
  if ((patterns.emptyViewsPatterns || []).includes(script.topic)) boost -= 10;
  if ((patterns.emptyViewsPatterns || []).includes(script.hookType)) boost -= 8;
  return boost;
}

function _slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function _ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function _writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  generateBestScript,
  selectBestScript,
  runLearningCycle
};
