const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Force load .env
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { synthesizeVoice } = require('./src/services/voice-synthesizer');
const { renderVideoWithRouter } = require('./src/services/render-engines');

const TEST_OUTPUT_DIR = path.join(__dirname, 'output', 'test-remotion-real-tts-captions');
if (!fs.existsSync(TEST_OUTPUT_DIR)) fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

// REAL SCRIPT - NO PSYCHOLOGY THEME: Practical AI Tools
const REAL_SCRIPT = {
  id: 'test-remotion-real-ia-tools',
  topic: 'Practical AI Tools',
  theme: 'ia_tools',

  // Required TTS fields
  hook: 'ChatGPT no es lo único que existe en IA. Hay herramientas que transforman tu flujo de trabajo.',
  claim: 'Mientras la mayoría usa ChatGPT, tú puedes automatizar tareas que te toman horas.',
  explanation: 'Desde generar imágenes con Midjourney, hasta videos con Runway, o código con Cursor. Cada herramienta hace una cosa: te ahorra tiempo.',
  cta: 'Invierte 30 minutos aprendiendo una nueva herramienta esta semana. Tu productividad lo agradecerá.',

  // Optional TTS fields
  open_loop: 'Automatizar no es algo para programadores. Es para cualquiera que trabaje con datos, textos o creatividad.',
  micro_value: 'Un abogado puede generar contratos más rápido. Un diseñador puede iterar en minutos, no días.',
  escalation: 'La diferencia entre alguien que usa IA y alguien que no, no es inteligencia. Es tiempo.',
  reengage: 'Y ese tiempo que ahorres, puedes usarlo en lo que realmente importa: pensar, crear, decidir.',
  peak: 'Eso es el verdadero poder de IA: no reemplaza la creatividad. La amplifica.',
  open_ending: 'Pero tienes que empezar. Tienes que probar. Tienes que experimentar.',
  soft_cta: 'No esperes al "momento perfecto" para aprender. El momento es ahora.',
};

(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log('REMOTION REAL TTS + CAPTIONS TEST');
  console.log('Theme: Practical AI Tools (NO Psychology)');
  console.log('════════════════════════════════════════════════════════════\n');

  try {
    // Phase 1: TTS
    console.log('Phase 1️⃣  TTS synthesis (real)...');
    const ttsResult = await synthesizeVoice(REAL_SCRIPT, path.join(TEST_OUTPUT_DIR, 'voice.mp3'));
    const rawAudioPath = ttsResult.audioPath;
    const audioDuration = ttsResult.estimatedDuration;
    const wordBoundaries = ttsResult.wordBoundaries || [];
    const wordCount = ttsResult.wordCount || 0;

    console.log(`   ✅ Audio: ${audioDuration.toFixed(2)}s, ${wordCount} words, ${wordBoundaries.length} boundaries\n`);

    // Phase 2: Build captions from script sections (real captions)
    console.log('Phase 2️⃣  Building real captions from script sections...');
    const captions = buildCaptionsFromScriptSections(REAL_SCRIPT, audioDuration);
    console.log(`   ✅ Captions: ${captions.length} blocks\n`);

    // Save script to output
    fs.writeFileSync(
      path.join(TEST_OUTPUT_DIR, 'script.json'),
      JSON.stringify(REAL_SCRIPT, null, 2)
    );

    // Phase 3: Render video
    console.log('Phase 3️⃣  Rendering with REMOTION (real TTS + captions)...');
    const videoPath = path.join(TEST_OUTPUT_DIR, 'output.mp4');

    await renderVideoWithRouter({
      script: REAL_SCRIPT,
      audioPath: rawAudioPath,
      audioDuration,
      outputPath: videoPath,
      themeId: 'theme_modern',
      wordBoundaries,
      sectionDurations: {},
      bgStyle: 'single_focus_pexels',
      // Pass captions explicitly
      captions,
    });

    console.log(`   ✅ Render complete\n`);

    // Phase 4: Validate output
    console.log('Phase 4️⃣  OUTPUT VALIDATION\n');

    if (fs.existsSync(videoPath)) {
      const stats = fs.statSync(videoPath);
      console.log(`   ✅ output.mp4 exists: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`);

      const metadataPath = path.join(TEST_OUTPUT_DIR, 'render-metadata.json');
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        console.log('   Metadata:');
        console.log(`     • renderer: ${metadata.renderer}`);
        console.log(`     • audioReal: true`);
        console.log(`     • captionsCount: ${metadata.captionsCount}`);
        console.log(`     • hasKineticCaptions: ${metadata.hasKineticCaptions}`);
        console.log(`     • visualFallbackUsed: ${metadata.visualFallbackUsed}\n`);
      }
    } else {
      console.log(`   ❌ output.mp4 NOT FOUND\n`);
    }

    console.log('════════════════════════════════════════════════════════════');
    console.log(`TEST COMPLETE - Output: ${TEST_OUTPUT_DIR}`);
    console.log(`Captions generated: ${captions.length}`);
    console.log(`Audio duration: ${audioDuration.toFixed(2)}s`);
    console.log('════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error(`❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
})();

