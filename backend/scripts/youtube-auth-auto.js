#!/usr/bin/env node

/**
 * youtube-auth-auto.js
 *
 * Abre automáticamente el navegador para autorización OAuth.
 * Muy simple: genera la URL, abre navegador, captura código.
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const axios = require('axios');
const { exec } = require('child_process');
const logger = require('../src/utils/logger');

const PORT = 3000;
const REDIRECT_URI = 'http://localhost:3000/oauth/youtube/callback';

let capturedCode = null;
let server = null;

// Crear servidor
const httpServer = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/oauth/youtube/callback') {
    const code = parsedUrl.query.code;

    if (code) {
      capturedCode = code;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="text-align:center;padding:40px"><h1>✅ ¡Éxito!</h1><p>Puedes cerrar esta ventana.</p></body></html>`);
      setTimeout(() => httpServer.close(), 500);
      return;
    }
  }

  res.writeHead(404);
  res.end('Not Found');
});

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  YOUTUBE OAUTH (AUTO-BROWSER)                          ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

(async () => {
  try {
    console.log(`1️⃣  CHECKING CREDENTIALS\n`);

    if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
      throw new Error('Missing credentials');
    }

    console.log(`   ✅ Credentials OK\n`);

    // Generar URL sin espacios
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.YOUTUBE_CLIENT_ID}&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Foauth%2Fyoutube%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.upload%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube&access_type=offline&prompt=consent`;

    console.log(`2️⃣  STARTING SERVER\n`);

    server = httpServer.listen(PORT, () => {
      console.log(`   ✅ Server listening on localhost:3000\n`);

      console.log(`3️⃣  OPENING BROWSER\n`);
      console.log(`   Abriendo navegador automáticamente...\n`);

      // Abrir navegador según SO
      const platform = process.platform;
      const openCommand =
        platform === 'darwin' ? `open "${authUrl}"` :
        platform === 'win32' ? `start "" "${authUrl}"` :
        `xdg-open "${authUrl}"`;

      exec(openCommand, (error) => {
        if (error) {
          console.log(`   ⚠️  No se pudo abrir navegador automáticamente\n`);
          console.log(`   Abre manualmente: ${authUrl}\n`);
        }
      });
    });

    // Esperar código
    console.log(`4️⃣  WAITING FOR AUTHORIZATION\n`);
    console.log(`   (Espera mientras autorizas en tu navegador...)\n`);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: 120 segundos sin autorización'));
      }, 120000);

      const check = setInterval(() => {
        if (capturedCode) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 500);
    });

    console.log(`   ✅ Código capturado\n`);

    // Intercambiar código
    console.log(`5️⃣  EXCHANGING FOR TOKENS\n`);

    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      code: capturedCode,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    });

    const { refresh_token } = tokenRes.data;

    if (!refresh_token) throw new Error('No refresh_token');

    console.log(`   ✅ Tokens obtenidos\n`);

    // Actualizar .env
    console.log(`6️⃣  UPDATING .env\n`);

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

    logger.info(`OAUTH_RENEW_SUCCESS | auto_browser`);

    // Verificar
    console.log(`════════════════════════════════════════════════════════\n`);
    console.log(`✅ YOUTUBE OAUTH RENOVADO\n`);
    console.log(`   Token: ${refresh_token.slice(0, 20)}...\n`);
    console.log(`🚀 PRÓXIMO PASO:\n`);
    console.log(`   node scripts/retry-publish-video.js d101f12c-3658-4a35-9923-687e59351744\n`);

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`OAUTH_RENEW_FAILED | ${err.message}`);
    if (server) server.close();
    process.exit(1);
  }
})();
