#!/usr/bin/env node

/**
 * emergency-rerender.js
 *
 * Re-renderiza un vídeo existente con validación de assets mejorada.
 * Usa: node scripts/emergency-rerender.js <videoId>
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const { renderVideo } = require('../src/services/video-renderer');

const videoId = process.argv[2];

if (!videoId) {
  console.error('\n❌ Usage: node scripts/emergency-rerender.js <videoId>\n');
  process.exit(1);
}

(async () => {
  try {
    const outputDir = path.resolve(`../output/${videoId}`);

    if (!fs.existsSync(outputDir)) {
      throw new Error(`Video directory not found: ${outputDir}`);
    }

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  EMERGENCY RE-RENDER                                   ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    // Cargar script
    const scriptPath = path.join(outputDir, 'script.json');
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`script.json not found: ${scriptPath}`);
    }

    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    console.log(`✅ Loaded script: ${script.hook}`);

    // Cargar audio
    const audioPath = path.join(outputDir, 'voice_proc.mp3');
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio not found: ${audioPath}`);
    }

    console.log(`✅ Audio: ${audioPath}`);

    // Eliminar output.mp4 anterior para forzar nuevo render
    const outputPath = path.join(outputDir, 'output.mp4');
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
      console.log(`⚠️  Removed old output.mp4`);
    }

    // Ejecutar render
    console.log(`\n🎬 Starting render...\n`);

    const result = await renderVideo({
      script,
      audioPath,
      outputPath,
      themeId: script.theme || 'psychology_dark',
      bgStyle: 'single_focus_pexels',
    });

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅ RE-RENDER COMPLETE                                  ║`);
    console.log(`╚════════════════════════════════════════════════════════╝`);

    console.log(`\n📹 Output: ${result}\n`);

    logger.info(`EMERGENCY_RERENDER_SUCCESS videoId=${videoId}`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`EMERGENCY_RERENDER_FAILED | ${err.message}`);
    process.exit(1);
  }
})();
