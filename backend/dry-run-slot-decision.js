#!/usr/bin/env node

/**
 * dry-run-slot-decision.js
 *
 * Simula la decisión del scheduler para el próximo slot.
 * NO toca YouTube, NO publica, solo analiza candidatos.
 *
 * Ejecutar: node dry-run-slot-decision.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './.env') });
const { execFileSync } = require('child_process');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const QUEUE_DIR = path.resolve('./queue/done');

function analyzeCandidates() {
  console.log('\n' + '═'.repeat(70));
  console.log('DRY-RUN: NEXT SLOT DECISION ANALYSIS');
  console.log('═'.repeat(70));

  const now = new Date();
  const cet = new Date(now.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }));
  console.log(`\nAnalysis time: ${cet.toLocaleTimeString('es-ES')} CET`);

  // 1. Load skipped slot state
  const skippedSlotsFile = path.resolve('./data/skipped-slots-state.json');
  let skippedSlot = null;
  if (fs.existsSync(skippedSlotsFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(skippedSlotsFile, 'utf8'));
      skippedSlot = state.lastSkippedSlot;
      if (skippedSlot) {
        const expireAt = new Date(skippedSlot.mustExpireAt);
        if (now > expireAt) {
          console.log(`⏰ Skipped slot EXPIRED (was: ${skippedSlot.slotTime})`);
          skippedSlot = null;
        } else {
          console.log(
            `⏰ Active skipped slot: ${skippedSlot.slotTime} | ` +
            `expires in ${Math.round((expireAt - now) / 1000 / 60)}min | ` +
            `reason: ${skippedSlot.reason}`
          );
        }
      }
    } catch (err) {
      console.warn(`⚠️  Error reading skipped slot: ${err.message}`);
    }
  }

  // 2. List ready candidates
  if (!fs.existsSync(QUEUE_DIR)) {
    console.log('\n❌ No queue/done directory');
    return;
  }

  const doneFiles = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json'));
  if (doneFiles.length === 0) {
    console.log('\n⚠️  No ready videos');
    return;
  }

  console.log(`\n📊 Analyzing ${doneFiles.length} ready candidates...\n`);

  const candidates = [];
  const rejects = [];

  for (const file of doneFiles) {
    try {
      const doneData = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      const videoId = doneData.videoId || doneData.id;

      const outputPath = path.join(OUTPUT_DIR, videoId, 'output.mp4');
      const publishedPath = path.join(OUTPUT_DIR, videoId, 'published.json');

      // Already published
      if (fs.existsSync(publishedPath)) {
        rejects.push({ videoId, reason: 'already_published' });
        continue;
      }

      // Output missing
      if (!fs.existsSync(outputPath)) {
        rejects.push({ videoId, reason: 'output_not_found' });
        continue;
      }

      const stats = fs.statSync(outputPath);
      const sizeKB = stats.size / 1024;
      const sizeMB = stats.size / 1024 / 1024;

      // Probe duration
      let duration = 0;
      try {
        const probeOutput = execFileSync(
          ffprobePath,
          ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', outputPath],
          { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
        );
        duration = parseFloat(probeOutput.trim());
      } catch (err) {
        rejects.push({ videoId, reason: 'ffprobe_failed' });
        continue;
      }

      // Get metadata
      const metadataPath = path.join(OUTPUT_DIR, videoId, 'metadata.json');
      let metadata = {};
      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        } catch {}
      }

      // Assess validity using central validator
      const { validatePublishCandidate } = require('./src/services/publish-candidate-validator.service');
      const validation = validatePublishCandidate({ videoId }, true);

      const statusIcon = validation.hardPassed ? '✅ OK' : '🔴 REJECT';
      console.log(
        `${statusIcon} ${videoId.substring(0, 8)} | ` +
        `${duration.toFixed(1)}s | ${sizeMB.toFixed(2)}MB | ` +
        `virality=${metadata.viralityScore || 0} QC=${metadata.qcScore || 0}`
      );

      if (validation.hardPassed) {
        candidates.push({
          videoId,
          duration,
          sizeKB,
          sizeMB,
          virality: metadata.viralityScore || 0,
          qcScore: metadata.qcScore || 0,
          priority: metadata.priority || 0,
          isValid: true,
          warnings: validation.warnings.length,
          quality: validation.quality
        });
      } else {
        rejects.push({
          videoId,
          reason: validation.hardBlocks[0] || 'unknown',
          duration,
          sizeKB,
        });
      }
    } catch (err) {
      console.error(`Error analyzing ${file}: ${err.message}`);
    }
  }

  // 3. Summary and recommendation
  console.log('\n' + '─'.repeat(70));
  console.log('DECISION:');
  console.log('─'.repeat(70));

  if (candidates.length === 0) {
    console.log('\n🔴 SLOT WILL BE SKIPPED (no valid candidates >=8s, >=300KB)');
    console.log('\nRejects breakdown:');
    const rejectsByReason = rejects.reduce((acc, r) => {
      acc[r.reason] = (acc[r.reason] || 0) + 1;
      return acc;
    }, {});
    Object.entries(rejectsByReason).forEach(([reason, count]) => {
      console.log(`  - ${reason}: ${count}`);
    });

    if (skippedSlot) {
      console.log(`\n📡 Late-publish status: ARMED (expires in ${Math.round((new Date(skippedSlot.mustExpireAt) - now) / 1000 / 60)}min)`);
      console.log('   When a valid video appears, it will be published automatically.');
    } else {
      console.log(`\n📡 Late-publish status: Will be ACTIVATED when this slot tries to run`);
    }
  } else {
    // Sort by virality
    candidates.sort((a, b) => b.virality - a.virality);
    const pick = candidates[0];

    console.log(`\n🟢 SLOT WILL BE FILLED`);
    console.log(`\nSelected candidate:`);
    console.log(`  videoId:  ${pick.videoId}`);
    console.log(`  duration: ${pick.duration.toFixed(1)}s ✅`);
    console.log(`  size:     ${pick.sizeMB.toFixed(2)}MB ✅`);
    console.log(`  virality: ${pick.virality}`);
    console.log(`  QC score: ${pick.qcScore}`);

    if (candidates.length > 1) {
      console.log(`\nAlternatives (if primary fails QC):`);
      candidates.slice(1).forEach((c, i) => {
        console.log(`  ${i + 2}. ${c.videoId.substring(0, 8)} (virality=${c.virality})`);
      });
    }

    console.log(`\n📡 Late-publish status: NOT NEEDED (slot covered)`);
    if (skippedSlot && !skippedSlot.latePublishExecuted) {
      console.log('   ⚠️  Skipped slot state exists but will be overridden by this slot fill');
    }
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

analyzeCandidates();
