#!/usr/bin/env node
/**
 * check-youtube-oauth.js
 * Verifica el estado del YouTube OAuth refresh token.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

async function checkYouTubeOAuth() {
  console.log(`\n${colors.blue}=== YouTube OAuth Status ===${colors.reset}\n`);

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || clientId === 'RELLENAR') {
    console.log(`${colors.red}❌ YOUTUBE_CLIENT_ID: NO CONFIGURADO${colors.reset}`);
    return false;
  }
  console.log(`${colors.green}✓ YOUTUBE_CLIENT_ID: ${clientId.substring(0, 20)}...${colors.reset}`);

  if (!refreshToken || refreshToken === 'RELLENAR') {
    console.log(`${colors.red}❌ YOUTUBE_REFRESH_TOKEN: NO CONFIGURADO${colors.reset}`);
    console.log(`\n${colors.yellow}ACCIÓN: Ve a http://localhost:3001/auth/youtube${colors.reset}`);
    return false;
  }
  console.log(`${colors.green}✓ YOUTUBE_REFRESH_TOKEN: configurado${colors.reset}`);

  console.log(`\n${colors.blue}Validando refresh token...${colors.reset}`);
  try {
    await axios.post('https://oauth2.googleapis.com/token', {
      client_id: clientId,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }, { timeout: 5000 });

    console.log(`${colors.green}✓ Token válido${colors.reset}`);
    return true;
  } catch (err) {
    const errorCode = err.response?.data?.error || 'UNKNOWN';
    console.log(`${colors.red}❌ Token inválido: ${errorCode}${colors.reset}`);

    if (errorCode === 'invalid_grant') {
      console.log(`\n${colors.yellow}SOLUCIÓN: http://localhost:3001/auth/youtube${colors.reset}`);
    }

    return false;
  }
}

checkYouTubeOAuth().then(isValid => {
  console.log(`\n`);
  process.exit(isValid ? 0 : 1);
}).catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
