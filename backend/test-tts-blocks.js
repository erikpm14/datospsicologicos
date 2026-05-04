const script = {
  id: 'final_test',
  hook: 'Tu potencial es infinito',
  claim: 'Tienes todo lo que necesitas dentro',
  explanation: 'Tu potencial es infinito y tienes todo lo que necesitas dentro de ti. Cada día es una nueva oportunidad para avanzar y crecer. Eres más capaz de lo que crees posible. No importa cuántas veces hayas caído, siempre puedes levantarte de nuevo. Tú puedes lograrlo.',
  cta: 'Avanza hoy',
};

const { ensureLegacyFields, getScriptSections } = require('./src/utils/script-segments');
const { prepareNarrationForTTS } = require('./src/services/voice-synthesizer');

// Can't export prepareNarrationForTTS directly, so let me just show the sections
const normalized = ensureLegacyFields(script);
const sections = getScriptSections(normalized);

console.log('Script sections:');
sections.forEach(s => {
  const words = s.text.split(/\s+/).length;
  console.log(`  ${s.key}: ${words} words | "${s.text.substring(0, 60)}..."`);
  console.log(`    Full: ${s.text}`);
});

const totalWords = sections.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
console.log(`\nTotal words: ${totalWords}`);
console.log(`Expected duration at 3.5 words/sec: ${(totalWords / 3.5).toFixed(2)}s`);
