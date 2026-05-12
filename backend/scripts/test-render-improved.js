#!/usr/bin/env node

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { renderDynamicBackgroundTimeline } = require('../src/services/dynamic-background-renderer');

const videoId = process.argv[2] || 'e97d2c43-0339-4128-9f8f-d94218710580';
const outputDir = path.join(__dirname, `../output-fase1-test/${videoId}`);
const metadataPath = path.join(outputDir, 'generation-metadata.json');
const outputPath = path.join(outputDir, 'output.mp4');
const audioPath = path.join(outputDir, 'temp-audio-extract.aac');

console.log('[TEST_RENDER_IMPROVED_STARTED]');
console.log(`Video ID: ${videoId}`);
console.log(`Output Dir: ${outputDir}`);

if (!fs.existsSync(metadataPath)) {
  console.error('Metadata not found');
  process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const clipTimeline = metadata.backgroundPlan?.clipTimeline;

if (!clipTimeline) {
  console.error('No clipTimeline found in metadata');
  process.exit(1);
}

console.log(`[CLIP_TIMELINE_FOUND] ${clipTimeline.length} clips`);

(async () => {
  try {
    const result = await renderDynamicBackgroundTimeline({
      audioPath,
      outputPath,
      clipTimeline,
      audioDuration: 35.4,
      outputDir,
    });

    console.log('[TEST_RENDER_IMPROVED_SUCCESS]', result);
    process.exit(0);
  } catch (err) {
    console.error('[TEST_RENDER_IMPROVED_FAILED]', err.message);
    process.exit(1);
  }
})();
