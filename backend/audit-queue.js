/**
 * audit-queue.js
 * Audita queue/done para identificar vídeos antiguos vs válidos
 */

const fs = require('fs');
const path = require('path');

const QUEUE_DONE = path.resolve('./backend/queue/done');

function auditVideo(filePath, filename) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const prefabScript = data.data?.prefabScript || {};
    const structureVersion = prefabScript.structureVersion;
    const durationSeconds = prefabScript.durationSeconds || 0;
    const topic = data.data?.topic || prefabScript.topic;
    const hookType = data.data?.growthContext?.hookType || prefabScript.hookType;
    const createdAt = data.createdAt;
    const viralityScore = prefabScript.viralityScore || 0;

    // Campos modernos que debería tener
    const hasRenderMode = !!prefabScript.renderMode || !!data.data?.renderMode;
    const hasSubtitleTiming = !!prefabScript.subtitleTimingMode || !!data.data?.subtitleTimingMode;
    const hasWordEngine = !!prefabScript.wordAlignmentEngine || !!data.data?.wordAlignmentEngine;
    const hasRetentionSpikes = !!prefabScript.retentionSpikeVersion || !!data.data?.retentionSpikeVersion;
    const hasHumanityScore = !!prefabScript.humanity_score || !!data.data?.humanity_score;

    // Validación de confessional
    const isConfessional = structureVersion?.includes('confessional') ||
                          structureVersion?.includes('v4') ||
                          structureVersion?.includes('retention');

    // Criterios de validez
    const isValid = {
      duration: durationSeconds >= 26 && durationSeconds <= 32,
      topic: !['productivity', 'cognitive_biases', 'attention', 'cerebro'].includes(topic),
      structureVersion: isConfessional,
      renderMode: hasRenderMode,
      subtitleTiming: hasSubtitleTiming,
      wordEngine: hasWordEngine,
      retentionSpikes: hasRetentionSpikes,
      humanityScore: hasHumanityScore || true, // Optional
      viralityScore: viralityScore >= 50,
    };

    const allValid = Object.values(isValid).every(v => v);

    return {
      videoId: data.id,
      filename: filename,
      createdAt,
      topic,
      hookType,
      structureVersion,
      durationSeconds,
      viralityScore,
      isConfessional,
      hasModernFields: {
        renderMode: hasRenderMode,
        subtitleTiming: hasSubtitleTiming,
        wordEngine: hasWordEngine,
        retentionSpikes: hasRetentionSpikes,
        humanityScore: hasHumanityScore,
      },
      validation: isValid,
      isValid: allValid,
    };
  } catch (err) {
    return {
      filename,
      error: err.message,
      isValid: false,
    };
  }
}

function main() {
  if (!fs.existsSync(QUEUE_DONE)) {
    console.log('❌ Queue directory not found:', QUEUE_DONE);
    return;
  }

  const files = fs.readdirSync(QUEUE_DONE).filter(f => f.endsWith('.json'));
  console.log(`\n📊 QUEUE AUDIT REPORT\n${'='.repeat(80)}\n`);
  console.log(`Total videos in queue: ${files.length}\n`);

  const audits = files.map(f => auditVideo(path.join(QUEUE_DONE, f), f));

  // Separar válidos e inválidos
  const valid = audits.filter(a => a.isValid && !a.error);
  const invalid = audits.filter(a => !a.isValid || a.error);

  console.log(`✅ VALID VIDEOS: ${valid.length}`);
  console.log(`❌ INVALID VIDEOS: ${invalid.length}\n`);

  // Mostrar inválidos
  if (invalid.length > 0) {
    console.log(`${'─'.repeat(80)}\n INVALID VIDEOS (should be deleted):\n${'─'.repeat(80)}\n`);

    invalid.forEach((audit, idx) => {
      if (audit.error) {
        console.log(`${idx + 1}. ${audit.filename} — ERROR: ${audit.error}`);
      } else {
        console.log(`${idx + 1}. ${audit.filename}`);
        console.log(`   VideoID:          ${audit.videoId}`);
        console.log(`   Created:          ${audit.createdAt}`);
        console.log(`   Duration:         ${audit.durationSeconds}s ${audit.validation.duration ? '✓' : '✗ (need 26-32s)'}`);
        console.log(`   Topic:            ${audit.topic} ${audit.validation.topic ? '✓' : '✗ (avoid productivity/cognitive_biases)'}`);
        console.log(`   Structure:        ${audit.structureVersion} ${audit.validation.structureVersion ? '✓' : '✗ (need confessional/v4)'}`);
        console.log(`   Virality Score:   ${audit.viralityScore} ${audit.validation.viralityScore ? '✓' : '✗ (need >=50)'}`);

        const missing = [];
        if (!audit.hasModernFields.renderMode) missing.push('renderMode');
        if (!audit.hasModernFields.subtitleTiming) missing.push('subtitleTiming');
        if (!audit.hasModernFields.wordEngine) missing.push('wordEngine');
        if (!audit.hasModernFields.retentionSpikes) missing.push('retentionSpikes');

        if (missing.length > 0) {
          console.log(`   Missing fields:   ${missing.join(', ')}`);
        }
        console.log('');
      }
    });
  }

  // Mostrar válidos
  if (valid.length > 0) {
    console.log(`\n${'─'.repeat(80)}\n VALID VIDEOS (keep these):\n${'─'.repeat(80)}\n`);
    valid.forEach((audit, idx) => {
      console.log(`${idx + 1}. ${audit.filename}`);
      console.log(`   VideoID:     ${audit.videoId}`);
      console.log(`   Duration:    ${audit.durationSeconds}s`);
      console.log(`   Topic:       ${audit.topic}`);
      console.log(`   Virality:    ${audit.viralityScore}/100`);
      console.log('');
    });
  }

  console.log(`${'='.repeat(80)}\n`);
  console.log(`📋 SUMMARY:`);
  console.log(`   Keep:   ${valid.length} video(s)`);
  console.log(`   Delete: ${invalid.length} video(s)`);
  console.log(`   Total:  ${files.length} video(s)\n`);

  // Export results
  const report = {
    timestamp: new Date().toISOString(),
    totalVideos: files.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    valid: valid.map(v => ({ videoId: v.videoId, filename: v.filename })),
    invalid: invalid.map(v => ({ videoId: v.videoId, filename: v.filename, reason: Object.entries(v.validation || {}).filter(([_, valid]) => !valid).map(([k]) => k) })),
  };

  fs.writeFileSync(path.resolve('./backend/queue-audit-report.json'), JSON.stringify(report, null, 2));
  console.log('📄 Report saved: ./backend/queue-audit-report.json\n');
}

main();
