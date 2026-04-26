/**
 * send-telegram-notification.js
 * Envía notificación al Telegram del video ya publicado
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { notifyVideoPublished } = require('./src/services/telegram-notifier');

const summaryPath = path.join(__dirname, 'output', 'prod-video', 'publication-summary.json');

if (!fs.existsSync(summaryPath)) {
  console.error('❌ No publication summary found');
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

(async () => {
  try {
    await notifyVideoPublished({
      script: {
        hook: summary.hook,
        effectName: summary.effectName,
        emotionalTrigger: summary.emotionalTrigger,
        viralTrigger: summary.viralTrigger,
        topic: 'relationships',
        keywords: ['relaciones', 'validación', 'psicología'],
      },
      results: [
        {
          platform: 'youtube',
          videoId: summary.videoId,
          url: summary.publishUrl,
          status: 'published',
        },
      ],
      errors: [],
      videoId: summary.videoId,
    });

    console.log('✅ Telegram notification sent!');
  } catch (err) {
    console.error('❌ Failed to send Telegram notification:', err.message);
    process.exit(1);
  }
})();
