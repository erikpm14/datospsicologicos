/**
 * test-confessional-hooks.js
 * Prueba el validador y generador de hooks confesionales
 */

const { getHookReport, validateHookConfessional } = require('./src/services/hook-validator.service');
const {
  generateConfessionalHook,
  generateBatch,
  CONFESSIONAL_TEMPLATES,
} = require('./src/services/confessional-hook-generator');

console.log('\n' + '═'.repeat(100));
console.log('  CONFESSIONAL HOOK SYSTEM TEST');
console.log('═'.repeat(100) + '\n');

// PARTE 1: Probar validador con ejemplos
console.log('📊 PARTE 1: Validar hooks (genéricos vs confesionales)\n');
console.log('─'.repeat(100) + '\n');

const testHooks = [
  // GENÉRICOS (deben ser rechazados)
  { text: 'La gente tóxica te enseña más sobre ti que cualquier terapeuta.', expected: 'RECHAZAR' },
  { text: 'Aprendes más de tus fracasos que de tus éxitos.', expected: 'RECHAZAR' },
  { text: 'Deberías escuchar más a tu intuición.', expected: 'RECHAZAR' },
  { text: '¿Por qué SIEMPRE compras cosas que no necesitas?', expected: 'RECHAZAR' },
  { text: 'Lo que nadie te dice sobre tomar decisiones.', expected: 'RECHAZAR' },
  { text: 'Descubre el secreto científico de la felicidad.', expected: 'RECHAZAR' },

  // CONFESIONALES (deben ser aceptados)
  { text: 'No sé por qué hago como que no pasa nada.', expected: 'ACEPTAR' },
  { text: 'Hay algo que hago cuando nadie me ve.', expected: 'ACEPTAR' },
  { text: 'Sé que está mal y lo hago igual.', expected: 'ACEPTAR' },
  { text: 'Nunca lo admitiría, pero es verdad.', expected: 'ACEPTAR' },
  { text: 'Tengo miedo de que descubran quién soy realmente.', expected: 'ACEPTAR' },
];

testHooks.forEach((test, idx) => {
  const report = getHookReport(test.text, 60);

  const status = report.status === '✓ VÁLIDO' ? '✓' : '✗';
  const expectMatch = (report.status === '✓ VÁLIDO' && test.expected === 'ACEPTAR') ||
                     (report.status === '✗ RECHAZADO' && test.expected === 'RECHAZAR');
  const checkmark = expectMatch ? '✅' : '❌';

  console.log(`${idx + 1}. ${checkmark} ${status} ${test.text.substring(0, 70)}`);
  console.log(`   Expected: ${test.expected} | Result: ${report.status}`);
  console.log(`   Score: ${report.originalVirality} → ${report.adjustedVirality} (penalty: -${report.penalty})`);
  if (report.notes.length > 0) {
    report.notes.forEach(note => console.log(`   ${note}`));
  }
  console.log('');
});

// PARTE 2: Generar nuevos hooks
console.log('\n' + '─'.repeat(100) + '\n');
console.log('🎯 PARTE 2: Generar hooks confesionales\n');
console.log('─'.repeat(100) + '\n');

const topics = ['relationships', 'emotions', 'habits'];

topics.forEach(topic => {
  console.log(`Topic: ${topic}\n`);

  for (let i = 0; i < 3; i++) {
    const generated = generateConfessionalHook(topic);
    const status = generated.validation.valid ? '✓' : '⚠️';
    const score = Math.round(generated.validation.score);

    console.log(`  ${status} [${score}] "${generated.hook}"`);
  }

  console.log('');
});

// PARTE 3: Batch generation
console.log('─'.repeat(100) + '\n');
console.log('📈 PARTE 3: Generar batch de 5 hooks por topic\n');
console.log('─'.repeat(100) + '\n');

['emotions', 'relationships'].forEach(topic => {
  console.log(`Topic: ${topic}`);
  const batch = generateBatch(5, topic);

  const valid = batch.filter(h => h.validation.valid).length;
  console.log(`  Result: ${valid}/5 válidos\n`);

  batch.forEach((h, idx) => {
    const icon = h.validation.valid ? '✓' : '⚠️';
    console.log(`  ${idx + 1}. ${icon} [${Math.round(h.validation.score)}] ${h.hook}`);
  });

  console.log('');
});

// PARTE 4: Estadísticas
console.log('─'.repeat(100) + '\n');
console.log('📋 PARTE 4: Resumen de templates\n');
console.log('─'.repeat(100) + '\n');

Object.entries(CONFESSIONAL_TEMPLATES).forEach(([category, templates]) => {
  console.log(`${category}: ${templates.length} templates`);
  console.log(`  → "${templates[0]}"`);
  console.log('');
});

console.log('═'.repeat(100));
console.log('✅ TEST COMPLETE');
console.log('═'.repeat(100) + '\n');
