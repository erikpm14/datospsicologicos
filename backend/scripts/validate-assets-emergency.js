#!/usr/bin/env node

/**
 * validate-assets-emergency.js
 *
 * Valida y repara los assets de un vídeo existente.
 * Uso: node scripts/validate-assets-emergency.js <videoId>
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const { validateAndFixAssets } = require('../src/services/asset-validator.service');

const videoId = process.argv[2];

if (!videoId) {
  console.error('\n❌ Usage: node scripts/validate-assets-emergency.js <videoId>\n');
  process.exit(1);
}

(async () => {
  try {
    const outputDir = path.resolve(`../output/${videoId}`);

    if (!fs.existsSync(outputDir)) {
      throw new Error(`Video directory not found: ${outputDir}`);
    }

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  ASSET VALIDATION & REPAIR                            ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    // Cargar render metadata
    const metadataPath = path.join(outputDir, 'render-metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`render-metadata.json not found: ${metadataPath}`);
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const clipPaths = metadata.clipPaths || [];

    console.log(`Original clips (${clipPaths.length}):`);
    clipPaths.forEach((cp, i) => {
      const exists = fs.existsSync(cp) ? '✅' : '❌';
      console.log(`  ${i + 1}. ${exists} ${path.basename(cp)}`);
    });

    // Cargar script
    const scriptPath = path.join(outputDir, 'script.json');
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`script.json not found: ${scriptPath}`);
    }

    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));

    // Validar assets
    console.log(`\n🔍 Validating and fixing assets...\n`);
    const validClips = await validateAndFixAssets(clipPaths, script, outputDir, videoId);

    if (!validClips) {
      throw new Error('Asset validation failed — no valid clips available');
    }

    console.log(`\n✅ Result (${validClips.length} valid clips):`);
    validClips.forEach((cp, i) => {
      const size = fs.statSync(cp).size / 1024 / 1024;
      console.log(`  ${i + 1}. ${path.basename(cp)} (${size.toFixed(1)}MB)`);
    });

    // Actualizar metadata
    metadata.clipPaths = validClips;
    metadata.assetValidationPassed = true;
    metadata.assetValidationAt = new Date().toISOString();

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    console.log(`\n✅ Updated render-metadata.json`);

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅ ASSET VALIDATION COMPLETE                         ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    logger.info(`ASSET_VALIDATION_REPAIR_SUCCESS videoId=${videoId} validClips=${validClips.length}`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`ASSET_VALIDATION_REPAIR_FAILED | ${err.message}`);
    process.exit(1);
  }
})();
