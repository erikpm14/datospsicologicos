#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  require('dotenv').config({ path: path.resolve('.env') });
} catch {}

const { inspectOutputVideo } = require('../src/services/operational-state.service');
const { publishAll, publishToYouTube } = require('../src/services/publisher');

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

(async () => {
  const videoId = process.argv[2];
  const mode = (process.argv[3] || 'youtube').toLowerCase();
  if (!videoId) {
    console.error('Usage: node dev-tools/publish-now.js <videoId> [youtube|all]');
    process.exit(1);
  }

  const snapshot = inspectOutputVideo(videoId);
  if (!snapshot.exists || !fs.existsSync(snapshot.videoPath)) {
    console.error(JSON.stringify({ ok: false, error: 'VIDEO_NOT_FOUND', videoId, videoPath: snapshot.videoPath }, null, 2));
    process.exit(2);
  }
  if (fs.existsSync(snapshot.publishedPath)) {
    console.error(JSON.stringify({ ok: false, error: 'ALREADY_PUBLISHED', videoId, publishedPath: snapshot.publishedPath }, null, 2));
    process.exit(3);
  }

  try {
    let results = [];
    let errors = [];
    if (mode === 'all') {
      const res = await publishAll(snapshot.videoPath, snapshot.script);
      if (res && res.success === false) {
        console.error(JSON.stringify({ ok: false, error: res.error, videoId, reason: res.reason, failures: res.failures }, null, 2));
        process.exit(4);
      }
      results = res.results || [];
      errors = res.errors || [];
    } else {
      const yt = await publishToYouTube(snapshot.videoPath, snapshot.script);
      results = [yt];
    }

    const publishedIds = {};
    for (const r of results) {
      if (r.platform === 'tiktok')    publishedIds.tiktokId    = r.publishId;
      if (r.platform === 'instagram') publishedIds.instagramId = r.mediaId;
      if (r.platform === 'youtube')   publishedIds.youtubeId   = r.videoId;
    }

    writeJSON(snapshot.publishedPath, {
      publishedAt: new Date().toISOString(),
      platforms: results.map((r) => r.platform),
      errors,
      manual: true,
      ...publishedIds,
    });

    console.log(JSON.stringify({
      ok: true,
      videoId,
      videoPath: snapshot.videoPath,
      results,
      errors,
      publishedPath: snapshot.publishedPath,
    }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: 'PUBLISH_FAILED', videoId, message: err.message }, null, 2));
    process.exit(4);
  }
})();
