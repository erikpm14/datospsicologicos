#!/usr/bin/env node

/**
 * run-auto-import.js
 *
 * Ejecuta manualmente la sincronización de output → queue/done
 * Uso: node run-auto-import.js [--continuous] [--interval MINUTES]
 *
 * --continuous    : Ejecuta cada X minutos (default 5 min)
 * --interval NUM  : Especifica intervalo en minutos
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './.env') });

const logger = require('./src/utils/logger');
const { runSync, startAutoSync, stopAutoSync } = require('./src/services/auto-import-from-output.service');

const args = process.argv.slice(2);
const continuous = args.includes('--continuous');
const intervalIdx = args.indexOf('--interval');
const interval = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1], 10) : null;

if (interval && !continuous) {
  logger.warn('--interval requires --continuous flag');
}

if (interval && interval > 0) {
  process.env.AUTO_IMPORT_INTERVAL_MINUTES = interval;
}

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('AUTO-IMPORT: Sync output/ → queue/done/');
  console.log('═'.repeat(70) + '\n');

  if (continuous) {
    console.log(`📡 Starting continuous mode (interval: ${process.env.AUTO_IMPORT_INTERVAL_MINUTES || 5} min)\n`);
    console.log('Press Ctrl+C to stop.\n');

    startAutoSync();

    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n\nShutting down...');
      stopAutoSync();
      process.exit(0);
    });
  } else {
    console.log('🔍 Running single sync...\n');
    const results = runSync();

    console.log('📊 Results:');
    console.log(`  Scanned:  ${results.scanned} directories`);
    console.log(`  Imported: ${results.imported} new entries`);
    console.log(`  Skipped:  ${results.skipped} (already exist or published)`);
    console.log(`  Errors:   ${results.errors} (invalid videos)`);
    console.log('\n' + '═'.repeat(70) + '\n');

    process.exit(results.imported > 0 ? 0 : 1);
  }
}

main().catch(err => {
  logger.error(`[AUTO_IMPORT] Fatal error: ${err.message}`);
  process.exit(1);
});
