/**
 * test-publish-validation.js
 * Test de validación de publicación con estándares V4.1 estrictos
 * Uso: node backend/test-publish-validation.js
 */

require('dotenv').config({ path: './backend/.env' });
const { generateScript } = require('./src/services/content-generator');
const { validateForPublish } = require('./src/services/publish-validator.service');

async function testPublishValidation() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║     V4.1 PUBLISH VALIDATION TEST                       ║`);
  console.log(`║   Testing: Duration 26-32s | Virality >=70 | Humanity >=85║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  try {
    // 1. Generar script
    console.log(`\n1️⃣  Generando script...`);
    let script;
    try {
      script = await generateScript({ topic: 'relationships' });
    } catch (err) {
      console.log(`❌ Generación falló: ${err.message}`);
      console.log(`   Motivo: Script no cumple V4.1 en generación`);
      return;
    }

    if (!script) {
      console.log(`❌ No se generó script`);
      return;
    }

    console.log(`✅ Script generado: ${script.videoId || 'unnamed'}`);
    console.log(`   Duration: ${script.durationSeconds || script.duration}s`);
    console.log(`   Virality: ${script.viralityScore}`);
    console.log(`   Humanity: ${script.humanityScore}`);

    // 2. Validar para publicación
    console.log(`\n2️⃣  Validando para publicación...`);
    const validation = validateForPublish({
      id: script.videoId || 'test-video',
      prefabScript: script,
    });

    console.log(`\n📊 RESULTADO DE VALIDACIÓN:`);
    if (validation.valid) {
      console.log(`✅ APROBADO PARA PUBLICACIÓN`);
      console.log(`\n   Estándares cumplidos:`);
      if (validation.standards) {
        console.log(`   - Duration: ${validation.standards.duration}`);
        console.log(`   - Virality: ${validation.standards.virality}`);
        console.log(`   - Humanity: ${validation.standards.humanity}`);
      }
      console.log(`\n   Estado: LISTO PARA PUBLICAR`);
    } else {
      console.log(`❌ RECHAZADO - NO CUMPLE ESTÁNDARES`);
      console.log(`   Motivo: ${validation.reason}`);

      if (validation.failureReasons) {
        console.log(`\n   Detalles:`);
        console.log(`   ${validation.failureReasons}`);
      }

      if (validation.failures) {
        console.log(`\n   Errores específicos:`);
        validation.failures.forEach((f) => {
          console.log(`   - ${f.field}: ${f.value} (${f.reason})`);
        });
      }

      if (validation.v4Errors) {
        console.log(`\n   Errores V4.1:`);
        validation.v4Errors.forEach((e) => console.log(`   - ${e}`));
      }

      console.log(`\n   Estado: EXCLUIDO DE PUBLICACIÓN`);
    }
  } catch (err) {
    console.error(`\n❌ Error en test: ${err.message}`);
    console.error(err.stack);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✨ Test completado`);
  process.exit(0);
}

testPublishValidation().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
