const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '../backend'));
require(path.resolve(process.cwd(), 'node_modules/dotenv')).config();

const logger = require(path.resolve(process.cwd(), 'src/utils/logger'));
const { runPublishCycle, getReadyToPublishVideos } = require(path.resolve(process.cwd(), 'src/services/publish-scheduler.service'));

const dryRun = process.argv.includes('--dry-run');

function readJSON(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const ready = getReadyToPublishVideos();
  if (ready.length === 0) {
    throw new Error('No hay videos listos para publicar');
  }

  const top = ready[0];
  logger.info(`publish:now | candidate=${top.videoId} | hook=${top.script?.hook || 'sin hook'} | priority=${top.priority}`);

  if (dryRun) {
    logger.info('publish:now | dry-run=true');
    return;
  }

  const before = readJSON(path.resolve(process.cwd(), 'data/publish-log.json'), []) || [];
  await runPublishCycle({ force: true });
  const after = readJSON(path.resolve(process.cwd(), 'data/publish-log.json'), []) || [];

  if (after.length <= before.length) {
    throw new Error('No se registró ninguna publicación nueva');
  }

  const published = after[0];
  logger.info(
    `publish:now | published=${published.videoId} | ` +
    `platforms=${(published.platforms || []).join(',') || 'none'} | ` +
    `hook=${published.hook || 'sin hook'}`
  );
}

main().catch((error) => {
  logger.error(`publish:now failed: ${error.message}`);
  process.exit(1);
});
