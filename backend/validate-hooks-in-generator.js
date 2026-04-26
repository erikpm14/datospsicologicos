/**
 * validate-hooks-in-generator.js
 * Genera 3 scripts con el sistema nuevo y valida que hooks sean confesionales
 */

const { generateScript } = require('./src/services/content-generator');
const { validateHookConfessional } = require('./src/services/hook-validator.service');
const logger = require('./src/utils/logger');

async function validateHooksInGenerator() {
  console.log('\n' + '═'.repeat(100));
  console.log('  VALIDATING HOOK QUALITY IN CONTENT GENERATOR');
  console.log('═'.repeat(100) + '\n');

  const results = [];

  for (let i = 0; i < 3; i++) {
    try {
      console.log(`\n📝 Generating candidate ${i + 1}/3...\n`);

      const script = await generateScript({
        topic: ['relationships', 'emotions', 'habits'][i],
      });

      const hookValidation = validateHookConfessional(script.hook);

      const result = {
        index: i + 1,
        topic: script.topic,
        hook: script.hook,
        hookScore: hookValidation.score,
        hookPriority: hookValidation.priority,
        viralityScore: script.viralityScore,
        status: hookValidation.score >= 70 ? '✅ VALID' : '❌ REJECTED',
        passesReality: hookValidation.passesReality,
        hasFirstPerson: hookValidation.hasFirstPerson,
        vulnerabilityScore: hookValidation.vulnerabilityScore,
        penalties: hookValidation.penalties,
      };

      results.push(result);

      // Mostrar resultado
      console.log(`${result.status} Candidate ${i + 1}`);
      console.log(`   Hook: "${result.hook}"`);
      console.log(`   Topic: ${result.topic}`);
      console.log(`   Hook Score: ${result.hookScore}/100 (${result.hookPriority})`);
      console.log(`   Virality Score: ${Math.round(result.viralityScore)}/100`);
      console.log(`   Passes Reality Test: ${result.passesReality}`);
      console.log(`   Has First Person: ${result.hasFirstPerson}`);
      console.log(`   Vulnerability Score: ${result.vulnerabilityScore}`);
      if (result.penalties.length > 0) {
        console.log(`   Penalties: ${result.penalties.join(', ')}`);
      }

    } catch (err) {
      console.error(`❌ Generation failed: ${err.message}`);
      results.push({
        index: i + 1,
        error: err.message,
        status: '❌ ERROR',
      });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(100));
  console.log('  VALIDATION SUMMARY');
  console.log('═'.repeat(100) + '\n');

  const valid = results.filter(r => r.status === '✅ VALID').length;
  const invalid = results.filter(r => r.status === '❌ REJECTED').length;
  const errors = results.filter(r => r.status === '❌ ERROR').length;

  console.log(`✅ Valid (>= 70): ${valid}/3`);
  console.log(`❌ Rejected (< 70): ${invalid}/3`);
  console.log(`⚠️  Errors: ${errors}/3\n`);

  // Detailed results
  results.forEach(r => {
    if (!r.error) {
      const icon = r.status === '✅ VALID' ? '✓' : '✗';
      console.log(`${icon} ${r.hook.substring(0, 60)}`);
      console.log(`  Score: ${r.hookScore} | Virality: ${Math.round(r.viralityScore)} | Reality: ${r.passesReality}`);
    }
  });

  console.log('\n' + '═'.repeat(100) + '\n');

  // Final verdict
  if (valid === 3) {
    console.log('✅ SUCCESS: All 3 candidates generated with valid confessional hooks (>= 70)\n');
    return true;
  } else {
    console.log(`⚠️  PARTIAL: ${valid}/3 valid candidates. System working but may need adjustment.\n`);
    return false;
  }
}

// Run
validateHooksInGenerator()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error(`FATAL ERROR: ${err.message}`);
    process.exit(1);
  });
