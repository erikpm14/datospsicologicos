require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'TEST';
process.env.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'TEST';
process.env.TELEGRAM_DRY_RUN = 'true';
process.env.TELEGRAM_NOTIFICATIONS_ENABLED = 'true';
process.env.TELEGRAM_MIN_LEVEL = process.env.TELEGRAM_MIN_LEVEL || 'ERROR';
process.env.TELEGRAM_COOLDOWN_MINUTES = process.env.TELEGRAM_COOLDOWN_MINUTES || '30';
process.env.TELEGRAM_DIGEST_ENABLED = process.env.TELEGRAM_DIGEST_ENABLED || 'true';

const fs = require('fs');
const path = require('path');
const {
  notifyJobFailed,
  notifySystemRecovered,
  notifySlotFailed,
  notifyPipelineBlocked,
  sendDigestIfDue,
} = require('../src/services/telegram-notifier');

const STATE = path.resolve('./data/telegram-alert-state.json');

async function run() {
  console.log('[TEST] simulate 10 identical errors (should send <=1 due to cooldown)');
  for (let i = 0; i < 10; i++) {
    await notifyJobFailed({ jobId: 'job_same', error: 'RENDER_BROKEN: ffmpeg failed' });
  }

  console.log('[TEST] watchdog OK (should not send)');
  await notifySystemRecovered({ scope: 'watchdog', detail: 'system stable' });

  console.log('[TEST] publish failed (should send)');
  await notifySlotFailed({ reason: 'publish_error', error: 'YOUTUBE_PUBLISH_FAILED', slot: '10:00' });

  console.log('[TEST] pipeline blocked CRITICAL (should send)');
  await notifyPipelineBlocked({ reason: 'no_real_progress', detail: '0 ready, 0 inPipeline' });

  console.log('[TEST] digest forced (should send 1 digest max)');
  await sendDigestIfDue({ force: true });

  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
  console.log('[STATE_KEYS]', Object.keys(state).filter((k) => !k.startsWith('digest:')).length);
  console.log('[DONE]');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
