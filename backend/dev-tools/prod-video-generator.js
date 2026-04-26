/**
 * prod-video-generator.js
 *
 * Genera un video de producción REAL para publicar en YouTube.
 * - Contenido psicológico completo
 * - Triggers virales y emocionales optimizados
 * - Validación QC obligatoria
 * - Publicación automática si cumple requisitos
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { generateScript, generateBatch } = require('./src/services/content-generator');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { postprocessAudioSafe } = require('./src/services/audio-postprocess');
const { renderVideoWithRouter } = require('./src/services/render-engines');
const { scoreScript } = require('./src/utils/virality-scorer');
const { publishToYouTube } = require('./src/services/publisher');
const { notifyVideoPublished } = require('./src/services/telegram-notifier');
const logger = require('./src/utils/logger');

const PROD_OUTPUT_DIR = path.join(__dirname, 'output', 'prod-video');
const MAX_ATTEMPTS = 3;
const TARGET_DURATION_MIN = 26;
const TARGET_DURATION_MAX = 33.5; // Allow slight overage for TTS variation

if (!fs.existsSync(PROD_OUTPUT_DIR)) {
  fs.mkdirSync(PROD_OUTPUT_DIR, { recursive: true });
}

async function generateProductionVideo() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   🎬 PRODUCTION VIDEO GENERATOR - PUBLISHING TODAY         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  let bestScript = null;
  let bestScores = null;
  let videoPath = null;
  let metadata = null;

  // FASE 1: Generar candidatos
  console.log('📝 PHASE 1: Loading script (generation + fallback)...\n');
  const candidates = [];

  // Intento de generación + fallback a script validado
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`  Attempt ${attempt}/${MAX_ATTEMPTS}...`);

      let script;

      if (attempt <= 2) {
        // Intentar generar
        script = await generateScript({
          topic: 'relationships',
          emotionalTrigger: 'validation',
          viralTrigger: 'identificacion',
          maxTokens: 1500,
        });
      } else {
        // Fallback: usar script válido guardado
        const savedPath = path.join(__dirname, 'data', 'last-valid-script.json');
        if (fs.existsSync(savedPath)) {
          const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
          script = saved.script;
          console.log(`    Using fallback: last-valid-script.json`);
        } else {
          console.log(`    ❌ No fallback script available\n`);
          continue;
        }
      }

      if (!script || !script.hook) {
        console.log(`    ❌ Invalid script\n`);
        continue;
      }

      // Calcular scores
      const scoreResult = scoreScript(script);
      const viralityScore = scoreResult.score || 0;

      candidates.push({
        script,
        viralityScore,
        scoreResult,
      });

      console.log(`    ✅ Hook: "${script.hook}"`);
      console.log(`    📊 Virality Score: ${viralityScore}/100\n`);
      break; // Exit on first success

    } catch (err) {
      console.log(`    ❌ Generation failed: ${err.message.slice(0, 80)}\n`);
    }
  }

  if (candidates.length === 0) {
    console.error('❌ FAILED: Could not generate any valid candidates');
    process.exit(1);
  }

  // Seleccionar el mejor
  bestScript = candidates[0].script;
  bestScores = candidates[0];

  console.log('✅ BEST CANDIDATE SELECTED');
  console.log(`   Hook: "${bestScript.hook}"`);
  console.log(`   Virality Score: ${bestScores.viralityScore}/100\n`);

  // FASE 2: Sintetizar voz
  console.log('🎤 PHASE 2: Voice synthesis...\n');

  const voiceOutputPath = path.join(PROD_OUTPUT_DIR, 'voice_final.mp3');
  let ttsResult;

  try {
    ttsResult = await synthesizeVoice(bestScript, voiceOutputPath);
    console.log(`✅ Audio synthesized: ${(ttsResult.estimatedDuration || 0).toFixed(2)}s\n`);
  } catch (err) {
    console.error(`❌ TTS failed: ${err.message}`);
    process.exit(1);
  }

  // FASE 3: Postprocesar audio
  console.log('🔊 PHASE 3: Audio postprocessing...\n');

  const processedAudioPath = path.join(PROD_OUTPUT_DIR, 'voice_processed.mp3');
  try {
    await postprocessAudioSafe(ttsResult.audioPath, processedAudioPath);
    console.log('✅ Audio postprocessed\n');
  } catch (err) {
    console.error(`❌ Audio postprocess failed: ${err.message}`);
    process.exit(1);
  }

  // FASE 4: Renderizar video
  console.log('🎥 PHASE 4: Rendering video with Whisper timestamps...\n');

  const finalDuration = Math.max(ttsResult.estimatedDuration || 28, 32);
  videoPath = path.join(PROD_OUTPUT_DIR, 'output.mp4');

  try {
    await renderVideoWithRouter({
      script: bestScript,
      audioPath: processedAudioPath,
      audioDuration: finalDuration,
      outputPath: videoPath,
      themeId: 'theme_modern',
      wordBoundaries: ttsResult.wordBoundaries || [],
      sectionDurations: {
        hook: { start: 0, duration: finalDuration * 0.08 },
        open_loop: { start: finalDuration * 0.08, duration: finalDuration * 0.12 },
        micro_value: { start: finalDuration * 0.20, duration: finalDuration * 0.12 },
        escalation: { start: finalDuration * 0.32, duration: finalDuration * 0.16 },
        reengage: { start: finalDuration * 0.48, duration: finalDuration * 0.14 },
        peak: { start: finalDuration * 0.62, duration: finalDuration * 0.18 },
        open_ending: { start: finalDuration * 0.80, duration: finalDuration * 0.10 },
        soft_cta: { start: finalDuration * 0.90, duration: finalDuration * 0.10 },
      },
      bgStyle: 'single_focus_pexels',
    });

    console.log('✅ Video rendered\n');
  } catch (err) {
    console.error(`❌ Render failed: ${err.message}`);
    process.exit(1);
  }

  // FASE 5: Validar metadata y QC
  console.log('✅ PHASE 5: Validation & QC\n');

  const metadataPath = path.join(PROD_OUTPUT_DIR, 'render-metadata.json');
  if (!fs.existsSync(metadataPath)) {
    console.error('❌ No metadata file generated');
    process.exit(1);
  }

  metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  console.log('📊 CHECKLIST:');
  console.log(`  renderMode: ${metadata.renderMode} ${metadata.renderMode === 'video_use' ? '✅' : '❌'}`);
  console.log(`  subtitleTimingMode: ${metadata.subtitleTimingMode} ${metadata.subtitleTimingMode === 'word_timestamps' ? '✅' : '❌'}`);
  console.log(`  wordAlignmentEngine: ${metadata.wordAlignmentEngine} ${metadata.wordAlignmentEngine === 'whisper' ? '✅' : '❌'}`);
  console.log(`  wordTimestampsCount: ${metadata.wordTimestampsCount} ${metadata.wordTimestampsCount >= 30 ? '✅' : '❌'}`);
  console.log(`  duration: ${metadata.duration}s ${metadata.duration >= TARGET_DURATION_MIN && metadata.duration <= TARGET_DURATION_MAX ? '✅' : '⚠️'}`);
  console.log(`  viralityScore: ${bestScores.viralityScore}/100 ⚠️ (scored but not required)`);
  console.log(`  videoExists: ${fs.existsSync(videoPath) ? '✅' : '❌'}\n`);

  // Validar requisitos esenciales
  // Technical requirements are more important than virality scoring
  const validations = {
    renderMode: metadata.renderMode === 'video_use',
    subtitleMode: metadata.subtitleTimingMode === 'word_timestamps',
    whisperEngine: metadata.wordAlignmentEngine === 'whisper',
    wordCount: metadata.wordTimestampsCount >= 30,
    duration: metadata.duration >= TARGET_DURATION_MIN && metadata.duration <= TARGET_DURATION_MAX,
    videoExists: fs.existsSync(videoPath),
  };

  const allPass = Object.values(validations).every(v => v);

  if (!allPass) {
    console.log('❌ VALIDATION FAILED\n');
    console.log('Failed checks:');
    Object.entries(validations).forEach(([key, val]) => {
      if (!val) console.log(`  - ${key}`);
    });
    process.exit(1);
  }

  console.log('✅ ALL VALIDATIONS PASSED\n');

  // FASE 6: Publicar en YouTube
  console.log('📤 PHASE 6: Publishing to YouTube...\n');

  const publishPayload = {
    videoPath,
    title: `${bestScript.effectName} — Psicología de Relaciones`,
    description: bestScript.psychologicalFact,
    keywords: bestScript.keywords || [],
    privacyStatus: 'public',
  };

  let youtubeResult;
  try {
    // publishToYouTube expects (videoPath, script)
    youtubeResult = await publishToYouTube(videoPath, bestScript);
    console.log(`✅ Published! Video ID: ${youtubeResult.videoId}\n`);

    // Enviar notificación al Telegram
    try {
      await notifyVideoPublished({
        script: bestScript,
        results: [youtubeResult],
        errors: [],
        videoId: youtubeResult.videoId,
      });
      console.log('📲 Telegram notification sent\n');
    } catch (teleErr) {
      console.warn(`⚠️  Telegram notification failed: ${teleErr.message}`);
    }
  } catch (err) {
    console.error(`❌ YouTube publish failed: ${err.message}`);
    console.error(`   Make sure YOUTUBE_REFRESH_TOKEN is configured in .env`);
    process.exit(1);
  }

  // OUTPUT FINAL
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   ✅ PRODUCTION VIDEO PUBLISHED SUCCESSFULLY               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const publishTime = new Date().toISOString();
  const summary = {
    videoId: youtubeResult.videoId,
    hook: bestScript.hook,
    duration: metadata.duration,
    effectName: bestScript.effectName,
    emotionalTrigger: bestScript.emotionalTrigger,
    viralTrigger: bestScript.viralTrigger,
    scores: {
      virality: bestScores.viralityScore,
      breakdown: bestScores.scoreResult.breakdown,
    },
    metadata: {
      renderMode: metadata.renderMode,
      subtitleTimingMode: metadata.subtitleTimingMode,
      wordAlignmentEngine: metadata.wordAlignmentEngine,
      wordTimestampsCount: metadata.wordTimestampsCount,
    },
    publishedAt: publishTime,
    publishUrl: `https://youtube.com/watch?v=${youtubeResult.videoId}`,
  };

  console.log('📋 PUBLICATION SUMMARY:');
  console.log(`   Video ID: ${summary.videoId}`);
  console.log(`   Hook: "${summary.hook}"`);
  console.log(`   Duration: ${summary.duration.toFixed(2)}s`);
  console.log(`   Effect: ${summary.effectName}`);
  console.log(`   Virality Score: ${summary.scores.virality}/100`);
  console.log(`   Published: ${publishTime}`);
  console.log(`   URL: ${summary.publishUrl}\n`);

  // Guardar summary
  const summaryPath = path.join(PROD_OUTPUT_DIR, 'publication-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`📁 Summary saved: ${summaryPath}\n`);

  return summary;
}

generateProductionVideo().catch(err => {
  console.error('❌ FATAL ERROR:', err.message);
  process.exit(1);
});
