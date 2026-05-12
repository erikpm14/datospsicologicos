#!/usr/bin/env node
/**
 * run-publish-safety-suite.js
 * Ejecuta todos los checks de seguridad antes de publicar.
 * Modo dry-run: no publica, solo valida.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');

const { checkAudioRealNotSilent } = require('../src/services/check-20-audio-real.service');
const { checkSubtitlesBurned } = require('../src/services/check-21-subtitles-burned.service');
const { checkVisualNotColorFallback } = require('../src/services/check-22-visual-real.service');
const { checkScriptAudioSubtitleAlignment } = require('../src/services/check-24-script-audio-subtitle-alignment.service');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../output-fase1-test'));

// Colores para consola
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

/**
 * Formato para imprimir resultados
 */
function printHeader(text) {
  console.log(`\n${colors.blue}${'═'.repeat(70)}${colors.reset}`);
  console.log(`${colors.blue}${text}${colors.reset}`);
  console.log(`${colors.blue}${'═'.repeat(70)}${colors.reset}\n`);
}

function printPass(text) {
  console.log(`${colors.green}✓ PASS${colors.reset}: ${text}`);
}

function printFail(text) {
  console.log(`${colors.red}✗ FAIL${colors.reset}: ${text}`);
}

function printWarn(text) {
  console.log(`${colors.yellow}⚠ WARN${colors.reset}: ${text}`);
}

/**
 * Ejecuta suite de checks para un videoId
 */
