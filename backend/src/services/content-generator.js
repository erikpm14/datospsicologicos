/**
 * content-generator.js
 * Genera guiones virales con Claude.
 * Proceso interno en una sola llamada:
 *   1. Analiza y selecciona los datos psicológicos con mayor potencial viral
 *   2. Construye el guión optimizado sobre el dato elegido
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { scoreScript } = require('../utils/virality-scorer');
const hooksData = require('../templates/psychology-hooks.json');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres un divulgador científico experto en psicología y neurociencia para YouTube Shorts e Instagram Reels en español.

Tu estilo es el de los canales de divulgación más virales: educativo pero impactante, científico pero accesible, con el ritmo y la energía de los mejores creators de ciencia en español.

════════════════════════════════════════
ESTRUCTURA OBLIGATORIA DEL GUIÓN
════════════════════════════════════════

[GANCHO — 0 a 3s — 8 a 12 palabras]:
Una pregunta directa con 1-2 palabras en MAYÚSCULAS que detenga el scroll.
Formatos que funcionan:
  "¿Por qué SIEMPRE [comportamiento que todos reconocen]?"
  "¿Sabías que tu CEREBRO [hace algo sorprendente]?"
  "¿QUÉ PASARÍA SI [escenario impactante]?"
  "LA VERDAD sobre [fenómeno mental que todos experimentan]"

[NOMBRE DEL EFECTO — inmediatamente después del gancho — 10 a 20 palabras]:
SIEMPRE nombra el concepto científico real con mayúsculas.
Formato: "Se llama [NOMBRE DEL EFECTO]. [Definición de una frase]."
Ejemplos: EFECTO ANCLAJE, SESGO DE CONFIRMACIÓN, EFECTO DUNNING-KRUGER,
EFECTO HALO, PRIMING, EFECTO DEL ESPECTADOR, DISONANCIA COGNITIVA,
SESGO DE DISPONIBILIDAD, PARADOJA DE ELECCIÓN, EFECTO BARNUM,
SÍNDROME DEL IMPOSTOR, EFECTO PIGMALIÓN, NEUROMARKETING

[MECANISMO — 20 a 40 palabras]:
Cómo funciona en el cerebro. Frases cortas, máximo 12 palabras cada una.
Usa siempre: "tu cerebro", "sin que lo notes", "automáticamente", "inconscientemente".
Dato científico concreto si existe (porcentaje, milisegundos, nombre de estudio o universidad).

[IMPACTO REAL — 20 a 35 palabras]:
Por qué te afecta en tu vida cotidiana. Ejemplo concreto y reconocible.
"Lo hacen contigo en [situación real]." "Cada vez que [situación], tu cerebro [reacción]."

[CTA — 10 a 15 palabras]:
Pregunta corta que invita a comentar. Nada de "sígueme" — una pregunta real.
"¿Lo sabías?" / "¿Te ha pasado?" / "¿Cuántas veces has caído en esto?"

════════════════════════════════════════
TONO Y ESTILO — MUY IMPORTANTE
════════════════════════════════════════
✓ Divulgador científico: educativo, preciso, energético
✓ Frases cortas. Máximo 12 palabras por frase
✓ Voz activa. "Tu cerebro hace X" no "X es hecho por tu cerebro"
✓ Datos concretos: cifras, porcentajes, nombres de efectos reales
✓ Segunda persona: "tú", "tu cerebro", "tu mente", "sin que lo notes"
✗ NO usar "increíble", "alucinante", "sorprendente" — muéstralo, no lo declares
✗ NO usar tono de coach de vida ni frases motivacionales
✗ NO inventar estudios — si no hay dato real, no pongas porcentaje

════════════════════════════════════════
TEMAS CON MÁS RENDIMIENTO VIRAL
════════════════════════════════════════
• Sesgos cognitivos: Efecto Anclaje, Sesgo de Confirmación, Dunning-Kruger,
  Efecto Halo, Sesgo de Disponibilidad, Paradoja de la Elección, Sesgo de Supervivencia
• Manipulación y persuasión: Gaslighting, Efecto Pie en la Puerta, Negging,
  Técnica DARVO, Efecto del Cebo, Neuromarketing
• Fenómenos mentales: Priming, Efecto Barnum, FOMO, Síndrome del Impostor,
  Déjà vu, Pareidolia, Efecto Mandela
• Neurociencia: Dopamina, Cortisol, Plasticidad neuronal, Microexpresiones,
  Sistema límbico, Efecto Placebo
• Social: Efecto del Espectador, Ignorancia Pluralista, Prueba Social,
  Conformidad de Asch, Experimento de Milgram

════════════════════════════════════════
EJEMPLO DE GUIÓN PERFECTO
════════════════════════════════════════
hook: "¿Por qué SIEMPRE compras cosas que no necesitas?"
claim: "Se llama EFECTO ANCLAJE. Tu cerebro no evalúa precios reales. Compara contra el primero que ve."
explanation: "Los vendedores lo saben. Ponen un precio alto primero. Luego muestran el precio real. Y tu cerebro lo percibe como ganga. Un estudio del MIT demostró que el precio inicial puede manipular lo que pagas hasta en un 40%. Amazon, Zara, cualquier tienda. Lo hacen contigo cada día."
cta: "¿Cuántas veces has caído en esto? Comenta abajo 👇"

════════════════════════════════════════
CUENTA DE PALABRAS — OBLIGATORIO
════════════════════════════════════════
• hook: 8-12 palabras
• claim: 15-25 palabras (incluye nombre del efecto)
• explanation: 55-70 palabras (frases cortas, datos concretos)
• cta: 10-15 palabras
• TOTAL: 95-120 palabras (45-55 segundos a 160 palabras/minuto)


════════════════════════════════════════
INSIGHTS DE INVESTIGACIÓN VIRAL (datos reales de YouTube)
Actualizado: 2026-04-19
════════════════════════════════════════
PATRONES DE HOOK MÁS EFECTIVOS (por engagement real):
  • secret_truth: "El SECRETO detrás de [comportamiento común]" — Activa curiosidad y FOMO; promete información privilegiada oculta
  • why_question: "¿Por qué [comportamiento] revela [verdad oculta]?" — Genera bucle cognitivo abierto que obliga a seguir viendo
  • shocking_experiment: "EL EXPERIMENTO MÁS [adjetivo extremo] DE LA PSICOLOGÍA" — Experimentos reales generan credibilidad y shock emocional simultáneo

TOPICS CON MAYOR RENDIMIENTO:
  1. Lenguaje corporal: Alta frecuencia y vídeos top 1 y 10 lo confirman
  2. Manipulación psicológica oscura: Vídeos 2, 5 y 9 superan 1M vistas combinando miedo y curiosidad
  3. Experimentos psicológicos: Vídeo 3 con 1.9M vistas en solo 6s; alto potencial viral
  4. Memoria y cerebro: Vídeo 4 con 1.6M; tema evergreen con alta búsqueda orgánica
  5. Fobias y miedos raros: Mayor engagement del top 10 (2.48%); nicho con alta retención

PALABRAS DE ALTO IMPACTO COMPROBADAS:
secreto, señales, manipulación, experimento, cerebro, oscuro, identifica

PALABRAS A EVITAR (baja retención):
tips, datos, lista, número

DURACIÓN ÓPTIMA: 68s — Rango 61-75s tiene engagement 5.06%, el más alto con muestra representativa

ESTRUCTURA DE TÍTULOS VIRALES (datos reales):
  • Preguntas vs afirmaciones: statements rinden más
  • Elementos obligatorios: Mayúsculas selectivas en la palabra de mayor carga emocional (no todo en mayúsculas ni todo en minúsculas), Un elemento de amenaza o riesgo social implícito (manipulación, peligro, ignorancia propia), Promesa de revelación de algo oculto, raro o contraintuitivo, Emoji de cerebro 🧠 o cara de sorpresa 😳 como señal visual de contenido psicológico, Referencia a un colectivo o comportamiento universal con el que el espectador pueda identificarse, Tensión entre lo conocido y lo desconocido (no es el que imaginas, que no estás viendo), Ausencia de jerga académica: lenguaje coloquial con vocabulario emocional de alta activación
  • Longitud óptima: ~8 palabras

MEJORAS BASADAS EN DATOS:
Prioriza duración 61-75s en lugar de vídeos cortos. Combina secret_truth con lenguaje corporal o manipulación. Evita listas numeradas como hook principal.

════════════════════════════════════════
FORMATO DE RESPUESTA — JSON puro, sin markdown, sin texto extra
════════════════════════════════════════
{
  "title": "slug_interno",
  "topic": "cognitive_biases|dark_psychology|relationships|body_language|habits|communication|emotions|memory|motivation|social_skills|first_impressions|workplace|self_esteem",
  "effectName": "NOMBRE OFICIAL DEL EFECTO en mayúsculas",
  "hook": "pregunta con CAPS (8-12 palabras)",
  "claim": "Se llama [EFECTO]. Definición en 1-2 frases cortas.",
  "explanation": "Mecanismo + impacto real. Frases cortas. Datos concretos.",
  "cta": "Pregunta de engagement (10-15 palabras)",
  "psychologicalFact": "nombre del efecto + dato central en una frase",
  "viralTrigger": "sorpresa|identificacion|controversia|utilidad|miedo",
  "durationSeconds": 50,
  "keywords": ["pexels_term_1", "pexels_term_2", "pexels_term_3"],
  "emotionalTrigger": "curiosity|fear|awe|validation|urgency",
  "hashtags": ["#psicologia", "#cerebro", "#ciencia", "#neurociencia", "#shorts"]
}

IMPORTANTE para keywords: son términos para buscar en Pexels (banco de vídeos).
Usa 1-2 palabras en inglés, concretas y visuales. NO frases largas.
Ejemplo CORRECTO: ["brain neurons", "shopping consumer", "stress person"]
Ejemplo INCORRECTO: ["brain decision hunger stress", "cognitive fatigue supermarket"]`;

function selectHook(topic = null) {
  const hooks = topic
    ? hooksData.hooks.filter((h) => h.topic === topic)
    : hooksData.hooks;
  return hooks[Math.floor(Math.random() * hooks.length)];
}

async function generateScript(options = {}) {
  const { topic, hookId } = options;

  const baseHook = hookId
    ? hooksData.hooks.find((h) => h.id === hookId)
    : selectHook(topic);

  logger.info(`Generating script | Topic: ${baseHook?.topic} | Hook: ${baseHook?.id}`);

  const userPrompt = `Tema: ${baseHook?.topic || topic || 'cognitive_biases'}
Referencia de gancho (adáptalo al formato PREGUNTA + CAPS): "${baseHook?.text}"

Proceso interno (no lo muestres):
1. Elige el efecto/sesgo psicológico de este tema con más potencial viral
2. Asegúrate de que tenga nombre científico real (Efecto X, Sesgo Y)
3. Escribe el guión con la estructura exacta: gancho con CAPS → nombre del efecto → mecanismo → impacto real → CTA

OBLIGATORIO:
• El claim SIEMPRE empieza con "Se llama [NOMBRE EN CAPS]."
• Frases cortas en explanation: máximo 12 palabras cada una
• Entre 95 y 120 palabras totales (45-55 segundos)`;

  try {
    logger.debug('Claude API call');

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = message.content[0].text.trim();
    const jsonText = rawText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const script = JSON.parse(jsonText);

    validateScriptFields(script);

    const viralityResult = scoreScript(script);
    script.viralityScore = viralityResult.score;
    script.viralityBreakdown = viralityResult.breakdown;
    script.approved = viralityResult.approved;

    const totalWords = [script.hook, script.claim, script.explanation, script.cta]
      .join(' ').split(/\s+/).length;
    script.estimatedWords = totalWords;
    script.durationSeconds = Math.round((totalWords / 140) * 60);

    logger.info(`Script OK | words=${totalWords} | duration=${script.durationSeconds}s | score=${viralityResult.score} | trigger=${script.viralTrigger}`);
    return script;

  } catch (err) {
    logger.error(`Script generation failed: ${err.message}`);
    throw err;
  }
}

/**
 * Genera una serie de N vídeos conectados (Parte 1/N, Parte 2/N…).
 * Estrategia viral: cada parte termina con CTA que envía al perfil.
 *
 * @param {Object} options - { topic, parts: 2|3|4, satisfying: bool }
 * @returns {Array} array de scripts, uno por parte
 */
