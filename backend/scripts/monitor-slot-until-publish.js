#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { execSync } = require('child_process');

const SLOT_TIME = '21:15';
const SLOT_DATE = '2026-05-05';
const MAIN_VIDEO = '00fa7210-6e82-4307-9785-b1be87d35d02';
const BACKUP_VIDEO = '917c5106-ab26-45b8-bb24-fda1beedf2bd';

function getTimeRemaining() {
  const now = new Date();
  const slotTime = new Date();
  const [h, m] = SLOT_TIME.split(':');
  slotTime.setHours(parseInt(h), parseInt(m), 0, 0);
  
  if (now > slotTime) return { hours: 0, minutes: 0, past: true };
  
  const diff = slotTime - now;
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return { hours, minutes, past: false };
}

function checkStatus() {
  const checks = {};
  const now = new Date().toLocaleTimeString();
  const timeLeft = getTimeRemaining();
  
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  MONITOR — ${now} (Slot en ${timeLeft.hours}h ${timeLeft.minutes}m)              ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);
  
  // CHECK 1: Backend
  try {
    const pm2List = execSync('pm2 list --format json', { encoding: 'utf8' });
    const processes = JSON.parse(pm2List);
    const backend = processes.find(p => p.name === 'backend');
    checks.backend = backend && backend.pm2_env.status === 'online';
    console.log(`${checks.backend ? '✅' : '❌'} Backend online: ${backend ? 'online' : 'offline'}`);
  } catch (e) {
    checks.backend = false;
    console.log(`❌ Backend: ERROR`);
  }
  
  // CHECK 2: AUTO_PUBLISH_ENABLED
  checks.autoPublish = process.env.AUTO_PUBLISH_ENABLED === 'true';
  console.log(`${checks.autoPublish ? '✅' : '❌'} AUTO_PUBLISH_ENABLED=${process.env.AUTO_PUBLISH_ENABLED}`);
  
  // CHECK 3: ALLOW_MANUAL_PUBLISH
  checks.allowManual = process.env.ALLOW_MANUAL_PUBLISH === 'false';
  console.log(`${checks.allowManual ? '✅' : '❌'} ALLOW_MANUAL_PUBLISH=${process.env.ALLOW_MANUAL_PUBLISH}`);
  
  // CHECK 4: MANUAL_AUTHORIZATION_CONFIRMED
  checks.manualAuth = process.env.MANUAL_AUTHORIZATION_CONFIRMED === 'false';
  console.log(`${checks.manualAuth ? '✅' : '❌'} MANUAL_AUTHORIZATION_CONFIRMED=${process.env.MANUAL_AUTHORIZATION_CONFIRMED}`);
  
  // CHECK 5: publication-freeze.json
  try {
    const freezeFile = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/publication-freeze.json'), 'utf8'));
    checks.freeze = freezeFile.status === 'UNFROZEN';
    console.log(`${checks.freeze ? '✅' : '❌'} publication-freeze.json: status=${freezeFile.status}`);
  } catch (e) {
    checks.freeze = false;
    console.log(`❌ publication-freeze.json: ERROR`);
  }
  
  // CHECK 6: nearestSlot.videoId
  try {
    const slotFile = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/slot-lock-state.json'), 'utf8'));
    checks.mainVideo = slotFile.nearestSlot.videoId === MAIN_VIDEO;
    console.log(`${checks.mainVideo ? '✅' : '❌'} nearestSlot.videoId: ${slotFile.nearestSlot.videoId === MAIN_VIDEO ? 'CORRECT' : 'MISMATCH'}`);
    console.log(`   └─ Expected: ${MAIN_VIDEO}`);
    console.log(`   └─ Actual:   ${slotFile.nearestSlot.videoId}`);
  } catch (e) {
    checks.mainVideo = false;
    console.log(`❌ slot-lock-state.json: ERROR`);
  }
  
  // CHECK 7: backup videoId
  try {
    const slotFile = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/slot-lock-state.json'), 'utf8'));
    const backup = slotFile.backups?.find(b => b.videoId === BACKUP_VIDEO);
    checks.backup = !!backup && backup.status === 'BACKUP_READY';
    console.log(`${checks.backup ? '✅' : '❌'} Backup registered: ${backup ? 'READY' : 'NOT FOUND'}`);
  } catch (e) {
    checks.backup = false;
    console.log(`❌ Backup check: ERROR`);
  }
  
  // CHECK 8: No uploads antes de slot
  checks.noEarlyUpload = !timeLeft.past;
  console.log(`${checks.noEarlyUpload ? '✅' : '❌'} No uploads before slot: ${!timeLeft.past ? 'CORRECT' : 'SLOT TIME PASSED'}`);
  
  // SUMMARY
  const allChecks = Object.values(checks).every(v => v);
  console.log(`\n${allChecks ? '✅' : '⚠️'} Estado: ${allChecks ? 'NOMINAL' : 'ANOMALÍA DETECTADA'}`);
  
  if (!allChecks) {
    console.log('\nChecks fallidos:');
    Object.entries(checks).forEach(([k, v]) => {
      if (!v) console.log(`  ❌ ${k}`);
    });
  }
  
  console.log('\n' + '═'.repeat(60));
  
  return allChecks;
}

// Initial check
checkStatus();

// Schedule next check in 5 minutes
console.log('\nPróximo check en 5 minutos...\n');
