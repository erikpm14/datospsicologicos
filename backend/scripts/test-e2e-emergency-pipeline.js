#!/usr/bin/env node
/**
 * TEST E2E — EMERGENCY PIPELINE (No LLM Required)
 *
 * Flujo usando emergency-generate-no-llm:
 * 1. Generar video de emergencia (sin LLM)
 * 2. Script Diversity Gate
 * 3. Background Planning
 * 4. Dynamic Background Render
 * 5. Manual Late Publish (QC + Duplicate + Publish)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const logger = require('../src/utils/logger');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../output-fase1-test'));

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n[EXECUTING] ${command} ${args.join(' ')}`);

    const proc = spawn('node', [command, ...args], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

function findLatestGeneratedVideo() {
  try {
    const dirs = fs.readdirSync(OUTPUT_DIR)
      .filter(d => {
        if (d === 'rejected' || d.startsWith('.')) return false;
        const fullPath = path.join(OUTPUT_DIR, d);
        return fs.statSync(fullPath).isDirectory();
      })
      .sort((a, b) => {
        const statA = fs.statSync(path.join(OUTPUT_DIR, a));
        const statB = fs.statSync(path.join(OUTPUT_DIR, b));
        return statB.mtime - statA.mtime;
      });

    if (!dirs.length) return null;

    const latestDir = dirs[0];
    const metadataPath = path.join(OUTPUT_DIR, latestDir, 'generation-metadata.json');
    const mp4Path = path.join(OUTPUT_DIR, latestDir, 'output.mp4');

    if (fs.existsSync(metadataPath) && fs.existsSync(mp4Path)) {
      return latestDir;
    }

    return null;
  } catch (err) {
    return null;
  }
}

function checkMetadata(videoId) {
  const metadataPath = path.join(OUTPUT_DIR, videoId, 'generation-metadata.json');
  if (!fs.existsSync(metadataPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    return null;
  }
}

function checkQCPassed(videoId) {
  const qcPath = path.join(OUTPUT_DIR, videoId, 'qc.json');
  if (!fs.existsSync(qcPath)) return null;

  try {
    const qc = JSON.parse(fs.readFileSync(qcPath, 'utf8'));
    return {
      passed: qc.passed === true,
      score: qc.score || 0,
      threshold: qc.threshold || 30,
      reasons: qc.reasons || [],
    };
  } catch {
    return null;
  }
}

function checkPublishStatus(videoId) {
  const publishPath = path.join(OUTPUT_DIR, videoId, 'published.json');
  if (!fs.existsSync(publishPath)) return null;

  try {
    const publish = JSON.parse(fs.readFileSync(publishPath, 'utf8'));
    return {
      published: !!publish.youtubeId,
      youtubeId: publish.youtubeId || 'N/A',
      publishedAt: publish.publishedAt,
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║     E2E EMERGENCY PIPELINE TEST (No LLM)       ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  logger.info('[E2E_EMERGENCY_TEST_STARTED]');

  try {
    // PHASE 1: Generate emergency video
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 1: EMERGENCY GENERATION (No LLM)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const beforeGeneration = findLatestGeneratedVideo();

    try {
      await runCommand('scripts/emergency-generate-no-llm.js');
    } catch (err) {
      console.log(`[GENERATION_FAILED] ${err.message}`);
      logger.error(`[E2E_EMERGENCY_GENERATION_FAILED] ${err.message}`);
      process.exit(1);
    }

    // Wait for file to appear
    let videoId = null;
    let attempts = 0;
    while (attempts < 30) {
      const latest = findLatestGeneratedVideo();
      if (latest && latest !== beforeGeneration) {
        videoId = latest;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
      attempts++;
    }

    if (!videoId) {
      console.log('[GENERATION_TIMEOUT] No new video detected');
      process.exit(1);
    }

    console.log(`[GENERATION_SUCCESS] videoId=${videoId.substring(0, 12)}...`);
    logger.info(`[E2E_EMERGENCY_GENERATION_OK] videoId=${videoId}`);

    // PHASE 2: Load and verify metadata
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 2: METADATA & SCRIPT DIVERSITY GATE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const metadata = checkMetadata(videoId);
    if (!metadata) {
      console.log('[METADATA_FAILED] Generation metadata not found');
      process.exit(1);
    }

    const hook = metadata.hook || metadata.script?.hook || 'N/A';
    const topic = metadata.topic || 'unknown';
    const hasTuCerebro = hook.toLowerCase().includes('tu cerebro');

    console.log(`[METADATA_LOADED]`);
    console.log(`  Hook: "${hook}"`);
    console.log(`  Topic: ${topic}`);
    console.log(`  Contains "tu cerebro": ${hasTuCerebro ? '⚠️ YES' : '✅ NO'}`);
    console.log(`  Virality Score: ${metadata.viralityScore || 'N/A'}`);
    console.log(`  Generation Mode: ${metadata.generationMode || 'N/A'}`);

    if (hasTuCerebro) {
      console.log('[WARNING] Hook contains "tu cerebro" (temp banned phrase)');
      logger.warn(`[E2E_WARNING_TU_CEREBRO] videoId=${videoId}`);
    }

    // Check if was rejected during diversity gate
    const dirPath = path.join(OUTPUT_DIR, videoId);
    const rejectedPath = path.join(OUTPUT_DIR, '../rejected/scripts-too-similar', videoId);

    if (!fs.existsSync(dirPath) && fs.existsSync(rejectedPath)) {
      console.log('[SCRIPT_DIVERSITY_GATE_REJECTED] Video was rejected during generation');
      console.log(`  Reason: Script failed diversity checks`);
      process.exit(1);
    }

    if (!fs.existsSync(dirPath)) {
      console.log('[VIDEO_NOT_FOUND] Video directory not found');
      process.exit(1);
    }

    console.log('[SCRIPT_DIVERSITY_GATE_PASS]');
    logger.info(`[E2E_DIVERSITY_GATE_OK] videoId=${videoId}`);

    // PHASE 3: Verify background plan
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 3: BACKGROUND PLANNING');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const bgPlan = metadata.backgroundPlan;
    if (!bgPlan || !Array.isArray(bgPlan.clipTimeline)) {
      console.log('[BACKGROUND_PLAN_FAILED] No background plan found');
      process.exit(1);
    }

    console.log(`[BACKGROUND_PLAN_OK]`);
    console.log(`  Clips: ${bgPlan.clipTimeline.length}`);
    console.log(`  Diversity Score: ${bgPlan.diversityScore}`);
    console.log(`  Primary Category: ${bgPlan.primaryCategory}`);
    console.log('[BACKGROUND_TIMELINE_CREATED]');
    logger.info(`[E2E_BACKGROUND_PLAN_OK] videoId=${videoId} clips=${bgPlan.clipTimeline.length}`);

    // PHASE 4: Manual Late Publish (applies render + QC + publish)
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 4: DYNAMIC RENDER + QC + DUPLICATE CHECK');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
      await runCommand('scripts/manual-late-publish.js', ['--video-id', videoId]);
    } catch (err) {
      console.log(`[LATE_PUBLISH_FAILED] ${err.message}`);
      logger.error(`[E2E_EMERGENCY_LATE_PUBLISH_FAILED] videoId=${videoId}`);
      process.exit(1);
    }

    // PHASE 5: Reload and verify final state
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 5: FINAL VERIFICATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check dynamic background was applied
    const finalMetadata = checkMetadata(videoId);
    const bgApplied = finalMetadata?.backgroundPlan?.appliedToRender === true;
    const renderMode = finalMetadata?.backgroundPlan?.renderMode;

    console.log(`[DYNAMIC_BACKGROUND_STATUS]`);
    console.log(`  Applied: ${bgApplied ? '✅ YES' : '❌ NO'}`);
    console.log(`  Render Mode: ${renderMode || 'N/A'}`);

    if (bgApplied) {
      console.log('[DYNAMIC_BACKGROUND_RENDER_SUCCESS]');
      logger.info(`[E2E_DYNAMIC_RENDER_OK] videoId=${videoId}`);
    }

    // Check QC
    const qc = checkQCPassed(videoId);
    if (!qc) {
      console.log('[QC_CHECK_FAILED] QC metadata not found');
      process.exit(1);
    }

    console.log(`\n[QC_VERIFICATION]`);
    console.log(`  Passed: ${qc.passed ? '✅ YES' : '❌ NO'}`);
    console.log(`  Score: ${qc.score}/${qc.threshold}`);

    if (!qc.passed) {
      console.log('[QC_FAILED] Video did not pass quality checks');
      if (qc.reasons.length) {
        console.log(`  Reasons: ${qc.reasons.join(', ')}`);
      }
      process.exit(1);
    }

    logger.info(`[E2E_QC_OK] videoId=${videoId}`);

    // Check publish status
    const publish = checkPublishStatus(videoId);
    if (!publish) {
      console.log('[PUBLISH_CHECK_FAILED] Publish metadata not found');
      process.exit(1);
    }

    console.log(`\n[PUBLISH_STATUS]`);
    console.log(`  Published: ${publish.published ? '✅ YES' : '❌ NO'}`);
    console.log(`  YouTube ID: ${publish.youtubeId}`);

    if (!publish.published) {
      console.log('[PUBLICATION_FAILED] Video was not published');
      process.exit(1);
    }

    // SUCCESS
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║       ✅ E2E EMERGENCY PIPELINE PASSED         ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    console.log('FINAL SUMMARY:');
    console.log(`  Video ID: ${videoId}`);
    console.log(`  Hook: "${hook}"`);
    console.log(`  Topic: ${topic}`);
    console.log(`  Background Clips: ${bgPlan.clipTimeline.length}`);
    console.log(`  Dynamic Render: ${bgApplied ? 'YES' : 'PENDING'}`);
    console.log(`  QC Score: ${qc.score}/${qc.threshold}`);
    console.log(`  YouTube: https://youtube.com/shorts/${publish.youtubeId}`);
    console.log('\n');

    logger.info(`[E2E_EMERGENCY_SUCCESS] videoId=${videoId} youtubeId=${publish.youtubeId}`);
    process.exit(0);

  } catch (err) {
    console.log(`\n[E2E_EMERGENCY_CRASHED] ${err.message}`);
    logger.error(`[E2E_EMERGENCY_CRASHED] ${err.message}`, err);
    process.exit(1);
  }
}

main();
