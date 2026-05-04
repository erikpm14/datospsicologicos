#!/usr/bin/env node
/**
 * TEST: Render real video con audio existente
 * - Usa el nuevo código de hyperframe-renderer.js con spawn
 * - Audio: archivo existente del intento anterior
 * - Validación exhaustiva
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
    logger.info('TEST: RENDER CON FFmpeg ARREGLADO');
    logger.info('='.repeat(70));

    // Encontrar audio existente
    const audioPath = path.join(__dirname, 'output-fase1-test/0bc823c5-8382-4e63-8b90-76422da08a61/voice.wav');
    const outputDir = path.join(__dirname, 'test-render-output');

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

    // Obtener duración del audio con ffprobe
    logger.info(`\n[AUDIO ANALYSIS]`);
    const ffprobeCmd = `"${ffprobeInstaller.path}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
    const durationOutput = execSync(ffprobeCmd, { encoding: 'utf-8' }).trim();
    const audioDuration = parseFloat(durationOutput);
    logger.info(`Audio duration: ${audioDuration.toFixed(2)}s`);

    // Render
    logger.info(`\n[RENDER]`);
    logger.info(`Output dir: ${outputDir}`);

    const startTime = Date.now();
    const result = await renderHyperframe({
      script: { id: 'test-video' },
      audioPath,
      captions: [],
      outputDir,
      videoId: 'test-render-fixed',
    });

    const renderTime = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`\n[RESULT]`);
    logger.info(`Render time: ${renderTime}s`);
    logger.info(`Success: ${result.success}`);
    logger.info(`Output: ${result.outputPath}`);

    // Validar archivo
    logger.info(`\n[VALIDATION]`);
    const outputPath = result.outputPath;

    if (!fs.existsSync(outputPath)) {
      logger.error(`✗ Output file not found: ${outputPath}`);
      process.exit(1);
    }

    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(3);
    logger.info(`✓ MP4 exists: ${sizeMB}MB (${stats.size} bytes)`);

    if (stats.size < 100 * 1024) {
      logger.error(`✗ File too small: ${sizeMB}MB (expected >100KB)`);
      process.exit(1);
    }

    logger.info(`✓ File size OK (${sizeMB}MB)`);

    // ffprobe del output
    logger.info(`\n[FFPROBE CHECK]`);
    const ffprobeOutCmd = `"${ffprobeInstaller.path}" -v error -show_entries format=duration,bit_rate -of default=noprint_wrappers=1 "${outputPath}"`;
    const ffprobeOut = execSync(ffprobeOutCmd, { encoding: 'utf-8' });
    const lines = ffprobeOut.split('\n').filter(l => l.trim());

    for (const line of lines) {
      logger.info(`${line}`);
    }

    const videoDuration = parseFloat(lines[0]);
    logger.info(`\nVideo duration: ${videoDuration.toFixed(2)}s`);

    if (videoDuration < 5) {
      logger.error(`✗ Duration too short: ${videoDuration.toFixed(2)}s`);
      process.exit(1);
    }

    logger.info(`✓ Duration OK`);

    // Check streams
    logger.info(`\n[STREAMS]`);
    const ffprobeStreamsCmd = `"${ffprobeInstaller.path}" -v error -select_streams v:0 -show_entries stream=codec_type,width,height -of default=noprint_wrappers=1 "${outputPath}"`;
    const videoprobeOut = execSync(ffprobeStreamsCmd, { encoding: 'utf-8' });
    logger.info(`Video stream:\n${videoprobeOut}`);

    const ffprobeAudioCmd = `"${ffprobeInstaller.path}" -v error -select_streams a:0 -show_entries stream=codec_type,sample_rate -of default=noprint_wrappers=1 "${outputPath}"`;
    const audioprobeOut = execSync(ffprobeAudioCmd, { encoding: 'utf-8' });
    logger.info(`Audio stream:\n${audioprobeOut}`);

    if (!videoprobeOut.includes('video')) {
      logger.error(`✗ No video stream found`);
      process.exit(1);
    }

    if (!audioprobeOut.includes('audio')) {
      logger.error(`✗ No audio stream found`);
      process.exit(1);
    }

    logger.info(`✓ Both video and audio streams present`);

    logger.info('\n' + '='.repeat(70));
    logger.info('TEST PASSED: ✓ RENDER FUNCIONA');
    logger.info('='.repeat(70));
    logger.info(`MP4: ${outputPath}`);
    logger.info(`Size: ${sizeMB}MB`);
    logger.info(`Duration: ${videoDuration.toFixed(2)}s`);
    logger.info(`\nListo para FASE 1 válido.`);

    process.exit(0);

  } catch (err) {
    logger.error(`\n[FATAL] ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }
})();