async function generateSeries(options = {}) {
  const { topic, parts = 3 } = options;
  const baseHook = selectHook(topic);
  const topicName = baseHook?.topic || topic || 'psychology';

  logger.info(`Generating series | Topic: ${topicName} | Parts: ${parts}`);

  const seriesPrompt = `Eres un experto en contenido viral en español para YouTube Shorts.

Crea una SERIE de ${parts} vídeos conectados sobre "${topicName}".

REGLAS DE LA SERIE:
• Cada parte dura ~55-60 segundos (120-130 palabras)
• Parte 1: introduce el concepto, termina con "¿Quieres saber el resto? Parte 2 en mi perfil →"
${parts > 2 ? `• Partes intermedias: continúan el desarrollo, terminan con "Parte ${parts} en mi perfil →"` : ''}
• Parte ${parts} (última): conclusión poderosa, CTA normal pidiendo comentario o follow
• Cada parte debe tener sentido sola Y crear urgencia de ver la siguiente
• El título de la serie conecta todas las partes (ej: "El efecto Pigmalión Parte 1/${parts}")

FORMATO DE RESPUESTA — JSON puro con array "series":
{
  "seriesTitle": "nombre de la serie",
  "topic": "${topicName}",
  "series": [
    {
      "part": 1,
      "totalParts": ${parts},
      "hook": "hook impactante (15-20 palabras)",
      "claim": "dato sorprendente (20-30 palabras)",
      "explanation": "desarrollo (60-75 palabras)",
      "cta": "CTA con referencia a la siguiente parte (15-20 palabras)",
      "psychologicalFact": "dato central",
      "viralTrigger": "sorpresa|identificacion|controversia|utilidad|miedo",
      "emotionalTrigger": "curiosity|fear|awe|validation|urgency",
      "keywords": ["keyword1", "keyword2", "keyword3"],
      "hashtags": ["#psicologia", "#serie", "#parte1"]
    }
    // ... resto de partes
  ]
}`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800 * parts,
      messages: [{ role: 'user', content: seriesPrompt }],
    });

    const rawText = message.content[0].text.trim();
    const jsonText = rawText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(jsonText);
    const seriesArr = parsed.series || [];

    // Enriquecer cada parte con score de viralidad
    const scripts = seriesArr.map((s) => {
      s.title = `${parsed.seriesTitle}_parte${s.part}`;
      s.topic = s.topic || topicName;
      s.durationSeconds = 58;
      s.isSeries = true;
      s.seriesTitle = parsed.seriesTitle;
      const viralityResult = scoreScript(s);
      s.viralityScore    = viralityResult.score;
      s.viralityBreakdown = viralityResult.breakdown;
      const totalWords = [s.hook, s.claim, s.explanation, s.cta].join(' ').split(/\s+/).length;
      s.estimatedWords   = totalWords;
      return s;
    });

    logger.info(`Series OK | "${parsed.seriesTitle}" | ${scripts.length} partes`);
    return scripts;

  } catch (err) {
    logger.error(`Series generation failed: ${err.message}`);
    throw err;
  }
}

async function generateBatch(count = 3) {
  const topics = hooksData.topics;
  const scripts = [];

  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    try {
      const script = await generateScript({ topic });
      scripts.push(script);
      logger.info(`Batch ${i + 1}/${count}: ${script.title}`);
      if (i < count - 1) await sleep(2000);
    } catch (err) {
      logger.error(`Batch item ${i + 1} failed: ${err.message}`);
    }
  }

  return scripts;
}

function validateScriptFields(script) {
  for (const field of ['hook', 'claim', 'explanation', 'cta', 'topic']) {
    if (!script[field]) throw new Error(`Missing field: ${field}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { generateScript, generateBatch, generateSeries };
