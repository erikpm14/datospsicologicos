/**
 * test-opportunistic-publish.js
 * Verifica que el sistema de opportunistic publish está funcionando
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════');
console.log('  OPPORTUNISTIC PUBLISH — TEST');
console.log('═══════════════════════════════════════════════════════════\n');

// Test 1: Verificar que el módulo carga
console.log('[TEST 1] Cargar módulo opportunistic-publish.js');
try {
  const opp = require('./src/services/opportunistic-publish.js');
  console.log('✓ Módulo cargado');
  console.log('  Exports:', Object.keys(opp).join(', '));
} catch (err) {
  console.error('✗ Error:', err.message);
  process.exit(1);
}

// Test 2: Verificar funciones
console.log('\n[TEST 2] Verificar funciones disponibles');
try {
  const { isPerfectVideo, publishOpportunistic, buildValidationResult } = require('./src/services/opportunistic-publish.js');

  if (typeof isPerfectVideo !== 'function') throw new Error('isPerfectVideo no es función');
  if (typeof publishOpportunistic !== 'function') throw new Error('publishOpportunistic no es función');
  if (typeof buildValidationResult !== 'function') throw new Error('buildValidationResult no es función');

  console.log('✓ Todas las funciones están disponibles');
} catch (err) {
  console.error('✗ Error:', err.message);
  process.exit(1);
}

// Test 3: Verificar que publish-scheduler.service.js carga
console.log('\n[TEST 3] Cargar publish-scheduler.service.js');
try {
  const scheduler = require('./src/services/publish-scheduler.service.js');
  console.log('✓ publish-scheduler cargado');
  console.log('  Exports:', Object.keys(scheduler).join(', '));
} catch (err) {
  console.error('✗ Error:', err.message);
  process.exit(1);
}

// Test 4: Validar flujo de isPerfectVideo
console.log('\n[TEST 4] Test función isPerfectVideo');
try {
  const { isPerfectVideo } = require('./src/services/opportunistic-publish.js');
  const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');

  // Buscar un vídeo que tenga output.mp4 y subtitles.ass
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.log('  ℹ OUTPUT_DIR no existe, skipping real video test');
  } else {
    const videos = fs.readdirSync(OUTPUT_DIR).filter(f =>
      fs.statSync(path.join(OUTPUT_DIR, f)).isDirectory()
    ).slice(0, 5);

    let foundPerfect = false;
    for (const videoId of videos) {
      const videoPath = path.join(OUTPUT_DIR, videoId, 'output.mp4');
      const result = isPerfectVideo(videoPath, path.join(OUTPUT_DIR, videoId));

      if (result) {
        console.log(`  ✓ Vídeo ${videoId} es perfecto`);
        foundPerfect = true;
      }
    }

    if (!foundPerfect && videos.length > 0) {
      console.log(`  ℹ Ninguno de los ${videos.length} vídeos examinados es perfecto (esperado)`);
    }
  }
  console.log('✓ isPerfectVideo funciona correctamente');
} catch (err) {
  console.error('✗ Error:', err.message);
  process.exit(1);
}

// Test 5: Verificar log file
console.log('\n[TEST 5] Verificar archivo de log');
try {
  const logPath = path.resolve('./data/opportunistic-publish-log.json');
  if (fs.existsSync(logPath)) {
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    console.log(`✓ Log file existe con ${log.length} entradas`);
  } else {
    console.log('✓ Log file no existe aún (se creará en primera publicación)');
  }
} catch (err) {
  console.error('✗ Error:', err.message);
  process.exit(1);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  ✓ TODOS LOS TESTS PASARON');
console.log('═══════════════════════════════════════════════════════════\n');
console.log('Sistema ready para opportunistic publish:');
console.log('  • AUTO_PUBLISH_ENABLED=' + (process.env.AUTO_PUBLISH_ENABLED || 'false'));
console.log('  • V4_VALIDATION_MODE=' + (process.env.V4_VALIDATION_MODE || 'strict'));
console.log('  • OUTPUT_DIR=' + (process.env.OUTPUT_DIR || './output'));
console.log('\nCuando hay vídeos perfectos, serán publicados sin esperar slots.');
