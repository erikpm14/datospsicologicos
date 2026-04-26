#!/usr/bin/env node
/**
 * test-audio-sync.js — Isolated validation of audio-subtitle synchronization
 *
 * Flow: TTS → audio final → detectVoiceSegments → subtítulos → render → QC
 * No publication, no scheduling, no scoring modifications
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { postprocessAudioSafe } = require('./src/services/audio-postprocess');
const { detectVoiceSegments } = require('./src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./src/services/render-engines');

const TEST_OUTPUT_DIR = path.resolve('./output/test-audio-sync');
const TEST_VIDEO_ID = `test-sync-${Date.now()}`;

// ─────────────────────────────────────────────────────────────────────────
// Test Script
// ─────────────────────────────────────────────────────────────────────────

const TEST_SCRIPT = {
  topic: 'relationships',
  hook: 'Mira esto cuando algo pequeño te cambie el cuerpo.',
  claim: 'Se llama EFECTO HALO.',
  explanation: 'Cuando ves a alguien atractivo, tendemos a asumir que es inteligente, amable y exitoso. Sin que lo notes, un rasgo positivo colorea todo lo demás.',
  revelation: 'Tu cerebro toma atalhos automáticamente.',
  cta: '¿Te ha pasado contigo?',
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
    throw new Error(`❌ ${name} file too small (${size} bytes)`);
  }
  console.log(`✅ ${name} exists (${(size / 1024).toFixed(1)} KB)`);
  return true;
}

function validateMetadata(metadataPath) {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  const checks = [
    {
      name: 'subtitleTimingMode',
      check: () => {
        if (metadata.subtitleTimingMode === 'audio_detected') {
          console.log(`✅ subtitleTimingMode: audio_detected`);
          return true;
        }
        throw new Error(`Expected "audio_detected", got "${metadata.subtitleTimingMode}"`);
      },
    },
    {
      name: 'voiceSegmentsDetected > 0',
      check: () => {
        if ((metadata.voiceSegmentsDetected || 0) > 0) {
          console.log(`✅ voiceSegmentsDetected: ${metadata.voiceSegmentsDetected}`);
          return true;
        }
        throw new Error(`Expected > 0, got ${metadata.voiceSegmentsDetected}`);
      },
    },
    {
      name: 'duration coherent',
      check: () => {
        const dur = metadata.duration;
        if (dur && dur > 1 && dur < 120) {
          console.log(`✅ duration: ${dur.toFixed(2)}s (coherent range [1-120]s)`);
          return true;
        }
        throw new Error(`Duration ${dur} outside expected range [1-120]s`);
      },
    },
  ];

  let passed = 0;
  for (const check of checks) {
    try {
      check.check();
      passed++;
    } catch (err) {
      console.log(`❌ ${check.name}: ${err.message}`);
    }
  }

  return passed === checks.length;
}

function validateVoiceSegments(segmentsPath) {
  const segments = JSON.parse(fs.readFileSync(segmentsPath, 'utf8'));

  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error(`voice-segments.json empty or invalid`);
  }

  console.log(`✅ voice-segments.json: ${segments.length} segments`);

  // Validate segment structure
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!('start' in seg) || !('end' in seg) || !('duration' in seg)) {
      throw new Error(`Segment ${i} missing start/end/duration`);
    }
    if (seg.end <= seg.start) {
      throw new Error(`Segment ${i} end <= start`);
    }
    if (Math.abs(seg.duration - (seg.end - seg.start)) > 0.01) {
      throw new Error(`Segment ${i} duration mismatch`);
    }
  }

  console.log(`✅ All ${segments.length} segments validated`);
  return segments;
}

function validateSubtitlesASS(assPath, voiceSegments) {
  const content = fs.readFileSync(assPath, 'utf8');

  if (!content.includes('[Events]')) {
    throw new Error('ASS file missing [Events] section');
  }

  const eventLines = content.split('\n').filter(l => l.startsWith('Dialogue:'));
  console.log(`✅ ASS file: ${eventLines.length} dialogue lines`);

  if (eventLines.length === 0) {
    throw new Error('No dialogue events in ASS file');
  }

  // Parse first event timing
  const firstLine = eventLines[0];
  const timeMatch = firstLine.match(/(\d+):(\d+):(\d+\.\d+)/);
  if (timeMatch) {
    const h = parseInt(timeMatch[1]);
    const m = parseInt(timeMatch[2]);
    const s = parseFloat(timeMatch[3]);
    const startTime = h * 3600 + m * 60 + s;

    // First subtitle should start close to first voice segment
    const firstVoiceStart = voiceSegments[0].start;
    const diff = Math.abs(startTime - firstVoiceStart);

    if (diff < 0.5) {
      console.log(`✅ First subtitle at ${startTime.toFixed(2)}s (voice starts at ${firstVoiceStart.toFixed(2)}s) - ALIGNED`);
    } else {
      console.log(`⚠️  First subtitle at ${startTime.toFixed(2)}s (voice starts at ${firstVoiceStart.toFixed(2)}s) - offset ${diff.toFixed(2)}s`);
      if (diff > 2) {
        throw new Error(`First subtitle too far from voice start (${diff.toFixed(2)}s gap)`);
      }
    }
  }

  return eventLines.length;
}

// ─────────────────────────────────────────────────────────────────────────
// Main Test Flow
// ─────────────────────────────────────────────────────────────────────────

async function runTest() {
  console.log('\n' + '='.repeat(70));
  console.log('AUDIO-SUBTITLE SYNCHRONIZATION TEST');
  console.log('='.repeat(70) + '\n');

  try {
    // Prepare output directory
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
    console.log(`📁 Test directory: ${TEST_OUTPUT_DIR}\n`);

    // Phase 1: TTS
    console.log('Phase 1️⃣  TTS synthesis...');
    let audioPath;
    let wordBoundaries = [];
    let estimatedDuration = 0;
    let sectionDurations = null;

    try {
      // Generar un outputPath que synthesizeVoice pueda usar
      const ttsOutputDir = TEST_OUTPUT_DIR;
      const ttsOutputPath = path.join(ttsOutputDir, 'voice_final.mp3');

      // TTS retorna audioPath (puede ser WAV o MP3 según el provider)
      const ttsResult = await synthesizeVoice(TEST_SCRIPT, ttsOutputPath);
      audioPath = ttsResult.audioPath;
      validateFileExists(audioPath, 'TTS audio');
      wordBoundaries = ttsResult.wordBoundaries || [];
      estimatedDuration = ttsResult.estimatedDuration;
      sectionDurations = ttsResult.sectionDurations || null;
      console.log(`   Estimated duration: ${estimatedDuration.toFixed(2)}s`);
      console.log(`   Provider: ${ttsResult.provider}`);
      console.log(`   Word boundaries: ${wordBoundaries.length}`);
      console.log(`   Section durations: ${sectionDurations ? Object.keys(sectionDurations).length + ' sections' : 'none'}\n`);
    } catch (err) {
      throw new Error(`TTS failed: ${err.message}`);
    }

    // Phase 2: Voice Segment Detection
    console.log('Phase 2️⃣  Voice segment detection (silencedetect)...');
    let voiceSegments = [];
    try {
      voiceSegments = await detectVoiceSegments(audioPath, TEST_OUTPUT_DIR, {
        noiseThreshold: -40,
        minDuration: 0.3,
      });
      if (voiceSegments.length === 0) {
        throw new Error('detectVoiceSegments returned empty array');
      }
      console.log(`   Detected ${voiceSegments.length} voice segments`);
      voiceSegments.forEach((seg, i) => {
        console.log(`     ${i + 1}. [${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s] (${seg.duration.toFixed(2)}s)`);
      });
      console.log();
    } catch (err) {
      throw new Error(`Voice segment detection failed: ${err.message}`);
    }

    // Phase 3: Subtitle Building & Rendering
    console.log('Phase 3️⃣  Building subtitles and rendering video...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');
    const finalDuration = Math.max(estimatedDuration, voiceSegments[voiceSegments.length - 1].end + 1);

    try {
      // Usar sectionDurations del TTS si están disponibles (Kokoro segmentado),
      // si no, crear unos básicos basados en duración estimada
      const renderSectionDurations = sectionDurations || {
        hook: { start: 0, duration: 1.5 },
        claim: { start: 1.5, duration: 2.0 },
        explanation: { start: 3.5, duration: 5.0 },
        revelation: { start: 8.5, duration: 2.5 },
        cta: { start: 11, duration: Math.max(1, finalDuration - 11) },
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

      console.log(`   ✅ Video render completed\n`);
    } catch (err) {
      throw new Error(`Video rendering failed: ${err.message}`);
    }

    // Phase 4: Validation
    console.log('Phase 4️⃣  Output validation...\n');

    const outputFiles = {
      'output.mp4': path.join(TEST_OUTPUT_DIR, 'output.mp4'),
      'subtitles.ass': path.join(TEST_OUTPUT_DIR, 'subtitles.ass'),
      'subtitles.srt': path.join(TEST_OUTPUT_DIR, 'subtitles.srt'),
      'voice-segments.json': path.join(TEST_OUTPUT_DIR, 'voice-segments.json'),
      'render-metadata.json': path.join(TEST_OUTPUT_DIR, 'render-metadata.json'),
    };

    let validationPassed = true;

    for (const [name, filepath] of Object.entries(outputFiles)) {
      try {
        // voice-segments.json puede ser pequeño si hay pocos segmentos
        const minSize = name === 'voice-segments.json' ? 20 : 100;
        validateFileExists(filepath, name, minSize);
      } catch (err) {
        console.log(err.message);
        validationPassed = false;
      }
    }

    console.log();

    // Metadata validation
    try {
      const metadata = validateMetadata(outputFiles['render-metadata.json']);
    } catch (err) {
      console.log(`❌ Metadata validation: ${err.message}`);
      validationPassed = false;
    }

    console.log();

    // Voice segments validation
    try {
      validateVoiceSegments(outputFiles['voice-segments.json']);
    } catch (err) {
      console.log(`❌ Voice segments validation: ${err.message}`);
      validationPassed = false;
    }

    console.log();

    // Subtitle timing validation
    try {
      validateSubtitlesASS(outputFiles['subtitles.ass'], voiceSegments);
    } catch (err) {
      console.log(`❌ Subtitle timing validation: ${err.message}`);
      validationPassed = false;
    }

    console.log();

    // Final result
    console.log('='.repeat(70));
    if (validationPassed) {
      console.log('✅ ALL VALIDATIONS PASSED');
      console.log('='.repeat(70) + '\n');
      console.log(`📊 Test Results:`);
      console.log(`   Video: ${videoPath}`);
      console.log(`   Voice segments: ${voiceSegments.length}`);
      console.log(`   Status: READY FOR PM2 RESTART\n`);
      return true;
    } else {
      console.log('❌ VALIDATION FAILED');
      console.log('='.repeat(70) + '\n');
      console.log('Review errors above before proceeding.\n');
      return false;
    }

  } catch (fatalErr) {
    console.log('\n' + '='.repeat(70));
    console.log('❌ FATAL ERROR');
    console.log('='.repeat(70));
    console.log(`Error: ${fatalErr.message}\n`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────

runTest()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('Test harness error:', err.message);
    process.exit(1);
  });
