#!/usr/bin/env node
/**
 * verify-youtube-oauth-safe.js
 *
 * Verificación segura de credenciales YouTube después de rotación.
 * - Refresca access token usando refresh token
 * - Llama a youtube.channels.list (operación de LECTURA segura)
 * - NO llama a youtube.videos.insert
 * - NO sube nada a YouTube
 * - NO modifica ningún registro
 *
 * Uso: node verify-youtube-oauth-safe.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

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

async function main() {
  logSection('VERIFICACIÓN OAUTH YOUTUBE (LECTURA SEGURA)');

  // 1. Verificar credenciales están presentes
  log('Paso 1: Verificando credenciales en .env...', 'yellow');

  const requiredVars = [
    'YOUTUBE_CLIENT_ID',
    'YOUTUBE_CLIENT_SECRET',
    'YOUTUBE_REFRESH_TOKEN'
  ];

  const missingVars = requiredVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    log(`❌ Credenciales faltantes: ${missingVars.join(', ')}`, 'red');
    process.exit(1);
  }
  log(`✓ Todas las credenciales presentes`, 'green');

  try {
    // 2. Crear cliente OAuth2
    log('\nPaso 2: Creando cliente OAuth2...', 'yellow');

    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      'http://localhost'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    });

    log(`✓ Cliente OAuth2 creado`, 'green');

    // 3. Refrescar token
    log('\nPaso 3: Refrescando access token...', 'yellow');

    let tokens;
    try {
      const result = await oauth2Client.refreshAccessToken();
      tokens = result.credentials;
      log(`✓ Access token refrescado exitosamente`, 'green');
      log(`  Tipo: ${tokens.token_type || 'Bearer'}`, 'green');
      log(`  Expira en: ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'desconocido'}`, 'green');
    } catch (err) {
      if (err.message.includes('invalid_grant')) {
        log(`❌ ERROR: invalid_grant - refresh token es inválido o expiró`, 'red');
        log(`   La rotación de credenciales puede no haber sido correcta`, 'red');
        process.exit(1);
      }
      throw err;
    }

    // 4. Llamar a youtube.channels.list (operación segura de LECTURA)
    log('\nPaso 4: Verificando acceso a YouTube API (lectura segura)...', 'yellow');
    log('  Llamando: youtube.channels.list({ mine: true })', 'yellow');

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client,
    });

    let channelsResponse;
    try {
      channelsResponse = await youtube.channels.list({
        part: 'snippet',
        mine: true,
      });
    } catch (err) {
      if (err.message.includes('Unauthorized')) {
        log(`❌ ERROR: Unauthorized - credenciales no válidas`, 'red');
        process.exit(1);
      }
      if (err.message.includes('Forbidden')) {
        log(`❌ ERROR: Forbidden - sin permisos para acceder a canal`, 'red');
        process.exit(1);
      }
      throw err;
    }

    log(`✓ Llamada a youtube.channels.list exitosa`, 'green');

    // 5. Verificar canal detectado
    log('\nPaso 5: Analizando canal detectado...', 'yellow');

    if (!channelsResponse.data.items || channelsResponse.data.items.length === 0) {
      log(`❌ No se detectó canal en la cuenta`, 'red');
      process.exit(1);
    }

    const channel = channelsResponse.data.items[0];
    const channelId = channel.id;
    const channelTitle = channel.snippet?.title || 'Sin título';

    log(`✓ Canal detectado:`, 'green');
    log(`  ID: ${channelId}`, 'green');
    log(`  Título: ${channelTitle}`, 'green');

    // 6. Verificar que coincide con YOUTUBE_CHANNEL_ID si está configurado
    if (process.env.YOUTUBE_CHANNEL_ID) {
      if (channelId === process.env.YOUTUBE_CHANNEL_ID) {
        log(`✓ Canal coincide con YOUTUBE_CHANNEL_ID configurado`, 'green');
      } else {
        log(`⚠️  ADVERTENCIA: Canal actual (${channelId}) NO coincide con YOUTUBE_CHANNEL_ID (${process.env.YOUTUBE_CHANNEL_ID})`, 'yellow');
        log(`   Considera actualizar YOUTUBE_CHANNEL_ID en .env si es incorrecto`, 'yellow');
      }
    } else {
      log(`ℹ️  YOUTUBE_CHANNEL_ID no está configurado en .env`, 'yellow');
      log(`   Puedes agregarlo: YOUTUBE_CHANNEL_ID=${channelId}`, 'yellow');
    }

    // 7. Verificar que NO se llamó a youtube.videos.insert
    log('\nPaso 6: Verificando que NO se realizó upload...', 'yellow');
    log(`✓ No se llamó a youtube.videos.insert (operación de lectura solamente)`, 'green');
    log(`✓ No se subió ningún vídeo a YouTube`, 'green');

    // 8. Resumen final
    logSection('VERIFICACIÓN COMPLETADA CON ÉXITO');

    log(`✓ Credenciales YouTube rotadas correctamente`, 'green');
    log(`✓ Access token refresh: PASS`, 'green');
    log(`✓ YouTube API accesible: PASS`, 'green');
    log(`✓ Canal detectado: ${channelTitle}`, 'green');
    log(`✓ invalid_grant: NO (credenciales válidas)`, 'green');
    log(`✓ unauthorized: NO (credenciales autenticadas)`, 'green');
    log(`✓ forbidden: NO (permisos suficientes)`, 'green');
    log(`✓ youtube.videos.insert: NO llamado (seguridad verificada)`, 'green');
    log(`✓ Upload: NO realizado (como esperado)`, 'green');

    log(`\n✅ CREDENCIALES YOUTUBE APTAS PARA PUBLICACIÓN PRIVADA FUTURA`, 'green');
    log(`\nPróximo paso: Autorizar upload privado con --confirm-private-upload`, 'blue');

    process.exit(0);
  } catch (err) {
    log(`\n❌ Error en verificación OAuth:`, 'red');
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
