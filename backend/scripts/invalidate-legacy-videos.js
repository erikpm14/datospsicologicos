#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './backend/output-fase1-test');
const LEGACY_DIR = path.join(OUTPUT_DIR, 'rejected', 'legacy-render');

const legacyVideos = [
  { id: '00fa7210-6e82-4307-9785-b1be87d35d02', reason: 'renderMode video_use incompatible with dynamic_background_timeline requirement' },
  { id: '917c5106-ab26-45b8-bb24-fda1beedf2bd', reason: 'backgroundPlan.appliedToRender !== true' }
];

console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║   INVALIDATE LEGACY RENDER VIDEOS                     ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

// Create legacy-render directory if not exists
if (!fs.existsSync(LEGACY_DIR)) {
  fs.mkdirSync(LEGACY_DIR, { recursive: true });
  console.log(`✅ Created: ${LEGACY_DIR}\n`);
}

// Move each legacy video
for (const video of legacyVideos) {
  const src = path.join(OUTPUT_DIR, video.id);
  const dest = path.join(LEGACY_DIR, video.id);
  
  if (!fs.existsSync(src)) {
    console.log(`⚠️  ${video.id}: NOT FOUND in output/`);
    continue;
  }
  
  // Remove destination if exists
  if (fs.existsSync(dest)) {
    console.log(`Removing existing: ${dest}`);
    fs.rmSync(dest, { recursive: true, force: true });
  }
  
  // Move to legacy-render
  fs.renameSync(src, dest);
  console.log(`✅ Moved: ${video.id}`);
  console.log(`   └─ reason: ${video.reason}\n`);
}

// Update slot-lock-state.json
console.log('Updating slot-lock-state.json...\n');
const slotStatePath = path.join(OUTPUT_DIR, '..', 'data', 'slot-lock-state.json');
let slotState = JSON.parse(fs.readFileSync(slotStatePath, 'utf8'));

// Invalidate nearestSlot
if (slotState.nearestSlot && slotState.nearestSlot.videoId === '00fa7210-6e82-4307-9785-b1be87d35d02') {
  slotState.history.push({
    action: 'invalidated',
    videoId: slotState.nearestSlot.videoId,
    reason: 'legacy_render_incompatible',
    invalidatedAt: new Date().toISOString(),
    details: 'renderMode=video_use incompatible with dynamic_background_timeline requirement'
  });
  
  slotState.nearestSlot = {
    date: '2026-05-05',
    time: '21:15',
    timezone: 'Europe/Madrid',
    locked: false,
    videoId: null,
    status: 'UNASSIGNED',
    reason: 'legacy_inventory_discarded'
  };
  
  console.log(`✅ invalidated nearestSlot.videoId=00fa7210`);
  console.log(`   └─ reason: legacy_render_incompatible\n`);
}

// Remove backups
if (slotState.backups) {
  const oldBackupCount = slotState.backups.length;
  slotState.backups = slotState.backups.filter(b => b.videoId !== '917c5106-ab26-45b8-bb24-fda1beedf2bd');
  
  if (oldBackupCount > slotState.backups.length) {
    slotState.history.push({
      action: 'backup_removed',
      videoId: '917c5106-ab26-45b8-bb24-fda1beedf2bd',
      reason: 'legacy_render_incompatible',
      removedAt: new Date().toISOString(),
      details: 'backgroundPlan.appliedToRender !== true'
    });
    
    console.log(`✅ removed backup 917c5106 (legacy render)`);
    console.log(`   └─ reason: legacy_render_incompatible\n`);
  }
}

fs.writeFileSync(slotStatePath, JSON.stringify(slotState, null, 2));
console.log('✅ slot-lock-state.json updated\n');

console.log('═'.repeat(58));
console.log('[LEGACY_RENDER_VIDEO_REJECTED] 00fa7210-6e82-...');
console.log('[LEGACY_RENDER_VIDEO_REJECTED] 917c5106-ab26-...');
console.log('[NEAREST_SLOT_RESERVATION_INVALIDATED] slot=2026-05-05 21:15');
console.log('═'.repeat(58) + '\n');

process.exit(0);
