#!/usr/bin/env node

/**
 * youtube-auth-renew.js
 *
 * Flujo OAuth completo para renovar YOUTUBE_REFRESH_TOKEN.
 *
 * Pasos:
 * 1. Generar URL de autorización
 * 2. Usuario abre URL y autoriza
 * 3. Pega el authorization code aquí
 * 4. Script intercambia code por tokens
 * 5. Imprime nuevo REFRESH_TOKEN para actualizar .env
 *
 * Uso: node scripts/youtube-auth-renew.js
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readline = require('readline');
const logger = require('../src/utils/logger');

const REDIRECT_URI = 'http://localhost:3000/oauth/youtube/callback';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  YOUTUBE OAUTH RENEWAL                                 ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

(async () => {
  try {
    // 1. Verificar CLIENT_ID y SECRET
    console.log(`1️⃣  CHECKING CREDENTIALS\n`);

    if (!process.env.YOUTUBE_CLIENT_ID) {
      throw new Error('YOUTUBE_CLIENT_ID not configured in .env');
    }
    if (!process.env.YOUTUBE_CLIENT_SECRET) {
      throw new Error('YOUTUBE_CLIENT_SECRET not configured in .env');
    }

    console.log(`   ✅ CLIENT_ID: ${process.env.YOUTUBE_CLIENT_ID.slice(0, 20)}...`);
    console.log(`   ✅ CLIENT_SECRET: ${process.env.YOUTUBE_CLIENT_SECRET.slice(0, 20)}...\n`);

    // 2. Generar URL de autorización
    console.log(`2️⃣  GENERATING AUTHORIZATION URL\n`);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', process.env.YOUTUBE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
    ].join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    console.log(`   Open this URL in your browser:\n`);
    console.log(`   ${authUrl.toString()}\n`);

    console.log(`   After authorizing, you'll be redirected to a URL like:`);
    console.log(`   http://localhost:3000/oauth/youtube/callback?code=<AUTHORIZATION_CODE>&...\n`);

    // 3. Pedir authorization code
    console.log(`3️⃣  PASTE AUTHORIZATION CODE\n`);

    const authCode = await question(`   Enter authorization code: `);

    if (!authCode || authCode.length < 10) {
      throw new Error('Invalid authorization code');
    }

    console.log(`\n   ✅ Code received\n`);

    // 4. Intercambiar code por tokens
    console.log(`4️⃣  EXCHANGING CODE FOR TOKENS\n`);
    console.log(`   POST https://oauth2.googleapis.com/token\n`);

    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      code: authCode,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }, {
      timeout: 15000,
    });

    const { access_token, refresh_token, expires_in, token_type } = tokenResponse.data;

    if (!refresh_token) {
      throw new Error('No refresh_token in response — did you use offline access?');
    }

    console.log(`   ✅ Tokens obtained\n`);

    // 5. Mostrar nuevo token
    console.log(`════════════════════════════════════════════════════════\n`);
    console.log(`✅ NEW REFRESH TOKEN\n`);

    console.log(`   Type: ${token_type}`);
    console.log(`   Access Token Expires: ${expires_in}s\n`);

    console.log(`📋 REFRESH TOKEN:\n`);
    console.log(`   ${refresh_token}\n`);

    console.log(`════════════════════════════════════════════════════════\n`);

    console.log(`⚠️  IMPORTANT:\n\n`);
    console.log(`1️⃣  Update your .env file:\n`);
    console.log(`   YOUTUBE_REFRESH_TOKEN=${refresh_token}\n\n`);

    console.log(`2️⃣  Or run this command to update automatically:\n`);
    console.log(`   npm run youtube:update-token -- ${refresh_token}\n\n`);

    console.log(`3️⃣  Verify the token works:\n`);
    console.log(`   node scripts/check-youtube-oauth.js\n\n`);

    console.log(`4️⃣  Retry publishing the blocked video:\n`);
    console.log(`   node scripts/retry-publish-video.js d101f12c-3658-4a35-9923-687e59351744\n`);

    // Log éxito
    logger.info(`YOUTUBE_AUTH_RENEW_SUCCESS | refresh_token_obtained`);

    // Ofrecer actualizar .env automáticamente
    console.log(`════════════════════════════════════════════════════════\n`);
    const updateEnv = await question(`\nUpdate .env file automatically? (y/n): `);

    if (updateEnv.toLowerCase() === 'y') {
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
      console.log(`\n✅ .env updated with new REFRESH_TOKEN\n`);
      logger.info(`YOUTUBE_ENV_UPDATED | refresh_token_written_to_env`);
    } else {
      console.log(`\n⚠️  .env NOT updated — do it manually\n`);
    }

    rl.close();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`YOUTUBE_AUTH_RENEW_FAILED | ${err.message}`);
    rl.close();
    process.exit(1);
  }
})();
