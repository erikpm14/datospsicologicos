#!/usr/bin/env node
/**
 * FORENSIC AUDIT: Complete investigation of 2026-05-05 publications
 *
 * Determines which process published each video and why
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.resolve(BACKEND_DIR, 'output-fase1-test');
const DATA_DIR = path.resolve(BACKEND_DIR, 'data');
const VIDEOS_JSON = path.resolve(DATA_DIR, 'videos.json');
const SLOT_STATE = path.resolve(DATA_DIR, 'slot-lock-state.json');
const PUBLISH_LOG = path.resolve(DATA_DIR, 'publish-log.json');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║         FORENSIC AUDIT: 2026-05-05 Publications             ║');
console.log('║  Complete investigation of publication sources and timing  ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Load databases
let videosDb = [];
try {
  const content = JSON.parse(fs.readFileSync(VIDEOS_JSON, 'utf8'));
  videosDb = content.published || content;
  if (!Array.isArray(videosDb)) videosDb = [];
} catch {
  console.log('⚠️  Could not read videos.json');
}

let publishLog = [];
try {
  const content = JSON.parse(fs.readFileSync(PUBLISH_LOG, 'utf8'));
  publishLog = content.published || content;
  if (!Array.isArray(publishLog)) publishLog = [];
} catch {
  console.log('⚠️  Could not read publish-log.json');
}

let slotState = {};
try {
  slotState = JSON.parse(fs.readFileSync(SLOT_STATE, 'utf8'));
} catch {
  console.log('⚠️  Could not read slot-lock-state.json');
}

// Filter videos published on 2026-05-05
const todayVideos = videosDb.filter(v => {
  if (!v.created_at) return false;
  return v.created_at.includes('2026-05-05');
});

console.log(`Found ${todayVideos.length} videos published on 2026-05-05\n`);

if (todayVideos.length === 0) {
  console.log('No publications found for today.');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────
// Build detailed report for each video
// ─────────────────────────────────────────────────────────────────

const auditData = [];

for (const video of todayVideos) {
  const videoId = video.id;
  const youtubeId = video.youtube_id;
  const publishedAt = video.created_at;
  const title = video.title || video.hook || '(no title)';

  console.log(`Analyzing: ${videoId.substring(0, 8)}... (${youtubeId})`);

  // Find in publish log
  const logEntry = publishLog.find(e => e.videoId === videoId);
  const publisherSource = determinePublisher(logEntry, publishedAt);

  // Check slot reservation
  const wasReserved = slotState.nearestSlot?.videoId === videoId || false;
  const expectedSlot = slotState.nearestSlot?.date && slotState.nearestSlot?.time
    ? `${slotState.nearestSlot.date} ${slotState.nearestSlot.time}`
    : 'unknown';

  // Parse publish time
  const pubDate = new Date(publishedAt);
  const [pubHour, pubMin] = [pubDate.getHours(), pubDate.getMinutes()];
  const publishedTime = `${String(pubHour).padStart(2, '0')}:${String(pubMin).padStart(2, '0')}`;

  // Check if before slot
  let beforeSlot = false;
  const slotTimes = [
    { hour: 14, min: 30, name: '14:30' },
    { hour: 21, min: 15, name: '21:15' },
  ];

  for (const slot of slotTimes) {
    const slotMinutes = slot.hour * 60 + slot.min;
    const pubMinutes = pubHour * 60 + pubMin;
    if (pubMinutes < slotMinutes) {
      beforeSlot = true;
      break;
    }
  }

  // Check metadata
  const videoDir = path.resolve(OUTPUT_DIR, videoId);
  const metadataPath = path.resolve(videoDir, 'generation-metadata.json');
  const publishedPath = path.resolve(videoDir, 'published.json');
  const mp4Path = path.resolve(videoDir, 'output.mp4');

  let metadata = null;
  let hasMetadata = false;
  let hasBackgroundPlan = false;
  let hasClipTimeline = false;
  let appliedToRender = false;
  let renderMode = null;
  let diversityScore = 0;
  let passedDiversityGate = false;
  let passedDuplicateCheck = false;
  let scriptDiversityFile = null;

  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      hasMetadata = true;
      if (metadata.backgroundPlan) {
        hasBackgroundPlan = true;
        if (metadata.backgroundPlan.clipTimeline) {
          hasClipTimeline = true;
        }
        appliedToRender = metadata.backgroundPlan.appliedToRender === true;
        renderMode = metadata.backgroundPlan.renderMode;
        diversityScore = metadata.backgroundPlan.diversityScore || 0;
      }
      passedDiversityGate = metadata.scriptDiversityGatePassed !== false;
      passedDuplicateCheck = metadata.duplicateCheckPassed !== false;
    } catch {}
  }

  // Check for script diversity gate results
  const scriptDiversityPath = path.resolve(videoDir, 'script-diversity*.json');
  let scriptDiversityFiles = [];
  if (fs.existsSync(videoDir)) {
    scriptDiversityFiles = fs.readdirSync(videoDir).filter(f => f.startsWith('script-diversity'));
    if (scriptDiversityFiles.length > 0) {
      scriptDiversityFile = scriptDiversityFiles[0];
    }
  }

  // Check file size
  let fileSize = 0;
  if (fs.existsSync(mp4Path)) {
    fileSize = fs.statSync(mp4Path).size;
  }

  // Check for violations
  const violations = [];
  if (beforeSlot) violations.push('PUBLISHED_BEFORE_SLOT');
  if (!appliedToRender && hasBackgroundPlan) violations.push('BACKGROUND_NOT_APPLIED');
  if (!hasClipTimeline && hasBackgroundPlan) violations.push('NO_DYNAMIC_CLIPS');
  if (passedDuplicateCheck === false) violations.push('DUPLICATE_RISK');
  if (passedDiversityGate === false) violations.push('DIVERSITY_GATE_FAILED');

  auditData.push({
    videoId,
    youtubeId,
    title: title.substring(0, 40),
    publishedAt: publishedTime,
    publisherSource,
    expectedSlot,
    wasReserved,
    appliedToRender,
    renderMode,
    diversityScore,
    duplicateRisk: passedDuplicateCheck === false,
    violations: violations.join(' | ') || 'NONE',
    fileSize: (fileSize / 1024 / 1024).toFixed(1),
    passedDiversityGate,
    passedDuplicateCheck,
    hasBackgroundPlan,
    hasClipTimeline
  });
}

// ─────────────────────────────────────────────────────────────────
// Print table
// ─────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(120));
console.log('FORENSIC AUDIT TABLE: 2026-05-05 Publications');
console.log('═'.repeat(120) + '\n');

console.log('VideoId (short) | YoutubeId | Time  | Publisher | Reserved | DynamicRender | Violations');
console.log('─'.repeat(120));

for (const audit of auditData) {
  const videoShort = audit.videoId.substring(0, 8);
  const reserved = audit.wasReserved ? '✓' : '✗';
  const dynamic = audit.appliedToRender ? '✓' : '✗';
  const violations = audit.violations === 'NONE' ? '✓ NONE' : `❌ ${audit.violations}`;

  console.log(`${videoShort}... | ${audit.youtubeId} | ${audit.publishedAt} | ${audit.publisherSource.padEnd(15)} | ${reserved} | ${dynamic} | ${violations}`);
}

console.log('');

// ─────────────────────────────────────────────────────────────────
// Detailed analysis
// ─────────────────────────────────────────────────────────────────

console.log('═'.repeat(120));
console.log('DETAILED ANALYSIS');
console.log('═'.repeat(120) + '\n');

// Count by publisher
const byPublisher = {};
for (const audit of auditData) {
  byPublisher[audit.publisherSource] = (byPublisher[audit.publisherSource] || 0) + 1;
}

console.log('Publications by Source:');
for (const [source, count] of Object.entries(byPublisher)) {
  console.log(`  ${source}: ${count} videos`);
}

// Count violations
const violationCounts = {};
for (const audit of auditData) {
  audit.violations.split(' | ').forEach(v => {
    if (v !== 'NONE') {
      violationCounts[v] = (violationCounts[v] || 0) + 1;
    }
  });
}

console.log('\nViolations Found:');
if (Object.keys(violationCounts).length === 0) {
  console.log('  ✓ No violations detected');
} else {
  for (const [violation, count] of Object.entries(violationCounts)) {
    console.log(`  ❌ ${violation}: ${count} videos`);
  }
}

// Before slot analysis
const beforeSlotVideos = auditData.filter(a => a.violations.includes('PUBLISHED_BEFORE_SLOT'));
console.log(`\nPublished Before Slot: ${beforeSlotVideos.length} videos`);
if (beforeSlotVideos.length > 0) {
  beforeSlotVideos.forEach(v => {
    console.log(`  ❌ ${v.videoId.substring(0, 8)}... at ${v.publishedAt}`);
  });
}

// Background render analysis
const noBackgroundRender = auditData.filter(a => a.hasBackgroundPlan && !a.appliedToRender);
console.log(`\nMissing Dynamic Background: ${noBackgroundRender.length} videos`);
if (noBackgroundRender.length > 0) {
  noBackgroundRender.forEach(v => {
    console.log(`  ❌ ${v.videoId.substring(0, 8)}... (has plan but not applied)`);
  });
}

console.log('\n');

// Export data for further analysis
fs.writeFileSync(
  path.resolve(DATA_DIR, 'forensic-audit-2026-05-05.json'),
  JSON.stringify(auditData, null, 2)
);

console.log(`✅ Detailed audit exported to: ${path.resolve(DATA_DIR, 'forensic-audit-2026-05-05.json')}`);

// ─────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────

function determinePublisher(logEntry, publishedAt) {
  if (!logEntry) {
    // Try to infer from timing
    const hour = new Date(publishedAt).getHours();
    if (hour === 14 || hour === 21) {
      return 'PublishScheduler(?)';
    }
    return 'unknown';
  }

  if (logEntry.strategy === 'reserved_slot') {
    return 'PublishScheduler';
  }
  if (logEntry.fallbackReason) {
    return 'PublishScheduler(FB)';
  }
  if (logEntry.latePublish) {
    return 'manual-late-publish';
  }
  if (logEntry.strategy === 'emergency') {
    return 'emergency:publish';
  }

  return 'unknown';
}
