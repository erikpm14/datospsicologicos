require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const QUEUE_DIR = path.resolve(process.env.QUEUE_DIR || './queue');
const DATA_DIR = path.resolve('./data');

function readJSON(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function listJsonJobs(dirName) {
  const dir = path.join(QUEUE_DIR, dirName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJSON(path.join(dir, file), null))
    .filter(Boolean);
}

function getOperationalThresholds() {
  return {
    minReady: Math.max(1, parseInt(process.env.MIN_READY_VIDEOS || '2', 10) || 2),
    targetReady: Math.max(1, parseInt(process.env.TARGET_READY_VIDEOS || process.env.MIN_READY_VIDEOS || '3', 10) || 3),
    maxPending: Math.max(1, parseInt(process.env.QUEUE_MAX_PENDING || '3', 10) || 3),
    readyStaleHours: Math.max(1, parseInt(process.env.READY_STALE_HOURS || '18', 10) || 18),
    activeStaleMinutes: Math.max(5, parseInt(process.env.ACTIVE_JOB_STALE_MINUTES || '45', 10) || 45),
    publishMissGraceMinutes: Math.max(10, parseInt(process.env.PUBLISH_SLOT_GRACE_MINUTES || '35', 10) || 35),
    progressStaleMinutes: Math.max(10, parseInt(process.env.PIPELINE_PROGRESS_STALE_MINUTES || '90', 10) || 90),
    topUpBatchSize: Math.max(1, parseInt(process.env.TOPUP_BATCH_SIZE || '2', 10) || 2),
  };
}

function getPublishTimes() {
  return String(process.env.PUBLISH_TIMES_CET || '09:00,13:00,15:30,19:00,21:00')
    .split(',')
    .map((time) => time.trim())
    .filter(Boolean);
}

function isMetadataComplete(script) {
  return Boolean(
    script &&
    String(script.hook || '').trim() &&
    String(script.claim || '').trim() &&
    String(script.explanation || '').trim() &&
    String(script.cta || '').trim() &&
    String(script.topic || '').trim()
  );
}

function inspectOutputVideo(videoId) {
  const dir = path.join(OUTPUT_DIR, videoId);
  const videoPath = path.join(dir, 'output.mp4');
  const scriptPath = path.join(dir, 'script.json');
  const qcPath = path.join(dir, 'qc.json');
  const renderPath = path.join(dir, 'render-metadata.json');
  const publishedPath = path.join(dir, 'published.json');
  const discardedPath = path.join(dir, 'discarded.json');
  const script = readJSON(scriptPath, null);
  const qc = readJSON(qcPath, null);
  const render = readJSON(renderPath, null);
  const stat = fs.existsSync(videoPath) ? fs.statSync(videoPath) : null;
  const ready = Boolean(
    stat &&
    stat.size > 0 &&
    script &&
    !fs.existsSync(publishedPath) &&
    !fs.existsSync(discardedPath)
  );

  return {
    videoId,
    dir,
    videoPath,
    scriptPath,
    qcPath,
    renderPath,
    publishedPath,
    discardedPath,
    exists: fs.existsSync(dir),
    ready,
    script,
    qc,
    render,
    sizeBytes: stat?.size || 0,
    createdAt: stat?.mtime?.toISOString() || null,
    metadataComplete: isMetadataComplete(script),
    hasVisibleVisuals: render?.visibleVisuals === true,
    renderMode: render?.renderMode || 'unknown',
    published: fs.existsSync(publishedPath),
    discarded: fs.existsSync(discardedPath),
  };
}

function isPublishAfterSatisfied(script) {
  if (!script?.publishAfter) return true;
  const publishAfterMs = new Date(script.publishAfter).getTime();
  return !Number.isNaN(publishAfterMs) && publishAfterMs <= Date.now();
}

function isReadyVideoEntry(entry) {
  return Boolean(
    entry &&
    entry.exists &&
    entry.sizeBytes > 0 &&
    entry.script &&
    !entry.published &&
    !entry.discarded &&
    isPublishAfterSatisfied(entry.script)
  );
}

function getReadyVideoEntries() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  return fs.readdirSync(OUTPUT_DIR)
    .filter((entry) => {
      const full = path.join(OUTPUT_DIR, entry);
      return fs.existsSync(full) && fs.statSync(full).isDirectory();
    })
    .map((entry) => inspectOutputVideo(entry))
    .filter((entry) => isReadyVideoEntry(entry));
}

function getQueueSnapshot() {
  const pendingJobs = listJsonJobs('pending');
  const activeJobs = listJsonJobs('active');
  const doneJobs = listJsonJobs('done');
  const failedJobs = listJsonJobs('failed');
  const readyVideos = getReadyVideoEntries();

  return {
    pendingJobs,
    activeJobs,
    doneJobs,
    failedJobs,
    readyVideos,
    readyCount: readyVideos.length,
    pendingCount: pendingJobs.length,
    activeCount: activeJobs.length,
    failedCount: failedJobs.length,
    inPipeline: pendingJobs.length + activeJobs.length,
    totalBuffered: readyVideos.length + pendingJobs.length + activeJobs.length,
  };
}

function getPipelineStatePath() {
  return path.join(DATA_DIR, 'pipeline-state.json');
}

function readPipelineState() {
  return readJSON(getPipelineStatePath(), {});
}

function writePipelineState(data) {
  const current = readPipelineState();
  writeJSON(getPipelineStatePath(), {
    ...current,
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

function touchPipelineState(patch = {}) {
  writePipelineState(patch);
}

function getMadridNowParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
  };
}

function getExpectedPublishSlot(now = new Date()) {
  const parts = getMadridNowParts(now);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const slots = getPublishTimes()
    .map((slot) => {
      const [hour, minute] = slot.split(':').map((value) => parseInt(value, 10));
      return { slot, minutes: hour * 60 + minute };
    })
    .sort((a, b) => a.minutes - b.minutes);

  let latest = null;
  for (const slot of slots) {
    if (slot.minutes <= currentMinutes) latest = slot;
  }
  return latest ? { ...latest, date: parts.date } : null;
}

function getMinutesSince(isoDate) {
  if (!isoDate) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.round((Date.now() - timestamp) / 60000);
}

module.exports = {
  OUTPUT_DIR,
  QUEUE_DIR,
  DATA_DIR,
  readJSON,
  writeJSON,
  getOperationalThresholds,
  getPublishTimes,
  getReadyVideoEntries,
  getQueueSnapshot,
  inspectOutputVideo,
  isReadyVideoEntry,
  isMetadataComplete,
  readPipelineState,
  writePipelineState,
  touchPipelineState,
  getExpectedPublishSlot,
  getMinutesSince,
};
