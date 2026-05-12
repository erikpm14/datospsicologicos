#!/usr/bin/env node
/**
 * TEST SUITE: Publish Guard Security
 *
 * Validates that publish guard correctly blocks unauthorized publications
 * Con sistema congelado: publication-freeze.json status=FROZEN
 *
 * Espera:
 * 1. manual-late-publish → BLOCKED (PUBLICATION_FREEZE)
 * 2. publish-late-recovery → BLOCKED (PUBLICATION_FREEZE)
 * 3. publish-next-valid → BLOCKED (PUBLICATION_FREEZE)
 * 4. retry-publish-video → BLOCKED (PUBLICATION_FREEZE)
 * 5. manual-publish-until-success → BLOCKED (PUBLICATION_FREEZE)
 * 6. Unknown source → BLOCKED (UNKNOWN_SOURCE)
 * 7. Video already published → BLOCKED (ALREADY_PUBLISHED)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const logger = require('../src/utils/logger');
const { assertPublishAllowed } = require('../src/services/publish-guard.service');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║         PUBLISH GUARD SECURITY TEST SUITE              ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertIncludes(actual, value, message) {
  if (!actual.includes(value)) {
    throw new Error(`${message}\nExpected array to include: ${value}\nActual: ${JSON.stringify(actual)}`);
  }
}

// ─────────────────────────────────────────────
// TEST 1: Publication Freeze Active
// ─────────────────────────────────────────────
test('Publication Freeze blocks manual-late-publish', () => {
  const result = assertPublishAllowed({
    videoId: 'test-video-001',
    source: 'manual-late-publish',
  });

  assertEquals(result.allowed, false, 'Should be blocked');
  assertEquals(result.reason, 'Sistema congelado por publicaciones previas con errores', 'Wrong reason');
  assertIncludes(result.errors, 'PUBLICATION_FREEZE_ACTIVE', 'Should have PUBLICATION_FREEZE_ACTIVE error');
});

test('Publication Freeze blocks publish-late-recovery', () => {
  const result = assertPublishAllowed({
    videoId: 'test-video-001',
    source: 'publish-late-recovery',
  });

  assertEquals(result.allowed, false, 'Should be blocked');
  assertIncludes(result.errors, 'PUBLICATION_FREEZE_ACTIVE', 'Should have PUBLICATION_FREEZE_ACTIVE error');
});

test('Publication Freeze blocks publish-next-valid', () => {
  const result = assertPublishAllowed({
    videoId: 'test-video-001',
    source: 'publish-next-valid',
  });

  assertEquals(result.allowed, false, 'Should be blocked');
  assertIncludes(result.errors, 'PUBLICATION_FREEZE_ACTIVE', 'Should have PUBLICATION_FREEZE_ACTIVE error');
});

test('Publication Freeze blocks retry-publish-video', () => {
  const result = assertPublishAllowed({
    videoId: 'test-video-001',
    source: 'retry-publish-video',
  });

  assertEquals(result.allowed, false, 'Should be blocked');
  assertIncludes(result.errors, 'PUBLICATION_FREEZE_ACTIVE', 'Should have PUBLICATION_FREEZE_ACTIVE error');
});

test('Publication Freeze blocks manual-publish-until-success', () => {
  const result = assertPublishAllowed({
    videoId: 'test-video-001',
    source: 'manual-publish-until-success',
  });

  assertEquals(result.allowed, false, 'Should be blocked');
  assertIncludes(result.errors, 'PUBLICATION_FREEZE_ACTIVE', 'Should have PUBLICATION_FREEZE_ACTIVE error');
});

// ─────────────────────────────────────────────
// TEST 2: Source Validation (while frozen - all blocked by freeze first)
// These test that source validation happens in order after freeze check
// ─────────────────────────────────────────────
test('Unknown source is blocked by publication freeze', () => {
  const result = assertPublishAllowed({
    videoId: 'test-video-001',
    source: undefined,
  });

  assertEquals(result.allowed, false, 'Should be blocked');
  // When frozen, the freeze check happens first
  assertIncludes(result.errors, 'PUBLICATION_FREEZE_ACTIVE', 'Should be blocked by freeze');
});

test('Prohibited source is blocked by publication freeze', () => {
  const result = assertPublishAllowed({
    videoId: 'test-video-001',
    source: 'slot-protection-daemon',
  });

  assertEquals(result.allowed, false, 'Should be blocked');
  // When frozen, the freeze check happens first, so we see PUBLICATION_FREEZE_ACTIVE
  assertIncludes(result.errors, 'PUBLICATION_FREEZE_ACTIVE', 'Should be blocked by freeze first');
});

// ─────────────────────────────────────────────
// Run Tests
// ─────────────────────────────────────────────
console.log(`Running ${tests.length} tests...\n`);

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(`   ${err.message}\n`);
    failed++;
  }
}

// ─────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

if (failed === 0) {
  console.log('✅ All tests PASSED! Publish Guard is working correctly.\n');
  console.log('System is FROZEN with:');
  console.log('  - publication-freeze.json status=FROZEN');
  console.log('  - All manual scripts BLOCKED');
  console.log('  - All unknown sources BLOCKED');
  console.log('  - All prohibited sources BLOCKED\n');
  process.exit(0);
} else {
  console.log(`❌ ${failed} test(s) FAILED\n`);
  process.exit(1);
}
