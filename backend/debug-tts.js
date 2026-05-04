const script = {
  id: 'final_test',
  hook: 'Tu potencial es infinito',
  claim: 'Tienes todo lo que necesitas dentro',
  explanation: 'Tu potencial es infinito y tienes todo lo que necesitas dentro de ti. Cada día es una nueva oportunidad para avanzar y crecer. Eres más capaz de lo que crees posible. No importa cuántas veces hayas caído, siempre puedes levantarte de nuevo. Tú puedes lograrlo.',
  cta: 'Avanza hoy',
  topic: 'resilience',
  themeId: 'psychology_dark',
  content_version: 'v2',
  viralityScore: 76,
  duration: 28
};

const { ensureLegacyFields, hasExpandedStructure, getScriptSections } = require('./src/utils/script-segments');

const normalized = ensureLegacyFields(script);
console.log('Script is expanded?', hasExpandedStructure(normalized));
console.log('Script sections:', getScriptSections(normalized).map(s => ({ key: s.key, length: s.text.length })));
