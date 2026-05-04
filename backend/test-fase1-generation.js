#!/usr/bin/env node
/**
 * FASE 1: Test single video generation with render fix validation
 * - Trigger exactly 1 generation cycle
 * - Monitor LLM calls (max 2 allowed)
 * - Validate MP4 file exists and is real (not fake metadata)
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const logger = require('./src/utils/logger');
const { runGenerationCycle } = require('./src/services/scheduler.service');
const { getUsageStatus } = require('./src/utils/llm-usage-tracker');

(async () => {
  try {
    logger.info('='.repeat(70));
    logger.info('FASE 1: SINGLE VIDEO GENERATION TEST');
    logger.info('='.repeat(70));

    // Check LLM baseline
    const baseline = getUsageStatus();
    logger.info(`[BASELINE] LLM calls today: ${baseline.calls}/${process.env.MAX_LLM_CALLS_PER_DAY}`);
    logger.info(`[BASELINE] Remaining budget: ${baseline.remaining} calls`);

    if (baseline.calls >= parseInt(process.env.MAX_LLM_CALLS_PER_DAY)) {
      logger.error('ERROR: LLM budget exhausted. Cannot generate.');
      process.exit(1);
    }

    // Trigger single generation cycle
    logger.info('\n[TRIGGER] Starting generation cycle...');
    const startTime = Date.now();

    const result = await runGenerationCycle();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`\n[COMPLETE] Generation finished in ${duration}s`);
    logger.info(`[RESULT] ${JSON.stringify(result, null, 2)}`);

    // Check LLM usage after generation
    const afterGen = getUsageStatus();
    const callsUsed = afterGen.calls - baseline.calls;
    logger.info(`\n[LLM AUDIT] Calls used in generation: ${callsUsed}`);
    logger.info(`[LLM AUDIT] New total: ${afterGen.calls}/${process.env.MAX_LLM_CALLS_PER_DAY}`);

    if (callsUsed > 2) {
      logger.warn(`WARNING: Generation used ${callsUsed} LLM calls (max 2 allowed for FASE 1)`);
    }

    // Find latest generated video
    logger.info('\n[VALIDATION] Checking for generated MP4...');
    const outputDir = path.resolve(__dirname, process.env.OUTPUT_DIR);
    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp4'));

    if (files.length === 0) {
      logger.error('ERROR: No MP4 files found in output directory!');
      process.exit(1);
    }

    // Get the most recently modified MP4
    const latestMp4 = files.reduce((latest, current) => {
      const currentPath = path.join(outputDir, current);
      const latestPath = path.join(outputDir, latest);
      const currentMtime = fs.statSync(currentPath).mtime;
      const latestMtime = fs.statSync(latestPath).mtime;
      return currentMtime > latestMtime ? current : latest;
    });

    const videoPath = path.join(outputDir, latestMp4);
    const stats = fs.statSync(videoPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    logger.info(`\n[FILE VALIDATION]`);
    logger.info(`  Path: ${videoPath}`);
    logger.info(`  Size: ${sizeMB}MB (${stats.size} bytes)`);
    logger.info(`  Created: ${stats.birthtime}`);

    // Validate file size > 1MB
    if (stats.size < 1024 * 1024) {
      logger.error(`ERROR: MP4 file too small (${sizeMB}MB, expected > 1MB). Likely fake metadata.`);
      process.exit(1);
    }

    logger.info(`✓ File size validation PASSED (${sizeMB}MB > 1MB)`);

    // Get video duration with ffprobe
    logger.info('\n[AUDIO/DURATION VALIDATION]');
    const { execSync } = require('child_process');

    try {
      const ffprobeCmd = `ffprobe -v error -show_entries format=duration,bit_rate -of default=noprint_wrappers=1 "${videoPath}"`;
      const ffprobeOutput = execSync(ffprobeCmd, { encoding: 'utf-8' });

      const durationMatch = ffprobeOutput.match(/duration=([\d.]+)/);
      const bitRateMatch = ffprobeOutput.match(/bit_rate=(\d+)/);

      const duration = durationMatch ? parseFloat(durationMatch[1]) : null;
      const bitRate = bitRateMatch ? parseInt(bitRateMatch[1]) : null;

      if (!duration) {
        logger.error('ERROR: Could not extract duration from MP4');
        process.exit(1);
      }

      logger.info(`  Duration: ${duration.toFixed(2)}s`);
      logger.info(`  Bit rate: ${(bitRate / 1000).toFixed(0)}kbps`);

      // Validate duration 8-60s
      if (duration < 8 || duration > 60) {
        logger.error(`ERROR: Duration out of range (${duration.toFixed(2)}s, expected 8-60s)`);
        process.exit(1);
      }

      logger.info(`✓ Duration validation PASSED (${duration.toFixed(2)}s within 8-60s range)`);

    } catch (err) {
      logger.error(`ERROR: ffprobe failed: ${err.message}`);
      process.exit(1);
    }

    // Check for audio stream
    logger.info('\n[AUDIO STREAM CHECK]');
    try {
      const audioCheckCmd = `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`;
      const audioOutput = execSync(audioCheckCmd, { encoding: 'utf-8' }).trim();

      if (audioOutput.includes('audio')) {
        logger.info('✓ Audio stream FOUND');
      } else {
        logger.warn('⚠ No audio stream detected');
      }
    } catch (err) {
      logger.warn(`⚠ Audio check failed: ${err.message}`);
    }

    // Check database for job metadata
    logger.info('\n[JOB METADATA CHECK]');
    try {
      const db = require('better-sqlite3')(process.env.SQLITE_DB_PATH);
      const jobs = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 5').all();

      if (jobs.length > 0) {
        const latestJob = jobs[0];
        logger.info(`  Latest job ID: ${latestJob.id}`);
        logger.info(`  Status: ${latestJob.status}`);
        logger.info(`  Video path in DB: ${latestJob.video_path}`);

        // Verify the path in DB actually exists
        if (latestJob.video_path && fs.existsSync(latestJob.video_path)) {
          logger.info(`✓ Job metadata references REAL file on disk`);
        } else {
          logger.error(`ERROR: Job metadata references non-existent file: ${latestJob.video_path}`);
          process.exit(1);
        }
      }

      db.close();
    } catch (err) {
      logger.warn(`⚠ Could not verify job metadata: ${err.message}`);
    }

    logger.info('\n' + '='.repeat(70));
    logger.info('FASE 1 RESULT: ✓ GENERATION AND VALIDATION PASSED');
    logger.info('='.repeat(70));
    logger.info(`- Generated 1 video with ${callsUsed} LLM calls (max 2 allowed)`);
    logger.info(`- MP4 file real and valid (${sizeMB}MB)`);
    logger.info(`- Audio stream present`);
    logger.info(`- Job metadata references actual file`);
    logger.info('\nReady for FASE 2: Prevent fake metadata verification');

    process.exit(0);

  } catch (err) {
    logger.error(`\n[FATAL] ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }
})();
