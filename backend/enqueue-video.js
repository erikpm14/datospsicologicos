require('dotenv').config({ path: './backend/.env' });
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const QUEUE_DIR = path.resolve('./backend/queue');

async function enqueueVideo(videoId) {
  const scriptPath = path.join('./output', videoId, 'script.json');
  
  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  
  const jobId = uuidv4();
  const jobFile = path.join(QUEUE_DIR, 'pending', `${jobId}.json`);
  
  fs.mkdirSync(path.dirname(jobFile), { recursive: true });
  fs.writeFileSync(jobFile, JSON.stringify({
    jobId,
    videoId,
    script,
    createdAt: new Date().toISOString(),
    status: 'pending',
  }, null, 2));

  console.log(`\n✅ Video enqueued for rendering`);
  console.log(`   JobID: ${jobId}`);
  console.log(`   VideoID: ${videoId}`);
  console.log(`   Location: ${jobFile}`);
  console.log(`\n🚀 Pipeline will process this job when a worker is available`);
  console.log(`   Monitor with: tail -f backend/queue/active/*`);
}

const videoId = process.argv[2];
if (!videoId) {
  console.error('Usage: node enqueue-video.js <VIDEO_ID>');
  process.exit(1);
}

enqueueVideo(videoId).catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
