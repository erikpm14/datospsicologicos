/**
 * generate-v41-videos.js
 * Genera 2 vídeos con sistema v4.1 completo
 */

const fs = require('fs');
const path = require('path');
const { generateScript } = require('./src/services/content-generator');
const { addVideoToQueue } = require('./src/queue/video-processor');
const logger = require('./src/utils/logger');

const TOPICS_PSYCHOLOGICAL = [
  'emotions',
  'relationships',
  'body_language',
  'social_patterns',
  'memory',
  'motivation',
  'social_skills',
  'communication',
  'decision_making',
  'perception',
];

async function generateVideoV41(topicIndex) {
  try {
    logger.info(`[V41] Generating video ${topicIndex + 1}/2...`);

    const topic = TOPICS_PSYCHOLOGICAL[Math.floor(Math.random() * TOPICS_PSYCHOLOGICAL.length)];

    // Configuración v4.1 completa
    const generationConfig = {
      topic,
      language: 'es',
      renderMode: 'video_use', // Obligatorio
      subtitleTimingMode: 'word_timestamps', // Obligatorio
      wordAlignmentEngine: 'whisper', // Obligatorio
      retentionSpikeVersion: 'v4.1', // Obligatorio
      structureVersion: 'confessional', // Obligatorio
      voiceMode: 'humanized', // Voz natural
      durationTarget: 28, // Meta 28s (rango 26-32)
      durationMinimum: 26,
      durationMaximum: 32,
      targetViralityScore: 75,
      targetHumanityScore: 80,
      format: 'confessional_psychological',
    };

    logger.info(`[V41] Config: topic=${topic}, duration=26-32s, v4.1 with word timestamps`);

    // Generar script
    const script = await generateScript(generationConfig);

    if (!script || script.error) {
      throw new Error(`Script generation failed: ${script?.error || 'unknown'}`);
    }

    logger.info(`[V41] ✓ Script generated`, {
      videoId: script.videoId,
      hook: script.hook,
      topic: script.topic,
      duration: script.durationSeconds,
      virality: script.viralityScore,
      humanity: script.humanity_score,
    });

    // Añadir a queue para procesamiento
    const queueResult = await addVideoToQueue({
      ...script,
      renderMode: 'video_use',
      subtitleTimingMode: 'word_timestamps',
      wordAlignmentEngine: 'whisper',
      retentionSpikeVersion: 'v4.1',
      structureVersion: 'confessional',
      voiceMode: 'humanized',
    });

    if (!queueResult || queueResult.error) {
      throw new Error(`Queue failed: ${queueResult?.error || 'unknown'}`);
    }

    logger.info(`[V41] ✓ Added to queue`, {
      jobId: queueResult.jobId,
      status: queueResult.status,
    });

    return {
      success: true,
      videoId: script.videoId,
      jobId: queueResult.jobId,
      script,
    };
  } catch (err) {
    logger.error(`[V41] Generation failed:`, { error: err.message });
    return {
      success: false,
      error: err.message,
    };
  }
}

async function main() {
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  GENERATING 2 V4.1 VIDEOS (confessional + word-timestamps)');
  console.log(`${'═'.repeat(80)}\n`);

  const results = [];

  for (let i = 0; i < 2; i++) {
    const result = await generateVideoV41(i);
    results.push(result);

    // Esperar un poco entre generaciones
    if (i < 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Resumen
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  GENERATION SUMMARY');
  console.log(`${'═'.repeat(80)}\n`);

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`✅ Successful: ${successful.length}`);
  successful.forEach((r, idx) => {
    console.log(`\n${idx + 1}. Video ${r.videoId}`);
    console.log(`   Hook:       ${r.script.hook}`);
    console.log(`   Topic:      ${r.script.topic}`);
    console.log(`   Duration:   ${r.script.durationSeconds}s`);
    console.log(`   Virality:   ${r.script.viralityScore}/100`);
    console.log(`   Humanity:   ${r.script.humanity_score}/100`);
    console.log(`   JobId:      ${r.jobId}`);
  });

  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}`);
    failed.forEach((r, idx) => {
      console.log(`\n${idx + 1}. Error: ${r.error}`);
    });
  }

  console.log(`\n${'═'.repeat(80)}\n`);
  console.log(`ℹ️  Videos are processing in queue. Check progress with:
  curl http://localhost:3001/api/queue\n`);
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
