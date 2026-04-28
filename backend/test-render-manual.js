/**
 * test-render-manual.js
 * Test manual de render para diagnosticar dónde se cuelga
 */

require('dotenv').config({ path: './backend/.env' });
const path = require('path');
const fs = require('fs');
const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { renderVideoWithRouter } = require('./src/services/render-engines');

const VIDEO_DIR = path.resolve('./output/51ef6963-d243-4a17-9bec-b048a0c3a8cb');

async function testRender() {
  console.log(`\n🔧 DIAGNOSTICANDO RENDER MANUAL`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  try {
    // 1. Leer script
    console.log(`1️⃣  Leyendo script...`);
    if (!fs.existsSync(path.join(VIDEO_DIR, 'script.json'))) {
      console.log(`❌ script.json no existe`);
      process.exit(1);
    }

    const script = JSON.parse(fs.readFileSync(path.join(VIDEO_DIR, 'script.json'), 'utf8'));
    console.log(`✅ Script leído`);
    console.log(`   Hook: ${script.hook}`);
    console.log(`   Duration: ${script.duration}s`);

    // 2. Síntesis de voz (con timeout)
    console.log(`\n2️⃣  Sintetizando voz (timeout 60s)...`);

    const ttsPromise = synthesizeVoice(script, path.join(VIDEO_DIR, 'voice.mp3'));
    const ttsTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TTS TIMEOUT after 60s')), 60000)
    );

    const ttsResult = await Promise.race([ttsPromise, ttsTimeout]);
    console.log(`✅ TTS completado`);
    console.log(`   Audio path: ${ttsResult.audioPath}`);
    console.log(`   Duration: ${ttsResult.estimatedDuration}s`);
    console.log(`   Word boundaries: ${ttsResult.wordBoundaries?.length || 0}`);

    // 3. Render (con timeout)
    console.log(`\n3️⃣  Renderizando vídeo (timeout 120s)...`);

    const renderPromise = renderVideoWithRouter({
      script,
      audioPath: ttsResult.audioPath,
      audioDuration: ttsResult.estimatedDuration,
      outputPath: path.join(VIDEO_DIR, 'output.mp4'),
      themeId: 'default',
      wordBoundaries: ttsResult.wordBoundaries || [],
      sectionDurations: ttsResult.sectionDurations || [],
    });

    const renderTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('RENDER TIMEOUT after 120s')), 120000)
    );

    const renderResult = await Promise.race([renderPromise, renderTimeout]);
    console.log(`✅ RENDER COMPLETADO`);

    // 4. Verificar output.mp4
    console.log(`\n4️⃣  Verificando output.mp4...`);
    if (fs.existsSync(path.join(VIDEO_DIR, 'output.mp4'))) {
      const size = fs.statSync(path.join(VIDEO_DIR, 'output.mp4')).size;
      console.log(`✅ output.mp4 existe (${(size / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      console.log(`❌ output.mp4 NO EXISTE después de render`);
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🎉 RENDER MANUAL EXITOSO`);
    console.log(`Las funciones individuales funcionan correctamente`);
    console.log(`El problema está en video-processor.js`);

  } catch (err) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`❌ ERROR EN RENDER: ${err.message}`);
    console.log(`DONDE SE CUELGA: ${err.stack}`);

    if (err.message.includes('TIMEOUT')) {
      console.log(`\n🔍 DIAGNOSIS: Timeout detectado`);
      console.log(`   La función ${err.message.split(' ')[0]} está colgada indefinidamente`);
    }
  }

  process.exit(0);
}

testRender();
