#!/usr/bin/env node

/**
 * analyze-performance.js
 * CLI para analizar rendimiento de vídeos
 *
 * Uso:
 * node scripts/analyze-performance.js
 * node scripts/analyze-performance.js hooks
 * node scripts/analyze-performance.js topics
 * node scripts/analyze-performance.js summary
 */

const performanceTracker = require('../src/services/performance-tracker.service');

function formatTable(data, title) {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  ${title}`);
  console.log(`═══════════════════════════════════════════════════════════`);

  if (Array.isArray(data) && data.length === 0) {
    console.log('  (Sin datos)');
    return;
  }

  if (Array.isArray(data)) {
    // Table format
    const cols = Object.keys(data[0] || {});
    const widths = cols.map(col => Math.max(col.length, 12));

    // Header
    console.log(
      '  ' +
      cols
        .map((col, i) => col.padEnd(widths[i]))
        .join('  ')
    );
    console.log(
      '  ' + cols.map((col, i) => '─'.repeat(widths[i])).join('  ')
    );

    // Rows
    data.slice(0, 10).forEach(row => {
      console.log(
        '  ' +
        cols
          .map((col, i) => String(row[col] || '').padEnd(widths[i]))
          .join('  ')
      );
    });

    if (data.length > 10) {
      console.log(`  ... y ${data.length - 10} más`);
    }
  } else {
    // Object format
    Object.entries(data).forEach(([key, value]) => {
      console.log(`  ${key}: ${JSON.stringify(value, null, 2).split('\n').join('\n  ')}`);
    });
  }
}

function showSummary() {
  const dashboard = performanceTracker.exportDashboardData();

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           PERFORMANCE ANALYTICS - VIDEO TRACKER            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // Summary
  console.log('\n📊 RESUMEN');
  console.log(`  Total vídeos tracked:  ${dashboard.summary.totalTracked}`);
  console.log(`  Publicados:            ${dashboard.summary.published}`);
  console.log(`  Pendientes:            ${dashboard.summary.pending}`);
  console.log(`  Última actualización:  ${dashboard.summary.lastUpdate || 'N/A'}`);

  // Top Hooks
  formatTable(
    dashboard.topHooks.map(h => ({
      hook: h.hook.substring(0, 40) + (h.hook.length > 40 ? '...' : ''),
      count: h.count,
      published: h.published,
      'pub. rate': h.publicationRate + '%',
      duration: h.avgDuration + 's',
    })),
    '🎣 TOP HOOKS (por publicaciones)'
  );

  // Top Topics
  formatTable(
    dashboard.topTopics.map(t => ({
      topic: t.topic,
      count: t.count,
      published: t.published,
      'pub. rate': t.publicationRate + '%',
      duration: t.avgDuration + 's',
    })),
    '🎯 TOP TOPICS (por publicaciones)'
  );

  // Full Analysis
  const analysis = dashboard.analysis;
  console.log('\n📈 ANÁLISIS COMPLETO');
  console.log(`  Vídeos totales:        ${analysis.totalVideos}`);
  console.log(`  Por hook (${Object.keys(analysis.byHook || {}).length} tipos):`);
  Object.entries(analysis.byHook || {}).slice(0, 5).forEach(([hook, stats]) => {
    console.log(`    - ${hook.substring(0, 30)}: ${stats.count} vídeos, ${stats.published} publicados`);
  });
  if (Object.keys(analysis.byHook || {}).length > 5) {
    console.log(`    ... y ${Object.keys(analysis.byHook).length - 5} hooks más`);
  }

  console.log(`\n  Por topic (${Object.keys(analysis.byTopic || {}).length} tipos):`);
  Object.entries(analysis.byTopic || {}).slice(0, 5).forEach(([topic, stats]) => {
    console.log(`    - ${topic}: ${stats.count} vídeos, ${stats.published} publicados`);
  });
  if (Object.keys(analysis.byTopic || {}).length > 5) {
    console.log(`    ... y ${Object.keys(analysis.byTopic).length - 5} topics más`);
  }

  console.log(`\n  Por virality tier (${Object.keys(analysis.byTier || {}).length} tiers):`);
  Object.entries(analysis.byTier || {}).forEach(([tier, stats]) => {
    console.log(`    - ${tier}: ${stats.count} vídeos, ${stats.published} publicados`);
  });
}

function showHooks() {
  const dashboard = performanceTracker.exportDashboardData();
  formatTable(
    dashboard.topHooks.map((h, i) => ({
      rank: (i + 1).toString(),
      hook: h.hook.substring(0, 60) + (h.hook.length > 60 ? '...' : ''),
      count: h.count,
      published: h.published,
      publicationRate: h.publicationRate + '%',
      avgDuration: h.avgDuration + 's',
    })),
    '🎣 ANÁLISIS DE HOOKS'
  );
}

function showTopics() {
  const dashboard = performanceTracker.exportDashboardData();
  formatTable(
    dashboard.topTopics.map((t, i) => ({
      rank: (i + 1).toString(),
      topic: t.topic,
      count: t.count,
      published: t.published,
      publicationRate: t.publicationRate + '%',
      avgDuration: t.avgDuration + 's',
    })),
    '🎯 ANÁLISIS DE TOPICS'
  );
}

function showRaw() {
  const data = performanceTracker.loadPerformanceData();
  console.log('\n📄 RAW DATA (últimos 20 vídeos):');
  console.log(JSON.stringify(data.videos.slice(-20), null, 2));
}

// CLI
const command = process.argv[2] || 'summary';
try {
  switch (command.toLowerCase()) {
    case 'hooks':
      showHooks();
      break;
    case 'topics':
      showTopics();
      break;
    case 'raw':
      showRaw();
      break;
    case 'summary':
    default:
      showSummary();
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

console.log('\n');
