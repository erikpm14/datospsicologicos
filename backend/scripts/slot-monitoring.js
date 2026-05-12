#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SLOT_TIME = '21:15';
const MAIN_VIDEO = '00fa7210-6e82-4307-9785-b1be87d35d02';
const BACKUP_VIDEO = '917c5106-ab26-45b8-bb24-fda1beedf2bd';

function getTimeRemaining() {
  const now = new Date();
  const slotTime = new Date();
  const [h, m] = SLOT_TIME.split(':');
  slotTime.setHours(parseInt(h), parseInt(m), 0, 0);
  
  if (now > slotTime) return { hours: 0, minutes: 0, seconds: 0, past: true };
  
  const diff = slotTime - now;
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { hours, minutes, seconds, past: false };
}

function checkStatus() {
  const checks = {};
  const now = new Date();
  const timeLeft = getTimeRemaining();
  
  const timeStr = now.toLocaleTimeString('es-ES');
  const timeLeftStr = timeLeft.past 
    ? 'SLOT EN CURSO' 
    : `${timeLeft.hours}h ${timeLeft.minutes}m ${timeLeft.seconds}s`;
  
  console.log(`\n┌─ MONITOR SLOT 2026-05-05 21:15 ─────────────────────────┐`);
  console.log(`│ Hora actual: ${timeStr.padEnd(45)} │`);
  console.log(`│ Tiempo al slot: ${timeLeftStr.padEnd(41)} │`);
  console.log(`└────────────────────────────────────────────────────────────┘\n`);
  
  // CHECK 1: Env vars
  console.log('Configuration:');
  checks.autoPublish = process.env.AUTO_PUBLISH_ENABLED === 'true';
  checks.allowManual = process.env.ALLOW_MANUAL_PUBLISH === 'false';
  checks.manualAuth = process.env.MANUAL_AUTHORIZATION_CONFIRMED === 'false';
  
  console.log(`  ${checks.autoPublish ? '✅' : '❌'} AUTO_PUBLISH_ENABLED=${process.env.AUTO_PUBLISH_ENABLED}`);
  console.log(`  ${checks.allowManual ? '✅' : '❌'} ALLOW_MANUAL_PUBLISH=${process.env.ALLOW_MANUAL_PUBLISH}`);
  console.log(`  ${checks.manualAuth ? '✅' : '❌'} MANUAL_AUTHORIZATION_CONFIRMED=${process.env.MANUAL_AUTHORIZATION_CONFIRMED}`);
  
  // CHECK 2: Files
  console.log('\nSystem State:');
  try {
    const freezeFile = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/publication-freeze.json'), 'utf8'));
    checks.freeze = freezeFile.status === 'UNFROZEN';
    console.log(`  ${checks.freeze ? '✅' : '❌'} publication-freeze.json: ${freezeFile.status}`);
  } catch (e) {
    checks.freeze = false;
    console.log(`  ❌ publication-freeze.json: ERROR`);
  }
  
  try {
    const slotFile = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/slot-lock-state.json'), 'utf8'));
    
    checks.mainVideo = slotFile.nearestSlot.videoId === MAIN_VIDEO;
    checks.mainReady = slotFile.nearestSlot.status === 'READY';
    console.log(`  ${checks.mainVideo ? '✅' : '❌'} Main video locked: ${slotFile.nearestSlot.videoId.substring(0, 8)}...`);
    console.log(`     └─ Status: ${slotFile.nearestSlot.status}`);
    
    const backup = slotFile.backups?.find(b => b.videoId === BACKUP_VIDEO);
    checks.backup = !!backup && backup.status === 'BACKUP_READY';
    console.log(`  ${checks.backup ? '✅' : '❌'} Backup ready: ${backup ? BACKUP_VIDEO.substring(0, 8) + '...' : 'NOT FOUND'}`);
  } catch (e) {
    checks.mainVideo = checks.mainReady = checks.backup = false;
    console.log(`  ❌ slot-lock-state.json: ERROR`);
  }
  
  // CHECK 3: Timeline
  console.log('\nTimeline:');
  checks.noEarlyUpload = !timeLeft.past;
  console.log(`  ${checks.noEarlyUpload ? '✅' : '❌'} No uploads before slot: ${timeLeft.past ? 'SLOT TIME PASSED' : 'NOT YET'}`);
  
  // SUMMARY
  const allOk = Object.values(checks).every(v => v);
  console.log('\n' + (allOk ? '✅' : '⚠️') + ' ' + (allOk ? 'NOMINAL' : 'ANOMALÍA'));
  console.log('─'.repeat(60) + '\n');
  
  return allOk;
}

checkStatus();
