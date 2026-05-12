#!/usr/bin/env node
/**
 * IDEMPOTENCY LOCK TEST
 *
 * Simulates concurrent publish attempts for the same videoId.
 * Verifies that:
 * 1. First attempt acquires lock
 * 2. Second attempt is blocked
 * 3. Lock is properly released after upload
 * 4. Stale locks are detected and cleaned up
 *
 * NO PUBLICATIONS ARE ATTEMPTED - DRY RUN ONLY
 */

const fs = require('fs');
const path = require('path');
const {
  acquirePublishLock,
  releasePublishLock,
  getActiveLock,
} = require('../src/services/publish-idempotency-lock.service');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');

// Test utilities
const results = [];
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function test(name, fn) {
  try {
    fn();
    results.push({ name, status: 'PASS' });
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err.message });
    testsFailed++;
    console.error(`✗ ${name}: ${err.message}`);
  }
}

function cleanupLock(videoId) {
  const videoDir = path.join(OUTPUT_DIR, videoId);
  const lockPath = path.join(videoDir, 'publishing-lock.json');
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {}
}

// ─────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║       IDEMPOTENCY LOCK TEST SUITE (DRY RUN)            ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// Test 1: Single lock acquisition
test('Single lock acquisition succeeds', () => {
  const videoId = 'test-video-single-lock';
  cleanupLock(videoId);

  const result = acquirePublishLock(videoId, {
    source: 'test-single',
    reason: 'dry_run_test',
  });

  assert(result.acquired === true, 'Lock should be acquired');
  assert(result.lockPath !== undefined, 'Lock path should be defined');
  assert(result.lockData !== undefined, 'Lock data should be defined');
  assert(result.lockData.status === 'upload_in_progress', 'Status should be upload_in_progress');

  cleanupLock(videoId);
});

// Test 2: Concurrent lock attempt blocked
test('Concurrent lock attempt is blocked', () => {
  const videoId = 'test-video-concurrent';
  cleanupLock(videoId);

  // First attempt succeeds
  const result1 = acquirePublishLock(videoId, {
    source: 'test-first',
    reason: 'dry_run_test',
  });
  assert(result1.acquired === true, 'First lock should be acquired');

  // Second attempt fails
  const result2 = acquirePublishLock(videoId, {
    source: 'test-second',
    reason: 'dry_run_test',
  });
  assert(result2.acquired === false, 'Second lock should not be acquired');
  assert(result2.error !== undefined, 'Error message should be defined');
  assert(
    result2.error.includes('already in progress'),
    'Error should mention concurrent upload'
  );
  assert(result2.existingLock !== undefined, 'Existing lock data should be returned');
  assert(result2.existingLock.source === 'test-first', 'Should show first source');

  cleanupLock(videoId);
});

// Test 3: Active lock detection
test('Active lock is properly detected', () => {
  const videoId = 'test-video-detect';
  cleanupLock(videoId);

  // Acquire lock
  const acquired = acquirePublishLock(videoId, {
    source: 'test-detect',
    reason: 'dry_run_test',
  });
  assert(acquired.acquired === true, 'Lock should be acquired');

  // Detect active lock
  const activeLock = getActiveLock(videoId);
  assert(activeLock !== null, 'Active lock should be detected');
  assert(activeLock.videoId === videoId, 'Lock should have correct videoId');
  assert(activeLock.source === 'test-detect', 'Lock should have correct source');
  assert(activeLock.status === 'upload_in_progress', 'Lock status should be upload_in_progress');

  cleanupLock(videoId);
});

// Test 4: Lock release on success
test('Lock is properly released after success', () => {
  const videoId = 'test-video-success';
  cleanupLock(videoId);

  // Acquire lock
  acquirePublishLock(videoId, { source: 'test-success' });

  // Release with success
  const released = releasePublishLock(videoId, true, 'test-youtube-id-12345');
  assert(released === true, 'Release should succeed');

  // Lock should be removed or marked as completed
  const activeLock = getActiveLock(videoId);
  assert(activeLock === null, 'Lock should be cleared after success');

  cleanupLock(videoId);
});

