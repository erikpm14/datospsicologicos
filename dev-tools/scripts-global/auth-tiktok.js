/**
 * auth-tiktok.js
 * Obtiene el access token de TikTok via OAuth2.
 *
 * PASO 1: node scripts/auth-tiktok.js
 *   → Abre la URL en el navegador, autoriza, copia el código de la callback
 * PASO 2: node scripts/auth-tiktok.js <código>
 *   → Intercambia el código por access_token y lo guarda en .env
 */

const path = require('path');
process.env.NODE_PATH = path.resolve(__dirname, '../backend/node_modules');
require('module').Module._initPaths();
require('dotenv').config({ path: path.resolve(__dirname, '../backend/.env') });

const axios = require('axios');
const fs = require('fs');

const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI  = process.env.TIKTOK_REDIRECT_URI;
const ENV_PATH      = path.resolve(__dirname, '../backend/.env');

const code = process.argv[2];

if (!code) {
  // ── PASO 1: muestra la URL de autorización ──────────────────────────────
  const state = Math.random().toString(36).slice(2);
  const authUrl =
    `https://www.tiktok.com/v2/auth/authorize?` +
    `client_key=${CLIENT_KEY}` +
    `&scope=user.info.basic,video.publish` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${state}`;

  console.log('\n🔑 Abre esta URL en el navegador para autorizar TikTok:\n');
  console.log(authUrl);
  console.log('\nDespués de autorizar, la página de callback mostrará el código.');
  console.log('Ejecuta: node scripts/auth-tiktok.js <código>\n');

} else {
  // ── PASO 2: intercambia el código por tokens ─────────────────────────────
  (async () => {
    console.log('\n🔄 Intercambiando código por access token...');
    try {
      const res = await axios.post(
        'https://open.tiktokapis.com/v2/oauth/token/',
        new URLSearchParams({
          client_key:    CLIENT_KEY,
          client_secret: CLIENT_SECRET,
          code,
          grant_type:    'authorization_code',
          redirect_uri:  REDIRECT_URI,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const { access_token, refresh_token, expires_in, open_id } = res.data;
      console.log(`✅ Access token obtenido | open_id: ${open_id}`);
      console.log(`   Expira en: ${(expires_in / 3600).toFixed(0)} horas`);

      // Guarda los tokens en .env
      let env = fs.readFileSync(ENV_PATH, 'utf8');
      env = env.replace(/TIKTOK_ACCESS_TOKEN=.*/, `TIKTOK_ACCESS_TOKEN=${access_token}`);
      env = env.replace(/TIKTOK_REFRESH_TOKEN=.*/, `TIKTOK_REFRESH_TOKEN=${refresh_token}`);
      fs.writeFileSync(ENV_PATH, env);

      console.log('\n✅ Tokens guardados en backend/.env');
      console.log('   Ya puedes subir vídeos con: node scripts/upload-tiktok.js <video> <script.json>\n');

    } catch (err) {
      console.error('❌ Error:', err.response?.data || err.message);
    }
  })();
}
