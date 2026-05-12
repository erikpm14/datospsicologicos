#!/usr/bin/env node

/**
 * check-slot-result-20260511-1430.js
 *
 * Script POST-SLOT de verificación (SOLO LECTURA)
 * Ejecutar después de 2026-05-11 14:40
 *
 * Uso:
 *   node scripts/check-slot-result-20260511-1430.js
 *   node scripts/check-slot-result-20260511-1430.js --verbose
 *
 * NO modifica estado, no publica, no reinicia procesos.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SLOT_DATE = '2026-05-11';
const SLOT_TIME = '14:30';
const SLOT_WINDOW_START = 14 * 60 + 25; // 14:25 en minutos
const SLOT_WINDOW_END = 14 * 60 + 40;   // 14:40 en minutos

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');
const DATA_DIR = path.resolve('./data');
const LOGS_DIR = path.resolve('./logs');

const PRINCIPAL_ID = '9e3208ce-04d9-47b1-9b7a-d3c2b7025867';
const BACKUP_ID = '2b260bb2-0a8c-4ac6-ad54-14ba64ceae4e';

const verbose = process.argv.includes('--verbose');

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function hasPublished(videoId) {
  const publishedPath = path.join(OUTPUT_DIR, videoId, 'published.json');
  return fs.existsSync(publishedPath);
}

function getPublishedData(videoId) {
  const publishedPath = path.join(OUTPUT_DIR, videoId, 'published.json');
  if (fs.existsSync(publishedPath)) {
    return readJSON(publishedPath);
  }
  return null;
}

function getGenerationMetadata(videoId) {
  const metaPath = path.join(OUTPUT_DIR, videoId, 'generation-metadata.json');
  return readJSON(metaPath);
}

function slotAlreadyOccurred() {
  const now = new Date();

  // Parsing para fecha y hora
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Verificar fecha
  if (dateStr < SLOT_DATE) return false;
  if (dateStr === SLOT_DATE) {
    // Mismo día - verificar hora
    const slotMinutes = 14 * 60 + 30;
    return currentMinutes > slotMinutes;
  }
  // dateStr > SLOT_DATE
  return true;
}

function searchLogsForPattern(logFile, pattern, lines = 100) {
  try {
    if (!fs.existsSync(logFile)) return [];
    const content = fs.readFileSync(logFile, 'utf8');
    const allLines = content.split('\n');
    const matches = [];

    for (const line of allLines) {
      if (pattern.test ? pattern.test(line) : line.includes(pattern)) {
        matches.push(line);
      }
    }

    return matches.slice(-lines);
  } catch (err) {
    return [];
  }
}

// ─────────────────────────────────────────────
// MAIN VERIFICATION
// ─────────────────────────────────────────────

function runVerification() {
  console.log('\n' + '═'.repeat(80));
  console.log('VERIFICACIÓN POST-SLOT 2026-05-11 14:30 Europe/Madrid');
  console.log('═'.repeat(80) + '\n');

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  console.log(`Hora de ejecución: ${dateStr} ${timeStr} (UTC+2 Madrid)`);
  console.log('');

  // ─────────────────────────────────────────────
  // 1. VERIFICAR SI EL SLOT YA OCURRIÓ
  // ─────────────────────────────────────────────

  const slotOccurred = slotAlreadyOccurred();

  if (!slotOccurred) {
    console.log('⚠️  ESTADO PRE-SLOT');
    console.log('El slot 2026-05-11 14:30 aún NO ha ocurrido.');
    console.log('Ejecutar este script DESPUÉS de las 14:40.');
    console.log('');
    console.log('Sistema está ARMADO y listo. Próxima ejecución: ' + SLOT_DATE + ' ' + SLOT_TIME);
    process.exit(0);
  }

  console.log('✓ Slot ya ocurrió. Verificando resultado...\n');

  // ─────────────────────────────────────────────
  // 2. CARGAR ESTADO PERSISTENTE
  // ─────────────────────────────────────────────

  const publishLog = readJSON(path.join(DATA_DIR, 'publish-log.json')) || { published: [] };
  const publishFreeze = readJSON(path.join(DATA_DIR, 'publication-freeze.json'));
  const slotLockState = readJSON(path.join(DATA_DIR, 'slot-lock-state.json'));

  const principalPublished = hasPublished(PRINCIPAL_ID);
  const backupPublished = hasPublished(BACKUP_ID);
  const principalData = getPublishedData(PRINCIPAL_ID);
  const backupData = getPublishedData(BACKUP_ID);

  // ─────────────────────────────────────────────
  // 3. DETECTAR RESULTADO
  // ─────────────────────────────────────────────

  let publishedVideo = null;
  let youtubeId = null;
  let usedPrincipal = false;
  let usedBackup = false;
  let usedFallback = false;
  let slotFailed = false;

  if (principalPublished) {
    publishedVideo = PRINCIPAL_ID;
    youtubeId = principalData?.youtubeId;
    usedPrincipal = true;
  } else if (backupPublished) {
    publishedVideo = BACKUP_ID;
    youtubeId = backupData?.youtubeId;
    usedBackup = true;
  } else {
    // Verificar si hay entrada nueva en publish-log desde el slot
    const newEntry = publishLog.published.find(entry => {
      if (!entry.publishedAt) return false;
      const pubDate = new Date(entry.publishedAt);
      const slotDate = new Date(`${SLOT_DATE}T${SLOT_TIME}:00Z`);
      return Math.abs(pubDate - slotDate) < 30 * 60 * 1000; // Dentro de 30 min del slot
    });

    if (newEntry) {
      publishedVideo = newEntry.videoId;
      youtubeId = newEntry.youtubeId;
      if (newEntry.videoId === PRINCIPAL_ID) usedPrincipal = true;
      if (newEntry.videoId === BACKUP_ID) usedBackup = true;
      // Si no es principal ni backup, es fallback
      if (newEntry.videoId !== PRINCIPAL_ID && newEntry.videoId !== BACKUP_ID) {
        usedFallback = true;
      }
    } else {
      slotFailed = true;
    }
  }

  // ─────────────────────────────────────────────
  // 4. ANALIZAR LOGS
  // ─────────────────────────────────────────────

  const errorLogPath = path.join(LOGS_DIR, 'error.log');
  const combinedLogPath = path.join(LOGS_DIR, 'combined.log');

  const slotDateRegex = /2026-05-11/;
  const errorLogs = searchLogsForPattern(errorLogPath, slotDateRegex, 200);

  let check19Executed = false;
  let check19Passed = false;
  let check19Failed = false;
  let publishGuardPassed = false;
  let publishGuardFailed = false;
  let duplicateCheckPassed = false;
  let duplicateCheckFailed = false;
  let oauthFailed = false;
  let oauthError = '';
  let avDurationMismatch = false;
  let slotLostFinal = false;
  let fallbackUsed = false;
  let noValidCandidates = false;

  for (const line of errorLogs) {
    if (line.includes('[CHECK_19]') || line.includes('AV sync PASS') || line.includes('AV_DURATION_SYNC')) {
      check19Executed = true;
      if (line.includes('PASS')) {
        check19Passed = true;
      }
      if (line.includes('FAIL') || line.includes('MISMATCH')) {
        check19Failed = true;
      }
    }

    if (line.includes('[PUBLISH_BLOCKED_READY_VALIDATION_FAILED]')) {
      publishGuardFailed = true;
    } else if (line.includes('guardAllowed')) {
      publishGuardPassed = true;
    }

    if (line.includes('DUPLICATE_HARD_BLOCK') || line.includes('duplicate.*hard')) {
      duplicateCheckFailed = true;
    } else if (line.includes('PASS') && line.includes('duplicate')) {
      duplicateCheckPassed = true;
    }

    if (line.includes('YOUTUBE_OAUTH') || line.includes('OAuth')) {
      if (line.includes('FAILED') || line.includes('ERROR')) {
        oauthFailed = true;
        oauthError = line;
      }
    }

    if (line.includes('invalid_grant')) {
      oauthError = 'invalid_grant - token expired or invalid';
    }

    if (line.includes('AV_DURATION_MISMATCH')) {
      avDurationMismatch = true;
    }

    if (line.includes('SLOT_LOST') && line.includes('FINAL')) {
      slotLostFinal = true;
    }

    if (line.includes('FALLBACK_PUBLISH')) {
      fallbackUsed = true;
    }

    if (line.includes('no_valid_candidates') || line.includes('NO_VALID_CANDIDATES')) {
      noValidCandidates = true;
    }
  }

  // ─────────────────────────────────────────────
  // 5. GENERAR INFORME
  // ─────────────────────────────────────────────

  console.log('\n' + '─'.repeat(80));
  console.log('RESULTADO SLOT 2026-05-11 14:30');
  console.log('─'.repeat(80) + '\n');

  console.log(`Estado:                    ${slotFailed ? '❌ FALLO - No publicado' : '✅ ÉXITO - Publicado'}`);
  console.log(`Vídeo publicado:           ${publishedVideo || '(ninguno)'}`);
  console.log(`YouTube ID:                ${youtubeId || '(no disponible)'}`);
  console.log(`Principal usado:           ${usedPrincipal ? '✓ SÍ' : '✗ NO'}`);
  console.log(`Backup usado:              ${usedBackup ? '✓ SÍ' : '✗ NO'}`);
  console.log(`Fallback usado:            ${usedFallback || fallbackUsed ? '✓ SÍ' : '✗ NO'}`);
  console.log('');

  console.log('─ CHECK 19 AV_DURATION_SYNC:');
  console.log(`  Ejecutado:               ${check19Executed ? '✓ SÍ' : '✗ NO'}`);
  console.log(`  Resultado:               ${check19Passed ? '✓ PASS' : check19Failed ? '✗ FAIL' : '? DESCONOCIDO'}`);
  console.log('');

  console.log('─ Publish Guard:');
  console.log(`  Pasó:                    ${publishGuardPassed ? '✓ SÍ' : publishGuardFailed ? '✗ BLOQUEADO' : '? DESCONOCIDO'}`);
  console.log('');

  console.log('─ Duplicate Hard Block:');
  console.log(`  Pasó:                    ${duplicateCheckPassed ? '✓ SÍ' : duplicateCheckFailed ? '✗ BLOQUEADO' : '? DESCONOCIDO'}`);
  console.log('');

  console.log('─ YouTube OAuth:');
  console.log(`  Error:                   ${oauthFailed ? `✗ SÍ - ${oauthError}` : '✓ NO'}`);
  console.log('');

  console.log('─ Errores detectados:');
  console.log(`  AV_DURATION_MISMATCH:    ${avDurationMismatch ? '✗ SÍ' : '✓ NO'}`);
  console.log(`  SLOT_LOST_FINAL:         ${slotLostFinal ? '✗ SÍ' : '✓ NO'}`);
  console.log(`  NO_VALID_CANDIDATES:     ${noValidCandidates ? '✗ SÍ' : '✓ NO'}`);
  console.log('');

  console.log('─ Estado final:');
  console.log(`  Freeze status:           ${publishFreeze?.status || '? desconocido'}`);
  console.log(`  AUTO_PUBLISH_ENABLED:    ${process.env.AUTO_PUBLISH_ENABLED || '? desconocido'}`);
  console.log(`  Próximo slot calculado:  ${slotLockState?.nearestSlot ? `${slotLockState.nearestSlot.date} ${slotLockState.nearestSlot.time}` : '? desconocido'}`);
  console.log('');

  // ─────────────────────────────────────────────
  // 6. RECOMENDACIONES
  // ─────────────────────────────────────────────

  console.log('─'.repeat(80));
  console.log('ACCIÓN RECOMENDADA:');
  console.log('─'.repeat(80) + '\n');

  if (!slotFailed && youtubeId) {
    console.log('✅ PUBLICACIÓN EXITOSA');
    console.log('');
    console.log(`Video ${publishedVideo} publicado como: https://www.youtube.com/shorts/${youtubeId}`);
    console.log('');
    console.log('Próximas acciones:');
    console.log('1. ✓ Confirmar que no hay doble-publicación');
    console.log('2. ✓ Verificar que published.json existe');
    console.log('3. ✓ Verificar entrada en publish-log.json');
    console.log('4. ✓ Documentar el éxito');
    console.log('5. ✓ Sistema continúa ARMADO para próximo slot 21:15');
  } else if (slotFailed) {
    console.log('❌ PUBLICACIÓN FALLIDA');
    console.log('');
    console.log('NO se publicó vídeo en este slot.');
    console.log('');
    console.log('Causa posible:');
    if (check19Failed) {
      console.log('  • CHECK 19 AV_DURATION_SYNC falló en ambos candidatos');
    }
    if (publishGuardFailed) {
      console.log('  • Publish Guard bloqueó ambos candidatos');
    }
    if (oauthFailed) {
      console.log('  • YouTube OAuth falló (verificar token)');
    }
    if (noValidCandidates) {
      console.log('  • No había vídeos READY válidos');
    }
    if (slotLostFinal) {
      console.log('  • Sistema perdió el slot por deadlock o timeout');
    }
    console.log('');
    console.log('Próximas acciones:');
    console.log('1. ⚠️  NO ejecutar late-recovery automático');
    console.log('2. ⚠️  Contactar a operador para análisis');
    console.log('3. ⚠️  Revisar logs detallados: logs/error.log');
    console.log('4. ⚠️  Sistema sigue ARMADO para próximo slot 21:15');
    console.log('5. ℹ️  Late-recovery disponible dentro 24h si es necesario');
  } else {
    console.log('⚠️  ESTADO INDETERMINADO');
    console.log('');
    console.log('No se pudo determinar si la publicación fue exitosa.');
    console.log('Revisar logs manualmente en: logs/error.log');
    console.log('Revisar publish-log.json para ver entrada más reciente.');
  }

  console.log('\n' + '═'.repeat(80));
  console.log(`Verificación completada: ${new Date().toISOString()}`);
  console.log('═'.repeat(80) + '\n');

  // ─────────────────────────────────────────────
  // 7. VERBOSE MODE
  // ─────────────────────────────────────────────

  if (verbose) {
    console.log('\n' + '═'.repeat(80));
    console.log('MODO VERBOSE - LOGS COMPLETOS');
    console.log('═'.repeat(80) + '\n');

    console.log('─ Últimas líneas del error.log (del slot):');
    console.log('');
    for (const line of errorLogs.slice(-20)) {
      console.log(line);
    }

    console.log('\n─ Publicaciones registradas (últimas 3):');
    console.log('');
    for (const entry of publishLog.published.slice(-3)) {
      console.log(`  ${entry.videoId.substring(0, 8)}... -> ${entry.youtubeId} (${entry.publishedAt})`);
    }

    console.log('\n─ Principal metadata:');
    const principalMeta = getGenerationMetadata(PRINCIPAL_ID);
    console.log(`  qcPassed: ${principalMeta?.qcPassed}`);
    console.log(`  avSyncValid: (revisar validator.service para checks.avSyncValid)`);

    console.log('\n─ Backup metadata:');
    const backupMeta = getGenerationMetadata(BACKUP_ID);
    console.log(`  qcPassed: ${backupMeta?.qcPassed}`);
    console.log(`  avSyncValid: (revisar validator.service para checks.avSyncValid)`);
  }
}

// ─────────────────────────────────────────────
// EJECUCIÓN
// ─────────────────────────────────────────────

try {
  runVerification();
} catch (err) {
  console.error('Error durante verificación:', err.message);
  if (verbose) console.error(err.stack);
  process.exit(1);
}
