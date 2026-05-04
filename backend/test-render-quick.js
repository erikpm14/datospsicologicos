#!/usr/bin/env node
/**
 * QUICK TEST: Render con audio corto (~10s)
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const logger = require('./src/utils/logger');
const { renderHyperframe } = require('./src/renderers/hyperframe-renderer');
const { execSync } = require('child_process');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

(async () => {
  try {
    logger.info('='.repeat(70));
    logger.info('QUICK TEST: Render 10s');
    logger.info('='.repeat(70));

    // Usar seg_block_1.wav que es más corto
    const audioPath = path.join(__dirname, 'output-fase1-test/88daec2d-4a58-43ab-8371-e82cd9d34f9b/seg_block_1.wav');
    const outputDir = path.join(__dirname, 'test-render-quick-output');

    if (!fs.existsSync(audioPath)) {
      logger.error(`Audio file not found: ${audioPath}`);
      process.exit(1);
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    logger.info(`\n[INPUT]`);
    logger.info(`Audio: ${audioPath}`);
    const audioStats = fs.statSync(audioPath);
    logger.info(`Audio size: ${(audioStats.size / 1024).toFixed(1)}KB`);

    // Obtener duración
    logger.info(`\n[AUDIO ANALYSIS]`);
    const ffprobeCmd = `"${ffprobeInstaller.path}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
    const durationOutput = execSync(ffprobeCmd, { encoding: 'utf-8' }).trim();
    const audioDuration = parseFloat(durationOutput);
    logger.info(`Audio duration: ${audioDuration.toFixed(2)}s`);

    // Render
    logger.info(`\n[RENDER]`);
    const startTime = Date.now();
    const result = await renderHyperframe({
      script: { id: 'quick-test' },
      audioPath,
      captions: [],
      outputDir,
      videoId: 'quick-render-test',
    });

    const renderTime = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`\n[RESULT]`);
    logger.info(`Render time: ${renderTime}s`);
    logger.info(`Success: ${result.success}`);

    // Validar archivo
    logger.info(`\n[VALIDATION]`);
    const outputPath = result.outputPath;

    if (!fs.existsSync(outputPath)) {
      logger.error(`✗ Output file not found: ${outputPath}`);
      process.exit(1);
    }

    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(3);
    logger.info(`✓ MP4 exists: ${sizeMB}MB`);

    if (stats.size < 100 * 1024) {
      logger.error(`✗ File too small: ${sizeMB}MB`);
      process.exit(1);
    }

    logger.info(`✓ File size OK`);

    // ffprobe
    logger.info(`\n[FFPROBE]`);
    const ffprobeOutCmd = `"${ffprobeInstaller.path}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`;
    const videoDuration = parseFloat(execSync(ffprobeOutCmd, { encoding: 'utf-8' }).trim());
    logger.info(`Video duration: ${videoDuration.toFixed(2)}s`);
    logger.info(`✓ PASS`);

    logger.info('\n' + '='.repeat(70));
    logger.info('RESULT: ✓ SUCCESS');
    logger.info('='.repeat(70));
    logger.info(`MP4: ${outputPath} (${sizeMB}MB, ${videoDuration.toFixed(2)}s)`);

    process.exit(0);

  } catch (err) {
    logger.error(`\n[ERROR] ${err.message}`);
    process.exit(1);
  }
})();
