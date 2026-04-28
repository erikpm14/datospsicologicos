/**
 * test-winners-analysis.js
 * Test de análisis de WINNERS para explotación
 * Uso: node backend/test-winners-analysis.js
 */

require('dotenv').config({ path: './backend/.env' });
const path = require('path');
const fs = require('fs');
const { analyzePerformance } = require('./src/services/performance-analyzer.service');
const { getOptimizationStatus } = require('./src/services/insights-optimizer.service');

async function testWinnersAnalysis() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║        WINNERS ANALYSIS TEST                           ║`);
  console.log(`║   Identifying best performing hooks and topics         ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  try {
    // 1. Ejecutar análisis de performance
    console.log(`\n1️⃣  Analyzing performance data...`);
    const insights = analyzePerformance();

    if (!insights) {
      console.log(`⚠️  No performance data available yet`);
      console.log(`   Sistema está listo para recibir datos cuando haya vídeos`);
      console.log(`   Continúa generando y publicando vídeos para comenzar análisis`);
      return;
    }

    console.log(`✅ Performance analysis complete`);
    console.log(`   Total videos analyzed: ${insights.totalVideosAnalyzed}`);
    console.log(`   Generated at: ${insights.generatedAt}`);

    // 2. Mostrar resultados
    console.log(`\n2️⃣  Analysis Results:`);

    // Top hooks
    if (insights.topHooks && insights.topHooks.length > 0) {
      console.log(`\n   📌 TOP HOOKS (WINNERS):`);
      insights.topHooks.slice(0, 5).forEach((h, i) => {
        console.log(`      ${i + 1}. "${h.hook}"`);
        console.log(`         Score: ${h.avgScore?.toFixed(2) || 'N/A'} | Usage: ${h.count || 0}`);
      });
    }

    // Top topics
    if (insights.topTopics && insights.topTopics.length > 0) {
      console.log(`\n   🎯 TOP TOPICS (WINNERS):`);
      insights.topTopics.slice(0, 5).forEach((t, i) => {
        console.log(`      ${i + 1}. ${t.topic}`);
        console.log(`         Avg Virality: ${t.avgVirality?.toFixed(2) || 'N/A'} | Count: ${t.count || 0}`);
      });
    }

    // Hook type distribution
    if (insights.recommendedHookTypeRatio) {
      console.log(`\n   ⚡ OPTIMAL HOOK TYPE DISTRIBUTION:`);
      console.log(`      Challenge: ${insights.recommendedHookTypeRatio.challenge || 'N/A'}%`);
      console.log(`      Observable: ${insights.recommendedHookTypeRatio.observable || 'N/A'}%`);
    }

    // 3. Mostrar status de optimización
    console.log(`\n3️⃣  Optimization Status:`);
    const status = getOptimizationStatus();
    console.log(`   Status: ${status.status.toUpperCase()}`);
    console.log(`   Hook Type Distribution: Challenge ${status.hookTypeDistribution.challenge}% | Observable ${status.hookTypeDistribution.observable}%`);
    console.log(`   Videos Analyzed: ${status.videosAnalyzed}`);
    console.log(`   Topics Tracked: ${status.topicsTracked}`);

    if (status.topPerformers && status.topPerformers.hookType) {
      console.log(`\n   🏆 Top Performing Topics:`);
      status.topPerformers.hookType.forEach((t, i) => {
        console.log(`      ${i + 1}. ${t.topic} (${t.avgVirality.toFixed(2)} avg virality)`);
      });
    }

    // 4. Verificar archivos generados
    console.log(`\n4️⃣  Generated Files:`);
    const insightsFile = path.resolve('./analytics/insights.json');
    if (fs.existsSync(insightsFile)) {
      console.log(`   ✅ analytics/insights.json created`);
      const stats = fs.statSync(insightsFile);
      console.log(`      Size: ${(stats.size / 1024).toFixed(2)} KB`);
    }

    const contextFile = path.resolve('./analytics/optimization-context.json');
    if (fs.existsSync(contextFile)) {
      console.log(`   ✅ analytics/optimization-context.json created`);
      const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
      console.log(`      Preferred Topics: ${context.preferredTopics.length}`);
      console.log(`      Best Hooks: ${context.bestHooks.length}`);
      console.log(`      Avoid Topics: ${context.avoidTopics.length}`);
      console.log(`      Confidence: ${context.confidence}%`);
    }

    // 5. Recomendaciones
    console.log(`\n5️⃣  Recommendations:`);
    if (insights.recommendations) {
      console.log(`   ${insights.recommendations}`);
    }
  } catch (err) {
    console.error(`\n❌ Error during analysis: ${err.message}`);
    console.error(err.stack);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✨ Winners analysis complete`);
  console.log(`   System is ready to exploit WINNERS when data available`);
}

testWinnersAnalysis().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
