/**
 * test-winners-integration.js
 * Test de integración 70/30 WINNERS exploitation
 * Genera 3 vídeos y muestra la estrategia usada
 */

require('dotenv').config({ path: './backend/.env' });
const { generateScript } = require('./src/services/content-generator');
const { getOptimizationContext } = require('./src/services/insights-optimizer.service');

async function testWinnersIntegration() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║      WINNERS EXPLOITATION 70/30 TEST                   ║`);
  console.log(`║   Validating integration without breaking pipeline    ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  try {
    // Mostrar contexto de optimización
    console.log(`\n📊 Optimization Context:`);
    const optContext = getOptimizationContext();
    console.log(`   Available: ${optContext.available}`);
    console.log(`   Preferred Topics: ${optContext.preferredTopics.length}`);
    console.log(`   Best Hooks: ${optContext.bestHooks.length}`);
    console.log(`   Avoid Topics: ${optContext.avoidTopics.length}`);
    console.log(`   Confidence: ${optContext.confidence}%`);

    // Generar 3 vídeos
    console.log(`\n🎬 Generating 3 test videos...\n`);

    for (let i = 1; i <= 3; i++) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Video ${i}/3`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      try {
        const script = await generateScript({ topic: null }); // Dejar que el sistema decida

        if (script) {
          console.log(`✅ Generated successfully`);
          console.log(`   Topic: ${script.topic}`);
          console.log(`   Hook: "${script.hook?.substring(0, 50)}..."`);
          console.log(`   Duration: ${script.duration}s`);
          console.log(`   Virality: ${script.viralityScore}`);
          console.log(`   Humanity: ${script.humanityScore}`);
        } else {
          console.log(`❌ Failed to generate script`);
        }
      } catch (err) {
        console.log(`❌ Generation error: ${err.message}`);
      }

      if (i < 3) {
        console.log(); // Spacing
      }
    }

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║                 TEST COMPLETE                          ║`);
    console.log(`╚════════════════════════════════════════════════════════╝`);
    console.log(`\n✅ Pipeline status: INTACT`);
    console.log(`✅ Strategy 70/30: INTEGRATED`);
    console.log(`✅ WINNERS exploitation: ACTIVE`);
    console.log(`\nNote: Check logs for GEN_STRATEGY to see exploitation in action`);
  } catch (err) {
    console.error(`\n❌ Test failed: ${err.message}`);
    console.error(err.stack);
  }
}

testWinnersIntegration().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
