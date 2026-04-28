/**
 * test-publish-validator-direct.js
 * Test directo del validador de publicación
 * Simula 3 casos: APROBADO, RECHAZADO por virality, RECHAZADO por humanity
 */

require('dotenv').config({ path: './backend/.env' });
const { validateForPublish } = require('./src/services/publish-validator.service');

function testValidator() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║     PUBLISH VALIDATOR — DIRECT TEST                   ║`);
  console.log(`║   Casos: APROBADO | LOW_VIRALITY | LOW_HUMANITY      ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  const testCases = [
    {
      name: 'CASO 1: Cumple todos los estándares',
      script: {
        videoId: 'test-approved-1',
        hook: '¿Cuándo empezaste a dudar?',
        structureVersion: 'confessional',
        retentionSpikeVersion: 'v4.1',
        renderMode: 'video_use',
        subtitleTimingMode: 'word_timestamps',
        wordAlignmentEngine: 'whisper',
        segments: ['hook', 'loop', 'value'],
        fullScript: 'Esto es una confesión de verdad sobre dudas internas',
        durationSeconds: 29,
        viralityScore: 78,
        humanityScore: 88,
        topic: 'relationships',
      },
      expected: 'APROBADO',
    },
    {
      name: 'CASO 2: Falla por viralityScore < 70',
      script: {
        videoId: 'test-low-virality-1',
        hook: '¿Cuándo empezaste a dudar?',
        structureVersion: 'confessional',
        retentionSpikeVersion: 'v4.1',
        renderMode: 'video_use',
        subtitleTimingMode: 'word_timestamps',
        wordAlignmentEngine: 'whisper',
        segments: ['hook', 'loop', 'value'],
        fullScript: 'Esto no es muy viral',
        durationSeconds: 29,
        viralityScore: 45, // < 70 ❌
        humanityScore: 88,
        topic: 'relationships',
      },
      expected: 'RECHAZADO (viralityScore < 70)',
    },
    {
      name: 'CASO 3: Falla por humanityScore < 85',
      script: {
        videoId: 'test-low-humanity-1',
        hook: '¿Cuándo empezaste a dudar?',
        structureVersion: 'confessional',
        retentionSpikeVersion: 'v4.1',
        renderMode: 'video_use',
        subtitleTimingMode: 'word_timestamps',
        wordAlignmentEngine: 'whisper',
        segments: ['hook', 'loop', 'value'],
        fullScript: 'Este script suena educativo. Aprende cómo funciona tu cerebro',
        durationSeconds: 29,
        viralityScore: 78,
        humanityScore: 62, // < 85 ❌
        topic: 'relationships',
      },
      expected: 'RECHAZADO (humanityScore < 85)',
    },
    {
      name: 'CASO 4: Falla por duración > 32s',
      script: {
        videoId: 'test-long-duration-1',
        hook: '¿Cuándo empezaste a dudar?',
        structureVersion: 'confessional',
        retentionSpikeVersion: 'v4.1',
        renderMode: 'video_use',
        subtitleTimingMode: 'word_timestamps',
        wordAlignmentEngine: 'whisper',
        segments: ['hook', 'loop', 'value'],
        fullScript: 'Texto largo',
        durationSeconds: 45, // > 32 ❌
        viralityScore: 78,
        humanityScore: 88,
        topic: 'relationships',
      },
      expected: 'RECHAZADO (duration > 32s)',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`${testCase.name}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const result = validateForPublish({
      id: testCase.script.videoId,
      prefabScript: testCase.script,
    });

    console.log(`Input:`);
    console.log(`  Duration: ${testCase.script.durationSeconds}s (26-32 required)`);
    console.log(`  Virality: ${testCase.script.viralityScore} (>=70 required)`);
    console.log(`  Humanity: ${testCase.script.humanityScore} (>=85 required)`);

    console.log(`\nResult:`);
    if (result.valid) {
      console.log(`✅ APROBADO`);
      if (result.standards) {
        console.log(`   ${result.standards.duration}`);
        console.log(`   ${result.standards.virality}`);
        console.log(`   ${result.standards.humanity}`);
      }
      if (testCase.expected.startsWith('APROBADO')) {
        console.log(`✅ Test PASSOU (resultado esperado)`);
        passed++;
      } else {
        console.log(`❌ Test FALLÓ (esperaba: ${testCase.expected})`);
        failed++;
      }
    } else {
      console.log(`❌ RECHAZADO`);
      console.log(`   ${result.reason}`);
      if (result.failureReasons) {
        console.log(`   Detalles: ${result.failureReasons}`);
      }
      if (testCase.expected.startsWith('RECHAZADO')) {
        console.log(`✅ Test PASSOU (resultado esperado)`);
        passed++;
      } else {
        console.log(`❌ Test FALLÓ (esperaba: ${testCase.expected})`);
        failed++;
      }
    }
  }

  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║                    RESUMEN FINAL                       ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);
  console.log(`✅ Passed: ${passed}/${testCases.length}`);
  console.log(`❌ Failed: ${failed}/${testCases.length}`);

  if (failed === 0) {
    console.log(`\n🎉 TODOS LOS TESTS PASARON`);
    console.log(`   Validador funciona correctamente con estándares estrictos`);
  } else {
    console.log(`\n⚠️  ${failed} test(s) fallido(s)`);
  }
}

testValidator();
