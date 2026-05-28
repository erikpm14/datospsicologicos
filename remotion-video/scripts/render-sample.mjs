#!/usr/bin/env node

/**
 * render-sample.mjs
 * Script para renderizar sample-video-plan.json
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const samplePath = path.resolve(projectRoot, 'src/examples/sample-video-plan.json');
const outputPath = path.resolve(projectRoot, 'output/sample.mp4');

// Crear directorio output si no existe
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('🎬 Rendering sample video with Remotion...');
console.log(`📋 Plan: ${samplePath}`);
console.log(`📁 Output: ${outputPath}`);

try {
  // Comando: remotion render src/Root.tsx VideosiaShort output/sample.mp4
  const cmd = `npx remotion render src/Root.tsx VideosiaShort "${outputPath}" --props-file "${samplePath}"`;

  console.log(`\n⚙️  Executing: ${cmd}\n`);
  execSync(cmd, { cwd: projectRoot, stdio: 'inherit' });

  console.log(`\n✅ Render complete!`);
  console.log(`📹 Output: ${outputPath}`);

  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
  }
} catch (error) {
  console.error(`\n❌ Render failed: ${error.message}`);
  process.exit(1);
}
