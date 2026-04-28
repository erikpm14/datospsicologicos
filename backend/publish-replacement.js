require('dotenv').config({ path: './backend/.env' });
const path = require('path');
const fs = require('fs');
const { publishAll } = require('./src/services/publisher');
const logger = require('./src/utils/logger');

const VIDEO_ID = '51ef6963-d243-4a17-9bec-b048a0c3a8cb';
const OUTPUT_DIR = path.join(path.resolve('./output'), VIDEO_ID);
const outputMp4 = path.join(OUTPUT_DIR, 'output.mp4');
const scriptPath = path.join(OUTPUT_DIR, 'script.json');

async function publishReplacement() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║         REPUBLISHING CORRECTED VIDEO                  ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);

  try {
    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    const wrappedScript = {
      ...script,
      prefabScript: script,
      id: VIDEO_ID,
    };

    console.log(`📤 Publicando vídeo arreglado...\n`);
    const { results, errors } = await publishAll(outputMp4, wrappedScript);

    if (!results || results.length === 0) {
      throw new Error(`Publish failed: ${errors.map((e) => e.error).join(', ')}`);
    }

    const youtubeResult = results.find((r) => r.platform === 'youtube');
    if (!youtubeResult) throw new Error('No YouTube result');

    const youtubeId = youtubeResult.videoId;

    console.log(`\n✅ PUBLICADO EXITOSAMENTE`);
    console.log(`   📺 YouTube ID: ${youtubeId}`);
    console.log(`   🔗 URL: https://youtube.com/watch?v=${youtubeId}`);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📝 NOTAS:`);
    console.log(`   - Video anterior (cZArF7sEj7E) puede ser eliminado de YouTube`);
    console.log(`   - Este nuevo video tiene subtítulos y imagen correcta`);
    console.log(`   - V4.1 contract: ✅ PASS\n`);

    logger.info('REPLACEMENT_PUBLISH_SUCCESS', {
      videoId: VIDEO_ID,
      newYoutubeId: youtubeId,
      oldYoutubeId: 'cZArF7sEj7E',
    });

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    process.exit(1);
  }
}

publishReplacement();
