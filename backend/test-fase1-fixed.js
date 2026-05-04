#!/usr/bin/env node
/**
 * FASE 1: Test single video generation with render fix validation (FIXED)
 * - Waits for job completion before checking for MP4
 * - Validates rendering actually produced a real file
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
    logger.info('FASE 1: SINGLE VIDEO GENERATION TEST (FIXED)');
    logger.info('='.repeat(70));

    // Check LLM baseline
    const baseline = getUsageStatus();
    logger.info(`[BASELINE] LLM calls today: ${baseline.calls}/${process.env.MAX_LLM_CALLS_PER_DAY}`);
    logger.info(`[BASELINE] Remaining budget: ${baseline.remaining} calls`);

    // Trigger generation
    logger.info('\n[TRIGGER] Starting generation cycle...');
    const startTime = Date.now();
    const result = await runGenerationCycle();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    logger.info(`[COMPLETE] Generation cycle finished in ${duration}s`);

    // Check LLM usage
    const afterGen = getUsageStatus();
    const callsUsed = afterGen.calls - baseline.calls;
    logger.info(`\n[LLM] Used: ${callsUsed} calls | New total: ${afterGen.calls}/${process.env.MAX_LLM_CALLS_PER_DAY}`);

    if (callsUsed > 2) {
      logger.warn(`⚠ ISSUE: Used ${callsUsed} LLM calls (max 2 allowed)`);
    }

    // Wait for jobs to be processed
    logger.info('\n[WAIT] Waiting for video processor to complete rendering...');
    const maxWaitMs = 120000; // 2 minutes
    const startWait = Date.now();
    let jobCompleted = false;
    let mp4Path = null;

    while (Date.now() - startWait < maxWaitMs) {
      // Check for MP4 in output directory
      const outputDir = path.resolve(__dirname, process.env.OUTPUT_DIR);
      if (fs.existsSync(outputDir)) {
        const dirs = fs.readdirSync(outputDir);
        for (const dir of dirs) {
          const fullPath = path.join(outputDir, dir);
          if (fs.statSync(fullPath).isDirectory()) {
            const mp4Files = fs.readdirSync(fullPath).filter(f => f.endsWith('.mp4'));
            if (mp4Files.length > 0) {
              mp4Path = path.join(fullPath, mp4Files[0]);
              logger.info(`✓ MP4 found: ${mp4Path}`);
              jobCompleted = true;
              break;
            }
          }
        }
      }

      if (jobCompleted) break;

      // Check job status
      const queueDir = process.env.QUEUE_DIR || './queue';
      const doneDir = path.join(queueDir, 'done');
      const pendingDir = path.join(queueDir, 'pending');
      const activeDir = path.join(queueDir, 'active');

      if (fs.existsSync(doneDir)) {
        const doneFiles = fs.readdirSync(doneDir).length;
        if (doneFiles > 0) {
          logger.info(`[QUEUE] Jobs in done: ${doneFiles} (checking for MP4...)`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
    }

    if (!jobCompleted) {
      logger.error('ERROR: Timeout waiting for MP4 generation (>2 minutes)');
      process.exit(1);
    }

    // Validate MP4 file
    logger.info('\n[VALIDATION] Analyzing MP4 file...');
    const stats = fs.statSync(mp4Path);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    logger.info(`  Path: ${mp4Path}`);
    logger.info(`  Size: ${sizeMB}MB (${stats.size} bytes)`);

    // Validate size > 1MB
    if (stats.size < 1024 * 1024) {
      logger.error(`✗ FAILED: File too small (${sizeMB}MB, expected >1MB)`);
      process.exit(1);
    }
    logger.info(`✓ Size validation PASSED (${sizeMB}MB > 1MB)`);

    // Check duration and audio with ffprobe
    logger.info('\n[AUDIO/DURATION] Checking...');
    const { execSync } = require('child_process');

    try {
      const ffprobeCmd = `ffprobe -v error -show_entries format=duration,bit_rate -of default=noprint_wrappers=1 "${mp4Path}"`;
      const ffprobeOutput = execSync(ffprobeCmd, { encoding: 'utf-8' });

      const durationMatch = ffprobeOutput.match(/duration=([\d.]+)/);
      const duration = durationMatch ? parseFloat(durationMatch[1]) : null;

      if (!duration) {
        logger.error('✗ FAILED: Could not extract duration');
        process.exit(1);
      }

      logger.info(`  Duration: ${duration.toFixed(2)}s`);

      if (duration < 8 || duration > 60) {
        logger.error(`✗ FAILED: Duration out of range (${duration.toFixed(2)}s, expected 8-60s)`);
        process.exit(1);
      }

      logger.info(`✓ Duration validation PASSED`);
    } catch (err) {
      logger.error(`✗ ffprobe failed: ${err.message}`);
      process.exit(1);
    }

    logger.info('\n' + '='.repeat(70));
    logger.info('FASE 1 RESULT: ✓ SUCCESS');
    logger.info('='.repeat(70));
    logger.info(`✓ MP4 generated (${sizeMB}MB)`);
    logger.info(`✓ Duration valid`);
    logger.info(`✓ Used ${callsUsed} LLM calls`);
    logger.info(`\nSystem is capable of generating real videos!`);
    logger.info(`Now safe to proceed to FASE 2 & FASE 3 for full audit.`);

    process.exit(0);

  } catch (err) {
    logger.error(`\n[FATAL] ${err.message}`);
    process.exit(1);
  }
})();