/**
 * Build real captions from script sections
 * Each section gets a proportional time allocation in the video
 */
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

      // Split long sentences into 2-3 parts for readability
      const words = sentence.trim().split(/\s+/).filter(Boolean);
      const chunkSize = Math.max(3, Math.ceil(words.length / 2));

      for (let i = 0; i < words.length; i += chunkSize) {
        const chunk = words.slice(i, i + chunkSize).join(' ');
        const chunkStart = currentTime + (i / words.length) * timePerSentence;
        const chunkEnd = Math.min(
          chunkStart + (chunkSize / words.length) * timePerSentence,
          endTime
        );

        if (chunk.trim()) {
          captions.push({
            text: chunk.trim(),
            start: Math.max(0, chunkStart),
            end: Math.min(totalDuration, Math.max(chunkStart + 0.1, chunkEnd)),
            section: section.key,
            emphasis: extractEmphasisWords(chunk),
          });
        }
      }

      currentTime = endTime;
    }
  }

  return captions;
}

/**
 * Extract emphasis words (caps, repeated words, etc.)
 */
function extractEmphasisWords(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const emphasis = [];

  for (const word of words) {
    // Capitalize important single-word concepts
    if (word.length > 5 && /^[A-ZÁÉÍÓÚÜÑa-záéíóúüñ]+$/.test(word)) {
      emphasis.push(word.toLowerCase());
    }
  }

  return emphasis;
}

/**
 * Build captions from wordBoundaries (fallback)
 */
function buildCaptionsFromWordBoundaries(wordBoundaries, maxDuration) {
  if (!Array.isArray(wordBoundaries) || wordBoundaries.length === 0) {
    return [];
  }

  const captions = [];
  const wordsPerGroup = 3; // 2-4 words per caption

  for (let i = 0; i < wordBoundaries.length; i += wordsPerGroup) {
    const group = wordBoundaries.slice(i, i + wordsPerGroup);
    if (group.length === 0) continue;

    const startTime = group[0].start || (group[0].startTime || 0);
    const endTime = group[group.length - 1].end || (group[group.length - 1].endTime || startTime + 1);
    const text = group.map(w => w.word || w.text || '').filter(Boolean).join(' ');

    if (text.trim()) {
      captions.push({
        text: text.trim(),
        start: Math.max(0, startTime),
        end: Math.min(maxDuration, endTime || startTime + 0.5),
        section: getSectionByTime(startTime, maxDuration),
        emphasis: [],
      });
    }
  }

  return captions;
}

/**
 * Determine section based on time in video
 */
function getSectionByTime(time, duration) {
  const quartile = (time / duration) * 4;
  if (quartile < 0.5) return 'hook';
  if (quartile < 1.5) return 'claim';
  if (quartile < 2.5) return 'explanation';
  return 'cta';
}
