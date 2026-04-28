require('dotenv').config({ path: './backend/.env' });
const path = require('path');
const fs = require('fs');
const { publishAll } = require('./src/services/publisher');
const logger = require('./src/utils/logger');

const VIDEO_ID = '51ef6963-d243-4a17-9bec-b048a0c3a8cb';
const OUTPUT_DIR = path.join(path.resolve('./output'), VIDEO_ID);

async function validateAndPublish() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║            MANUAL V4.1 PUBLISH (BYPASS)               ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);

  try {
    // 1. VALIDACIÓN PREVIA
    console.log(`1️⃣  Validando archivos y metadata...\n`);

    const scriptPath = path.join(OUTPUT_DIR, 'script.json');
    const outputMp4 = path.join(OUTPUT_DIR, 'output.mp4');
    const metadataFile = path.join(OUTPUT_DIR, 'render-metadata.json');

    // Verificar existencia de archivos
    if (!fs.existsSync(scriptPath)) throw new Error(`script.json no existe: ${scriptPath}`);
    if (!fs.existsSync(outputMp4)) throw new Error(`output.mp4 no existe: ${outputMp4}`);
    if (!fs.existsSync(metadataFile)) throw new Error(`render-metadata.json no existe: ${metadataFile}`);

    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));

    // Verificar V4.1 contract
    const checks = [
      { name: 'VideoID', value: script.videoId, expected: VIDEO_ID },
      { name: 'Duration', value: script.duration, expected: '26-32s', check: (v) => v >= 26 && v <= 32 },
      { name: 'Virality Score', value: script.viralityScore, expected: '>=70', check: (v) => v >= 70 },
      { name: 'Humanity Score', value: script.humanityScore, expected: '>=85', check: (v) => v >= 85 },
      { name: 'Structure Version', value: script.structureVersion, expected: 'confessional' },
      { name: 'Retention Spike', value: script.retentionSpikeVersion, expected: 'v4.1' },
      { name: 'Render Mode', value: script.renderMode, expected: 'video_use' },
      { name: 'Subtitle Timing', value: script.subtitleTimingMode, expected: 'word_timestamps' },
      { name: 'Word Alignment', value: script.wordAlignmentEngine, expected: 'whisper' },
    ];

    let allPassed = true;
    for (const check of checks) {
      const passed = check.check ? check.check(check.value) : check.value === check.expected;
      const status = passed ? '✅' : '❌';
      console.log(`   ${status} ${check.name}: ${check.value} (expected: ${check.expected})`);
      if (!passed) allPassed = false;
    }

    if (!allPassed) throw new Error('V4.1 contract validation FAILED');

    // Verificar output.mp4 size
    const stats = fs.statSync(outputMp4);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`   ✅ output.mp4: ${sizeMB} MB`);

    console.log(`\n✅ VALIDACIÓN EXITOSA - Todos los contratos V4.1 pasados\n`);

    // 2. BYPASS SCHEDULER - Preparar wrapper para validator
    console.log(`2️⃣  Publicando vídeo (bypass scheduler)...\n`);

    // El validator espera videoData.prefabScript, entonces preparamos el wrapper
    const wrappedScript = {
      ...script,
      prefabScript: script, // Validator busca esto
      id: VIDEO_ID,
    };

    const { results, errors } = await publishAll(outputMp4, wrappedScript);

    if (!results || results.length === 0) {
      throw new Error(`Publish failed: ${errors.map((e) => e.error).join(', ')}`);
    }

    const youtubeResult = results.find((r) => r.platform === 'youtube');
    if (!youtubeResult) {
      throw new Error('No YouTube publish result found');
    }

    const youtubeId = youtubeResult.videoId;

    // 3. CONFIRMAR PUBLICACIÓN
    console.log(`\n3️⃣  Confirmando publicación...\n`);
    console.log(`   ✅ Vídeo publicado exitosamente`);
    console.log(`   📺 YouTube ID: ${youtubeId}`);
    console.log(`   🔗 URL: https://youtube.com/watch?v=${youtubeId}`);

    // 4. LOG FINAL
    logger.info('MANUAL_PUBLISH_SUCCESS', {
      videoId: VIDEO_ID,
      youtubeId,
      publishedAt: new Date().toISOString(),
      contractVersion: 'v4.1',
      duration: script.duration,
      viralityScore: script.viralityScore,
      humanityScore: script.humanityScore,
    });

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║           ✅ MANUAL PUBLISH SUCCESS                   ║`);
    console.log(`╚════════════════════════════════════════════════════════╝`);
    console.log(`\n✨ Vídeo V4.1 publicado inmediatamente sin scheduler\n`);

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error('MANUAL_PUBLISH_FAILED', { videoId: VIDEO_ID, error: err.message });
    process.exit(1);
  }
}

validateAndPublish();
