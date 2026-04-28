require('dotenv').config({ path: './backend/.env' });
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

console.log(`\n╔════════════════════════════════════════════════════════╗`);
console.log(`║       AUDITORÍA E2E COMPLETA - PIPELINE VIDEO         ║`);
console.log(`╚════════════════════════════════════════════════════════╝\n`);

const AUDIT = {
  timestamp: new Date().toISOString(),
  status: 'OK',
  issues: [],
  warnings: [],
  components: {},
};

// 1. FLUJO COMPLETO
console.log(`1️⃣  FLUJO COMPLETO (VIDEO RECIENTE)\n`);

const VIDEO_ID = '51ef6963-d243-4a17-9bec-b048a0c3a8cb';
const OUTPUT_DIR = path.join(path.resolve('./output'), VIDEO_ID);
const EXPORT_DIR = path.resolve('./exports');

const flowStages = [
  { name: 'GENERATED', file: path.join(OUTPUT_DIR, 'script.json') },
  { name: 'RENDERED', file: path.join(OUTPUT_DIR, 'output.mp4') },
];

for (const stage of flowStages) {
  const exists = fs.existsSync(stage.file);
  const status = exists ? '✅' : '❌';
  console.log(`   ${status} ${stage.name}`);
  AUDIT.components[stage.name] = exists ? 'pass' : 'fail';
}

// 2. VALIDACIÓN DE GENERACIÓN
console.log(`\n2️⃣  VALIDACIÓN GENERACIÓN\n`);

const scriptPath = path.join(OUTPUT_DIR, 'script.json');
if (fs.existsSync(scriptPath)) {
  try {
    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));

    const genChecks = [
      { name: 'structureVersion = confessional', pass: script.structureVersion === 'confessional' },
      { name: 'retentionSpikeVersion = v4.1', pass: script.retentionSpikeVersion === 'v4.1' },
      { name: 'viralityScore >= 70', pass: script.viralityScore >= 70 },
      { name: 'humanityScore >= 85', pass: script.humanityScore >= 85 },
      { name: 'duration 26-32s', pass: script.duration >= 26 && script.duration <= 32 },
      { name: 'hook present', pass: !!script.hook },
    ];

    genChecks.forEach(check => {
      const status = check.pass ? '✅' : '❌';
      console.log(`   ${status} ${check.name}`);
      if (!check.pass) AUDIT.warnings.push(`Generation: ${check.name}`);
    });

    AUDIT.components.GENERATION = genChecks.every(c => c.pass) ? 'pass' : 'warning';
  } catch (err) {
    console.log(`   ❌ Script parsing error`);
    AUDIT.issues.push(`Generation: ${err.message}`);
    AUDIT.components.GENERATION = 'fail';
  }
}

// 3. VALIDACIÓN DE RENDER
console.log(`\n3️⃣  VALIDACIÓN RENDER\n`);

const mp4Path = path.join(OUTPUT_DIR, 'output.mp4');
if (fs.existsSync(mp4Path)) {
  try {
    const stats = fs.statSync(mp4Path);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    console.log(`   ✅ File exists: ${sizeMB} MB`);
    AUDIT.components.RENDER = 'pass';
  } catch (err) {
    console.log(`   ❌ File error`);
    AUDIT.issues.push(`Render: ${err.message}`);
    AUDIT.components.RENDER = 'fail';
  }
} else {
  console.log(`   ❌ No output.mp4`);
  AUDIT.issues.push('Render: No output.mp4');
  AUDIT.components.RENDER = 'fail';
}

// 4. VALIDACIÓN DE SUBTÍTULOS
console.log(`\n4️⃣  VALIDACIÓN SUBTÍTULOS\n`);

