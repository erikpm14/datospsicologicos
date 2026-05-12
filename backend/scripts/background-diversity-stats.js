#!/usr/bin/env node
/**
 * BACKGROUND DIVERSITY STATISTICS
 * Muestra el estado actual de rotación y diversidad visual del canal
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { getRecentUsageStats, BACKGROUND_ASSETS, VISUAL_CATEGORIES } = require('../src/services/background-diversity.service');

console.log('\n╔════════════════════════════════════════════════╗');
console.log('║     BACKGROUND DIVERSITY STATISTICS            ║');
console.log('╚════════════════════════════════════════════════╝\n');

const stats = getRecentUsageStats();

if (!stats) {
  console.log('No statistics available yet.');
  process.exit(1);
}

// Recent backgrounds
console.log('📹 RECENT BACKGROUNDS (Last 5 videos):\n');
stats.lastUsedAssets.forEach((bg, i) => {
  const asset = BACKGROUND_ASSETS.find(a => a.assetId === bg.assetId);
  const category = VISUAL_CATEGORIES[bg.category];

  console.log(`  ${i + 1}. ${bg.assetId}`);
  console.log(`     Category: ${category ? category.label : bg.category}`);
  console.log(`     Video: ${bg.videoId.substring(0, 8)}...`);
  console.log(`     Used: ${new Date(bg.timestamp).toLocaleString('es-ES')}\n`);
});

// Category distribution
console.log('📊 CATEGORY DISTRIBUTION:\n');
const totalUses = Object.values(stats.categoryStats).reduce((a, b) => a + b, 0);
Object.entries(stats.categoryStats)
  .sort((a, b) => b[1] - a[1])
  .forEach(([category, count]) => {
    const percentage = ((count / totalUses) * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor(count * 3));
    console.log(`  ${category.padEnd(20)} │ ${bar} ${count} (${percentage}%)`);
  });

// Color distribution
console.log('\n🎨 COLOR DISTRIBUTION:\n');
const totalColors = Object.values(stats.colorStats).reduce((a, b) => a + b, 0);
Object.entries(stats.colorStats)
  .sort((a, b) => b[1] - a[1])
  .forEach(([color, count]) => {
    const percentage = ((count / totalColors) * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor(count * 2));
    console.log(`  ${color.padEnd(15)} │ ${bar} ${count} (${percentage}%)`);
  });

// Diversity status
console.log('\n✅ DIVERSITY STATUS:\n');
const uniqueCategories = Object.keys(stats.categoryStats).length;
const uniqueColors = Object.keys(stats.colorStats).length;
const maxAssets = BACKGROUND_ASSETS.length;

console.log(`  Total recorded backgrounds: ${stats.totalRecorded}`);
console.log(`  Unique categories used: ${uniqueCategories}/${Object.keys(VISUAL_CATEGORIES).length}`);
console.log(`  Unique colors used: ${uniqueColors}/`);
console.log(`  Available assets: ${maxAssets}`);

const diversityPercentage = ((uniqueCategories / Object.keys(VISUAL_CATEGORIES).length) * 100).toFixed(1);
console.log(`  Overall diversity: ${diversityPercentage}% of possible categories`);

if (diversityPercentage >= 60) {
  console.log('\n  ✅ DIVERSITY LEVEL: EXCELLENT');
} else if (diversityPercentage >= 40) {
  console.log('\n  ⚠️  DIVERSITY LEVEL: GOOD');
} else {
  console.log('\n  ⚠️  DIVERSITY LEVEL: NEEDS IMPROVEMENT');
}

// Warn about repetition
const mostUsedCategory = Object.entries(stats.categoryStats).sort((a, b) => b[1] - a[1])[0];
if (mostUsedCategory && mostUsedCategory[1] > 5) {
  console.log(`\n  ⚠️  WARNING: "${mostUsedCategory[0]}" has been used ${mostUsedCategory[1]} times`);
  console.log('     Consider increasing diversity by using other categories');
}

console.log('\n');
process.exit(0);