function runSafetyChecks(videoId) {
  printHeader(`SAFETY SUITE: ${videoId}`);

  const videoPath = path.join(OUTPUT_DIR, videoId, 'output.mp4');

  // Verificar que el archivo existe
  if (!fs.existsSync(videoPath)) {
    printFail(`Video file not found: ${videoPath}`);
    return { passed: false, reason: 'FILE_NOT_FOUND' };
  }

  printPass(`Video file exists: ${videoPath}`);

  const results = {
    videoId,
    checks: [],
    allPassed: true,
    timestamp: new Date().toISOString(),
  };

  // CHECK 19: AV Sync (ya debería estar implementado)
  console.log(`\n${colors.blue}[CHECK_19] AV_DURATION_SYNC${colors.reset}`);
  console.log('(Already validated in ready-video-validator)');

  // CHECK 20: Audio Real Not Silent
  console.log(`\n${colors.blue}[CHECK_20] AUDIO_REAL_NOT_SILENT${colors.reset}`);
  try {
    const check20Result = checkAudioRealNotSilent(videoPath);
    results.checks.push({
      name: 'CHECK_20_AUDIO_REAL_NOT_SILENT',
      result: check20Result.ready ? 'PASS' : 'FAIL',
      details: check20Result.details,
    });

    if (check20Result.ready) {
      printPass(`Audio is real and audible (mean: ${check20Result.details.meanVolume.toFixed(1)} dB, max: ${check20Result.details.maxVolume.toFixed(1)} dB)`);
    } else {
      printFail(`${check20Result.reason}`);
      if (check20Result.details.issues) {
        check20Result.details.issues.forEach(issue => printWarn(issue));
      }
      results.allPassed = false;
    }
  } catch (err) {
    printFail(`Error running CHECK_20: ${err.message}`);
    results.allPassed = false;
    results.checks.push({
      name: 'CHECK_20_AUDIO_REAL_NOT_SILENT',
      result: 'ERROR',
      error: err.message,
    });
  }

  // CHECK 21: Subtitles Burned
  console.log(`\n${colors.blue}[CHECK_21] SUBTITLES_BURNED_VISIBLE${colors.reset}`);
  const framesDir = path.join(__dirname, `../incident-bad-upload-${videoId.substring(0, 8)}/frames`);
  try {
    const check21Result = checkSubtitlesBurned(videoPath, framesDir);
    results.checks.push({
      name: 'CHECK_21_SUBTITLES_BURNED_VISIBLE',
      result: check21Result.ready ? 'PASS' : 'FAIL',
      details: check21Result.details,
    });

    if (check21Result.ready) {
      const evidence = check21Result.details.renderEvidenceSources || [];
      const sources = evidence.map(e => e.file).join(', ');
      printPass(`Subtitles are burned (evidenced by: ${sources || 'embedded streams'})`);
    } else {
      printFail(`${check21Result.reason}`);
      if (check21Result.details.issues) {
        check21Result.details.issues.forEach(issue => printWarn(issue));
      }
      results.allPassed = false;
    }
  } catch (err) {
    printFail(`Error running CHECK_21: ${err.message}`);
    results.allPassed = false;
    results.checks.push({
      name: 'CHECK_21_SUBTITLES_BURNED_VISIBLE',
      result: 'ERROR',
      error: err.message,
    });
  }

  // CHECK 22: Visual Not Color Fallback
  console.log(`\n${colors.blue}[CHECK_22] FINAL_VISUAL_NOT_COLOR_FALLBACK${colors.reset}`);
  try {
    const check22Result = checkVisualNotColorFallback(videoPath);
    results.checks.push({
      name: 'CHECK_22_FINAL_VISUAL_NOT_COLOR_FALLBACK',
      result: check22Result.ready ? 'PASS' : 'FAIL',
      details: check22Result.details,
    });

    if (check22Result.ready) {
      const bgPlan = check22Result.details.backgroundPlan;
      printPass(`Visual quality OK (diversityScore: ${bgPlan.diversityScore}, hasRealAssets: ${bgPlan.hasRealAssets})`);
    } else {
      printFail(`${check22Result.reason}`);
      if (check22Result.details.issues) {
        check22Result.details.issues.forEach(issue => printWarn(issue));
      }
      results.allPassed = false;
    }
  } catch (err) {
    printFail(`Error running CHECK_22: ${err.message}`);
    results.allPassed = false;
    results.checks.push({
      name: 'CHECK_22_FINAL_VISUAL_NOT_COLOR_FALLBACK',
      result: 'ERROR',
      error: err.message,
    });
  }

  // CHECK 24: Script-Audio-Subtitle Alignment
  console.log(`\n${colors.blue}[CHECK_24] SCRIPT_AUDIO_SUBTITLE_ALIGNMENT${colors.reset}`);
  try {
    const check24Result = checkScriptAudioSubtitleAlignment(videoPath, videoId);
    results.checks.push({
      name: 'CHECK_24_SCRIPT_AUDIO_SUBTITLE_ALIGNMENT',
      result: check24Result.pass ? 'PASS' : 'FAIL',
      details: check24Result.details,
    });

    if (check24Result.pass) {
      const details = check24Result.details || {};
      printPass(`Script, audio, and subtitles aligned (similarity: ${details.contentSimilarity || 'N/A'})`);
    } else {
      printFail(`${check24Result.error}`);
      if (check24Result.blockReason) {
        printWarn(`BLOCK REASON: ${check24Result.blockReason}`);
      }
      results.allPassed = false;
    }
  } catch (err) {
    printFail(`Error running CHECK_24: ${err.message}`);
    results.allPassed = false;
    results.checks.push({
      name: 'CHECK_24_SCRIPT_AUDIO_SUBTITLE_ALIGNMENT',
      result: 'ERROR',
      error: err.message,
    });
  }

  // RESUMEN FINAL
  printHeader('SAFETY SUITE SUMMARY');

  console.log(`VideoId: ${videoId}`);
  console.log(`Timestamp: ${results.timestamp}`);
  console.log(`\nChecks Results:`);
  results.checks.forEach(check => {
    const status = check.result === 'PASS' ? `${colors.green}${check.result}${colors.reset}` :
                   check.result === 'FAIL' ? `${colors.red}${check.result}${colors.reset}` :
                   `${colors.yellow}${check.result}${colors.reset}`;
    console.log(`  ${check.name}: ${status}`);
  });

  console.log(`\nOverall: ${results.allPassed ? `${colors.green}ALL PASSED${colors.reset}` : `${colors.red}SOME FAILED${colors.reset}`}`);
  console.log(`\n${colors.blue}Security Status: ${results.allPassed ? 'SAFE FOR PUBLICATION' : 'BLOCKED - FIX ISSUES'}${colors.reset}\n`);

  return results;
}

/**
 * Main
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node run-publish-safety-suite.js <videoId>');
    console.log('  node run-publish-safety-suite.js --all-ready');
    console.log('\nExample:');
    console.log('  node run-publish-safety-suite.js 9e3208ce-04d9-47b1-9b7a-d3c2b7025867');
    process.exit(1);
  }

  const mode = args[0];

  if (mode === '--all-ready') {
    // Scan output-fase1-test para todos los READY
    console.log(`Scanning ${OUTPUT_DIR} for READY videos...`);

    const dirs = fs.readdirSync(OUTPUT_DIR).filter(name => {
      const stat = fs.statSync(path.join(OUTPUT_DIR, name));
      return stat.isDirectory();
    });

    let passCount = 0;
    let failCount = 0;

    dirs.forEach(dir => {
      const result = runSafetyChecks(dir);
      if (result.allPassed) {
        passCount++;
      } else {
        failCount++;
      }
    });

    console.log(`\n${colors.blue}${'═'.repeat(70)}${colors.reset}`);
    console.log(`Total: ${passCount} PASS, ${failCount} FAIL`);
    console.log(`${colors.blue}${'═'.repeat(70)}${colors.reset}\n`);

  } else {
    // Single videoId
    const result = runSafetyChecks(mode);
    process.exit(result.allPassed ? 0 : 1);
  }
}

main();
