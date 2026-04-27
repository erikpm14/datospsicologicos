#!/usr/bin/env node

/**
 * retry-publish-video.js
 *
 * Reintenta publicar un vídeo específico sin regenerarlo.
 * Verifica captions-debug.json, output.mp4 y OAuth antes de intentar.
 *
 * Uso: node scripts/retry-publish-video.js d101f12c-3658-4a35-9923-687e59351744
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../src/utils/logger');
const { publishAll } = require('../src/services/publisher');
const { validateCaptionsForPublish } = require('../src/services/caption-pre-publish-validator');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const videoIdArg = process.argv[2];

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║  RETRY PUBLISH VIDEO (No Rerender)                    ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

(async () => {
  try {
    if (!videoIdArg) {
      throw new Error('Missing videoId argument. Usage: retry-publish-video.js <videoId>');
    }

    const videoId = videoIdArg;
    const outputDir = path.join(OUTPUT_DIR, videoId);
    const videoPath = path.join(outputDir, 'output.mp4');
    const scriptPath = path.join(outputDir, 'script.json');

    console.log(`1️⃣  CHECKING VIDEO FILES\n`);
    console.log(`   videoId: ${videoId}`);
    console.log(`   outputDir: ${outputDir}\n`);

    // 1. Verificar output.mp4
    if (!fs.existsSync(videoPath)) {
      throw new Error(`output.mp4 not found: ${videoPath}`);
    }
    const videoSize = fs.statSync(videoPath).size / 1024 / 1024;
    console.log(`   ✅ output.mp4: ${videoSize.toFixed(2)}MB`);

    // 2. Verificar script.json
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`script.json not found: ${scriptPath}`);
    }
    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    console.log(`   ✅ script.json: ${script.viralityScore || 'N/A'} (virality)\n`);

    // 3. Verificar captions-debug.json
    console.log(`2️⃣  VALIDATING CAPTIONS\n`);

    const captionValidation = validateCaptionsForPublish(videoId, null, {
      allowFallbackForEmergency: true,
    });

    if (!captionValidation.ok) {
      throw new Error(`Captions validation failed: ${captionValidation.reason}`);
    }

    console.log(`   ✅ captions-debug.json valid`);
    console.log(`   Source: ${captionValidation.debugData?.source}`);
    console.log(`   Drift: ${captionValidation.debugData?.drift?.status}\n`);

    // 4. Verificar OAuth
    console.log(`3️⃣  CHECKING YOUTUBE OAUTH\n`);

    if (!process.env.YOUTUBE_REFRESH_TOKEN) {
      throw new Error('YOUTUBE_REFRESH_TOKEN not configured. Run: node scripts/youtube-auth-renew.js');
    }

    try {
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: process.env.YOUTUBE_CLIENT_ID,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
        refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }, {
        timeout: 15000,
      });

      if (!tokenResponse.data?.access_token) {
        throw new Error('No access_token in response');
      }

      console.log(`   ✅ YouTube OAuth valid\n`);
    } catch (oauthErr) {
      const errorCode = oauthErr.response?.data?.error;
      if (errorCode === 'invalid_grant') {
        throw new Error(
          'YOUTUBE_REFRESH_TOKEN expired. Renew it: node scripts/youtube-auth-renew.js'
        );
      }
      throw new Error(`OAuth check failed: ${errorCode || oauthErr.message}`);
    }

    // 5. Intentar publicar
    console.log(`4️⃣  PUBLISHING VIDEO\n`);

    const publishResult = await publishAll(videoPath, script);

    console.log(`════════════════════════════════════════════════════════\n`);

    if (publishResult.errors && publishResult.errors.length > 0) {
      console.error(`⚠️  PARTIAL SUCCESS - Some platforms failed:\n`);
      for (const err of publishResult.errors) {
        console.error(`   ❌ ${err.platform}: ${err.error}`);
      }
      console.error();
    }

    if (publishResult.results && publishResult.results.length > 0) {
      console.log(`✅ VIDEO PUBLISHED\n`);
      for (const result of publishResult.results) {
        console.log(`   ✅ ${result.platform}: ${result.publishId || result.status}`);
      }
      console.log();

      logger.info(`RETRY_PUBLISH_SUCCESS | videoId=${videoId} | platforms=${publishResult.results.map(r => r.platform).join(',')}`);
      process.exit(0);
    } else {
      throw new Error(`No successful platform: ${JSON.stringify(publishResult)}`);
    }
  } catch (err) {
    console.error(`\n❌ RETRY FAILED\n`);
    console.error(`   ${err.message}\n`);

    if (err.message.includes('invalid_grant')) {
      console.error(`⚠️  ACTION REQUIRED:\n`);
      console.error(`   1. Run: node scripts/youtube-auth-renew.js\n`);
      console.error(`   2. Update .env with new YOUTUBE_REFRESH_TOKEN\n`);
      console.error(`   3. Then retry: node scripts/retry-publish-video.js ${videoIdArg}\n`);
    }

    logger.error(`RETRY_PUBLISH_FAILED | videoId=${videoIdArg} | ${err.message}`);
    process.exit(1);
  }
})();
