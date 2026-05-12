#!/usr/bin/env node
/**
 * manual-publish-single-real-private.js
 *
 * Publicación real controlada a YouTube en PRIVADO, usando YouTube Data API real.
 *
 * Características:
 * - Solo publica un videoId específico (dfbe032d-98c3-4a03-954a-0410f6f83de2)
 * - Requiere --confirm-private-upload explícito
 * - Publica como PRIVATE (no PUBLIC)
 * - Usa youtube.videos.insert real de Google APIs
 * - Falla si cualquier validación no pasa
 * - Mantiene sistema FROZEN (no activa scheduler, no AUTO_PUBLISH_ENABLED)
 * - Protección contra doble publicación (slot idempotency)
 * - Soporta --dry-run para simular sin subir
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const OUTPUT_DIR = path.resolve(__dirname, '../output-fase1-test');
const DATA_DIR = path.resolve(__dirname, '../data');

const ALLOWED_VIDEO_ID = 'dfbe032d-98c3-4a03-954a-0410f6f83de2';
const EXPECTED_SHA256 = 'BF6BD062E7B1330ED8E6D7CE0FAE412C24A77B0021CC15F51E52C58AA197F397';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(text, color = 'reset') {
  console.log(`${colors[color]}${text}${colors.reset}`);
}

function logSection(title) {
  console.log(`\n${colors.blue}${'═'.repeat(70)}${colors.reset}`);
  console.log(`${colors.blue}${title}${colors.reset}`);
  console.log(`${colors.blue}${'═'.repeat(70)}${colors.reset}\n`);
}

function validateYoutubeId(youtubeId) {
  // YouTube IDs son 11 caracteres alfanuméricos (sin TEST_ prefix)
  if (!youtubeId || youtubeId.startsWith('TEST_')) {
    return false;
  }
  return /^[A-Za-z0-9_-]{11}$/.test(youtubeId);
}

async function main() {
  const videoId = process.argv[2];
  const confirmFlag = process.argv[3];
  const dryRun = process.argv.includes('--dry-run');

  logSection('PUBLICACIÓN REAL CONTROLADA EN PRIVADO');

  // Validación de argumentos
  if (!videoId) {
    log('Usage: node manual-publish-single-real-private.js <videoId> [--confirm-private-upload|--dry-run]', 'red');
    process.exit(1);
  }

  if (videoId !== ALLOWED_VIDEO_ID) {
    log(`❌ ERROR: Este script solo publica: ${ALLOWED_VIDEO_ID}`, 'red');
    log(`   Intentaste: ${videoId}`, 'red');
    process.exit(1);
  }

  if (!dryRun && confirmFlag !== '--confirm-private-upload') {
    log('❌ ERROR: Debes confirmar --confirm-private-upload para publicar real', 'red');
    log('Usage (REAL UPLOAD): node manual-publish-single-real-private.js dfbe032d-98c3-4a03-954a-0410f6f83de2 --confirm-private-upload', 'red');
    log('Usage (DRY RUN): node manual-publish-single-real-private.js dfbe032d-98c3-4a03-954a-0410f6f83de2 --dry-run', 'red');
    process.exit(1);
  }

  log(`VideoID: ${videoId}`, 'green');
  log(`Modo: ${dryRun ? 'DRY-RUN (simulación)' : 'REAL UPLOAD (privado)'}`, dryRun ? 'yellow' : 'yellow');
  log(`Privacidad: private\n`, 'green');

  const videoDir = path.join(OUTPUT_DIR, videoId);
  const videoPath = path.join(videoDir, 'output.mp4');
  const publishLogPath = path.join(DATA_DIR, 'publish-log.json');
  const slotLocksPath = path.join(DATA_DIR, 'slot-publication-locks.json');
  const publishedPath = path.join(videoDir, 'published.json');

  // 1. Verificar archivo existe
  if (!fs.existsSync(videoPath)) {
    log(`❌ Archivo no encontrado: ${videoPath}`, 'red');
    process.exit(1);
  }
  log('✓ Video file found\n', 'green');

  // 2. Verificar SHA256
  log('Verificando SHA256...', 'yellow');
  const crypto = require('crypto');
  const fileBuffer = fs.readFileSync(videoPath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  const fileSHA256 = hashSum.digest('hex').toUpperCase();

  if (fileSHA256 !== EXPECTED_SHA256) {
    log(`❌ SHA256 NO COINCIDE`, 'red');
    log(`   Esperado: ${EXPECTED_SHA256}`, 'red');
    log(`   Calculado: ${fileSHA256}`, 'red');
    process.exit(1);
  }
  log(`✓ SHA256 coincide: ${fileSHA256.substring(0, 16)}...\n`, 'green');

  // 3. Verificar que NO hay published.json real
  if (fs.existsSync(publishedPath)) {
    const existing = JSON.parse(fs.readFileSync(publishedPath, 'utf8'));
    if (!existing.simulated && existing.youtubeId && !existing.youtubeId.startsWith('TEST_')) {
      log(`❌ ERROR: Ya existe publicación real registrada`, 'red');
      log(`   YouTube ID: ${existing.youtubeId}`, 'red');
      process.exit(1);
    }
  }
  log('✓ No hay publicación real previa\n', 'green');

  // 4. Verificar que NO existe slot lock real previo
  if (fs.existsSync(slotLocksPath)) {
    const locks = JSON.parse(fs.readFileSync(slotLocksPath, 'utf8'));
    if (locks[videoId] && locks[videoId].realUpload === true && validateYoutubeId(locks[videoId].youtubeId)) {
      log(`❌ ERROR: Ya existe publicación real en slot lock`, 'red');
      log(`   YouTube ID: ${locks[videoId].youtubeId}`, 'red');
      process.exit(1);
    }
  }
  log('✓ No hay lock previo para publicación real\n', 'green');

  // 5. Verificar que AUTO_PUBLISH_ENABLED=false
  const envPath = path.resolve(__dirname, '../.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  if (!envContent.includes('AUTO_PUBLISH_ENABLED=false')) {
    log(`❌ ERROR: AUTO_PUBLISH_ENABLED no está false`, 'red');
    process.exit(1);
  }
  log('✓ AUTO_PUBLISH_ENABLED=false (sistema seguro)\n', 'green');

  // 6. Verificar publication-freeze.json=FROZEN
  const freezePath = path.join(DATA_DIR, 'publication-freeze.json');
  const freeze = JSON.parse(fs.readFileSync(freezePath, 'utf8'));
  if (!freeze.status || !freeze.status.includes('FROZEN')) {
    log(`❌ ERROR: Sistema no está FROZEN`, 'red');
    process.exit(1);
  }
  log('✓ System is FROZEN (seguro)\n', 'green');

  // 7. Ejecutar safety suite
  logSection('EJECUTAR VALIDACIONES');
  log('Ejecutando safety suite...', 'yellow');
  try {
    execSync(`node scripts/run-publish-safety-suite.js ${videoId}`, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit'
    });
  } catch (err) {
    log(`\n❌ Safety suite falló`, 'red');
    process.exit(1);
  }

  log(`\n✓ Todos los checks pasaron\n`, 'green');

  // 8. Si es DRY-RUN, informar y salir
  if (dryRun) {
    logSection('DRY-RUN COMPLETADO');
    log(`✓ Todas las validaciones pasaron`, 'green');
    log(`✓ Credenciales YouTube API: ${process.env.YOUTUBE_CLIENT_ID ? '✓ Detectadas' : '❌ Faltan'}`, 'green');
    log(`✓ Archivo listo para upload: ${videoPath}`, 'green');
    log(`✓ Privacidad sería: private`, 'green');
    log(`✓ Sistema seguiría FROZEN tras publicación real`, 'green');
    log(`\n✅ DRY-RUN EXITOSO - Listo para publicación real controlada\n`, 'green');
    process.exit(0);
  }

  // 8.5. PRE-UPLOAD AUDIT - Final validation before youtube.videos.insert
  logSection('PRE-UPLOAD AUDIT - VALIDACIÓN FINAL');

  // Check humanReviewStatus
  const humanReviewPath = path.join(videoDir, 'human-review-status.json');
  if (fs.existsSync(humanReviewPath)) {
    try {
      const reviewStatus = JSON.parse(fs.readFileSync(humanReviewPath, 'utf8'));
      if (reviewStatus.humanReviewStatus === 'FAILED' || reviewStatus.publicable === false) {
        log(`❌ ERROR: Video ha sido marcado como NO publicable por revisión humana`, 'red');
        log(`   Status: ${reviewStatus.humanReviewStatus}`, 'red');
        log(`   Publicable: ${reviewStatus.publicable}`, 'red');
        if (reviewStatus.failureReasons && reviewStatus.failureReasons.length > 0) {
          log(`   Razones:`, 'red');
          reviewStatus.failureReasons.forEach(r => log(`     - ${r}`, 'red'));
        }
        process.exit(1);
      }
    } catch (err) {
      log(`⚠️  Warning: No se pudo leer human-review-status.json: ${err.message}`, 'yellow');
    }
  }
  log('✓ Human review status OK (no bloqueado)\n', 'green');

  // Final CHECK_24 validation
  log('Ejecutando CHECK_24 final (validación script-audio-subtitle)...', 'yellow');
  try {
    const { checkScriptAudioSubtitleAlignment } = require('../src/services/check-24-script-audio-subtitle-alignment.service');
    const check24Result = checkScriptAudioSubtitleAlignment(videoPath, videoId);

    if (!check24Result.pass) {
      log(`❌ ERROR: CHECK_24 falló`, 'red');
      log(`   Error: ${check24Result.error}`, 'red');
      if (check24Result.blockReason) {
        log(`   Block reason: ${check24Result.blockReason}`, 'red');
      }
      process.exit(1);
    }
    log(`✓ CHECK_24 pasó - script, audio y subtítulos validados\n`, 'green');
  } catch (err) {
    log(`❌ ERROR: Error ejecutando CHECK_24: ${err.message}`, 'red');
    process.exit(1);
  }

  // 9. PUBLICACIÓN REAL A YOUTUBE
  logSection('PUBLICANDO A YOUTUBE (PRIVADO)');

  // Validar credenciales
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REFRESH_TOKEN) {
    log(`❌ ERROR: Credenciales YouTube API incompletas`, 'red');
    log(`   YOUTUBE_CLIENT_ID: ${process.env.YOUTUBE_CLIENT_ID ? '✓' : '❌ Falta'}`, 'red');
    log(`   YOUTUBE_CLIENT_SECRET: ${process.env.YOUTUBE_CLIENT_SECRET ? '✓' : '❌ Falta'}`, 'red');
    log(`   YOUTUBE_REFRESH_TOKEN: ${process.env.YOUTUBE_REFRESH_TOKEN ? '✓' : '❌ Falta'}`, 'red');
    process.exit(1);
  }

  try {
    // Crear cliente OAuth2
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      'http://localhost'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    });

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client,
    });

    // Leer metadata para título y descripción
    const scriptPath = path.join(videoDir, 'script.json');
    let title = `Psychology Shorts - ${videoId}`;
    let description = 'Educational content about psychology and neuroscience.';

    if (fs.existsSync(scriptPath)) {
      const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
      title = script.hook || title;
      description = script.explanation || description;
    }

    log(`Título: ${title}`, 'green');
    log(`Descripción: ${description.substring(0, 50)}...`, 'green');
    log(`Privacidad: private`, 'green');
    log(`\nUpload a YouTube...`, 'yellow');

    // Upload real a YouTube
    const response = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: title,
          description: description,
          tags: ['psychology', 'neuroscience', 'education', 'shorts'],
          defaultLanguage: 'es',
        },
        status: {
          privacyStatus: 'private', // PRIVADO, no public
          madeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(videoPath),
      },
    });

    const youtubeId = response.data.id;

    // Validar que YouTube ID sea real
    if (!validateYoutubeId(youtubeId)) {
      log(`❌ ERROR: YouTube retornó ID inválido: ${youtubeId}`, 'red');
      process.exit(1);
    }

    log(`\n✓ Upload exitoso a YouTube`, 'green');
    log(`  YouTube ID: ${youtubeId}`, 'green');
    log(`  Privacidad: private`, 'green');
    log(`  Timestamp: ${new Date().toISOString()}`, 'green');

    // 10. Guardar registros reales
    logSection('GUARDAR REGISTROS REALES');

    // published.json real
    const publishedData = {
      videoId,
      youtubeId,
      publishedAt: new Date().toISOString(),
      method: 'manual-publish-single-real-private',
      privacyStatus: 'private',
      sha256: fileSHA256,
      realUpload: true,
      simulated: false,
      apiResponse: {
        status: response.status,
        kind: response.data.kind,
      },
    };

    fs.writeFileSync(publishedPath, JSON.stringify(publishedData, null, 2));
    log(`✓ published.json creado (REAL)`, 'green');

    // publish-log.json
    let publishLogData = { published: [] };
    if (fs.existsSync(publishLogPath)) {
      try {
        publishLogData = JSON.parse(fs.readFileSync(publishLogPath, 'utf8'));
      } catch (e) {
        publishLogData = { published: [] };
      }
    }

    publishLogData.published.push({
      videoId,
      youtubeId,
      publishedAt: new Date().toISOString(),
      method: 'manual-publish-single-real-private',
      privacyStatus: 'private',
      sha256: fileSHA256,
      realUpload: true,
      apiStatus: response.status,
    });

    fs.writeFileSync(publishLogPath, JSON.stringify(publishLogData, null, 2));
    log(`✓ publish-log.json actualizado (REAL)`, 'green');

    // slot-publication-locks.json
    let locks = {};
    if (fs.existsSync(slotLocksPath)) {
      locks = JSON.parse(fs.readFileSync(slotLocksPath, 'utf8'));
    }

    locks[videoId] = {
      youtubeId,
      publishedAt: new Date().toISOString(),
      method: 'manual-publish-single-real-private',
      privacyStatus: 'private',
      realUpload: true,
      idempotencyLocked: true,
    };

    fs.writeFileSync(slotLocksPath, JSON.stringify(locks, null, 2));
    log(`✓ slot-publication-locks.json actualizado (LOCK REAL ACTIVO)`, 'green');

    // 11. Informe final
    logSection('PUBLICACIÓN COMPLETADA');

    log(`VideoID:               ${videoId}`, 'green');
    log(`YouTube ID:            ${youtubeId}`, 'green');
    log(`Privacidad:            private`, 'green');
    log(`Publicado en:          ${new Date().toISOString()}`, 'green');
    log(`SHA256:                ${fileSHA256.substring(0, 16)}...`, 'green');
    log(`AUTO_PUBLISH_ENABLED:  false (sin cambios)`, 'green');
    log(`Sistema:               FROZEN CRITICAL (sin cambios)`, 'green');

    log(`\n✅ PUBLICACIÓN REAL CONTROLADA COMPLETADA CON ÉXITO`, 'green');

    log(`\n📺 Ver en YouTube Studio (privado):`, 'blue');
    log(`https://studio.youtube.com/video/${youtubeId}/edit`, 'blue');

    log(`\n⚠️  RECORDATORIO:`, 'yellow');
    log(`El vídeo está PRIVADO. Para hacerlo público:`, 'yellow');
    log(`1. Ve a YouTube Studio`, 'yellow');
    log(`2. Selecciona el vídeo`, 'yellow');
    log(`3. Cambia visibilidad a "Público"`, 'yellow');

    process.exit(0);
  } catch (err) {
    log(`\n❌ Error en publicación a YouTube:`, 'red');
    log(`${err.message}`, 'red');

    if (err.errors) {
      log(`\nDetalles de error:`, 'red');
      err.errors.forEach(e => {
        log(`  - ${e.message}`, 'red');
      });
    }

    process.exit(1);
  }
}

main();
