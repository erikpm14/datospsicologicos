const { validateReadyVideo } = require('./src/services/ready-video-validator.service');

const videos = [
  '9e3208ce-04d9-47b1-9b7a-d3c2b7025867',
  '2b260bb2-0a8c-4ac6-ad54-14ba64ceae4e',
  '21f27877-3ca3-4eea-a516-4b01546a6cf9',
  '25f1efa2-a181-4ecc-9935-6c53143c742b',
  '46c658c5-4970-4ea1-aee2-42acb204f1b6',
  '51f843c1-d8ce-4223-b1ed-099e428b8840',
  '655daf0f-1261-41a6-8793-71c839eb9dc0',
  'c092efdf-6d6a-4674-b82e-a7737f0392c7',
  'c4b8a416-6c01-4329-bd7b-019f66c24620',
  'd44d2810-3934-4bba-b9e7-4bd62ec033a9'
];

console.log('\n[VALIDATEREADYVIDEO WITH CHECK 19]\n');
let passCount = 0;
let failCount = 0;

videos.forEach(vid => {
  const result = validateReadyVideo(vid);
  if (result.ready) {
    console.log(`✓ ${vid}`);
    passCount++;
  } else {
    console.log(`✗ ${vid}`);
    result.errors.forEach(e => {
      if (e.includes('CHECK_19')) console.log(`  → ${e}`);
    });
    failCount++;
  }
});

console.log(`\nRESULT: ${passCount} PASS | ${failCount} FAIL\n`);
