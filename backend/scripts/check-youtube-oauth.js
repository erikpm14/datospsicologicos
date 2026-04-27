#!/usr/bin/env node

/**
 * check-youtube-oauth.js
 *
 * Valida que el YOUTUBE_REFRESH_TOKEN sea válido.
 * No intenta publicar nada, solo verifica credenciales.
 *
 * Uso: node scripts/check-youtube-oauth.js
 */

require('dotenv').config({ path: '.env' });

const axios = require('axios');
const logger = require('../src/utils/logger');

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  YOUTUBE OAUTH VALIDATION                             ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

(async () => {
  try {
    // 1. Verificar variables de entorno
    console.log(`1️⃣  CHECKING CONFIGURATION\n`);

    const required = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      console.error(`\n❌ MISSING ENVIRONMENT VARIABLES\n`);
      for (const key of missing) {
        console.error(`   ${key}`);
      }
      console.error(`\n   Add them to .env file\n`);
      logger.error(`YOUTUBE_OAUTH_CHECK_FAILED | missing_vars=${missing.join(',')}`);
      process.exit(1);
    }

    console.log(`   ✅ YOUTUBE_CLIENT_ID configured`);
    console.log(`   ✅ YOUTUBE_CLIENT_SECRET configured`);
    console.log(`   ✅ YOUTUBE_REFRESH_TOKEN configured\n`);

    // 2. Probar refresh token
    console.log(`2️⃣  TESTING REFRESH TOKEN\n`);
    console.log(`   POST https://oauth2.googleapis.com/token`);
    console.log(`   grant_type: refresh_token\n`);

    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }, {
      timeout: 15000,
    });

    if (!response.data?.access_token) {
      throw new Error('No access_token in response');
    }

    console.log(`   ✅ Access token obtained\n`);

    // 3. Resultado
    console.log(`════════════════════════════════════════════════════════\n`);
    console.log(`✅ YOUTUBE OAUTH VALID\n`);

    console.log(`   YOUTUBE_OAUTH_VALID=true`);
    console.log(`   token_type=${response.data.token_type}`);
    console.log(`   expires_in=${response.data.expires_in}s`);
    console.log(`   scope=${response.data.scope}\n`);

    logger.info(`YOUTUBE_OAUTH_CHECK_PASS | expires_in=${response.data.expires_in}`);

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ YOUTUBE OAUTH INVALID\n`);

    const errorCode = err.response?.data?.error;
    const errorDesc = err.response?.data?.error_description;

    if (errorCode === 'invalid_grant') {
      console.error(`   Error: ${errorCode}`);
      console.error(`   ${errorDesc}\n`);
      console.error(`   The refresh token has expired or is invalid.\n`);
      console.error(`⚠️  ACTION REQUIRED:\n`);
      console.error(`   Run: node scripts/youtube-auth-renew.js\n`);
    } else {
      console.error(`   Error: ${errorCode || err.message}`);
      console.error(`   ${errorDesc || ''}\n`);
    }

    logger.error(`YOUTUBE_OAUTH_CHECK_FAILED | error=${errorCode || err.message}`);

    console.log(`   YOUTUBE_OAUTH_VALID=false`);
    console.log(`   reason=${errorCode || err.message}\n`);

    process.exit(1);
  }
})();
