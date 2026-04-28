#!/usr/bin/env node

/**
 * youtube-auth-renew-simple.js
 *
 * Versión simplificada sin redirect_uri complicada.
 * Genera URL OAuth y maneja el código manualmente.
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readline = require('readline');
const logger = require('../src/utils/logger');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  YOUTUBE OAUTH RENEWAL (SIMPLE)                        ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

(async () => {
  try {
    // 1. Verificar credenciales
    console.log(`1️⃣  CHECKING CREDENTIALS\n`);

    if (!process.env.YOUTUBE_CLIENT_ID) {
      throw new Error('YOUTUBE_CLIENT_ID not configured');
    }
    if (!process.env.YOUTUBE_CLIENT_SECRET) {
      throw new Error('YOUTUBE_CLIENT_SECRET not configured');
    }

    console.log(`   ✅ CLIENT_ID configured`);
    console.log(`   ✅ CLIENT_SECRET configured\n`);

    // 2. Generar URL OAuth con redirect_uri estándar
    console.log(`2️⃣  AUTHORIZATION URL\n`);

    // Usar urn:ietf:wg:oauth:2.0:oob (out-of-band) para código manual
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', process.env.YOUTUBE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', 'urn:ietf:wg:oauth:2.0:oob');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
    ].join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    console.log(`   📋 PASO 1: Copia esta URL en tu navegador\n`);
    console.log(`   ${authUrl.toString()}\n`);

    console.log(`   📋 PASO 2: Google te pedirá que autorices\n`);
    console.log(`      ✓ Elige tu cuenta de Google`);
    console.log(`      ✓ Haz clic en "Permitir" cuando pida permisos\n`);

    console.log(`   📋 PASO 3: Google te mostrará un código\n`);
    console.log(`      (Si usas navegador de escritorio: verás el código en la página)`);
    console.log(`      (Si la URL no funciona: intenta con otro navegador)\n`);

    // 3. Pedir código
    const authCode = await question(`   Pega aquí el authorization code: `);

    if (!authCode || authCode.length < 10) {
      throw new Error('Invalid authorization code (too short)');
    }

    console.log(`\n   ✅ Código recibido (${authCode.length} caracteres)\n`);

    // 4. Intercambiar código por tokens
    console.log(`3️⃣  EXCHANGING CODE FOR TOKENS\n`);
    console.log(`   POST oauth2.googleapis.com/token\n`);

    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      code: authCode,
      grant_type: 'authorization_code',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    }, {
      timeout: 15000,
    });

    const { access_token, refresh_token, expires_in, token_type } = tokenResponse.data;

    if (!refresh_token) {
      throw new Error('No refresh_token received');
    }

    console.log(`   ✅ Tokens obtenidos\n`);

    // 5. Mostrar nuevo token
    console.log(`════════════════════════════════════════════════════════\n`);
    console.log(`✅ NUEVO REFRESH TOKEN\n`);

    console.log(`   Type: ${token_type}`);
    console.log(`   Access Token Expires: ${expires_in}s\n`);

    console.log(`📋 REFRESH TOKEN:\n`);
    console.log(`   ${refresh_token}\n`);

    // 6. Actualizar .env
    console.log(`════════════════════════════════════════════════════════\n`);
    const updateEnv = await question(`Actualizar .env automáticamente? (s/n): `);

    if (updateEnv.toLowerCase() === 's' || updateEnv.toLowerCase() === 'y') {
      const envPath = path.resolve('.env');
      let envContent = fs.readFileSync(envPath, 'utf8');

      if (envContent.includes('YOUTUBE_REFRESH_TOKEN=')) {
        envContent = envContent.replace(
          /^YOUTUBE_REFRESH_TOKEN=.*/m,
          `YOUTUBE_REFRESH_TOKEN=${refresh_token}`
        );
      } else {
        envContent += `\nYOUTUBE_REFRESH_TOKEN=${refresh_token}\n`;
      }

      fs.writeFileSync(envPath, envContent, 'utf8');
      console.log(`\n✅ .env actualizado con nuevo REFRESH_TOKEN\n`);
      logger.info(`OAUTH_RENEW_SUCCESS | token_updated_in_env`);

      // 7. Verificar que funciona
      console.log(`4️⃣  VERIFICANDO TOKEN\n`);

      try {
        const verifyResponse = await axios.post('https://oauth2.googleapis.com/token', {
          client_id: process.env.YOUTUBE_CLIENT_ID,
          client_secret: process.env.YOUTUBE_CLIENT_SECRET,
          refresh_token,
          grant_type: 'refresh_token',
        }, {
          timeout: 15000,
        });

        if (verifyResponse.data?.access_token) {
          console.log(`   ✅ Token válido\n`);
          logger.info(`OAUTH_VALIDATION_PASS`);

          console.log(`════════════════════════════════════════════════════════\n`);
          console.log(`✅ TODO LISTO\n`);
          console.log(`   YOUTUBE_OAUTH_VALID=true\n`);

          console.log(`🚀 PRÓXIMO PASO:\n`);
          console.log(`   node scripts/retry-publish-video.js d101f12c-3658-4a35-9923-687e59351744\n`);

          rl.close();
          process.exit(0);
        }
      } catch (err) {
        throw new Error(`Token verification failed: ${err.message}`);
      }
    } else {
      console.log(`\n⚠️  .env NO actualizado\n`);
      console.log(`   Actualiza manualmente:\n`);
      console.log(`   YOUTUBE_REFRESH_TOKEN=${refresh_token}\n`);
      rl.close();
      process.exit(0);
    }
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`OAUTH_RENEW_FAILED | ${err.message}`);
    rl.close();
    process.exit(1);
  }
})();
