const fs = require('fs');
const path = require('path');
const { validateReadyVideo } = require('../src/services/ready-video-validator.service');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');
const REJECTED_DIR = path.resolve(OUTPUT_DIR, '../rejected');

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║     VIDEO INVENTORY AUDIT                             ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// Get all videos
const allDirs = [];
if (fs.existsSync(OUTPUT_DIR)) {
  const dirs = fs.readdirSync(OUTPUT_DIR).filter(d => {
    const p = path.join(OUTPUT_DIR, d);
    return fs.statSync(p).isDirectory() && d !== 'rejected' && !d.startsWith('.');
  });
  allDirs.push(...dirs.map(d => ({ dir: d, status: 'output' })));
}

// Get rejected videos
const rejectedCategories = {};
if (fs.existsSync(REJECTED_DIR)) {
  const categories = fs.readdirSync(REJECTED_DIR).filter(d => {
    return fs.statSync(path.join(REJECTED_DIR, d)).isDirectory();
  });
  for (const cat of categories) {
    const vidDirs = fs.readdirSync(path.join(REJECTED_DIR, cat));
    for (const vid of vidDirs) {
      rejectedCategories[vid] = cat;
      allDirs.push({ dir: vid, status: 'rejected', category: cat });
    }
  }
}

let readyCount = 0;
let notReadyCount = 0;
const readyVideos = [];
const notReadyVideos = [];

console.log(`Total videos found: ${allDirs.length}\n`);

for (const entry of allDirs) {
  const validation = validateReadyVideo(entry.dir);
  
  if (entry.status === 'rejected') {
    notReadyCount++;
    notReadyVideos.push({
      videoId: entry.dir.substring(0, 8),
      status: `REJECTED/${entry.category}`,
      reason: 'In rejected directory'
    });
  } else if (validation.ready) {
    readyCount++;
    readyVideos.push({
      videoId: entry.dir.substring(0, 8),
      status: 'READY'
    });
  } else {
    notReadyCount++;
    const reason = validation.errors.length > 0 ? validation.errors[0].split(']')[1]?.trim() || validation.errors[0] : 'Unknown';
    notReadyVideos.push({
      videoId: entry.dir.substring(0, 8),
      status: 'NOT READY',
      reason: reason.substring(0, 50)
    });
  }
}

console.log(`READY for publication: ${readyCount}`);
if (readyVideos.length > 0) {
  readyVideos.slice(0, 5).forEach(v => {
    console.log(`  ✓ ${v.videoId}...`);
  });
  if (readyVideos.length > 5) console.log(`  ... and ${readyVideos.length - 5} more`);
}

console.log(`\nNOT READY: ${notReadyCount}`);
if (notReadyVideos.length > 0) {
  notReadyVideos.slice(0, 5).forEach(v => {
    console.log(`  ✗ ${v.videoId}... (${v.status}: ${v.reason})`);
  });
  if (notReadyVideos.length > 5) console.log(`  ... and ${notReadyVideos.length - 5} more`);
}

// Check for dangerous videos
console.log('\n4. DANGEROUS VIDEO CHECK:');
let hasDangerous = false;
for (const v of allDirs) {
  if (v.status !== 'rejected') {
    const metaPath = path.join(OUTPUT_DIR, v.dir, 'generation-metadata.json');
    const pubPath = path.join(OUTPUT_DIR, v.dir, 'published.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.youtubeId) {
          console.log(`  ✗ ${v.dir.substring(0, 8)}... has youtubeId (already published)`);
          hasDangerous = true;
        }
        if (meta.renderMode === 'video_use' || meta.renderMode === 'hyperframe_html') {
          console.log(`  ✗ ${v.dir.substring(0, 8)}... uses legacy renderMode: ${meta.renderMode}`);
          hasDangerous = true;
        }
      } catch (e) {}
    }
    if (fs.existsSync(pubPath)) {
      console.log(`  ✗ ${v.dir.substring(0, 8)}... has published.json (already published)`);
      hasDangerous = true;
    }
  }
}
if (!hasDangerous) {
  console.log('  ✓ No videos with youtubeId/published.json in publishable pool');
  console.log('  ✓ No legacy render (video_use) videos in publishable pool');
}

console.log('\n5. SUBTITLE CHECK:');
let missingSubtitles = 0;
for (const v of allDirs) {
  if (v.status !== 'rejected') {
    const subPath = path.join(OUTPUT_DIR, v.dir, 'subtitles.vtt');
    if (!fs.existsSync(subPath)) {
      missingSubtitles++;
    }
  }
}
console.log(`  Videos missing subtitles.vtt: ${missingSubtitles}`);
if (missingSubtitles > 0) console.log('  ✗ Some videos lack subtitles');
else console.log('  ✓ All videos have subtitles');
