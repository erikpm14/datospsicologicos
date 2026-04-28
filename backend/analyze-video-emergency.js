const ffmpeg = require('fluent-ffmpeg');

const videoPath = '../output/d101f12c-3658-4a35-9923-687e59351744/output.mp4';

ffmpeg.ffprobe(videoPath, (err, metadata) => {
  if (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════');
  console.log('FORMAT');
  console.log('═══════════════════════════════════════');
  console.log('Duration:', metadata.format.duration, 'seconds');
  console.log('Bitrate:', metadata.format.bit_rate, 'bps');
  console.log('Size:', metadata.format.size, 'bytes');

  console.log('\n═══════════════════════════════════════');
  console.log('STREAMS');
  console.log('═══════════════════════════════════════');

  (metadata.streams || []).forEach((stream, idx) => {
    console.log(`\nStream ${idx}:`);
    console.log('  Type:', stream.codec_type);
    console.log('  Codec:', stream.codec_name);
    if (stream.width) console.log('  Dimensions:', stream.width, 'x', stream.height);
    if (stream.r_frame_rate) console.log('  Frame rate:', stream.r_frame_rate);
    if (stream.sample_rate) console.log('  Sample rate:', stream.sample_rate);
  });

  process.exit(0);
});
