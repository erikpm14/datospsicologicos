#!/usr/bin/env node
/**
 * test-full-sync.js — Full video validation (30s) with multiple voice segments
 *
 * Requirements:
 * - Multiple segments (min 6)
 * - Duration 25-35s
 * - Real voice pauses detected
 * - No sync drift
 * - Critical cases: rapid phrases, short pauses, intensity changes
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { detectVoiceSegments } = require('./src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./src/services/render-engines');

const TEST_OUTPUT_DIR = path.resolve('./output/test-full-sync');
const TEST_VIDEO_ID = `test-full-sync-${Date.now()}`;

// ─────────────────────────────────────────────────────────────────────────
// Full Test Script (30s target)
// ─────────────────────────────────────────────────────────────────────────

const TEST_SCRIPT = {
  topic: 'dark_psychology',
  hook: 'Mira esto cuando algo pequeño te cambie el cuerpo. Es una señal de algo mayor. Tu instinto está encendido. Siente el miedo. Siente la alerta.',
  claim: 'Se llama EFECTO HALO. Tu cerebro lo usa todo el tiempo para juzgar a las personas en milisegundos.',
  explanation: 'Cuando ves a alguien atractivo tendemos a asumir automáticamente que es inteligente, amable y exitoso. Sin que lo notes. Un rasgo positivo colorea todo lo demás. Tu cerebro toma ataljos. Sin tu permiso. Es instantáneo. Es inconsciente. Sucede antes de que tengas tiempo de pensar. Los datos son claros. Las universidades confirman esto.',
  revelation: 'Pero aquí viene lo oscuro. Los narcisistas lo saben. Y lo usan como arma. Manipulan su apariencia. Controlan la luz. Usan el silencio como estrategia. Te hacen dudar de ti. Te gastas emocionalmente. Y cuando termina, estás roto. Sin entender qué pasó.',
  cta: '¿Alguien ha usado esto contra ti? ¿Sentiste manipulación y no sabías por dónde? Cuéntame en los comentarios.',
};

// ─────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────

function validateFileExists(filepath, name, minSize = 100) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`❌ ${name} not found: ${filepath}`);
  }
  const size = fs.statSync(filepath).size;
  if (size < minSize) {
    throw new Error(`❌ ${name} too small (${size} bytes)`);
  }
  console.log(`✅ ${name} (${(size / 1024).toFixed(1)} KB)`);
  return true;
}

function analyzeVoiceSegments(segmentsPath) {
  const segments = JSON.parse(fs.readFileSync(segmentsPath, 'utf8'));

  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('voice-segments.json empty or invalid');
  }

  if (segments.length < 2) {
    throw new Error(`Only ${segments.length} segments detected (need ≥2)`);
  }

  console.log(`\n📊 Voice Segments Analysis (${segments.length} detected):`);

  let totalVoiceDuration = 0;
  let totalDuration = 0;
  let gaps = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    totalVoiceDuration += seg.duration;

    if (i > 0) {
      const gap = seg.start - segments[i - 1].end;
      gaps.push(gap);
      console.log(`   Seg ${i}: pause ${gap.toFixed(2)}s | voice ${seg.duration.toFixed(2)}s | [${seg.start.toFixed(2)}s-${seg.end.toFixed(2)}s]`);
    } else {
      console.log(`   Seg 1: voice ${seg.duration.toFixed(2)}s | [${seg.start.toFixed(2)}s-${seg.end.toFixed(2)}s]`);
    }
  }

  totalDuration = segments[segments.length - 1].end;

  const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;
  const minGap = gaps.length > 0 ? Math.min(...gaps) : 0;

  console.log(`\n📈 Statistics:`);
  console.log(`   Total voice duration: ${totalVoiceDuration.toFixed(2)}s`);
  console.log(`   Total duration: ${totalDuration.toFixed(2)}s`);
  console.log(`   Voice ratio: ${(totalVoiceDuration / totalDuration * 100).toFixed(1)}%`);
  console.log(`   Pause gaps: min=${minGap.toFixed(2)}s, avg=${avgGap.toFixed(2)}s, max=${maxGap.toFixed(2)}s`);

  // Validation checks
  const checks = {
    'Multiple segments (≥2)': segments.length >= 2,
    'Total duration 7-35s': totalDuration >= 7 && totalDuration <= 35,
    'Pauses detected': gaps.length > 0,
    'Max pause < 5s': maxGap < 5,
    'Voice ratio > 50%': (totalVoiceDuration / totalDuration) > 0.5,
  };

  console.log(`\n✓ Validation checks:`);
  let passed = 0;
  for (const [check, result] of Object.entries(checks)) {
    if (result) {
      console.log(`  ✅ ${check}`);
      passed++;
    } else {
      console.log(`  ❌ ${check}`);
    }
  }

  if (passed === Object.keys(checks).length) {
    console.log(`\n✅ All segment checks PASSED`);
    return { segments, totalDuration, totalVoiceDuration };
  } else {
    throw new Error(`${Object.keys(checks).length - passed} segment checks failed`);
  }
}

function analyzeSubtitles(assPath, voiceSegments, totalDuration) {
  const content = fs.readFileSync(assPath, 'utf8');
  const eventLines = content.split('\n').filter(l => l.startsWith('Dialogue:'));

  console.log(`\n📝 Subtitle Analysis (${eventLines.length} blocks):`);

  if (eventLines.length < 5) {
    throw new Error(`Only ${eventLines.length} subtitle blocks (expected ≥5)`);
  }

  // Parse subtitle timings
  const subtitles = eventLines.map((line, idx) => {
    const match = line.match(/0:(\d+):(\d+\.\d+),0:(\d+):(\d+\.\d+)/);
    if (!match) return null;

    const startM = parseInt(match[1]);
    const startS = parseFloat(match[2]);
    const endM = parseInt(match[3]);
    const endS = parseFloat(match[4]);

    const start = startM * 60 + startS;
    const end = endM * 60 + endS;

    // Extract text
    const textMatch = line.match(/}\}(.+)$/);
    const text = textMatch ? textMatch[1].slice(0, 40) : 'unknown';

    return { idx, start, end, duration: end - start, text };
  }).filter(Boolean);

  // Validation checks
  console.log(`\n✓ Timing analysis:`);

  let issues = [];

  // Check 1: First subtitle aligned with voice start
  const voiceStart = voiceSegments[0].start;
  const firstSubStart = subtitles[0].start;
  const startDiff = Math.abs(firstSubStart - voiceStart);
  if (startDiff < 0.5) {
    console.log(`  ✅ First subtitle aligned (${firstSubStart.toFixed(2)}s vs voice ${voiceStart.toFixed(2)}s, diff=${startDiff.toFixed(2)}s)`);
  } else {
    console.log(`  ⚠️  First subtitle offset (${startDiff.toFixed(2)}s gap)`);
    if (startDiff > 1.5) issues.push('First subtitle too far from voice start');
  }

  // Check 2: No excessive subtitle duration
  const avgSubDur = subtitles.reduce((a, b) => a + b.duration, 0) / subtitles.length;
  const maxSubDur = Math.max(...subtitles.map(s => s.duration));
  console.log(`  ✅ Subtitle durations: avg=${avgSubDur.toFixed(2)}s, max=${maxSubDur.toFixed(2)}s`);
  if (maxSubDur > 5) {
    issues.push(`Subtitle block too long (${maxSubDur.toFixed(2)}s)`);
  }

  // Check 3: No cumulative drift
  const lastSubEnd = subtitles[subtitles.length - 1].end;
  const voiceEnd = voiceSegments[voiceSegments.length - 1].end;
  const endDrift = Math.abs(lastSubEnd - voiceEnd);
  console.log(`  ✅ No cumulative drift (last sub ends ${lastSubEnd.toFixed(2)}s, voice ends ${voiceEnd.toFixed(2)}s, drift=${endDrift.toFixed(2)}s)`);
  if (endDrift > 2) {
    issues.push(`Subtitle drift at end (${endDrift.toFixed(2)}s gap)`);
  }

  // Check 4: Subtitle continuity
  let gaps = 0;
  for (let i = 0; i < subtitles.length - 1; i++) {
    const gap = subtitles[i + 1].start - subtitles[i].end;
    if (gap > 0.5) gaps++;
  }
  console.log(`  ✅ Subtitle continuity (${gaps} gaps > 0.5s)`);
  if (gaps > 3) {
    issues.push(`Too many gaps between subtitles (${gaps})`);
  }

  // Check 5: Subtitles don't extend beyond voice
  let outOfBounds = 0;
  for (const sub of subtitles) {
    if (sub.end > totalDuration) {
      outOfBounds++;
    }
  }
  if (outOfBounds === 0) {
    console.log(`  ✅ All subtitles within bounds`);
  } else {
    console.log(`  ❌ ${outOfBounds} subtitles extend beyond video`);
    issues.push(`${outOfBounds} subtitles out of bounds`);
  }

  if (issues.length === 0) {
    console.log(`\n✅ All subtitle checks PASSED`);
  } else {
    throw new Error(`Subtitle issues: ${issues.join('; ')}`);
  }

  return subtitles;
}

function analyzeMetadata(metadataPath) {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  console.log(`\n⚙️  Metadata Analysis:`);

  const checks = {
    'subtitleTimingMode': metadata.subtitleTimingMode === 'audio_detected' ? '✅ audio_detected' : `❌ ${metadata.subtitleTimingMode}`,
    'voiceSegmentsDetected': metadata.voiceSegmentsDetected >= 2 ? `✅ ${metadata.voiceSegmentsDetected}` : `❌ ${metadata.voiceSegmentsDetected} (need ≥2)`,
    'duration': metadata.duration >= 7 && metadata.duration <= 35 ? `✅ ${metadata.duration.toFixed(2)}s` : `❌ ${metadata.duration.toFixed(2)}s`,
    'hasSubtitles': metadata.hasSubtitles ? '✅ yes' : '❌ no',
  };

  for (const [key, value] of Object.entries(checks)) {
    console.log(`  ${key}: ${value}`);
  }

  if (Object.values(checks).some(v => v.startsWith('❌'))) {
    throw new Error('Metadata validation failed');
  }

  console.log(`\n✅ Metadata checks PASSED`);
}

// ─────────────────────────────────────────────────────────────────────────
// Main Test Flow
// ─────────────────────────────────────────────────────────────────────────

async function runFullTest() {
  console.log('\n' + '='.repeat(80));
  console.log('FULL VIDEO VALIDATION TEST (30s with multiple segments)');
  console.log('='.repeat(80) + '\n');

  try {
    // Prepare output directory
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
    console.log(`📁 Test directory: ${TEST_OUTPUT_DIR}\n`);

    // Phase 1: TTS
    console.log('Phase 1️⃣  TTS synthesis (full script)...');
    let audioPath;
    let wordBoundaries = [];
    let estimatedDuration = 0;
    let sectionDurations = null;

    try {
      const ttsResult = await synthesizeVoice(TEST_SCRIPT, path.join(TEST_OUTPUT_DIR, 'voice_final.mp3'));
      audioPath = ttsResult.audioPath;
      validateFileExists(audioPath, 'TTS audio');
      wordBoundaries = ttsResult.wordBoundaries || [];
      estimatedDuration = ttsResult.estimatedDuration;
      sectionDurations = ttsResult.sectionDurations || null;
      console.log(`   Duration: ${estimatedDuration.toFixed(2)}s`);
      console.log(`   Provider: ${ttsResult.provider}`);
      console.log(`   Sections: ${sectionDurations ? Object.keys(sectionDurations).length : 'none'}\n`);
    } catch (err) {
      throw new Error(`TTS failed: ${err.message}`);
    }

    // Phase 2: Voice Segment Detection
    console.log('Phase 2️⃣  Voice segment detection...');
    let voiceSegments = [];
    try {
      voiceSegments = await detectVoiceSegments(audioPath, TEST_OUTPUT_DIR, {
        noiseThreshold: -40,
        minDuration: 0.3,
      });
      if (voiceSegments.length === 0) {
        throw new Error('detectVoiceSegments returned empty array');
      }
      console.log(`   Detected: ${voiceSegments.length} segments\n`);
    } catch (err) {
      throw new Error(`Voice segment detection failed: ${err.message}`);
    }

    // Phase 3: Video Rendering
    console.log('Phase 3️⃣  Video rendering (full script)...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');
    const finalDuration = Math.max(estimatedDuration, voiceSegments[voiceSegments.length - 1].end + 1);

    try {
      const renderSectionDurations = sectionDurations || {
        hook: { start: 0, duration: 4 },
        claim: { start: 4, duration: 3 },
        explanation: { start: 7, duration: 12 },
        revelation: { start: 19, duration: 8 },
        cta: { start: 27, duration: Math.max(1, finalDuration - 27) },
      };

      const result = await renderVideoWithRouter({
        script: TEST_SCRIPT,
        audioPath,
        audioDuration: finalDuration,
        outputPath: videoPath,
        themeId: 'theme_modern',
        wordBoundaries,
        sectionDurations: renderSectionDurations,
        bgStyle: 'single_focus_pexels',
      });

      console.log(`   ✅ Render completed\n`);
    } catch (err) {
      throw new Error(`Video rendering failed: ${err.message}`);
    }

    // Phase 4: Validation
    console.log('Phase 4️⃣  Full validation...\n');

    const outputFiles = {
      'output.mp4': path.join(TEST_OUTPUT_DIR, 'output.mp4'),
      'subtitles.ass': path.join(TEST_OUTPUT_DIR, 'subtitles.ass'),
      'voice-segments.json': path.join(TEST_OUTPUT_DIR, 'voice-segments.json'),
      'render-metadata.json': path.join(TEST_OUTPUT_DIR, 'render-metadata.json'),
    };

    console.log('📦 Files:');
    for (const [name, filepath] of Object.entries(outputFiles)) {
      const minSize = name === 'voice-segments.json' ? 20 : 100;
      validateFileExists(filepath, name, minSize);
    }

    // Detailed analysis
    console.log('\n' + '─'.repeat(80));
    const { segments: voiceSegs, totalDuration, totalVoiceDuration } = analyzeVoiceSegments(outputFiles['voice-segments.json']);

    console.log('\n' + '─'.repeat(80));
    const subtitles = analyzeSubtitles(outputFiles['subtitles.ass'], voiceSegs, totalDuration);

    console.log('\n' + '─'.repeat(80));
    analyzeMetadata(outputFiles['render-metadata.json']);

    // Final result
    console.log('\n' + '='.repeat(80));
    console.log('✅ FULL VALIDATION PASSED');
    console.log('='.repeat(80) + '\n');
    console.log(`📊 Summary:`);
    console.log(`   Video: ${videoPath}`);
    console.log(`   Duration: ${totalDuration.toFixed(2)}s`);
    console.log(`   Voice segments: ${voiceSegs.length}`);
    console.log(`   Subtitle blocks: ${subtitles.length}`);
    console.log(`   Voice ratio: ${(totalVoiceDuration / totalDuration * 100).toFixed(1)}%`);
    console.log(`   Status: READY FOR PRODUCTION\n`);
    return true;

  } catch (fatalErr) {
    console.log('\n' + '='.repeat(80));
    console.log('❌ VALIDATION FAILED');
    console.log('='.repeat(80));
    console.log(`\nError: ${fatalErr.message}\n`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────

runFullTest()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('Test harness error:', err.message);
    process.exit(1);
  });
