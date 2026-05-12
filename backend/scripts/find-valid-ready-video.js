#!/usr/bin/env node
/**
 * Find a valid READY video that is NOT already published
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.resolve(BACKEND_DIR, 'output-fase1-test');
const DATA_DIR = path.resolve(BACKEND_DIR, 'data');
const VIDEOS_JSON_PATH = path.resolve(DATA_DIR, 'videos.json');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║    SEARCH: Find valid READY video (NOT published)          ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Load published videos database
let publishedIds = new Set();
try {
  const videosDb = JSON.parse(fs.readFileSync(VIDEOS_JSON_PATH, 'utf8'));
  const items = videosDb.published || videosDb;
  if (Array.isArray(items)) {
    items.forEach(v => {
      if (v.id && v.youtube_id) {
        publishedIds.add(v.id);
      }
    });
  }
} catch (err) {
  console.log(`⚠️  Could not read videos database: ${err.message}`);
}

console.log(`Known published videos: ${publishedIds.size}`);
console.log('');

// Scan output directory for READY videos
const videoIds = fs.readdirSync(OUTPUT_DIR).filter(id => {
  const videoPath = path.join(OUTPUT_DIR, id);
  return fs.statSync(videoPath).isDirectory();
});

console.log(`Scanning ${videoIds.length} directories in output/...\n`);

const candidates = [];

for (const videoId of videoIds) {
  const videoDir = path.join(OUTPUT_DIR, videoId);

  // Check 1: Must have output.mp4
  const mp4Path = path.join(videoDir, 'output.mp4');
  if (!fs.existsSync(mp4Path)) continue;

  // Check 2: Must have generation-metadata.json
  const metadataPath = path.join(videoDir, 'generation-metadata.json');
  if (!fs.existsSync(metadataPath)) continue;

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    // Check 3: Must NOT be already published
    if (publishedIds.has(videoId)) {
      console.log(`✗ ${videoId.substring(0, 8)}... → ALREADY PUBLISHED (youtube_id exists)`);
      continue;
    }

    // Check 4: Must NOT have published.json
    const publishedPath = path.join(videoDir, 'published.json');
    if (fs.existsSync(publishedPath)) {
      console.log(`✗ ${videoId.substring(0, 8)}... → published.json exists`);
      continue;
    }

    // Check 5: Must pass basic metadata checks
    if (!metadata.backgroundPlan?.diversityScore || metadata.backgroundPlan.diversityScore < 70) {
      console.log(`✗ ${videoId.substring(0, 8)}... → background diversity too low`);
      continue;
    }

    if (metadata.backgroundPlan?.appliedToRender !== true) {
      console.log(`✗ ${videoId.substring(0, 8)}... → background not applied to render`);
      continue;
    }

    // This is a candidate!
    const size = fs.statSync(mp4Path).size;
    candidates.push({
      videoId,
      size,
      diversityScore: metadata.backgroundPlan.diversityScore,
      generatedAt: metadata.generatedAt,
      topic: metadata.topic,
      hook: metadata.hook
    });

    console.log(`✓ ${videoId.substring(0, 8)}... → VALID READY (not published)`);
  } catch (err) {
    console.log(`? ${videoId.substring(0, 8)}... → metadata error: ${err.message}`);
  }
}

console.log('');

if (candidates.length === 0) {
  console.log('❌ NO VALID READY VIDEOS FOUND\n');
  console.log('Next steps:');
  console.log('  1. Generate new video: node scripts/emergency-generate-no-llm.js');
  console.log('  2. Verify it passes all checks');
  console.log('  3. Run this script again\n');
  process.exit(1);
}

// Sort by most recent
candidates.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));

console.log(`Found ${candidates.length} valid READY video(s):\n`);

candidates.forEach((cand, idx) => {
  console.log(`${idx + 1}. ${cand.videoId}`);
  console.log(`   Size: ${(cand.size / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   Diversity: ${cand.diversityScore}`);
  console.log(`   Topic: ${cand.topic}`);
  console.log(`   Hook: ${cand.hook.substring(0, 50)}...`);
  console.log('');
});

const best = candidates[0];
console.log('═'.repeat(60));
console.log('✅ RECOMMENDED: Use most recent');
console.log(`\n   videoId: ${best.videoId}\n`);

console.log('Export as environment variable:');
console.log(`   READY_VIDEO_ID=${best.videoId}\n`);

// Also output as JSON for script parsing
console.log(JSON.stringify({
  recommended: best.videoId,
  all: candidates.map(c => c.videoId)
}, null, 2));
