#!/usr/bin/env node

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const { getReadyToPublishVideos } = require('./src/services/publish-scheduler.service');
const { validateCaptionsForPublish } = require('./src/services/caption-pre-publish-validator');
const { getRealAudioDuration } = require('./src/services/video-renderer');
const { renderVideoWithRouter } = require('./src/services/render-engines');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const FIX_COMMIT = 'fdb32ed';
const FIX_COMMIT_ISO = '2026-04-27T10:17:39.000Z';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hasOverlap(captions = []) {
  for (let i = 1; i < captions.length; i++) {
    if ((captions[i]?.start || 0) < (captions[i - 1]?.end || 0)) return true;
  }
  return false;
}

function inspectCandidate(video) {
  const dir = path.join(OUTPUT_DIR, video.videoId);
  const outputPath = path.join(dir, 'output.mp4');
  const audioPath = path.join(dir, 'voice_proc.mp3');
  const debugPath = path.join(dir, 'captions-debug.json');
  const outputStat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
  const debug = fs.existsSync(debugPath) ? readJson(debugPath) : null;
  const captionSource = debug?.source || debug?.captionSource || null;
  const driftStatus = debug?.drift?.status || null;

  return {
    videoId: video.videoId,
    dir,
    outputPath,
    audioPath,
    debugPath,
    outputExists: Boolean(outputStat),
    outputMtimeIso: outputStat?.mtime?.toISOString() || null,
    renderedBeforeFix: outputStat ? outputStat.mtime.getTime() < new Date(FIX_COMMIT_ISO).getTime() : true,
    captionsDebugExists: Boolean(debug),
    captionSource,
    driftStatus,
    debug,
  };
}

async function rerenderCandidate(video, inspection) {
  if (!fs.existsSync(inspection.audioPath)) {
    throw new Error(`voice_proc.mp3 missing for ${video.videoId}`);
  }

  console.log(`NEXT_SLOT_RERENDER_STARTED videoId=${video.videoId}`);

  const script = { ...video.script, videoId: video.videoId, id: video.videoId };
  const audioDuration = await getRealAudioDuration(inspection.audioPath);

  await renderVideoWithRouter({
    script,
    audioPath: inspection.audioPath,
    audioDuration,
    outputPath: inspection.outputPath,
    themeId: script.themeId || 'dark_neural',
    wordBoundaries: [],
    sectionDurations: null,
    forceCaptionSync: true,
  });

  console.log(`NEXT_SLOT_RERENDER_DONE videoId=${video.videoId}`);
}

(async () => {
  const readyVideos = getReadyToPublishVideos();
  if (readyVideos.length === 0) {
    throw new Error('No videos ready to publish');
  }

  const nextVideo = readyVideos[0];
  const inspection = inspectCandidate(nextVideo);
  const validation = validateCaptionsForPublish(nextVideo.videoId);
  const needsRerender = (
    inspection.renderedBeforeFix ||
    !inspection.captionsDebugExists ||
    !validation.ok
  );

  console.log(`NEXT_SLOT_CAPTION_CHECK_START videoId=${nextVideo.videoId}`);
  console.log(`videoId=${nextVideo.videoId}`);
  console.log(`renderedBeforeCommit${FIX_COMMIT}=${inspection.renderedBeforeFix}`);
  console.log(`captionsDebugExists=${inspection.captionsDebugExists}`);
  console.log(`captionSource=${inspection.captionSource || 'null'}`);
  console.log(`driftStatus=${inspection.driftStatus || 'null'}`);

  if (needsRerender) {
    console.log(`NEXT_SLOT_CAPTION_CHECK_BLOCKED reason=${inspection.renderedBeforeFix ? `output_before_${FIX_COMMIT}` : validation.reason}`);
    await rerenderCandidate(nextVideo, inspection);
  }

  const finalInspection = inspectCandidate(nextVideo);
  const finalValidation = validateCaptionsForPublish(nextVideo.videoId);
  const finalDebug = finalInspection.debug || {};
  const overlaps = hasOverlap(finalDebug.captions || []);
  const lastCaptionEnd = finalDebug.lastCaption?.end || 0;
  const audioDuration = finalDebug.audioDuration || 0;

  if (
    !finalValidation.ok ||
    finalInspection.renderedBeforeFix ||
    finalInspection.captionSource !== 'final-audio-speech-segment' ||
    !['excellent', 'acceptable'].includes(finalInspection.driftStatus) ||
    overlaps ||
    lastCaptionEnd > audioDuration ||
    (finalDebug.captionsCount || 0) <= 0
  ) {
    throw new Error(`Next slot candidate invalid: ${finalValidation.reason}`);
  }

  console.log(`NEXT_SLOT_CAPTION_CHECK_PASS videoId=${nextVideo.videoId} source=${finalInspection.captionSource} driftStatus=${finalInspection.driftStatus}`);
  console.log('VIDEO_READY_FOR_NEXT_SLOT=true');
  console.log(`videoId=${nextVideo.videoId}`);
  console.log(`captionSource=${finalInspection.captionSource}`);
  console.log(`driftStatus=${finalInspection.driftStatus}`);
  console.log(`outputPath=${finalInspection.outputPath}`);
})().catch((err) => {
  console.error(`NEXT_SLOT_CAPTION_CHECK_BLOCKED reason=${err.message}`);
  process.exit(1);
});
