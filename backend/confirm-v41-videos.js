/**
 * confirm-v41-videos.js
 * Audita y confirma los vídeos generados cumplen v4.1
 */

const fs = require('fs');
const path = require('path');

const QUEUE_DONE = path.resolve('./backend/queue/done');
const EXPORTS_DIR = path.resolve('./backend/exports');

function getExportPath(videoId) {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');

  const dateFolder = path.join(EXPORTS_DIR, `${year}-${month}-${day}`);

  if (fs.existsSync(dateFolder)) {
    const files = fs.readdirSync(dateFolder);
    const videoFile = files.find(f => f.includes(videoId) && f.endsWith('.mp4'));
    return videoFile ? path.join(dateFolder, videoFile) : null;
  }
  return null;
}

function confirmVideo(videoId, filename) {
  try {
    const filePath = path.join(QUEUE_DONE, filename);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const prefabScript = data.data?.prefabScript || {};
    const metadata = data.data?.metadata || {};

    const videoData = {
      videoId,
      filename,
      createdAt: data.createdAt,
      hook: prefabScript.hook || 'N/A',
      topic: prefabScript.topic || 'N/A',
      durationSeconds: prefabScript.durationSeconds || 0,
      viralityScore: prefabScript.viralityScore || 0,
      humanityScore: prefabScript.humanity_score || metadata.humanity_score || 0,
      formatScore: prefabScript.formatScore || 0,
      structureVersion: prefabScript.structureVersion || 'N/A',
      retentionSpikeVersion: prefabScript.retentionSpikeVersion || metadata.retentionSpikeVersion || 'N/A',
      renderMode: prefabScript.renderMode || metadata.renderMode || 'N/A',
      subtitleTimingMode: prefabScript.subtitleTimingMode || metadata.subtitleTimingMode || 'N/A',
      wordAlignmentEngine: prefabScript.wordAlignmentEngine || metadata.wordAlignmentEngine || 'N/A',
      voiceMode: prefabScript.voiceMode || metadata.voiceMode || 'N/A',
    };

    // Validar v4.1
    const v41Checks = {
      duration_valid: videoData.durationSeconds >= 26 && videoData.durationSeconds <= 32,
      virality_valid: videoData.viralityScore >= 70,
      humanity_valid: videoData.humanityScore >= 70,
      structure_confessional: videoData.structureVersion?.includes('confessional') || videoData.structureVersion?.includes('v4'),
      spike_v41: videoData.retentionSpikeVersion === 'v4.1',
      render_video_use: videoData.renderMode === 'video_use',
      subtitles_word: videoData.subtitleTimingMode === 'word_timestamps',
      engine_whisper: videoData.wordAlignmentEngine === 'whisper',
    };

    const exportPath = getExportPath(videoId);

    return {
      ...videoData,
      v41Checks,
      isFullyV41: Object.values(v41Checks).every(v => v),
      exportPath,
    };
  } catch (err) {
    return {
      videoId,
      filename,
      error: err.message,
      isFullyV41: false,
    };
  }
}

function main() {
  const files = fs.readdirSync(QUEUE_DONE).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.log('\n❌ No videos found in queue/done\n');
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(100)}`);
  console.log('  V4.1 VIDEO CONFIRMATION REPORT');
  console.log(`${'═'.repeat(100)}\n`);

  const videos = files.map((f, idx) => {
    const videoId = path.basename(f, '.json');
    return confirmVideo(videoId, f);
  });

  // Agrupar por validez
  const valid = videos.filter(v => v.isFullyV41 && !v.error);
  const partial = videos.filter(v => !v.isFullyV41 && !v.error);
  const errors = videos.filter(v => v.error);

  console.log(`✅ FULLY V4.1 COMPLIANT: ${valid.length}`);
  console.log(`⚠️  PARTIAL (needs tuning): ${partial.length}`);
  console.log(`❌ ERRORS: ${errors.length}\n`);

  // Mostrar detalle de los válidos
  if (valid.length > 0) {
    console.log(`${'─'.repeat(100)}\n VALID V4.1 VIDEOS:\n${'─'.repeat(100)}\n`);

    valid.forEach((v, idx) => {
      console.log(`${idx + 1}. ${v.filename}`);
      console.log(`   ✓ VideoID:                ${v.videoId}`);
      console.log(`   ✓ Hook:                   ${v.hook}`);
      console.log(`   ✓ Topic:                  ${v.topic}`);
      console.log(`   ✓ Duration:               ${v.durationSeconds}s (26-32s range)`);
      console.log(`   ✓ Virality Score:         ${v.viralityScore}/100 (≥70)`);
      console.log(`   ✓ Humanity Score:         ${v.humanityScore}/100 (≥70)`);
      console.log(`   ✓ Format Score:           ${v.formatScore}/100`);
      console.log(`   ✓ Structure Version:      ${v.structureVersion}`);
      console.log(`   ✓ Retention Spikes:       ${v.retentionSpikeVersion}`);
      console.log(`   ✓ Render Mode:            ${v.renderMode}`);
      console.log(`   ✓ Subtitle Timing:        ${v.subtitleTimingMode}`);
      console.log(`   ✓ Word Alignment:         ${v.wordAlignmentEngine}`);
      console.log(`   ✓ Voice Mode:             ${v.voiceMode}`);
      console.log(`   ✓ Created:                ${v.createdAt}`);
      console.log(`   ✓ Export Path:            ${v.exportPath || 'Not exported yet'}`);
      console.log('');
    });
  }

  // Mostrar parciales
  if (partial.length > 0) {
    console.log(`\n${'─'.repeat(100)}\n PARTIAL V4.1 (needs fixes):\n${'─'.repeat(100)}\n`);

    partial.forEach((v, idx) => {
      if (v.error) return;

      const failures = Object.entries(v.v41Checks)
        .filter(([_, check]) => !check)
        .map(([key, _]) => key);

      console.log(`${idx + 1}. ${v.filename}`);
      console.log(`   VideoID: ${v.videoId}`);
      console.log(`   Failures: ${failures.join(', ')}`);
      console.log('');
    });
  }

  // Errores
  if (errors.length > 0) {
    console.log(`\n${'─'.repeat(100)}\n ERRORS:\n${'─'.repeat(100)}\n`);
    errors.forEach((v, idx) => {
      console.log(`${idx + 1}. ${v.filename}: ${v.error}`);
    });
  }

  console.log(`\n${'═'.repeat(100)}\n`);
  console.log(`📊 SUMMARY:`);
  console.log(`   Total:   ${videos.length} video(s)`);
  console.log(`   Valid:   ${valid.length} (ready to publish)`);
  console.log(`   Partial: ${partial.length} (need fixes)`);
  console.log(`   Errors:  ${errors.length}\n`);

  // Exportar reporte
  const report = {
    timestamp: new Date().toISOString(),
    total: videos.length,
    valid: valid.length,
    partial: partial.length,
    errors: errors.length,
    videos: videos.map(v => ({
      videoId: v.videoId,
      hook: v.hook,
      topic: v.topic,
      duration: v.durationSeconds,
      virality: v.viralityScore,
      humanity: v.humanityScore,
      isFullyV41: v.isFullyV41,
      exportPath: v.exportPath,
    })),
  };

  fs.writeFileSync(
    path.resolve('./backend/v41-confirmation-report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(`📄 Report saved: ./backend/v41-confirmation-report.json\n`);
}

main();
