#!/usr/bin/env node

/**
 * youtube-auth-server.js
 *
 * Servidor OAuth temporal que captura el authorization code.
 * Usa el redirect_uri configurado en Google Cloud Console.
 *
 * Flujo:
 * 1. Script inicia servidor en localhost:3000
 * 2. Usuario abre URL OAuth en navegador
 * 3. Google redirige a localhost:3000/oauth/youtube/callback?code=...
 * 4. Script captura el code automáticamente
 * 5. Script intercambia code por tokens
 * 6. Actualiza .env
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const axios = require('axios');
const logger = require('../src/utils/logger');

const PORT = 3000;
const REDIRECT_URI = 'http://localhost:3000/oauth/youtube/callback';

let capturedCode = null;
let serverInstance = null;

// Crear servidor HTTP
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/oauth/youtube/callback') {
    const code = parsedUrl.query.code;
    const error = parsedUrl.query.error;

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html>
          <head><title>Error de Autorización</title></head>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1>❌ Error de Autorización</h1>
            <p><strong>Error:</strong> ${error}</p>
            <p>Por favor, intenta de nuevo.</p>
          </body>
        </html>
      `);
      return;
    }

    if (code) {
      capturedCode = code;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html>
          <head><title>✅ Autorización Exitosa</title></head>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1>✅ Autorización Completada</h1>
            <p>El código ha sido capturado automáticamente.</p>
            <p>Puedes cerrar esta ventana.</p>
            <p><small>Volviendo al script...</small></p>
          </body>
        </html>
      `);

      // Cerrar servidor después de 1 segundo
      setTimeout(() => {
        server.close();
      }, 1000);
      return;
    }
  }

  res.writeHead(404);
  res.end('Not Found');
});

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  YOUTUBE OAUTH RENEWAL (SERVER)                        ║`);
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

    // 2. Iniciar servidor
    console.log(`2️⃣  STARTING OAUTH SERVER\n`);
    console.log(`   Listening on ${REDIRECT_URI}\n`);

    serverInstance = server.listen(PORT, () => {
      console.log(`   ✅ Server ready\n`);
    });

    // 3. Generar URL OAuth
    console.log(`3️⃣  AUTHORIZATION URL\n`);

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

    console.log(`   📋 ABRE ESTA URL EN TU NAVEGADOR:\n`);
    console.log(`   ${authUrl.toString()}\n`);

    console.log(`   ✓ Google te pedirá autorización`);
    console.log(`   ✓ Haz clic en "Permitir"`);
    console.log(`   ✓ Se cerrará automáticamente\n`);

    // 4. Esperar a que capture el código
    console.log(`4️⃣  WAITING FOR AUTHORIZATION...\n`);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: no authorization received (waited 300s)'));
      }, 300000);

      const checkCode = setInterval(() => {
        if (capturedCode) {
          clearInterval(checkCode);
          clearTimeout(timeout);
          resolve();
        }
      }, 500);
    });

    console.log(`   ✅ Authorization code captured\n`);

    // 5. Intercambiar código por tokens
    console.log(`5️⃣  EXCHANGING CODE FOR TOKENS\n`);

    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      code: capturedCode,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }, {
      timeout: 15000,
    });

    const { access_token, refresh_token, expires_in, token_type } = tokenResponse.data;

    if (!refresh_token) {
      throw new Error('No refresh_token received');
    }

    console.log(`   ✅ Tokens obtained\n`);

    // 6. Mostrar nuevo token
    console.log(`════════════════════════════════════════════════════════\n`);
    console.log(`✅ NUEVO REFRESH TOKEN\n`);

    console.log(`   Type: ${token_type}`);
    console.log(`   Access Token Expires: ${expires_in}s\n`);

    console.log(`📋 REFRESH TOKEN:\n`);
    console.log(`   ${refresh_token}\n`);

    // 7. Actualizar .env
    console.log(`════════════════════════════════════════════════════════\n`);

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
    console.log(`✅ .env ACTUALIZADO\n`);
    logger.info(`OAUTH_RENEW_SUCCESS | token_updated_in_env`);

    // 8. Verificar que funciona
    console.log(`6️⃣  VALIDATING NEW TOKEN\n`);

    const verifyResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token,
      grant_type: 'refresh_token',
    }, {
      timeout: 15000,
    });

    if (verifyResponse.data?.access_token) {
      console.log(`   ✅ Token válido y funcional\n`);
      logger.info(`OAUTH_VALIDATION_PASS`);

      console.log(`════════════════════════════════════════════════════════\n`);
      console.log(`✅ YOUTUBE OAUTH RENOVADO\n`);

      console.log(`   YOUTUBE_OAUTH_VALID=true`);
      console.log(`   Token type: ${verifyResponse.data.token_type}`);
      console.log(`   Expires in: ${verifyResponse.data.expires_in}s\n`);

      console.log(`🚀 PRÓXIMO PASO:\n`);
      console.log(`   Publicar vídeo sin rerender:\n`);
      console.log(`   node scripts/retry-publish-video.js d101f12c-3658-4a35-9923-687e59351744\n`);

      process.exit(0);
    }
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`OAUTH_RENEW_FAILED | ${err.message}`);
    if (serverInstance) {
      serverInstance.close();
    }
    process.exit(1);
  }
})();
