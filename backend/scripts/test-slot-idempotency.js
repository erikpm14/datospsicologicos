#!/usr/bin/env node
/**
 * test-slot-idempotency.js
 * TAREA 6: Verificar que slot-level idempotency lock funciona correctamente.
 *
 * Tests:
 * 1. Principal publica → backup bloqueado
 * 2. Principal falla antes de upload → backup permitido
 * 3. Proceso duplicado intenta mismo slot → bloqueado
 * 4. Slot estado PUBLISHED es persistente
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const SlotLockService = require('../src/services/slot-idempotency-lock.service');

const LOCKS_FILE = path.resolve(__dirname, '../data/slot-publication-locks.json');

function colorize(text, color) {
  const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
  };
  return `${colors[color] || ''}${text}${colors.reset}`;
}

function printHeader(text) {
  console.log(`\n${colorize('═'.repeat(70), 'blue')}`);
  console.log(colorize(text, 'blue'));
  console.log(`${colorize('═'.repeat(70), 'blue')}\n`);
}

function printTest(name, passed) {
  const status = passed ? colorize('✓ PASS', 'green') : colorize('✗ FAIL', 'red');
  console.log(`${status}: ${name}`);
}

function initLocks() {
  if (!fs.existsSync(path.dirname(LOCKS_FILE))) {
    fs.mkdirSync(path.dirname(LOCKS_FILE), { recursive: true });
  }
  fs.writeFileSync(LOCKS_FILE, JSON.stringify({ locks: [], metadata: { version: '1.0' } }, null, 2));
}

function clearLocks() {
  initLocks();
}

function getLocks() {
  try {
    return JSON.parse(fs.readFileSync(LOCKS_FILE, 'utf8')).locks || [];
  } catch {
    return [];
  }
}

function test1_PrincipalPublishesBlocksBackup() {
  console.log('\n📋 TEST 1: Principal publishes → backup blocked\n');
  clearLocks();

  const videoId1 = uuidv4();
  const youtubeId = 'hWL72kiFkdM';

  // Principal acquires lock
  const result = SlotLockService.acquireSlotLock('2026-05-11', '14-30', videoId1);
  const slotKey = result.slotKey;
  const acquired = result.acquired === true;
  printTest('Principal acquires slot lock', acquired);

  // Principal publishes
  const published = SlotLockService.markSlotAsPublished(slotKey, videoId1, youtubeId);
  printTest('Principal marked as PUBLISHED with youtubeId', published);

  // Backup tries to publish (should fail)
  const videoId2 = uuidv4();
  const backupResult = SlotLockService.canAttemptBackup(slotKey, videoId1);
  const canBackup = backupResult.allowed === true;
  printTest('Backup cannot attempt (canAttemptBackup returns false)', !canBackup);

  return acquired && published && !canBackup;
}

function test2_PrincipalFailsAllowsBackup() {
  console.log('\n📋 TEST 2: Principal fails before upload → backup allowed\n');
  clearLocks();

  const videoId1 = uuidv4();
  const videoId2 = uuidv4();

  // Principal fails to upload (status = FAILED)
  const result = SlotLockService.acquireSlotLock('2026-05-11', '14-30', videoId1);
  const slotKey = result.slotKey;
  const acquired = result.acquired === true;

  const failed = SlotLockService.markSlotAsFailed(slotKey, videoId1, 'upload_timeout');
  printTest('Principal marked as FAILED', failed);

  // Backup can now attempt
  const backupResult = SlotLockService.canAttemptBackup(slotKey, videoId1);
  const canBackup = backupResult.allowed === true;
  printTest('Backup can attempt after principal fails', canBackup);

  if (canBackup) {
    SlotLockService.recordBackupAttempt(slotKey, videoId1, videoId2, 'fallback_to_backup');
    const locks2 = getLocks();
    const backupRecorded = locks2.some(l => l.backupAttempts?.some(b => b.videoId === videoId2));
    printTest('Backup attempt recorded', backupRecorded);
  }

  return acquired && failed && canBackup;
}

function test3_DuplicateProcessBlocked() {
  console.log('\n📋 TEST 3: Duplicate process tries same slot → blocked\n');
  clearLocks();

  const videoId = uuidv4();
  const youtubeId = 'hWL72kiFkdM';

  // First process publishes
  const result1 = SlotLockService.acquireSlotLock('2026-05-11', '14-30', videoId);
  const slotKey = result1.slotKey;
  SlotLockService.markSlotAsPublished(slotKey, videoId, youtubeId);

  // Duplicate process tries to acquire same slot
  const videoId2 = uuidv4();
  const result2 = SlotLockService.acquireSlotLock('2026-05-11', '14-30', videoId2);
  const cannotAcquire = result2.acquired !== true;
  printTest('Duplicate process cannot acquire lock', cannotAcquire);

  return cannotAcquire;
}

function test4_SlotStatePersistent() {
  console.log('\n📋 TEST 4: Slot state is persistent across restarts\n');
  clearLocks();

  const videoId = uuidv4();
  const youtubeId = 'hWL72kiFkdM';

  // Session 1: Publish video
  const result = SlotLockService.acquireSlotLock('2026-05-11', '14-30', videoId);
  const slotKey = result.slotKey;
  SlotLockService.markSlotAsPublished(slotKey, videoId, youtubeId);

  // Session 2 (simulated restart): Reload locks
  const locks = getLocks();
  const found = locks.find(l => l.slotKey === slotKey && l.status === 'published');
  printTest('Lock persisted after simulated restart', !!found);

  if (found) {
    printTest('youtubeId preserved', found.youtubeId === youtubeId);
  }

  return !!found && found?.youtubeId === youtubeId;
}

function test5_MultipleSlots() {
  console.log('\n📋 TEST 5: Multiple slots work independently\n');
  clearLocks();

  const videoId1 = uuidv4();
  const videoId2 = uuidv4();
  const youtubeId1 = 'hWL72kiFkdM';
  const youtubeId2 = '-4j9AxR1veI';

  // Slot 1
  const result1 = SlotLockService.acquireSlotLock('2026-05-11', '14-30', videoId1);
  const slotKey1 = result1.slotKey;
  SlotLockService.markSlotAsPublished(slotKey1, videoId1, youtubeId1);

  // Slot 2 (should be independent)
  const result2 = SlotLockService.acquireSlotLock('2026-05-11', '15-30', videoId2);
  const slotKey2 = result2.slotKey;
  SlotLockService.markSlotAsPublished(slotKey2, videoId2, youtubeId2);

  const locks = getLocks();
  const slot1 = locks.find(l => l.slotKey === slotKey1);
  const slot2 = locks.find(l => l.slotKey === slotKey2);

  printTest('Slot 1 published successfully', slot1?.status === 'published');
  printTest('Slot 2 published independently', slot2?.status === 'published');
  printTest('Both slots have different youtubeIds', slot1?.youtubeId !== slot2?.youtubeId);

  return slot1?.status === 'published' && slot2?.status === 'published' && slot1?.youtubeId !== slot2?.youtubeId;
}

async function main() {
  printHeader('TAREA 6 — SLOT IDEMPOTENCY LOCK TESTS');

  const results = [];

  try {
    results.push({ name: 'Test 1: Principal publishes → backup blocked', passed: test1_PrincipalPublishesBlocksBackup() });
    results.push({ name: 'Test 2: Principal fails → backup allowed', passed: test2_PrincipalFailsAllowsBackup() });
    results.push({ name: 'Test 3: Duplicate process blocked', passed: test3_DuplicateProcessBlocked() });
    results.push({ name: 'Test 4: Slot state persistent', passed: test4_SlotStatePersistent() });
    results.push({ name: 'Test 5: Multiple slots independent', passed: test5_MultipleSlots() });
  } catch (err) {
    console.error(`\n${colorize('ERROR:', 'red')} ${err.message}`);
    console.error(err.stack);
  }

  // Summary
  printHeader('TEST SUMMARY');
  results.forEach(r => {
    const status = r.passed ? colorize('✓ PASS', 'green') : colorize('✗ FAIL', 'red');
    console.log(`${status}: ${r.name}`);
  });

  const allPassed = results.every(r => r.passed);
  const passCount = results.filter(r => r.passed).length;
  console.log(`\n${colorize(`\nResult: ${passCount}/${results.length} tests passed`, allPassed ? 'green' : 'red')}\n`);

  if (allPassed) {
    console.log(colorize('✓ Slot idempotency lock is working correctly!', 'green'));
    console.log('✓ System is protected against double publication\n');
    clearLocks();
    process.exit(0);
  } else {
    console.error(colorize('✗ Some tests failed. See above for details.\n', 'red'));
    process.exit(1);
  }
}

main();
