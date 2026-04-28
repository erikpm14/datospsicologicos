require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');

const VIDEO_ID = '1cc054c0-de34-4689-aa18-3401d8008306';

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║ DIAGNÓSTICO: Vídeo Negro ${VIDEO_ID.slice(0, 20)}`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

// 1. Archivos locales
console.log(`1️⃣  ARCHIVOS LOCALES\n`);

const outputDir = path.join(path.resolve('./output'), VIDEO_ID);
const files = {
  'script.json': path.join(outputDir, 'script.json'),
  'output.mp4': path.join(outputDir, 'output.mp4'),
  'subtitles.ass': path.join(outputDir, 'subtitles.ass'),
  'render-metadata.json': path.join(outputDir, 'render-metadata.json'),
};

let filesPresent = true;
for (const [name, filePath] of Object.entries(files)) {
  const exists = fs.existsSync(filePath);
  console.log(`   ${exists ? '✅' : '❌'} ${name}`);
  if (!exists) filesPresent = false;
}

if (!filesPresent) {
  console.log(`\n⚠️  CRÍTICO: Archivos faltantes. Es imposible validar sin script.json.`);
}

// 2. Publish log entry
console.log(`\n2️⃣  ENTRADA EN PUBLISH LOG\n`);

const publishLog = JSON.parse(fs.readFileSync(path.resolve('./data/publish-log.json'), 'utf8'));
const entry = publishLog.find(e => e.videoId === VIDEO_ID);

if (entry) {
  console.log(`   Published: ${entry.publishedAt}`);
  console.log(`   Virality: ${entry.viralityScore}`);
  console.log(`   Humanity: ${entry.humanityScore || 'MISSING (required >= 85)'}`);
  console.log(`   Topic: ${entry.topic}`);
  console.log(`   Hook: "${entry.hook}"`);
  console.log(`   Platforms: ${entry.platforms.join(', ') || 'NONE'}`);

  if (entry.errors && entry.errors.length > 0) {
    console.log(`\n   ❌ Errors:${entry.errors.map(e => `\n     - ${e.platform}: ${e.error}`).join('')}`);
  }
} else {
  console.log(`   ❌ Not found in publish-log.json`);
}

// 3. Queue history
console.log(`\n3️⃣  HISTORIAL EN COLAS\n`);

const queueDirs = {
  'pending': path.resolve('./queue/pending'),
  'active': path.resolve('./queue/active'),
  'done': path.resolve('./queue/done'),
  'discarded': path.resolve('./queue/discarded-invalid-current'),
};

for (const [type, dir] of Object.entries(queueDirs)) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir);
  const videoFile = files.find(f => f.includes(VIDEO_ID));
  if (videoFile) {
    console.log(`   Found in ${type}: ${videoFile}`);
  }
}

// 4. V4.1 Compliance
console.log(`\n4️⃣  V4.1 COMPLIANCE\n`);

if (entry) {
  const checks = [
    { name: 'viralityScore >= 70', pass: entry.viralityScore >= 70, value: entry.viralityScore },
    { name: 'humanityScore >= 85', pass: (entry.humanityScore || 0) >= 85, value: entry.humanityScore || 'MISSING' },
    { name: 'Tiene archivos locales', pass: filesPresent, value: filesPresent ? 'YES' : 'NO' },
  ];

  checks.forEach(c => {
    const status = c.pass ? '✅' : '❌';
    console.log(`   ${status} ${c.name}: ${c.value}`);
  });
}

// 5. ROOT CAUSE ANALYSIS
console.log(`\n5️⃣  ROOT CAUSE ANALYSIS\n`);

const issues = [];

if (!filesPresent) {
  issues.push('❌ CRÍTICO: Archivos locales NO existen. Imposible validar video.');
  issues.push('   → El vídeo fue publicado sin archivos MP4 ni subtítulos locales.');
  issues.push('   → Posible: renderizado fallado silenciosamente antes de guardar.');
}

if (entry && entry.viralityScore < 70) {
  issues.push('❌ FALLO V4.1: viralityScore < 70');
  issues.push('   → Vídeo no cumplía standards mínimos pero fue publicado.');
}

if (entry && (!entry.humanityScore || entry.humanityScore < 85)) {
  issues.push('❌ FALLO V4.1: humanityScore < 85 (o missing)');
  issues.push('   → Vídeo no tenía validación de humanidad.');
}

if (issues.length === 0) {
  issues.push('✅ No se detectaron issues de V4.1.');
}

issues.forEach(issue => console.log(`   ${issue}`));

// 6. TIMELINE
console.log(`\n6️⃣  TIMELINE\n`);

const publishTime = entry ? new Date(entry.publishedAt) : null;
console.log(`   Published: ${publishTime ? publishTime.toISOString() : 'unknown'}`);
console.log(`   Audit fix date: 2026-04-26T22:53:00Z (video obeCWBmr5XE)`);

if (publishTime) {
  const timeDiff = new Date('2026-04-26T22:53:00Z') - publishTime;
  const minutes = Math.round(timeDiff / 1000 / 60);
  console.log(`   ⚠️  Gap: ${minutes} minutes BEFORE the fix video`);
  console.log(`   → This video was published PRE-FIX. QC hard was not active yet.`);
}

// 7. RECOMENDACIONES
console.log(`\n7️⃣  RECOMENDACIONES\n`);

console.log(`   1. ✅ Implementado: Validación de archivos locales en publishAll()`);
console.log(`   2. ⚠️  TODO: Validar que QC hard esté activo en TODAS las rutas de publish`);
console.log(`   3. ⚠️  TODO: Agregar logs detallados si files are missing pre-publish`);
console.log(`   4. ⚠️  TODO: Mejorar monitoreo de vídeos publicados sin archivos locales`);

console.log(`\n════════════════════════════════════════════════════════\n`);

process.exit(0);
