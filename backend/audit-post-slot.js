const fs = require('fs');
const path = require('path');

const now = new Date();
const hh = String(now.getHours()).padStart(2, '0');
const mm = String(now.getMinutes()).padStart(2, '0');

// ═══════════════════════════════════════════════════════════
// 1. ÚLTIMO INTENTO DE PUBLICACIÓN
// ═══════════════════════════════════════════════════════════

const publishLog = './data/publish-scheduler-log.json';
let lastPublishAttempt = null;

if (fs.existsSync(publishLog)) {
  try {
    const log = JSON.parse(fs.readFileSync(publishLog, 'utf8'));
    if (Array.isArray(log) && log.length > 0) {
      lastPublishAttempt = log[0];
    }
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// 2. QUEUE STATE
// ═══════════════════════════════════════════════════════════

const queueBase = './queue';
let queue = { pending: 0, active: 0, done: 0, failed: 0 };
for (const state of Object.keys(queue)) {
  const dir = path.join(queueBase, state);
  if (fs.existsSync(dir)) {
    queue[state] = fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
  }
}

const bufferEval = queue.done >= 10 ? 'OK' : queue.done >= 5 ? 'ESTABLE' : 'RIESGO';

// ═══════════════════════════════════════════════════════════
// 3. TTS HEALTH
// ═══════════════════════════════════════════════════════════

const genLog = './data/scheduler-generation-log.json';
let ttsStatus = 'UNKNOWN';
let ttsRatio = '0%';
let last5Gen = [];

if (fs.existsSync(genLog)) {
  const log = JSON.parse(fs.readFileSync(genLog, 'utf8'));
  last5Gen = log.slice(0, 5);
  const success = last5Gen.filter(e => e.success).length;
  ttsRatio = Math.round((success / Math.max(1, last5Gen.length)) * 100) + '%';
  ttsStatus = success >= 4 ? 'OK' : success >= 2 ? 'INESTABLE' : 'ROTO';
}

// ═══════════════════════════════════════════════════════════
// 4. QC CHECK
// ═══════════════════════════════════════════════════════════

const qcLog = './data/qc-checks.json';
let qcPassRate = 0;

if (fs.existsSync(qcLog)) {
  const log = JSON.parse(fs.readFileSync(qcLog, 'utf8'));
  if (Array.isArray(log) && log.length > 0) {
    const last10 = log.slice(0, 10);
    const passes = last10.filter(e => e.passed).length;
    qcPassRate = Math.round((passes / last10.length) * 100);
  }
}

// ═══════════════════════════════════════════════════════════
// 5. NEXT SLOT
// ═══════════════════════════════════════════════════════════

const slots = ['14:30', '21:15'];
const currentMin = now.getHours() * 60 + now.getMinutes();
let nextSlot = null;
for (const slot of slots) {
  const [h, m] = slot.split(':').map(Number);
  const slotMin = h * 60 + m;
  if (slotMin > currentMin) {
    nextSlot = { time: slot, minUntil: slotMin - currentMin };
    break;
  }
}
if (!nextSlot) {
  const [h, m] = slots[0].split(':').map(Number);
  const slotMin = h * 60 + m;
  const minToMidnight = 24 * 60 - currentMin;
  nextSlot = { time: slots[0], minUntil: minToMidnight + slotMin };
}

// ═══════════════════════════════════════════════════════════
// 6. ANALYSIS
// ═══════════════════════════════════════════════════════════

let cycleStatus = 'ESTABLE';
let issues = [];

if (!lastPublishAttempt || !lastPublishAttempt.success) {
  issues.push('publish_failed_or_missing');
  cycleStatus = 'INESTABLE';
}

if (parseInt(ttsRatio) < 80) {
  issues.push('tts_ratio_baja');
  cycleStatus = 'INESTABLE';
}

if (qcPassRate < 60) {
  issues.push('qc_rate_baja');
  cycleStatus = 'INESTABLE';
}

if (queue.done < 5) {
  issues.push('buffer_bajo');
  cycleStatus = 'INESTABLE';
}

const monetizationReady =
  (lastPublishAttempt && lastPublishAttempt.success) &&
  (queue.done >= 10) &&
  (parseInt(ttsRatio) >= 80) &&
  (qcPassRate >= 70);

const monetizationStatus = monetizationReady ? 'READY FOR SCALE' : 'NOT READY';

// ═══════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════

console.log('');
console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║         AUDIT SENIOR — POST-SLOT (MODO PRODUCCIÓN)            ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');

console.log('📤 VALIDACIÓN DEL SLOT');
if (lastPublishAttempt) {
  const time = lastPublishAttempt.cycleAt ? new Date(lastPublishAttempt.cycleAt).toLocaleString() : 'N/A';
  console.log('- Intento: ' + time);
  console.log('- Status: ' + (lastPublishAttempt.success ? '✓ PUBLICADO' : '✗ FALLÓ'));
  if (lastPublishAttempt.videoId) console.log('- VideoId: ' + lastPublishAttempt.videoId);
  if (lastPublishAttempt.reason) console.log('- Motivo: ' + lastPublishAttempt.reason);
} else {
  console.log('- Sin intentos de publicación registrados');
}
console.log('');

console.log('📊 ESTADO POST-SLOT');
console.log('- Ready: ' + queue.done + ' | Pending: ' + queue.pending + ' | Active: ' + queue.active);
console.log('- Failed: ' + queue.failed);
console.log('- Evaluación: ' + (bufferEval === 'OK' ? '✓' : bufferEval === 'ESTABLE' ? '⚠️' : '❌') + ' ' + bufferEval);
console.log('');

console.log('🎙️ TTS HEALTH (POST)');
console.log('- Ratio: ' + ttsRatio + ' (' + last5Gen.map(g => g.success ? '✓' : '✗').join(' ') + ')');
console.log('- Estado: ' + (ttsStatus === 'OK' ? '✓' : ttsStatus === 'INESTABLE' ? '⚠️' : '❌') + ' ' + ttsStatus);
console.log('');

console.log('🧪 QC REAL (sin RECOVERY_MODE)');
console.log('- Pass rate: ' + qcPassRate + '%');
console.log('- Estado: ' + (qcPassRate >= 70 ? '✓' : qcPassRate >= 50 ? '⚠️' : '❌') + (qcPassRate >= 70 ? ' OK' : qcPassRate >= 50 ? ' DEGRADADO' : ' CRÍTICO'));
console.log('');

console.log('📅 PRÓXIMO SLOT');
console.log('- Slot: ' + nextSlot.time + ' (en ' + nextSlot.minUntil + ' min)');
console.log('- Ready: ' + queue.done + ' (min. 5)');
console.log('- Protección: ' + (queue.done >= 5 ? '✓ SÍ' : '❌ NO'));
console.log('');

if (issues.length > 0) {
  console.log('⚠️ ISSUES');
  issues.forEach(i => console.log('- ' + i));
  console.log('');
}

console.log('╔════════════════════════════════════════════════════════════════╗');
if (cycleStatus === 'ESTABLE') {
  console.log('║              ✅ CICLO ESTABLE (producción lista)              ║');
} else {
  console.log('║             ⚠️ CICLO INESTABLE (vigilar, posible fallo)       ║');
}
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');

console.log('💰 ESTADO PARA MONETIZACIÓN');
console.log('- Publica sin intervención: ' + (lastPublishAttempt && lastPublishAttempt.success ? 'SÍ ✓' : 'NO ✗'));
console.log('- Buffer >10: ' + (queue.done >= 10 ? 'SÍ ✓' : 'NO ✗'));
console.log('- TTS estable (≥80%): ' + (parseInt(ttsRatio) >= 80 ? 'SÍ ✓' : 'NO ✗'));
console.log('- QC consistente (≥70%): ' + (qcPassRate >= 70 ? 'SÍ ✓' : 'NO ✗'));
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  ' + (monetizationStatus === 'READY FOR SCALE' ? '✅ READY FOR SCALE' : '❌ NOT READY'));
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');

// ACTION
if (cycleStatus === 'ESTABLE' && monetizationReady) {
  console.log('no tocar nada');
} else if (cycleStatus === 'ESTABLE') {
  console.log('mantener modo normal');
} else if (queue.done < 5) {
  console.log('generar +3 vídeos');
} else if (parseInt(ttsRatio) < 80) {
  console.log('reiniciar TTS');
} else {
  console.log('activar recovery');
}
console.log('');
