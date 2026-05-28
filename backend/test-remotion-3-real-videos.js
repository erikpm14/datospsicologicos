const path = require('path');
const fs = require('fs');

// Force load .env
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { renderVideoWithRouter } = require('./src/services/render-engines');
const { execSync } = require('child_process');

const MAIN_OUTPUT_DIR = path.join(__dirname, 'output', 'test-remotion-3-videos');
if (!fs.existsSync(MAIN_OUTPUT_DIR)) fs.mkdirSync(MAIN_OUTPUT_DIR, { recursive: true });

// 3 Real scripts for different themes
const VIDEOS = [
  {
    id: 'ia-tools',
    name: 'IA Práctica',
    dir: 'video-1-ia-tools',
    script: {
      id: 'video-ia-tools-001',
      topic: 'Herramientas de IA',
      hook: 'Hay 3 herramientas de IA que ahorran tiempo real a profesionales.',
      claim: 'No estoy hablando de ChatGPT. Estoy hablando de herramientas específicas para tareas concretas.',
      explanation: 'Midjourney para imágenes en 30 segundos. Cursor para código que se escribe solo. Synthesia para vídeos sin salir del escritorio.',
      cta: 'Si trabajas con datos o creatividad, una de estas tres va a cambiar tu flujo de trabajo este año.',
      open_loop: 'La mayoría de profesionales sigue haciendo tareas manualmente que una IA podría automatizar.',
      micro_value: 'Cada hora que ahorras con IA, es una hora que recuperas para pensar en estrategia.',
      escalation: 'La diferencia entre competencia normal y competencia de élite, es la IA.',
      reengage: 'No necesitas entender cómo funciona internamente. Solo necesitas saber qué hace.',
      peak: 'Eso es el poder de estas herramientas: baja barrera de entrada, altísimo retorno.',
      open_ending: 'Pero tienes que probar. Tienes que experimentar.',
      soft_cta: 'Elige una de estas tres y dedica 15 minutos hoy. El resultado te sorprenderá.',
    }
  },
  {
    id: 'automation',
    name: 'Automatización',
    dir: 'video-2-automation',
    script: {
      id: 'video-automation-001',
      topic: 'Automatización sin código',
      hook: 'Automatizar tareas repetitivas es lo primero que debe hacer cualquier freelancer.',
      claim: 'No es un lujo. Es una necesidad de supervivencia económica.',
      explanation: 'Zapier conecta tus herramientas. Make automatiza flujos complejos. Airtable es tu base de datos. Con estas tres, eliminas 10 horas de trabajo manual a la semana.',
      cta: 'La pregunta no es si deberías automatizar. La pregunta es cuánto dinero pierdes cada mes sin hacerlo.',
      open_loop: 'Cada tarea que repites más de 2 veces, debería estar automatizada.',
      micro_value: 'Una automatización simple te ahorra 5 horas al mes. Eso son 60 horas al año.',
      escalation: 'Si no automatizas, estás compitiendo con alguien que sí lo hace. Y pierdes.',
      reengage: 'Automatizar no es difícil. Solo necesita 30 minutos de setup.',
      peak: 'Una vez que automatizas, esas 60 horas anuales son tuyas. Puedes facturar más clientes.',
      open_ending: 'Pero primero tienes que identificar qué automatizar.',
      soft_cta: 'Escribe hoy 3 tareas que repites. Mañana automatiza una. Verás el impacto inmediato.',
    }
  },
  {
    id: 'culture-code',
    name: 'Cultura Digital',
    dir: 'video-3-culture-code',
    script: {
      id: 'video-culture-code-001',
      topic: 'Vídeos con código',
      hook: 'Cada vez más vídeos en internet se hacen con código en lugar de cámara.',
      claim: 'Esto no es un detalle técnico. Es un cambio de poder en la industria creativa.',
      explanation: 'Con Remotion, generas vídeos programáticamente. Puedes hacer 1000 variantes en segundos. No necesitas cámara, no necesitas talento. Necesitas lógica.',
      cta: 'Si creas contenido, aprender a programar vídeos es como aprender a programar html hace 20 años.',
      open_loop: 'La mayoría de creadores sigue editando a mano. Pixel a pixel.',
      micro_value: 'Un script de Remotion genera 100 vídeos. Un editor manual hace 1.',
      escalation: 'La escala es el futuro. Los creadores que escalan ganan. Los que no, compiten por migajas.',
      reengage: 'No necesitas ser programador. Necesitas entender la lógica básica.',
      peak: 'Con código, puedes iterar en minutos. Con cámara, en días.',
      open_ending: 'Eso es poder. Puro poder.',
      soft_cta: 'Si no sabes programar, aprende. Si sabes, usa Remotion. El futuro es vídeo generado.',
    }
  }
];

