#!/usr/bin/env node
/**
 * test-tts.js
 * Prueba aislada del pipeline TTS. Valida Edge TTS y Kokoro.
 *
 * Uso: node scripts/test-tts.js [--edge-only] [--kokoro-only]
 */

const path = require('path');
// Load .env from backend
try {
  require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({
    path: path.resolve(__dirname, '../backend/.env'),
  });
} catch {}

const { MsEdgeTTS, OUTPUT_FORMAT } = require(path.resolve(__dirname, '../backend/node_modules/msedge-tts'));
const { execFile } = require('child_process');
const fs   = require('fs');

const TMP_DIR     = path.resolve(__dirname, '../backend/assets/kokoro');
const KOKORO_SCRIPT = path.resolve(__dirname, '../backend/src/utils/kokoro_tts.py');
const PYTHON_BIN  = process.env.PYTHON_BIN || 'python3';

const EDGE_ONLY   = process.argv.includes('--edge-only');
const KOKORO_ONLY = process.argv.includes('--kokoro-only');

const TEST_TEXT = 'Si haces esto antes de dormir, tu cerebro sigue trabajando aunque no te des cuenta.';
const TEST_SCRIPT = {
  hook:        'Si haces esto antes de dormir, tu cerebro sigue trabajando aunque no te des cuenta.',
  claim:       'Tu corteza prefrontal no descansa: consolida lo que aprendiste.',
  explanation: 'Cada vez que revisas el móvil antes de dormir, interrumpes ese proceso. Tu amígdala queda activa, generando cortisol. Te despiertas más cansado de lo que te dormiste.',
  cta:         '¿Lo reconoces? Comenta si te ha pasado esta semana.',
};

function ok(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ  ${msg}`); }

function validateAudioFile(filePath, provider) {
  if (!fs.existsSync(filePath)) {
    fail(`${provider}: archivo no creado en ${filePath}`);
    return false;
  }
  const size = fs.statSync(filePath).size;
  if (size < 1000) {
    fail(`${provider}: archivo existe pero pesa ${size} bytes (demasiado pequeño)`);
    return false;
  }
  ok(`${provider}: archivo creado — ${(size / 1024).toFixed(0)} KB en ${path.basename(filePath)}`);
  return true;
}

// ── Edge TTS ──────────────────────────────────────────────────────────────────
async function testEdgeTTS() {
  console.log('\n── EDGE TTS ────────────────────────────────────────────────');
  const voice    = process.env.EDGE_TTS_VOICE || 'es-ES-ElviraNeural';
  const outPath  = path.join(TMP_DIR, 'test_edge_tts.mp3');

  info(`Voice: ${voice}`);
  info(`Text: "${TEST_TEXT}"`);

  const hookIsQ  = TEST_SCRIPT.hook.trim().endsWith('?');
  const ssml =
    (hookIsQ
      ? `<prosody pitch="+10%" rate="-8%">${TEST_SCRIPT.hook}</prosody>`
      : TEST_SCRIPT.hook) +
    `<break time="650ms"/>${TEST_SCRIPT.claim}<break time="400ms"/>` +
    `${TEST_SCRIPT.explanation}<break time="400ms"/>${TEST_SCRIPT.cta}`;

  info(`SSML chars: ${ssml.length}`);

  const start = Date.now();
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(ssml);

    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(outPath);
      audioStream.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      audioStream.on('error', reject);
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    const valid = validateAudioFile(outPath, 'Edge TTS');

    if (valid) {
      const size = fs.statSync(outPath).size;
      // MP3 at 96kbps ≈ 12000 bytes/sec → rough duration estimate
      const estDuration = ((size / 12000)).toFixed(1);
      ok(`Edge TTS: duración estimada ~${estDuration}s (${elapsed}s de generación)`);
      info(`Ruta: ${outPath}`);
      return { ok: true, provider: 'edge', path: outPath, size, estDuration };
    }
    return { ok: false, provider: 'edge', error: 'empty file' };
  } catch (err) {
    fail(`Edge TTS: ${err.message}`);
    return { ok: false, provider: 'edge', error: err.message };
  }
}

// ── Kokoro TTS ────────────────────────────────────────────────────────────────
async function testKokoroTTS() {
  console.log('\n── KOKORO TTS ──────────────────────────────────────────────');
  const voice   = process.env.KOKORO_VOICE || 'ef_dora';
  const speed   = process.env.KOKORO_SPEED || '1.05';
  const outPath = path.join(TMP_DIR, 'test_kokoro_tts.wav');

  info(`Voice: ${voice} | Speed: ${speed}`);
  info(`Script: ${KOKORO_SCRIPT}`);

  if (!fs.existsSync(KOKORO_SCRIPT)) {
    fail(`kokoro_tts.py not found at ${KOKORO_SCRIPT}`);
    return { ok: false, provider: 'kokoro', error: 'script not found' };
  }

  const normalizedText = TEST_TEXT
    .replace(/\b([A-ZÁÉÍÓÚÜÑ]{2,})\b/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[\u{1F300}-\u{1F9FF}]/gu, '')
    .trim();

  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  const start = Date.now();
  return new Promise((resolve) => {
    execFile(
      PYTHON_BIN,
      [KOKORO_SCRIPT, normalizedText, outPath, voice, speed],
      { timeout: 60_000 },
      (err, stdout, stderr) => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(2);
        if (err) {
          fail(`Kokoro: proceso falló — ${err.message}`);
          if (stderr) info(`stderr: ${stderr.slice(0, 200)}`);
          resolve({ ok: false, provider: 'kokoro', error: err.message });
          return;
        }
        try {
          const result = JSON.parse(stdout.trim());
          if (!result.ok) {
            fail(`Kokoro: error de Python — ${result.error}`);
            resolve({ ok: false, provider: 'kokoro', error: result.error });
            return;
          }
          const valid = validateAudioFile(outPath, 'Kokoro');
          if (valid) {
            const size = fs.statSync(outPath).size;
            ok(`Kokoro: duración real ${result.duration}s (${elapsed}s de generación)`);
            info(`Ruta: ${outPath}`);
            resolve({ ok: true, provider: 'kokoro', path: outPath, size, duration: result.duration });
          } else {
            resolve({ ok: false, provider: 'kokoro', error: 'empty file' });
          }
        } catch {
          fail(`Kokoro: stdout no es JSON válido — "${stdout.slice(0, 100)}"`);
          resolve({ ok: false, provider: 'kokoro', error: 'bad stdout' });
        }
      },
    );
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' TTS TEST — Datos Psicológicos');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Texto de prueba:\n  "${TEST_TEXT}"\n`);

  const results = [];

  if (!KOKORO_ONLY) results.push(await testEdgeTTS());
  if (!EDGE_ONLY)   results.push(await testKokoroTTS());

  // Resumen final
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' RESUMEN');
  console.log('═══════════════════════════════════════════════════════');

  let hasWorking = false;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✅ ${r.provider.toUpperCase().padEnd(7)} — OK | ${(r.size / 1024).toFixed(0)} KB | ${r.path}`);
      hasWorking = true;
    } else {
      console.log(`  ❌ ${r.provider.toUpperCase().padEnd(7)} — FAILED: ${r.error}`);
    }
  }

  console.log('');
  if (hasWorking) {
    console.log('✅ Al menos un proveedor TTS funciona. El pipeline está listo.');
    process.exit(0);
  } else {
    console.log('❌ TODOS LOS PROVEEDORES FALLARON. Verifica la conexión a internet y Python.');
    process.exit(1);
  }
})();
