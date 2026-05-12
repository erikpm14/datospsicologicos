#!/usr/bin/env node

/**
 * validate-reprocessed.js
 *
 * Validates a reprocessed video against validateReadyVideo() and cross-backup diversity
 * Usage: node scripts/validate-reprocessed.js <videoId> <principalVideoId>
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const { validateReadyVideo } = require('../src/services/ready-video-validator.service');

// String similarity using Levenshtein distance
function stringSimilarity(str1 = '', str2 = '') {
  const s1 = (str1 || '').toLowerCase().trim();
  const s2 = (str2 || '').toLowerCase().trim();

  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const longerLength = longer.length;

  if (longerLength === 0) return 100;

  const editDistance = _levenshteinDistance(longer, shorter);
  return Math.round((1.0 - editDistance / longerLength) * 100);
}

function _levenshteinDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

const videoId = process.argv[2];
const principalVideoId = process.argv[3];

if (!videoId || !principalVideoId) {
  console.error('\n❌ Usage: node scripts/validate-reprocessed.js <videoId> <principalVideoId>\n');
  process.exit(1);
}

(async () => {
  try {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  VALIDATE REPROCESSED VIDEO                            ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    // Validate the video
    console.log(`🔍 Validating: ${videoId}`);
    const validationResult = validateReadyVideo(videoId);

    const isValid = validationResult.valid || validationResult.ready;
    if (!isValid) {
      console.error(`\n❌ VALIDATION FAILED:\n${validationResult.errors.join('\n')}\n`);
      process.exit(1);
    }

    console.log(`✅ Validation PASSED\n`);
    console.log('Checks:');
    Object.entries(validationResult.checks || {}).forEach(([key, value]) => {
      const icon = value === true ? '✅' : value === false ? '❌' : '⚠️';
      console.log(`  ${icon} ${key}: ${value}`);
    });

    // Now check cross-backup diversity with principal
    console.log(`\n🔍 Cross-backup diversity check against: ${principalVideoId}`);

    const videoDir = path.resolve(`output-fase1-test/${videoId}`);
    const principalDir = path.resolve(`output-fase1-test/${principalVideoId}`);

    const videoMetadata = JSON.parse(fs.readFileSync(path.join(videoDir, 'generation-metadata.json'), 'utf8'));
    const principalMetadata = JSON.parse(fs.readFileSync(path.join(principalDir, 'generation-metadata.json'), 'utf8'));

    const hook1 = videoMetadata.hook || '';
    const hook2 = principalMetadata.hook || '';
    const title1 = videoMetadata.title || videoMetadata.hook || '';
    const title2 = principalMetadata.title || principalMetadata.hook || '';

    // Get full scripts from script.json if available
    let script1 = '';
    let script2 = '';
    const scriptPath1 = path.join(videoDir, 'script.json');
    const scriptPath2 = path.join(principalDir, 'script.json');

    if (fs.existsSync(scriptPath1)) {
      const scriptData = JSON.parse(fs.readFileSync(scriptPath1, 'utf8'));
      script1 = (scriptData.hook || '') + ' ' + (scriptData.description || '');
      // Add all segments
      if (scriptData.segments) {
        script1 += ' ' + scriptData.segments.map(s => s.content).join(' ');
      }
    }

    if (fs.existsSync(scriptPath2)) {
      const scriptData = JSON.parse(fs.readFileSync(scriptPath2, 'utf8'));
      script2 = (scriptData.hook || '') + ' ' + (scriptData.description || '');
      if (scriptData.segments) {
        script2 += ' ' + scriptData.segments.map(s => s.content).join(' ');
      }
    }

    // Calculate similarities (return 0-100 scale, convert to 0-1 for comparison)
    const hookSim = stringSimilarity(hook1, hook2) / 100;
    const titleSim = stringSimilarity(title1, title2) / 100;
    const scriptSim = script1 && script2 ? stringSimilarity(script1, script2) / 100 : 0;

    console.log(`\nDiversity Metrics:`);
    console.log(`  Hook similarity:   ${(hookSim * 100).toFixed(1)}% (threshold: <60%)`);
    console.log(`  Title similarity:  ${(titleSim * 100).toFixed(1)}% (threshold: <60%)`);
    console.log(`  Script similarity: ${(scriptSim * 100).toFixed(1)}% (threshold: <60%)`);

    const hookOk = hookSim < 0.60;
    const titleOk = titleSim < 0.60;
    const scriptOk = scriptSim < 0.60;

    console.log(`\nResults:`);
    console.log(`  ${hookOk ? '✅' : '❌'} Hook: ${(hookSim * 100).toFixed(1)}%`);
    console.log(`  ${titleOk ? '✅' : '❌'} Title: ${(titleSim * 100).toFixed(1)}%`);
    console.log(`  ${scriptOk ? '✅' : '❌'} Script: ${(scriptSim * 100).toFixed(1)}%`);

    if (hookOk && titleOk && scriptOk) {
      console.log(`\n✅ DIVERSITY VALIDATION PASSED - Video can be used as backup\n`);
      logger.info(`REPROCESSED_VIDEO_VALID videoId=${videoId}`);
      process.exit(0);
    } else {
      console.log(`\n❌ DIVERSITY VALIDATION FAILED - Similarity too high\n`);
      logger.error(`REPROCESSED_VIDEO_REJECTED videoId=${videoId}`);
      process.exit(1);
    }

  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    logger.error(`VALIDATION_ERROR | ${err.message}`);
    process.exit(1);
  }
})();
