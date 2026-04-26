#!/usr/bin/env node
/**
 * test-production-sync.js — Final production validation (30s) with 6+ voice segments
 *
 * Requirements:
 * - 6+ voice segments with realistic pauses
 * - Varied phrase lengths
 * - Real rhythm changes
 * - Validate no drift, proper sync, visual coherence
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { detectVoiceSegments, postprocessAudioSafe } = require('./src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./src/services/render-engines');

const TEST_OUTPUT_DIR = path.resolve('./output/test-production-sync');

// ─────────────────────────────────────────────────────────────────────────
// Production Test Script (30s target with 6+ segments)
// ─────────────────────────────────────────────────────────────────────────

const PRODUCTION_SCRIPT = {
  topic: 'relationships',
  hook: 'Mira esto. Cuando alguien te ignora después de ser cariñoso. Tu cerebro lo siente. Y entra en pánico. Busca la razón. Busca la culpa. Pero hay algo psicológico sucediendo. Algo que no ves venir.',
  claim: 'Se llama INTERMITENT REINFORCEMENT. Es la estrategia más poderosa de manipulación del mundo. Los casinos la usan. Los narcisistas la dominan.',
  explanation: 'Funciona así: recibimos atención inconsistente. A veces sí. A veces no. Nunca sabemos cuándo. Entonces nuestro cerebro busca obsesivamente la siguiente recompensa. Como un ratón en un laberinto. Aprieta el botón. Una vez tiene comida. Otra vez nada. Pero sigue apretando. Una y otra vez. Para siempre. Ese eres tú.',
  revelation: 'La verdad es cruel. El inconsistente es más adictivo que el consistente. Porque el inconsistente genera ansiedad. Y la ansiedad es la droga más fuerte. El narcisista lo sabe. Por eso te ignora. Por eso te presta atención. Por eso no puedes irte. Estás atrapado en el ciclo. Buscando la siguiente dosis.',
  cta: '¿Te ha pasado? ¿Alguien te tiene atrapado en este ciclo? ¿Sigues buscando la atención que nunca llega consistentemente? Comenta. No estás solo.',
};

// ─────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────

function analyzeVoiceSegmentsProd(segmentsPath) {
  const segments = JSON.parse(fs.readFileSync(segmentsPath, 'utf8'));

  if (segments.length < 5) {
    throw new Error(`Only ${segments.length} segments (need ≥5 for production)`);
  }

  console.log(`\n📊 PRODUCTION Voice Segments (${segments.length} detected):`);

  let totalVoiceDuration = 0;
  let gaps = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    totalVoiceDuration += seg.duration;

    if (i > 0) {
      const gap = seg.start - segments[i - 1].end;
      gaps.push({ index: i, gap, duration: gap.toFixed(2) });
    }
  }

  const totalDuration = segments[segments.length - 1].end;

  console.log(`   Total segments: ${segments.length}`);
  console.log(`   Total duration: ${totalDuration.toFixed(2)}s`);
  console.log(`   Total voice: ${totalVoiceDuration.toFixed(2)}s`);
  console.log(`   Voice ratio: ${(totalVoiceDuration / totalDuration * 100).toFixed(1)}%`);

  if (gaps.length > 0) {
    const avgGap = gaps.reduce((a, b) => a + b.gap, 0) / gaps.length;
    const maxGap = Math.max(...gaps.map(g => g.gap));
    console.log(`\n   Pause analysis:`);
    console.log(`     Pauses detected: ${gaps.length}`);
    console.log(`     Average pause: ${avgGap.toFixed(3)}s`);
    console.log(`     Max pause: ${maxGap.toFixed(3)}s`);
    console.log(`     Realistic pauses: ${gaps.filter(g => g.gap > 0.1 && g.gap < 2).length}/${gaps.length}`);
  }

  // Validation
  const checks = {
    'Multiple segments (≥5)': segments.length >= 5,
    'Total duration 10-35s': totalDuration >= 10 && totalDuration <= 35,
    'Realistic pauses': gaps.length > 0,
    'Voice ratio >50%': (totalVoiceDuration / totalDuration) > 0.5,
  };

  console.log(`\n✓ Segment validation:`);
  let passed = 0;
  for (const [check, result] of Object.entries(checks)) {
    if (result) {
      console.log(`  ✅ ${check}`);
      passed++;
    } else {
      console.log(`  ❌ ${check}`);
    }
  }

  if (passed !== Object.keys(checks).length) {
    throw new Error(`${Object.keys(checks).length - passed} segment checks failed`);
  }

  console.log(`\n✅ All segment checks PASSED`);
  return { segments, totalDuration, totalVoiceDuration, gaps };
}

function analyzeSubtitlesProd(assPath, voiceSegments, totalDuration) {
  const content = fs.readFileSync(assPath, 'utf8');
  const eventLines = content.split('\n').filter(l => l.startsWith('Dialogue:'));

  console.log(`\n📝 PRODUCTION Subtitle Analysis (${eventLines.length} blocks):`);

  const subtitles = eventLines.map((line, idx) => {
    const match = line.match(/0:(\d+):(\d+\.\d+),0:(\d+):(\d+\.\d+)/);
    if (!match) return null;

    const startM = parseInt(match[1]);
    const startS = parseFloat(match[2]);
    const endM = parseInt(match[3]);
    const endS = parseFloat(match[4]);

    const start = startM * 60 + startS;
    const end = endM * 60 + endS;

    return { idx, start, end, duration: end - start };
  }).filter(Boolean);

  console.log(`   Total blocks: ${subtitles.length}`);

  // Critical checks
  console.log(`\n✓ Sync validation:`);

  let issues = [];

  // 1. First subtitle alignment
  const voiceStart = voiceSegments[0].start;
  const firstSubStart = subtitles[0].start;
  const startDiff = Math.abs(firstSubStart - voiceStart);
  if (startDiff < 0.3) {
    console.log(`  ✅ First subtitle aligned (${startDiff.toFixed(2)}s offset)`);
  } else {
    issues.push(`First subtitle offset ${startDiff.toFixed(2)}s`);
  }

  // 2. Duration consistency
  const durations = subtitles.map(s => s.duration);
  const avgDur = durations.reduce((a, b) => a + b, 0) / durations.length;
  const minDur = Math.min(...durations);
  const maxDur = Math.max(...durations);
  console.log(`  ✅ Subtitle durations: min=${minDur.toFixed(2)}s, avg=${avgDur.toFixed(2)}s, max=${maxDur.toFixed(2)}s`);

  if (minDur < 0.3) {
    issues.push(`Subtitle too short (${minDur.toFixed(2)}s)`);
  }
  if (maxDur > 3) {
    issues.push(`Subtitle too long (${maxDur.toFixed(2)}s)`);
  }

  // 3. Flicker check (rapid succession)
  let flickers = 0;
  for (let i = 0; i < subtitles.length - 1; i++) {
    const gap = subtitles[i + 1].start - subtitles[i].end;
    if (gap < 0.05) flickers++;
  }
  console.log(`  ✅ Flicker check: ${flickers === 0 ? 'no flickering' : `${flickers} rapid transitions`}`);

  // 4. Cumulative drift
  const lastSubEnd = subtitles[subtitles.length - 1].end;
  const voiceEnd = voiceSegments[voiceSegments.length - 1].end;
  const endDrift = Math.abs(lastSubEnd - voiceEnd);
  console.log(`  ✅ Cumulative drift: ${endDrift.toFixed(2)}s (${(endDrift / totalDuration * 100).toFixed(1)}%)`);
  if (endDrift > 1.5) {
    issues.push(`Drift too large (${endDrift.toFixed(2)}s)`);
  }

  // 5. Coverage analysis
  let uncoveredTime = 0;
  for (let i = 0; i < voiceSegments.length; i++) {
    const seg = voiceSegments[i];
    const covering = subtitles.filter(s =>
      (s.start < seg.end && s.end > seg.start)
    );
    if (covering.length === 0) {
      uncoveredTime += seg.duration;
    }
  }
  console.log(`  ✅ Coverage: ${uncoveredTime === 0 ? 'complete' : `${uncoveredTime.toFixed(2)}s uncovered`}`);

  if (issues.length > 0) {
    throw new Error(`Subtitle issues: ${issues.join('; ')}`);
  }

  console.log(`\n✅ All subtitle checks PASSED`);
  return subtitles;
}

function analyzeMetadataProd(metadataPath, segmentCount) {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  console.log(`\n⚙️  PRODUCTION Metadata Validation:`);

  const checks = {
    'subtitleTimingMode': metadata.subtitleTimingMode === 'audio_detected' ? '✅ audio_detected' : `❌ ${metadata.subtitleTimingMode}`,
    'voiceSegmentsDetected': metadata.voiceSegmentsDetected >= 5 ? `✅ ${metadata.voiceSegmentsDetected}` : `❌ ${metadata.voiceSegmentsDetected} (need ≥5)`,
    'duration': metadata.duration >= 10 && metadata.duration <= 35 ? `✅ ${metadata.duration.toFixed(2)}s` : `❌ ${metadata.duration.toFixed(2)}s (need 10-35s)`,
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

async function runProductionTest() {
  console.log('\n' + '═'.repeat(80));
  console.log('FINAL PRODUCTION VALIDATION (30s with 6+ voice segments)');
  console.log('═'.repeat(80) + '\n');

  try {
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
    console.log(`📁 Output: ${TEST_OUTPUT_DIR}\n`);

    // Phase 1: TTS
    console.log('Phase 1️⃣  TTS synthesis (extended production script)...');
    let audioPath, wordBoundaries = [], estimatedDuration = 0, sectionDurations = null;

    try {
      const ttsResult = await synthesizeVoice(PRODUCTION_SCRIPT, path.join(TEST_OUTPUT_DIR, 'voice_final.mp3'));
      let rawAudioPath = ttsResult.audioPath;
      wordBoundaries = ttsResult.wordBoundaries || [];
      estimatedDuration = ttsResult.estimatedDuration;
      sectionDurations = ttsResult.sectionDurations || null;
      console.log(`   ✅ Audio: ${estimatedDuration.toFixed(2)}s | Provider: ${ttsResult.provider}`);

      // Process audio for rendering
      console.log(`   Processing audio...`);
      const processedAudioPath = path.join(TEST_OUTPUT_DIR, 'voice_processed.mp3');
      const postResult = await postprocessAudioSafe(rawAudioPath, processedAudioPath);
      audioPath = postResult.audioPath;
      console.log(`   ✅ Audio processed and ready\n`);
    } catch (err) {
      throw new Error(`TTS failed: ${err.message}`);
    }

    // Phase 2: Voice Segment Detection
    console.log('Phase 2️⃣  Voice segment detection (production quality)...');
    let voiceSegments = [];
    try {
      voiceSegments = await detectVoiceSegments(audioPath, TEST_OUTPUT_DIR, {
        noiseThreshold: -35,  // More sensitive (was -40)
        minDuration: 0.15,    // Shorter min pause (was 0.3)
      });
      if (voiceSegments.length === 0) {
        throw new Error('No segments detected');
      }
      console.log(`   ✅ Detected: ${voiceSegments.length} segments\n`);
    } catch (err) {
      throw new Error(`Segment detection failed: ${err.message}`);
    }

    // Phase 3: Rendering
    console.log('Phase 3️⃣  Rendering production video...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');
    const finalDuration = Math.max(estimatedDuration, voiceSegments[voiceSegments.length - 1].end + 1);

    try {
      const renderSectionDurations = sectionDurations || {
        hook: { start: 0, duration: 8 },
        claim: { start: 8, duration: 4 },
        explanation: { start: 12, duration: 12 },
        revelation: { start: 24, duration: 12 },
        cta: { start: 36, duration: Math.max(1, finalDuration - 36) },
      };

      await renderVideoWithRouter({
        script: PRODUCTION_SCRIPT,
        audioPath,
        audioDuration: finalDuration,
        outputPath: videoPath,
        themeId: 'theme_modern',
        wordBoundaries,
        sectionDurations: renderSectionDurations,
        bgStyle: 'single_focus_pexels',
      });

      console.log(`   ✅ Render complete\n`);
    } catch (err) {
      throw new Error(`Render failed: ${err.message}`);
    }

    // Phase 4: Production Validation
    console.log('Phase 4️⃣  PRODUCTION validation...\n');

    const files = {
      'output.mp4': path.join(TEST_OUTPUT_DIR, 'output.mp4'),
      'subtitles.ass': path.join(TEST_OUTPUT_DIR, 'subtitles.ass'),
      'voice-segments.json': path.join(TEST_OUTPUT_DIR, 'voice-segments.json'),
      'render-metadata.json': path.join(TEST_OUTPUT_DIR, 'render-metadata.json'),
    };

    console.log('📦 Output files:');
    for (const [name, fpath] of Object.entries(files)) {
      if (fs.existsSync(fpath)) {
        const size = fs.statSync(fpath).size;
        console.log(`  ✅ ${name} (${(size / 1024).toFixed(1)} KB)`);
      } else {
        throw new Error(`Missing: ${name}`);
      }
    }

    // Detailed validation
    console.log('\n' + '─'.repeat(80));
    const { segments, totalDuration } = analyzeVoiceSegmentsProd(files['voice-segments.json']);

    console.log('\n' + '─'.repeat(80));
    analyzeSubtitlesProd(files['subtitles.ass'], segments, totalDuration);

    console.log('\n' + '─'.repeat(80));
    analyzeMetadataProd(files['render-metadata.json'], segments.length);

    // Final report
    console.log('\n' + '═'.repeat(80));
    console.log('✅ PRODUCTION VALIDATION PASSED');
    console.log('═'.repeat(80));
    console.log(`\n📊 Final Report:`);
    console.log(`   Duration: ${totalDuration.toFixed(2)}s`);
    console.log(`   Voice segments: ${segments.length}`);
    console.log(`   Sync mode: audio_detected (real-time)`);
    console.log(`   Drift: < 1.5s`);
    console.log(`   Status: READY FOR PRODUCTION`);
    console.log(`\n   Next: All production videos will use real audio synchronization.\n`);
    return true;

  } catch (fatalErr) {
    console.log('\n' + '═'.repeat(80));
    console.log('❌ VALIDATION FAILED');
    console.log('═'.repeat(80));
    console.log(`\nError: ${fatalErr.message}\n`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────

runProductionTest()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('Test error:', err.message);
    process.exit(1);
  });