async function generateBatch() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('REMOTION 3 REAL VIDEOS TEST');
  console.log('════════════════════════════════════════════════════════════\n');

  const results = [];
  const startTime = Date.now();

  for (const video of VIDEOS) {
    try {
      console.log(`\n📹 VIDEO ${video.id.toUpperCase()} — ${video.name}`);
      console.log('─'.repeat(60));

      const outputDir = path.join(MAIN_OUTPUT_DIR, video.dir);
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      // TTS
      console.log('→ TTS synthesis...');
      const ttsStart = Date.now();
      const ttsResult = await synthesizeVoice(video.script, path.join(outputDir, 'voice.mp3'));
      const ttsDuration = (Date.now() - ttsStart) / 1000;
      const audioPath = ttsResult.audioPath;
      const audioDuration = ttsResult.estimatedDuration;

      console.log(`   ✅ ${audioDuration.toFixed(2)}s @ ${ttsDuration.toFixed(1)}s`);

      // Captions
      console.log('→ Building captions...');
      const captions = buildCaptionsFromScriptSections(video.script, audioDuration);
      console.log(`   ✅ ${captions.length} captions`);

      // Render
      console.log('→ Rendering with Remotion...');
      const renderStart = Date.now();
      const videoPath = path.join(outputDir, 'output.mp4');

      await renderVideoWithRouter({
        script: video.script,
        audioPath,
        audioDuration: Math.ceil(audioDuration),
        outputPath: videoPath,
        themeId: 'theme_modern',
        wordBoundaries: [],
        sectionDurations: {},
        bgStyle: 'single_focus_pexels',
        captions,
      });

      const renderDuration = (Date.now() - renderStart) / 1000;
      console.log(`   ✅ ${renderDuration.toFixed(1)}s`);

      // Save metadata
      fs.writeFileSync(
        path.join(outputDir, 'script.json'),
        JSON.stringify(video.script, null, 2)
      );

      // Validate output
      const stats = fs.statSync(videoPath);
      const sizeMs = stats.size / 1024 / 1024;

      console.log(`→ Output: ${sizeMs.toFixed(2)}MB`);

      // Extract frames
      console.log('→ Extracting frames...');
      const framesDir = path.join(outputDir, 'frames');
      if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

      const frameTimes = [0.5, 3, 8, 15, 25, Math.max(0, audioDuration - 1)];
      for (const time of frameTimes) {
        try {
          execSync(
            `ffmpeg -ss ${time} -i "${videoPath.replace(/\\/g, '/')}" -vframes 1 -q:v 2 -update 1 "${path.join(framesDir, `frame_${time}s.png`).replace(/\\/g, '/')}" 2>/dev/null`,
            { stdio: 'pipe' }
          );
        } catch (e) {
          // ignore
        }
      }

      const frameCount = fs.readdirSync(framesDir).length;
      console.log(`   ✅ ${frameCount} frames`);

      results.push({
        id: video.id,
        name: video.name,
        status: 'PASS',
        audioDuration: audioDuration.toFixed(2),
        captionsCount: captions.length,
        sizeMs: sizeMs.toFixed(2),
        ttsDuration: ttsDuration.toFixed(1),
        renderDuration: renderDuration.toFixed(1),
        frameCount,
        outputDir,
      });

    } catch (error) {
      console.error(`❌ ERROR: ${error.message}`);
      results.push({
        id: video.id,
        name: video.name,
        status: 'FAIL',
        error: error.message,
      });
    }
  }

  const totalDuration = (Date.now() - startTime) / 1000;

  // Summary
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('════════════════════════════════════════════════════════════\n');

  results.forEach(r => {
    if (r.status === 'PASS') {
      console.log(`${r.id.padEnd(15)} ${r.status} | ${r.audioDuration}s | ${r.captionsCount} captions | ${r.sizeMs}MB | ${r.renderDuration}s render`);
    } else {
      console.log(`${r.id.padEnd(15)} ${r.status} | ${r.error}`);
    }
  });

  console.log(`\nTotal time: ${totalDuration.toFixed(1)}s`);
  console.log(`\nOutputs: ${MAIN_OUTPUT_DIR}\n`);

  // Save results
  fs.writeFileSync(
    path.join(MAIN_OUTPUT_DIR, 'batch-results.json'),
    JSON.stringify(results, null, 2)
  );
}

function buildCaptionsFromScriptSections(script, totalDuration) {
  const sections = [
    { key: 'hook', text: script.hook, duration: 0.12 },
    { key: 'claim', text: script.claim, duration: 0.15 },
    { key: 'explanation', text: script.explanation, duration: 0.25 },
    { key: 'open_ending', text: script.open_ending, duration: 0.15 },
    { key: 'soft_cta', text: script.soft_cta, duration: 0.33 },
  ];

  const captions = [];
  let currentTime = 0;

  for (const section of sections) {
    if (!section.text) continue;

    const sectionDuration = totalDuration * section.duration;
    const sentences = section.text.split(/(?<=[.!?])\s+/).filter(Boolean);

    if (sentences.length === 0) continue;

    const timePerSentence = sectionDuration / sentences.length;

    for (const sentence of sentences) {
      const endTime = Math.min(currentTime + timePerSentence, totalDuration);
      const words = sentence.trim().split(/\s+/).filter(Boolean);
      const chunkSize = Math.max(3, Math.ceil(words.length / 2));

      for (let i = 0; i < words.length; i += chunkSize) {
        const chunk = words.slice(i, i + chunkSize).join(' ');
        const chunkStart = currentTime + (i / words.length) * timePerSentence;
        const chunkEnd = Math.min(chunkStart + (chunkSize / words.length) * timePerSentence, endTime);

        if (chunk.trim()) {
          captions.push({
            text: chunk.trim(),
            start: Math.max(0, chunkStart),
            end: Math.min(totalDuration, Math.max(chunkStart + 0.1, chunkEnd)),
            section: section.key,
            emphasis: [],
          });
        }
      }

      currentTime = endTime;
    }
  }

  return captions;
}

generateBatch().catch(err => {
  console.error(`❌ BATCH FAILED: ${err.message}`);
  process.exit(1);
});
