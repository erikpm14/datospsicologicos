#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

process.chdir(path.resolve(__dirname, '..'));

try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  require('dotenv').config({ path: path.resolve('.env') });
} catch {}

const { getReadyToPublishVideos } = require('../src/services/publish-scheduler.service');
const { inspectOutputVideo } = require('../src/services/operational-state.service');
const { checkProductionQuality } = require('../src/services/production-quality-checker');
const { validateCaptionsForPublish } = require('../src/services/caption-pre-publish-validator');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

function ffprobeJson(videoPath) {
  const out = execFileSync(
    ffprobePath,
    [
      '-v', 'error',
      '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,nb_frames',
      '-of', 'json',
      videoPath,
    ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out);
}

function getStreamsInfo(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const hasVideo = streams.some((s) => s.codec_type === 'video');
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  const durationSec = probe?.format?.duration ? Number(probe.format.duration) : NaN;
  return { hasVideo, hasAudio, durationSec };
}

async function validateCandidate(videoId) {
  const snapshot = inspectOutputVideo(videoId);
  if (!snapshot.exists || !fs.existsSync(snapshot.videoPath)) {
    return { ok: false, reasons: ['output file missing'], snapshot };
  }

  const stat = fs.statSync(snapshot.videoPath);
  if (stat.size < 1024 * 1024) {
    return { ok: false, reasons: ['size < 1MB'], snapshot, sizeBytes: stat.size };
  }

  let probe;
  try {
    probe = ffprobeJson(snapshot.videoPath);
  } catch (e) {
    return { ok: false, reasons: [`ffprobe_failed | ${e.message}`], snapshot, sizeBytes: stat.size };
  }

  const { hasVideo, hasAudio, durationSec } = getStreamsInfo(probe);
  const reasons = [];
  if (!hasVideo) reasons.push('no_video_stream');
  if (!hasAudio) reasons.push('no_audio_stream');
  if (!Number.isFinite(durationSec)) reasons.push('duration_unknown');
  if (Number.isFinite(durationSec) && (durationSec < 8 || durationSec > 60)) reasons.push(`duration_out_of_range(${durationSec.toFixed(2)}s)`);

  const qc = await checkProductionQuality(snapshot.dir, snapshot.script);
  if (!qc.passed) reasons.push(...qc.reasons);

  if (snapshot.render?.visibleVisuals !== true) reasons.push('render_without_visible_visuals');
  if (['gradient', 'gradient_fallback'].includes(snapshot.render?.renderMode)) reasons.push(`render_degraded(${snapshot.render.renderMode})`);

  const captionValidation = validateCaptionsForPublish(videoId);
  if (!captionValidation.ok) reasons.push(`captions_invalid | ${captionValidation.reason}`);

  return {
    ok: reasons.length === 0,
    reasons,
    snapshot,
    sizeBytes: stat.size,
    durationSec,
    hasVideo,
    hasAudio,
    qc,
    captionValidation,
  };
}

(async () => {
  const slot = process.argv[2] || '14:30';
  const focusVideoId = process.argv[3] || null;
  const ready = getReadyToPublishVideos();

  console.log(JSON.stringify({
    nowCET: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).replace(' ', 'T'),
    slotCET: slot,
    AUTO_PUBLISH_ENABLED: process.env.AUTO_PUBLISH_ENABLED,
    readyCount: ready.length,
    topCandidates: ready.slice(0, 10).map((v) => ({ videoId: v.videoId, priority: v.priority, qcPassed: v.qc?.passed ?? null })),
  }, null, 2));

  if (focusVideoId) {
    const res = await validateCandidate(focusVideoId);
    console.log(JSON.stringify({
      ok: res.ok,
      slotCET: slot,
      videoId: focusVideoId,
      videoPath: res.snapshot?.videoPath,
      sizeBytes: res.sizeBytes,
      durationSec: res.durationSec,
      reasons: res.reasons,
    }, null, 2));
    process.exit(res.ok ? 0 : 2);
  }

  for (const v of ready) {
    const res = await validateCandidate(v.videoId);
    if (res.ok) {
      console.log(JSON.stringify({
        ok: true,
        slotCET: slot,
        videoId: v.videoId,
        jobId: v.videoId,
        videoPath: res.snapshot.videoPath,
        sizeBytes: res.sizeBytes,
        durationSec: res.durationSec,
      }, null, 2));
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ ok: false, slotCET: slot, reason: 'NO_PASSING_CANDIDATE' }, null, 2));
  process.exit(2);
})();
