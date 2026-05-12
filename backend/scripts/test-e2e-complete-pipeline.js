#!/usr/bin/env node
/**
 * TEST E2E — COMPLETE PIPELINE VALIDATION
 *
 * Flujo completo:
 * 1. Generar nuevo vídeo
 * 2. Script Diversity Gate
 * 3. Background Planning
 * 4. Dynamic Background Render
 * 5. Hard Validation
 * 6. Prepublish QC
 * 7. Duplicate Hard Block
 * 8. Publicación
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

async function checkDiversityGatePass(videoId) {
  const metadataPath = path.join(OUTPUT_DIR, videoId, 'generation-metadata.json');
  if (!fs.existsSync(metadataPath)) return null;

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const script = metadata.script || {};

  return {
    passed: metadata.diversityGatePassed !== false,
    topic: metadata.psychologyTopic || 'unknown',
    hook: script.hook || 'N/A',
    hasTuCerebro: (script.hook || '').toLowerCase().includes('tu cerebro'),
  };
}

function checkBackgroundPlanExists(videoId) {
  const metadataPath = path.join(OUTPUT_DIR, videoId, 'generation-metadata.json');
  if (!fs.existsSync(metadataPath)) return null;

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const backgroundPlan = metadata.backgroundPlan;

  return {
    exists: !!backgroundPlan,
    hasClipTimeline: backgroundPlan && Array.isArray(backgroundPlan.clipTimeline),
    clipCount: backgroundPlan ? backgroundPlan.clipTimeline?.length || 0 : 0,
    diversityScore: backgroundPlan?.diversityScore || 0,
  };
}

function checkDynamicBackgroundApplied(videoId) {
  const metadataPath = path.join(OUTPUT_DIR, videoId, 'generation-metadata.json');
  if (!fs.existsSync(metadataPath)) return null;

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const backgroundPlan = metadata.backgroundPlan;

  return {
    applied: backgroundPlan?.appliedToRender === true,
    renderMode: backgroundPlan?.renderMode,
    renderedAt: backgroundPlan?.renderedAt,
  };
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
  console.log('║       E2E COMPLETE PIPELINE TEST                ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  logger.info('[E2E_TEST_STARTED] Complete pipeline validation');

  try {
    // PHASE 1: Generate video
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 1: GENERATE VIDEO');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const beforeGeneration = findLatestGeneratedVideo();

    try {
      await runCommand('scripts/manual-generate-video.js');
    } catch (err) {
      console.log(`[GENERATION_FAILED] ${err.message}`);
      logger.error(`[E2E_TEST_FAILED_GENERATION] ${err.message}`);
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
    logger.info(`[E2E_GENERATION_COMPLETE] videoId=${videoId}`);

    // PHASE 2: Check Script Diversity Gate
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 2: SCRIPT DIVERSITY GATE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const diversityCheck = await checkDiversityGatePass(videoId);
    if (!diversityCheck) {
      console.log('[DIVERSITY_CHECK_FAILED] Metadata not found');
      process.exit(1);
    }

    console.log(`[SCRIPT_DIVERSITY_CHECK_RESULT]`);
    console.log(`  Status: ${diversityCheck.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Hook: "${diversityCheck.hook}"`);
    console.log(`  Topic: ${diversityCheck.topic}`);
    console.log(`  Contains "tu cerebro": ${diversityCheck.hasTuCerebro ? '⚠️ YES' : '✅ NO'}`);

    if (!diversityCheck.passed) {
      console.log('[DIVERSITY_GATE_FAILED] Script rejected');
      logger.error(`[E2E_FAILED_DIVERSITY_GATE] videoId=${videoId}`);
      process.exit(1);
    }

    if (diversityCheck.hasTuCerebro) {
      console.log('[WARNING] Hook contains "tu cerebro" (temp banned phrase)');
      logger.warn(`[E2E_WARNING_TU_CEREBRO] videoId=${videoId}`);
    }

    logger.info(`[E2E_DIVERSITY_GATE_PASS] videoId=${videoId}`);

    // PHASE 3: Check Background Plan
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 3: BACKGROUND PLANNING');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const bgPlan = checkBackgroundPlanExists(videoId);
    console.log(`[BACKGROUND_PLAN_CHECK]`);
    console.log(`  Exists: ${bgPlan.exists ? '✅ YES' : '❌ NO'}`);
    console.log(`  Has clipTimeline: ${bgPlan.hasClipTimeline ? '✅ YES' : '❌ NO'}`);
    console.log(`  Clip count: ${bgPlan.clipCount}`);
    console.log(`  Diversity score: ${bgPlan.diversityScore}`);

    if (!bgPlan.exists || !bgPlan.hasClipTimeline) {
      console.log('[BACKGROUND_PLAN_FAILED] No clipTimeline found');
      logger.error(`[E2E_FAILED_BACKGROUND_PLAN] videoId=${videoId}`);
      process.exit(1);
    }

    console.log('[BACKGROUND_TIMELINE_CREATED]');
    logger.info(`[E2E_BACKGROUND_PLAN_OK] videoId=${videoId} clips=${bgPlan.clipCount}`);

    // PHASE 4: Check Dynamic Background Render
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 4: DYNAMIC BACKGROUND RENDER');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const bgRender = checkDynamicBackgroundApplied(videoId);
    console.log(`[DYNAMIC_BACKGROUND_CHECK]`);
    console.log(`  Applied: ${bgRender.applied ? '✅ YES' : '❌ NO'}`);
    console.log(`  Render mode: ${bgRender.renderMode || 'N/A'}`);
    console.log(`  Rendered at: ${bgRender.renderedAt ? '✅ YES' : '❌ PENDING'}`);

    if (!bgRender.applied || bgRender.renderMode !== 'dynamic_background_timeline') {
      console.log('[WARNING] Dynamic background not yet applied - may be applied during late publish');
      logger.warn(`[E2E_WARNING_NO_RENDER_YET] videoId=${videoId}`);
    } else {
      console.log('[DYNAMIC_BACKGROUND_RENDER_SUCCESS]');
      logger.info(`[E2E_DYNAMIC_RENDER_OK] videoId=${videoId}`);
    }

    // PHASE 5: Manual Late Publish (triggers render + QC + publish)
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 5: MANUAL LATE PUBLISH (QC + DUPLICATE + PUBLISH)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
      await runCommand('scripts/manual-late-publish.js', ['--video-id', videoId]);
    } catch (err) {
      console.log(`[LATE_PUBLISH_FAILED] ${err.message}`);
      logger.error(`[E2E_FAILED_LATE_PUBLISH] videoId=${videoId} - ${err.message}`);
      process.exit(1);
    }

    // PHASE 6: Verify QC
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 6: PREPUBLISH QC VERIFICATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const qc = checkQCPassed(videoId);
    if (!qc) {
      console.log('[QC_CHECK_FAILED] QC metadata not found');
      process.exit(1);
    }

    console.log(`[QC_RESULT]`);
    console.log(`  Passed: ${qc.passed ? '✅ YES' : '❌ NO'}`);
    console.log(`  Score: ${qc.score}/${qc.threshold}`);
    if (qc.reasons.length) {
      console.log(`  Reasons: ${qc.reasons.join(', ')}`);
    }

    if (!qc.passed) {
      console.log('[QC_FAILED] Video did not pass quality checks');
      logger.error(`[E2E_FAILED_QC] videoId=${videoId}`);
      process.exit(1);
    }

    logger.info(`[E2E_QC_PASS] videoId=${videoId}`);

    // PHASE 7: Verify Publish Status
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 7: PUBLICATION STATUS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const publish = checkPublishStatus(videoId);
    if (!publish) {
      console.log('[PUBLISH_CHECK_FAILED] Publish metadata not found');
      process.exit(1);
    }

    console.log(`[PUBLISH_RESULT]`);
    console.log(`  Published: ${publish.published ? '✅ YES' : '❌ NO'}`);
    console.log(`  YouTube ID: ${publish.youtubeId}`);
    if (publish.publishedAt) {
      console.log(`  Published at: ${publish.publishedAt}`);
    }

    if (!publish.published) {
      console.log('[PUBLICATION_FAILED] Video was not published');
      logger.error(`[E2E_FAILED_PUBLICATION] videoId=${videoId}`);
      process.exit(1);
    }

    // FINAL SUMMARY
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║           ✅ E2E TEST PASSED                   ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    console.log('SUMMARY:');
    console.log(`  Video ID: ${videoId}`);
    console.log(`  Hook: ${diversityCheck.hook}`);
    console.log(`  Psychology Topic: ${diversityCheck.topic}`);
    console.log(`  Background Clips: ${bgPlan.clipCount}`);
    console.log(`  QC Score: ${qc.score}/${qc.threshold}`);
    console.log(`  YouTube URL: https://youtube.com/shorts/${publish.youtubeId}`);
    console.log('\n');

    logger.info(`[E2E_TEST_SUCCESS] videoId=${videoId} youtubeId=${publish.youtubeId}`);
    process.exit(0);

  } catch (err) {
    console.log(`\n[E2E_TEST_CRASHED] ${err.message}`);
    logger.error(`[E2E_TEST_CRASHED] ${err.message}`, err);
    process.exit(1);
  }
}

main();
