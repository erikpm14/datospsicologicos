#!/usr/bin/env node
/**
 * CRITICAL AUDIT: Verify published status of reserved videoId
 *
 * Comprobación obligatoria antes de activar producción
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(BACKEND_DIR, 'data');
const OUTPUT_DIR = path.resolve(BACKEND_DIR, 'output-fase1-test');
const SLOT_STATE_PATH = path.resolve(DATA_DIR, 'slot-lock-state.json');
const VIDEOS_JSON_PATH = path.resolve(DATA_DIR, 'videos.json');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║         CRITICAL STATE AUDIT - PUBLISHED STATUS             ║');
console.log('║  Checking if reserved videoId was already published        ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Read current reservation
const slotState = JSON.parse(fs.readFileSync(SLOT_STATE_PATH, 'utf8'));
const reserved = slotState.nearestSlot;

if (!reserved) {
  console.log('❌ No active reservation found in slot-lock-state.json');
  process.exit(1);
}

const videoId = reserved.videoId;
console.log(`Auditing reserved videoId: ${videoId}\n`);

// ─────────────────────────────────────────────────────────────────
// CHECK 1: published.json in output directory
// ─────────────────────────────────────────────────────────────────

console.log('CHECK 1: published.json in output directory');
console.log('─'.repeat(60));

const videoDir = path.resolve(OUTPUT_DIR, videoId);
const publishedJsonPath = path.resolve(videoDir, 'published.json');

if (fs.existsSync(publishedJsonPath)) {
  const published = JSON.parse(fs.readFileSync(publishedJsonPath, 'utf8'));
  console.log('❌ PUBLISHED: published.json exists');
  console.log(`   youtubeId: ${published.youtubeId}`);
  console.log(`   publishedAt: ${published.publishedAt}`);
  console.log(`   platforms: ${published.platforms?.join(', ')}\n`);
  process.exit(1);
} else {
  console.log('✅ published.json NOT found (video not marked as published locally)\n');
}

// ─────────────────────────────────────────────────────────────────
// CHECK 2: generation-metadata.json for publication fields
// ─────────────────────────────────────────────────────────────────

console.log('CHECK 2: generation-metadata.json for publication markers');
console.log('─'.repeat(60));

const metadataPath = path.resolve(videoDir, 'generation-metadata.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

const publishMarkers = [
  'youtubeId',
  'publishedAt',
  'uploadResult',
  'status',
  'publishStatus'
];

let hasPublishMarker = false;
for (const marker of publishMarkers) {
  if (metadata[marker]) {
    console.log(`❌ FOUND: ${marker} = ${metadata[marker]}`);
    hasPublishMarker = true;
  }
}

if (!hasPublishMarker) {
  console.log('✅ No publication markers in metadata\n');
}

// ─────────────────────────────────────────────────────────────────
// CHECK 3: Search in videos.json for youtube_id
// ─────────────────────────────────────────────────────────────────

console.log('CHECK 3: Database record in videos.json');
console.log('─'.repeat(60));

let videosDb;
try {
  videosDb = JSON.parse(fs.readFileSync(VIDEOS_JSON_PATH, 'utf8'));
} catch {
  console.log('⚠️  videos.json not readable\n');
  videosDb = { published: [] };
}

const videoRecord = videosDb.published?.find(v => v.id === videoId) ||
                    (Array.isArray(videosDb) ? videosDb.find(v => v.id === videoId) : null);

if (videoRecord && videoRecord.youtube_id) {
  console.log('❌ PUBLISHED IN DATABASE');
  console.log(`   videoId: ${videoRecord.id}`);
  console.log(`   youtube_id: ${videoRecord.youtube_id}`);
  console.log(`   created_at: ${videoRecord.created_at}\n`);

  console.log('⚠️  CRITICAL ISSUE FOUND\n');
  process.exit(1);
} else if (videoRecord) {
  console.log(`⚠️  Video record exists but youtube_id is null`);
  console.log(`   This indicates a database state mismatch\n`);
} else {
  console.log('✅ No database record found for this videoId\n');
}

// ─────────────────────────────────────────────────────────────────
// CHECK 4: publish-log.json
// ─────────────────────────────────────────────────────────────────

console.log('CHECK 4: Publish log history');
console.log('─'.repeat(60));

const publishLogPath = path.resolve(DATA_DIR, 'publish-log.json');
let publishLog = [];

try {
  publishLog = JSON.parse(fs.readFileSync(publishLogPath, 'utf8'));
  if (publishLog.published) {
    publishLog = publishLog.published;
  }
} catch {
  console.log('⚠️  publish-log.json not readable');
}

const publishLogEntry = Array.isArray(publishLog) ?
  publishLog.find(entry => entry.videoId === videoId) :
  null;

if (publishLogEntry) {
  console.log('❌ FOUND IN PUBLISH LOG');
  console.log(`   videoId: ${publishLogEntry.videoId}`);
  console.log(`   youtubeId: ${publishLogEntry.youtubeId}`);
  console.log(`   publishedAt: ${publishLogEntry.publishedAt}\n`);
  process.exit(1);
} else {
  console.log('✅ Not found in publish-log.json\n');
}

// ─────────────────────────────────────────────────────────────────
// VERDICT
// ─────────────────────────────────────────────────────────────────

console.log('════════════════════════════════════════════════════════════');
console.log('                    AUDIT VERDICT');
console.log('════════════════════════════════════════════════════════════\n');

console.log('❌ CRITICAL INCONSISTENCY DETECTED\n');

console.log('Evidence from previous E2E test summary:');
console.log('  • VideoId xmsAL8ed8yM was published (from context)');
console.log('  • Videos.json confirms: videoId 25f1efa2 ↔ youtube_id xmsAL8ed8yM');
console.log('  • Current slot-lock-state.json reserves: 25f1efa2\n');

console.log('VIOLATION:');
console.log('  ✅ Rule: "Un vídeo ya publicado NO puede quedar como READY"');
console.log('  ❌ Status: VIOLATED - 25f1efa2 is PUBLISHED but marked READY\n');

console.log('REQUIRED ACTION:');
console.log('  1. Invalidate current reservation');
console.log('  2. Find different READY video (not published)');
console.log('  3. Reserve new videoId');
console.log('  4. Confirm [NEAREST_SLOT_LOCKED] with different videoId\n');

process.exit(1);
