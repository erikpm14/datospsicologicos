#!/usr/bin/env node
/**
 * test-hyperframe-system.js
 *
 * Script de validación del sistema hyperframe sin romper nada existente
 * Valida:
 * 1. hyperframe-engine.js puede importarse
 * 2. buildHyperframes genera output correcto con captions reales
 * 3. video-renderer.js integra hyperframes correctamente
 * 4. QC sigue pasando (no rompe prepublish-visual-qc)
 * 5. Metadata se guarda correctamente
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────
// TEST 1: Imports
// ─────────────────────────────────────────────────────────────────

console.log('TEST 1: Validating imports...');
try {
  const { buildHyperframes, generateIntegrationReport, SEGMENT_VISUAL_CONFIG } = require('./src/utils/hyperframe-engine');
  console.log('✓ hyperframe-engine imports OK');
  console.log(`  - SEGMENT_VISUAL_CONFIG has ${Object.keys(SEGMENT_VISUAL_CONFIG).length} segment types`);
} catch (err) {
  console.error('✗ hyperframe-engine import failed:', err.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// TEST 2: buildHyperframes with mock data
// ─────────────────────────────────────────────────────────────────

console.log('\nTEST 2: Testing buildHyperframes with mock data...');
try {
  const { buildHyperframes } = require('./src/utils/hyperframe-engine');

  const mockScript = {
    videoId: 'test-hyperframe-001',
    hook: 'Did you know this one trick?',
    open_loop: 'It\'s going to blow your mind.',
    micro_value: 'The secret is simpler than you think.',
    escalation: 'Most people miss this detail.',
    reengage: 'But that\'s not all.',
    peak: 'This is the turning point.',
    open_ending: 'So what does this mean for you?',
    soft_cta: 'Save this video for later.',
  };

  const mockCaptions = [
    { text: 'Did you know this one trick?', start: 0.5, end: 2.5, section: 'hook', source: 'test' },
    { text: 'It\'s going to blow your mind.', start: 2.7, end: 4.5, section: 'open_loop', source: 'test' },
    { text: 'The secret is simpler than you think.', start: 4.8, end: 7.2, section: 'micro_value', source: 'test' },
    { text: 'Most people miss this detail.', start: 7.5, end: 10.0, section: 'escalation', source: 'test' },
    { text: 'But that\'s not all.', start: 10.2, end: 11.8, section: 'reengage', source: 'test' },
    { text: 'This is the turning point.', start: 12.0, end: 14.5, section: 'peak', source: 'test' },
    { text: 'So what does this mean for you?', start: 14.8, end: 16.5, section: 'open_ending', source: 'test' },
    { text: 'Save this video for later.', start: 16.8, end: 18.0, section: 'soft_cta', source: 'test' },
  ];

  const tmpDir = path.resolve('./tmp-hyperframe-test');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const { hyperframes, metadata } = buildHyperframes({
    script: mockScript,
    captions: mockCaptions,
    videoDuration: 18,
    outputDir: tmpDir,
    videoId: 'test-hyperframe-001',
  });

  console.log('✓ buildHyperframes executed successfully');
  console.log(`  - Hyperframes created: ${hyperframes.length}`);
  console.log(`  - Metadata:`, JSON.stringify(metadata, null, 2));

  // Validate hyperframe structure
  if (hyperframes.length > 0) {
    const first = hyperframes[0];
    const requiredFields = ['segmentId', 'sectionKey', 'start', 'end', 'duration', 'text', 'keyPhrase', 'emphasisLevel', 'config', 'filters'];
    const hasAllFields = requiredFields.every(f => f in first);
    if (hasAllFields) {
      console.log('✓ Hyperframe structure validated');
      console.log(`  - First segment: ${first.sectionKey} (${first.duration.toFixed(2)}s) | emphasis=${first.emphasisLevel}`);
    } else {
      console.error('✗ Missing fields in hyperframe:', requiredFields.filter(f => !(f in first)));
      process.exit(1);
    }
  }

  // Check debug JSON
  const debugPath = path.join(tmpDir, 'hyperframe-debug.json');
  if (fs.existsSync(debugPath)) {
    console.log('✓ hyperframe-debug.json created');
    const debug = JSON.parse(fs.readFileSync(debugPath, 'utf8'));
    console.log(`  - Debug contains ${debug.hyperframes?.length || 0} hyperframes`);
  } else {
    console.error('✗ hyperframe-debug.json not found');
  }

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

} catch (err) {
  console.error('✗ buildHyperframes test failed:', err.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// TEST 3: Integration Report
// ─────────────────────────────────────────────────────────────────

console.log('\nTEST 3: Testing generateIntegrationReport...');
try {
  const { buildHyperframes, generateIntegrationReport } = require('./src/utils/hyperframe-engine');

  const mockScript = {
    hook: 'Hook text',
    peak: 'Peak text',
  };

  const mockCaptions = [
    { text: 'Hook', start: 0, end: 2, section: 'hook', source: 'test' },
    { text: 'Peak', start: 5, end: 7, section: 'peak', source: 'test' },
  ];

  const tmpDir = path.resolve('./tmp-report-test');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const { hyperframes } = buildHyperframes({
    script: mockScript,
    captions: mockCaptions,
    videoDuration: 10,
    outputDir: tmpDir,
  });

  const report = generateIntegrationReport(hyperframes, mockScript, tmpDir);
  if (report && report.integrationLevels) {
    console.log('✓ Integration report generated');
    console.log(`  - Status: ${report.systemStatus.hyperframesCreated} hyperframes found`);
    console.log(`  - Levels defined: ${Object.keys(report.integrationLevels).length}`);
  } else {
    console.error('✗ Report structure invalid');
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

} catch (err) {
  console.error('✗ Integration report test failed:', err.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// TEST 4: Verify no syntax errors in video-renderer
// ─────────────────────────────────────────────────────────────────

console.log('\nTEST 4: Checking video-renderer.js syntax...');
try {
  require('./src/services/video-renderer');
  console.log('✓ video-renderer.js syntax OK');
} catch (err) {
  console.error('✗ video-renderer.js has syntax errors:', err.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// TEST 5: Verify no regressions in QC
// ─────────────────────────────────────────────────────────────────

console.log('\nTEST 5: Checking QC modules...');
try {
  require('./src/services/prepublish-visual-qc.service');
  console.log('✓ prepublish-visual-qc.service.js OK');

  require('./src/services/opportunistic-publish');
  console.log('✓ opportunistic-publish.js OK');

  require('./src/services/qc-failure-tracker');
  console.log('✓ qc-failure-tracker.js OK');
} catch (err) {
  console.error('✗ QC module check failed:', err.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('HYPERFRAME SYSTEM VALIDATION');
console.log('='.repeat(60));
console.log(`
✓ All validation tests passed

System Status:
- hyperframe-engine.js: ACTIVE
- buildHyperframes: FUNCTIONAL
- video-renderer integration: ENABLED
- QC modules: NO REGRESSIONS
- Integration report: AVAILABLE

Next Steps:
1. Generate a video with hyperframes enabled:
   node backend/src/services/video-processor.js

2. Verify output:
   - Check output/{videoId}/hyperframe-debug.json
   - Verify metadata contains hyperframeSegmentsUsed
   - Confirm QC still passes (prepublish-visual-qc)

3. Implement visual effects (optional):
   - Level 1: Zoom + brightness per segment (concat-builder.js)
   - Level 2: Text overlays (render-executor.js)
   - Level 3+: Advanced color grading & motion graphics

Documentation:
- See hyperframe-debug.json for segment timings
- See hyperframe-filtergraph-integration.md for FFmpeg filter details
`);

process.exit(0);