const assPath = path.join(OUTPUT_DIR, 'subtitles.ass');
if (fs.existsSync(assPath)) {
  try {
    const assContent = fs.readFileSync(assPath, 'utf8');
    const dialogueLines = (assContent.match(/^Dialogue:/gm) || []).length;

    console.log(`   ✅ File exists: ${dialogueLines} subtitle lines`);
    AUDIT.components.SUBTITLES = 'pass';
  } catch (err) {
    console.log(`   ❌ ASS error`);
    AUDIT.issues.push(`Subtitles: ${err.message}`);
    AUDIT.components.SUBTITLES = 'fail';
  }
} else {
  console.log(`   ❌ No subtitles.ass`);
  AUDIT.issues.push('Subtitles: Missing .ass file');
  AUDIT.components.SUBTITLES = 'fail';
}

// 5. VALIDACIÓN QC
console.log(`\n5️⃣  VALIDACIÓN QC (CRÍTICO)\n`);

try {
  const { validateVideoQC } = require('./src/services/publish-validator.service');
  const qcResult = validateVideoQC(mp4Path, assPath, VIDEO_ID);

  if (qcResult.valid) {
    console.log(`   ✅ QC HARD PASS`);
    AUDIT.components.QC = 'pass';
  } else {
    console.log(`   ❌ QC FAILED`);
    AUDIT.issues.push(`QC: ${qcResult.error}`);
    AUDIT.components.QC = 'fail';
    AUDIT.status = 'CRITICAL';
  }
} catch (err) {
  console.log(`   ❌ QC error`);
  AUDIT.issues.push(`QC: ${err.message}`);
  AUDIT.components.QC = 'fail';
}

// 6. VALIDACIÓN COLAS
console.log(`\n6️⃣  VALIDACIÓN COLAS\n`);

const QUEUE_DIR = path.resolve('./backend/queue');
const queueDirs = {
  pending: path.join(QUEUE_DIR, 'pending'),
  active: path.join(QUEUE_DIR, 'active'),
  done: path.join(QUEUE_DIR, 'done'),
};

let queueOk = true;
for (const [type, dir] of Object.entries(queueDirs)) {
  if (fs.existsSync(dir)) {
    const count = fs.readdirSync(dir).length;
    console.log(`   ✅ ${type}: ${count} jobs`);
  } else {
    console.log(`   ❌ ${type}: missing`);
    queueOk = false;
  }
}

AUDIT.components.QUEUES = queueOk ? 'pass' : 'fail';

// 7. PUBLICACIÓN
console.log(`\n7️⃣  PUBLICACIÓN\n`);

const publishedPath = path.resolve('./published.json');
if (fs.existsSync(publishedPath)) {
  try {
    const published = JSON.parse(fs.readFileSync(publishedPath, 'utf8'));
    console.log(`   ✅ published.json exists`);
    console.log(`   📊 Total: ${published.videos?.length || 0} videos`);
    AUDIT.components.PUBLISH = 'pass';
  } catch (err) {
    console.log(`   ❌ parse error`);
    AUDIT.issues.push(`Publish: ${err.message}`);
    AUDIT.components.PUBLISH = 'fail';
  }
} else {
  console.log(`   ⚠️  Not yet created`);
  AUDIT.components.PUBLISH = 'warning';
}

// REPORTE FINAL
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`\n📊 REPORTE FINAL\n`);

const statusEmoji = AUDIT.status === 'OK' ? '✅' : '⚠️';
console.log(`${statusEmoji} STATUS GLOBAL: ${AUDIT.status}\n`);

console.log(`Component Status:`);
Object.entries(AUDIT.components).forEach(([comp, status]) => {
  const emoji = status === 'pass' ? '✅' : status === 'warning' ? '⚠️' : '❌';
  console.log(`   ${emoji} ${comp}: ${status.toUpperCase()}`);
});

if (AUDIT.issues.length > 0) {
  console.log(`\n❌ ISSUES:`);
  AUDIT.issues.forEach(issue => console.log(`   - ${issue}`));
  AUDIT.status = 'CRITICAL';
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

fs.mkdirSync(path.resolve('./audits'), { recursive: true });
fs.writeFileSync(
  path.resolve('./audits/e2e-audit.json'),
  JSON.stringify(AUDIT, null, 2)
);

console.log(`📋 Reporte guardado: audits/e2e-audit.json\n`);
process.exit(0);
