/**
 * Quick integration test: calls synthesizeVoice directly with a realistic script
 * to confirm Kokoro handles full production text correctly.
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '../backend'));
// Load env from backend dir
process.env.NODE_PATH = path.resolve(__dirname, '../backend/node_modules');
require('module').Module._initPaths();
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config();
const { synthesizeVoice } = require(path.resolve(__dirname, '../backend/src/services/voice-synthesizer'));
const fs   = require('fs');

const TEST_SCRIPT = {
  hook:        'Si haces esto antes de dormir, tu cerebro sigue trabajando aunque no te des cuenta.',
  claim:       'Tu corteza prefrontal no descansa: consolida lo que aprendiste hoy.',
  explanation: 'Cada vez que revisas el móvil antes de dormir, interrumpes ese proceso. Tu amígdala queda activa, generando cortisol. Te despiertas más cansado de lo que te dormiste.',
  cta:         'Lo reconoces cada vez que abres el móvil por la noche.',
};

const OUT_PATH = path.resolve('./assets/kokoro/integration_test.wav');

(async () => {
  console.log('Integration TTS test...');
  console.log(`Hook: "${TEST_SCRIPT.hook}"`);
  try {
    const result = await synthesizeVoice(TEST_SCRIPT, OUT_PATH);
    const size = fs.existsSync(result.audioPath) ? fs.statSync(result.audioPath).size : 0;
    console.log(`\n✅ PASS — provider=${result.provider} | ${(size/1024).toFixed(0)} KB | ~${result.estimatedDuration}s`);
    console.log(`   Path: ${result.audioPath}`);
    // Clean up
    try { fs.unlinkSync(result.audioPath); } catch {}
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ FAIL — ${err.message}`);
    process.exit(1);
  }
})();
