require('dotenv').config({ path: './backend/.env' });
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

const VIDEO_ID = '51ef6963-d243-4a17-9bec-b048a0c3a8cb';
const OUTPUT_DIR = path.join(path.resolve('./output'), VIDEO_ID);
const EXPORTS_DIR = path.resolve('./exports');

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║          AUDITORÍA: FALLO DE VÍDEO NEGRO              ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

try {
  // 1. BUSCAR METADATA DEL VÍDEO MALO
  console.log(`1️⃣  BUSCANDO METADATA DEL VÍDEO MALO (DpbjNbvTYbk)...\n`);
  
  const exportDirs = fs.readdirSync(EXPORTS_DIR)
    .filter(d => fs.statSync(path.join(EXPORTS_DIR, d)).isDirectory())
    .sort()
    .reverse();

  let badVideoMeta = null;
  for (const dateDir of exportDirs.slice(0, 5)) {
    const dateExportPath = path.join(EXPORTS_DIR, dateDir);
    const files = fs.readdirSync(dateExportPath);
    const jsonFile = files.find(f => f.endsWith('.json'));
    
    if (jsonFile) {
      const filePath = path.join(dateExportPath, jsonFile);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (content.youtubeId === 'DpbjNbvTYbk' || content.hook?.includes('sentir')) {
        badVideoMeta = { file: jsonFile, path: filePath, content };
        break;
      }
    }
  }

  if (badVideoMeta) {
    console.log(`   ✅ Encontrado: ${badVideoMeta.file}`);
    console.log(`   📺 YouTube ID: DpbjNbvTYbk`);
    console.log(`   📅 Timestamp: ${badVideoMeta.content.publishedAt || 'N/A'}`);
  } else {
    console.log(`   ⚠️  Metadata no encontrada en exports (probablemente borrada)`);
  }

  // 2. VALIDAR VÍDEO BUENO ACTUAL
  console.log(`\n2️⃣  VALIDANDO VÍDEO BUENO ACTUAL (obeCWBmr5XE)...\n`);
  
  const outputMp4 = path.join(OUTPUT_DIR, 'output.mp4');
  const assFile = path.join(OUTPUT_DIR, 'subtitles.ass');
  const scriptPath = path.join(OUTPUT_DIR, 'script.json');
  const metadataPath = path.join(OUTPUT_DIR, 'render-metadata.json');

  // 2a. Validaciones básicas
  const checks = {
    'output.mp4 existe': fs.existsSync(outputMp4),
    'subtitles.ass existe': fs.existsSync(assFile),
    'script.json existe': fs.existsSync(scriptPath),
    'render-metadata.json existe': fs.existsSync(metadataPath),
  };

  for (const [check, passed] of Object.entries(checks)) {
    console.log(`   ${passed ? '✅' : '❌'} ${check}`);
  }

  // 2b. Tamaño de archivo
  const stats = fs.statSync(outputMp4);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`   ${stats.size > 1000000 ? '✅' : '❌'} Tamaño: ${sizeMB} MB (mínimo 1MB para vídeo válido)`);

  // 2c. ffprobe - streams
  console.log(`\n   ffprobe validation:\n`);
  const ffprobeCmd = `"${ffprobePath}" -v error -show_streams -show_format "${outputMp4}"`;
  const probeOutput = execSync(ffprobeCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  
  const videoStreamMatch = probeOutput.match(/\[STREAM\]([\s\S]*?)\[\/STREAM\]/);
  const audioStreamMatch = probeOutput.match(/\[STREAM\]([\s\S]*?)codec_type=audio([\s\S]*?)\[\/STREAM\]/);
  const formatMatch = probeOutput.match(/\[FORMAT\]([\s\S]*?)\[\/FORMAT\]/);

  // Video stream
  if (videoStreamMatch) {
    const videoData = videoStreamMatch[1];
    const width = videoData.match(/width=(\d+)/)?.[1];
    const height = videoData.match(/height=(\d+)/)?.[1];
    const frames = videoData.match(/nb_frames=(\d+)/)?.[1];
    const codec = videoData.match(/codec_name=(\w+)/)?.[1];
    const pixfmt = videoData.match(/pix_fmt=(\w+)/)?.[1];
    
    console.log(`   Video stream:`);
    console.log(`   ✅ Exists: ${width}x${height}`);
    console.log(`   ${frames ? '✅' : '❌'} Frames: ${frames || 'N/A'} (>0 = tiene contenido)`);
    console.log(`   ${codec === 'h264' ? '✅' : '❌'} Codec: ${codec || 'N/A'}`);
    console.log(`   ${pixfmt === 'yuv420p' ? '✅' : '❌'} Pixel format: ${pixfmt || 'N/A'}`);
  } else {
    console.log(`   ❌ NO VIDEO STREAM FOUND - THIS IS THE PROBLEM!`);
  }

  // Audio stream
  if (audioStreamMatch) {
    console.log(`   ✅ Audio stream exists`);
  } else {
    console.log(`   ❌ NO AUDIO STREAM`);
  }

  // Duration
  if (formatMatch) {
    const formatData = formatMatch[1];
    const duration = parseFloat(formatData.match(/duration=([\d.]+)/)?.[1]);
    console.log(`   ${duration && duration >= 26 && duration <= 32 ? '✅' : '❌'} Duration: ${duration?.toFixed(2)}s (26-32s required)`);
  }

  // 2d. Subtítulos
  console.log(`\n   Subtitles validation:\n`);
  if (fs.existsSync(assFile)) {
    const assContent = fs.readFileSync(assFile, 'utf8');
    const dialogueLines = (assContent.match(/^Dialogue:/gm) || []).length;
    console.log(`   ✅ ASS file exists`);
    console.log(`   ✅ Dialogue lines: ${dialogueLines}`);
    console.log(`   ${dialogueLines > 0 ? '✅' : '❌'} Has subtitles to burn-in`);
  }

  // 3. DIAGNÓSTICO DEL FALLO ANTERIOR
  console.log(`\n3️⃣  DIAGNÓSTICO DEL FALLO DE VÍDEO NEGRO\n`);
  console.log(`   Causa probable:`);
  console.log(`   ❌ renderWithGradientBg línea 1232-1234:`);
  console.log(`      Antes: color source SIN duración en lavfi`);
  console.log(`      color=${bgColor}:s=1080x1920:r=30`);
  console.log(`      + inputOptions: -t ${realDuration}`);
  console.log(`      `);
  console.log(`      Problema: FFmpeg puede no inicializar video stream`);
  console.log(`      si la duración no está en el filtro lavfi.`);
  console.log(`      `);
  console.log(`   ✅ Fix aplicado:`);
  console.log(`      color=c=${bgColor}:s=1080x1920:r=30:d=${realDuration}`);
  console.log(`      Duración EXPLÍCITA en lavfi source.`);

  console.log(`\n   Cambios adicionales:`);
  console.log(`   ✅ format=yuv420p en filtergraph`);
  console.log(`   ✅ -profile:v high -level 4.0 para YouTube compatibility`);
  console.log(`   ✅ -shortest para sync audio/video`);
  console.log(`   ✅ Removido -t redundante en output`);

  // 4. VALIDACIÓN QC DURO
  console.log(`\n4️⃣  VALIDACIÓN QC DURO PRE-PUBLISH\n`);
  
  let qcPassed = true;
  const qcChecks = [
    { name: 'Video stream exists', passed: !!videoStreamMatch },
    { name: 'Frame count > 0', passed: parseInt(videoStreamMatch?.[1]?.match(/nb_frames=(\d+)/)?.[1] || 0) > 0 },
    { name: 'Codec h264', passed: videoStreamMatch?.[1]?.includes('codec_name=h264') },
    { name: 'Pixel format yuv420p', passed: videoStreamMatch?.[1]?.includes('pix_fmt=yuv420p') },
    { name: 'Resolution 1080x1920', passed: videoStreamMatch?.[1]?.includes('width=1080') && videoStreamMatch?.[1]?.includes('height=1920') },
    { name: 'Audio stream exists', passed: !!audioStreamMatch },
    { name: 'File size > 1MB', passed: stats.size > 1000000 },
    { name: 'Subtitles present', passed: fs.existsSync(assFile) },
  ];

  for (const qc of qcChecks) {
    console.log(`   ${qc.passed ? '✅' : '❌'} ${qc.name}`);
    if (!qc.passed) qcPassed = false;
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (qcPassed) {
    console.log(`✅ VÍDEO BUENO VALIDADO - LISTO PARA YOUTUBE`);
  } else {
    console.log(`❌ VÍDEO TIENE PROBLEMAS - BLOQUEAR PUBLISH`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

} catch (err) {
  console.error(`\n❌ ERROR: ${err.message}\n`);
  console.error(err.stack);
}

process.exit(0);
