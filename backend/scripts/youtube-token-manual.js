#!/usr/bin/env node

/**
 * youtube-token-manual.js
 *
 * Genera REFRESH_TOKEN manualmente usando Google OAuth.
 * Método: User Agent flow (sin redirect_uri complicado)
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
console.log(`║  YOUTUBE TOKEN MANUAL (Sin redirect_uri)              ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

(async () => {
  try {
    console.log(`📋 INSTRUCCIONES\n`);
    console.log(`Este método genera el token sin necesidad de redirect_uri.\n`);

    console.log(`1️⃣  OBTÉN TU CODE DE GOOGLE\n`);
    console.log(`   Abre esta URL en tu navegador:\n`);

    // Generar authorization URL
    const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
    if (!CLIENT_ID) {
      throw new Error('YOUTUBE_CLIENT_ID not configured');
    }

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&scope=https://www.googleapis.com/auth/youtube.upload%20https://www.googleapis.com/auth/youtube&response_type=code&redirect_uri=urn:ietf:wg:oauth:2.0:oob&access_type=offline&prompt=consent`;

    console.log(`   ${authUrl}\n`);

    console.log(`   ✓ Haz login con tu cuenta de Google`);
    console.log(`   ✓ Autoriza el acceso a YouTube`);
    console.log(`   ✓ Google te dará un código (puedes verlo en la página o en la URL)\n`);

    // Pedir código
    const authCode = await question(`2️⃣  PEGA EL CÓDIGO AQUÍ: `);

    if (!authCode || authCode.length < 10) {
      throw new Error('Invalid code (too short)');
    }

    console.log(`\n   ✅ Código recibido\n`);

    // Intercambiar por refresh_token
    console.log(`3️⃣  OBTENIENDO TOKENS\n`);

    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      code: authCode,
      grant_type: 'authorization_code',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    if (!refresh_token) {
      throw new Error('No refresh_token en respuesta');
    }

    console.log(`   ✅ Tokens obtenidos\n`);

    // Actualizar .env
    console.log(`4️⃣  ACTUALIZAR .env\n`);

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

    console.log(`   ✅ .env actualizado\n`);

    // Verificar
    console.log(`════════════════════════════════════════════════════════\n`);
    console.log(`✅ YOUTUBE OAUTH RENOVADO\n`);
    console.log(`   Type: Bearer`);
    console.log(`   Expires in: ${expires_in}s\n`);

    console.log(`🚀 PRÓXIMO PASO:\n`);
    console.log(`   node scripts/retry-publish-video.js d101f12c-3658-4a35-9923-687e59351744\n`);

    logger.info(`OAUTH_MANUAL_SUCCESS`);
    rl.close();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`OAUTH_MANUAL_FAILED | ${err.message}`);
    rl.close();
    process.exit(1);
  }
})();