// Test 5: Lock release on failure
test('Lock is properly updated on failure', () => {
  const videoId = 'test-video-failed';
  cleanupLock(videoId);

  // Acquire lock
  const acquired = acquirePublishLock(videoId, { source: 'test-failed' });
  const lockPath = acquired.lockPath;

  // Release with failure
  releasePublishLock(videoId, false);

  // Lock should still exist but be marked as failed
  const lockContent = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert(lockContent.status === 'failed', 'Lock status should be failed');
  assert(lockContent.failedAt !== undefined, 'Lock should have failedAt timestamp');

  cleanupLock(videoId);
});

// Test 6: Lock expiry and recovery
test('Stale locks are detected and cleaned up', () => {
  const videoId = 'test-video-stale';
  cleanupLock(videoId);

  // Acquire lock and manually age it
  const acquired = acquirePublishLock(videoId, { source: 'test-stale' });
  const lockPath = acquired.lockPath;

  // Manually modify createdAt to 1 hour ago
  const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  lockData.createdAt = oneHourAgo.toISOString();
  fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2));

  // Should detect stale lock and clean it up (no youtubeId or published.json)
  const activeLock = getActiveLock(videoId);
  assert(activeLock === null, 'Stale lock should be cleaned up if no youtubeId/published.json');

  cleanupLock(videoId);
});

// Test 7: Lock data structure
test('Lock file has correct structure', () => {
  const videoId = 'test-video-structure';
  cleanupLock(videoId);

  const acquired = acquirePublishLock(videoId, {
    source: 'test-structure',
    reason: 'test_reason',
  });

  const lockData = acquired.lockData;
  assert(lockData.videoId === videoId, 'Should have videoId');
  assert(lockData.source === 'test-structure', 'Should have source');
  assert(lockData.reason === 'test_reason', 'Should have reason');
  assert(lockData.createdAt !== undefined, 'Should have createdAt');
  assert(lockData.pid !== undefined, 'Should have pid');
  assert(lockData.status === 'upload_in_progress', 'Should have status');
  assert(lockData.hostname !== undefined, 'Should have hostname');

  cleanupLock(videoId);
});

// Test 8: Multiple sequential locks
test('Sequential locks work correctly', () => {
  const videoId = 'test-video-sequential';
  cleanupLock(videoId);

  // First lock cycle
  const lock1 = acquirePublishLock(videoId, { source: 'test-seq-1' });
  assert(lock1.acquired === true, 'First lock should be acquired');

  releasePublishLock(videoId, true, 'youtube-id-1');

  // Second lock cycle for same videoId should fail (video already published)
  // but lock file should be gone, so we can detect this via another method
  cleanupLock(videoId); // Simulate published.json being there would block in real scenario

  const lock2 = acquirePublishLock(videoId, { source: 'test-seq-2' });
  assert(lock2.acquired === true, 'Second lock (after cleanup) should be acquired');

  cleanupLock(videoId);
});

// ─────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║                   TEST SUMMARY                         ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

for (const result of results) {
  const icon = result.status === 'PASS' ? '✓' : '✗';
  console.log(`${icon} ${result.name}`);
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }
}

console.log(`\nTotal: ${testsPassed}/${testsPassed + testsFailed} tests passed`);

if (testsFailed === 0) {
  console.log('\n✓ ALL IDEMPOTENCY LOCK TESTS PASSED (DRY RUN)');
  console.log('\nNo YouTube uploads were attempted.');
  console.log('Lock mechanism is working correctly for concurrent protection.\n');
  process.exit(0);
} else {
  console.log(`\n✗ ${testsFailed} TEST(S) FAILED\n`);
  process.exit(1);
}
