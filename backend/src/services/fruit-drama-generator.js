/**
 * fruit-drama-generator.js
 *
 * Genera guiones de drama de frutas virales con Claude.
 * Formato: 2 personajes fruta con diÃ¡logos de infidelidad / celos / traiciÃ³n.
 * Estrategia documentada: 300M vistas en 15 dÃ­as (@ai.cinema021 "Fruit Love Island").
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');
const { parseModelJsonWithRecovery } = require('../utils/llm-json');
const { callAnthropicWithTimeout, createLlmMetrics, mergeLlmMetrics, markLlmHardFail, attachLlmMetrics } = require('../utils/llm-call');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function requestJsonRecovery(prompt, rawText, label, llmMetrics, maxTokens = 1200) {
  logger.warn(`${label}: requesting clean JSON recovery from model`);
  llmMetrics.llm_total_calls += 1;
  const recovery = await callAnthropicWithTimeout(client, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: `${prompt}\n\nTu respuesta anterior no era JSON valido. Devuelve SOLO JSON VALIDO. Sin markdown. Sin fences. Sin javascript. Sin texto explicativo. Sin texto antes ni despues. Una unica respuesta JSON parseable.\n\nRESPUESTA ANTERIOR:\n${String(rawText || '').slice(0, 12000)}`,
    }],
  }, { label: `${label}.recovery` });
  return recovery.content?.[0]?.text?.trim() || '';
}

const FRUIT_PAIRS = [
  { a: { name: 'Fresa',   voice: 'es-ES-ElviraNeural', pexels: 'strawberry close up' },
    b: { name: 'LimÃ³n',   voice: 'es-ES-AlvaroNeural', pexels: 'lemon close up'      } },
  { a: { name: 'Mango',   voice: 'es-MX-DaliaNeural',  pexels: 'mango close up'      },
    b: { name: 'Coco',    voice: 'es-MX-JorgeNeural',  pexels: 'coconut close up'    } },
  { a: { name: 'Cereza',  voice: 'es-ES-ElviraNeural', pexels: 'cherry close up'     },
    b: { name: 'Uva',     voice: 'es-AR-TomasNeural',  pexels: 'grape close up'      } },
  { a: { name: 'Naranja', voice: 'es-ES-ElviraNeural', pexels: 'orange fruit close'  },
    b: { name: 'Kiwi',    voice: 'es-ES-AlvaroNeural', pexels: 'kiwi fruit close up' } },
  { a: { name: 'MelocotÃ³n',voice:'es-ES-ElviraNeural', pexels: 'peach fruit close up'},
    b: { name: 'PlÃ¡tano', voice: 'es-AR-TomasNeural',  pexels: 'banana close up'     } },
];

const DRAMA_THEMES = [
  { id: 'cheating',       label: 'Infidelidad',   prompt: 'uno de los personajes fue infiel' },
  { id: 'jealousy',       label: 'Celos extremos', prompt: 'celos enfermizos que destruyen la relaciÃ³n' },
  { id: 'revenge',        label: 'Venganza',       prompt: 'el traicionado se venga de forma inesperada' },
  { id: 'toxic_ex',       label: 'Ex tÃ³xico',      prompt: 'el ex aparece queriendo retomar la relaciÃ³n' },
  { id: 'secret_child',   label: 'Hijo secreto',   prompt: 'aparece un hijo secreto que lo cambia todo' },
  { id: 'money_lies',     label: 'Mentiras de dinero', prompt: 'uno mintiÃ³ sobre el dinero y el otro lo descubre' },
];

async function generateFruitDrama(opts = {}) {
  const pair      = FRUIT_PAIRS[opts.pairIndex ?? Math.floor(Math.random() * FRUIT_PAIRS.length)];
  const theme     = DRAMA_THEMES.find(t => t.id === opts.themeId)
                 || DRAMA_THEMES[Math.floor(Math.random() * DRAMA_THEMES.length)];
  const episode   = opts.episode   || 1;
  const serTitle  = opts.seriesTitle || `${pair.a.name} y ${pair.b.name}: ${theme.label}`;
  const llmMetrics = createLlmMetrics();

  logger.info(`FruitDrama | ${pair.a.name} & ${pair.b.name} | Theme: ${theme.label} | Ep ${episode}`);

  const prompt = `Eres un guionista de dramas virales de TikTok. Escribe un corto dramÃ¡tico de 60 segundos protagonizado por frutas que tienen emociones humanas.

PERSONAJES:
- ${pair.a.name} (voz femenina): el personaje traicionado/afectado
- ${pair.b.name} (voz masculina): el culpable / que tiene que dar explicaciones

TEMA DEL EPISODIO: ${theme.prompt}
EPISODIO: ${episode} de la serie "${serTitle}"

REGLAS DRAMÃTICAS:
â€¢ 8-12 lÃ­neas de diÃ¡logo en total (alternando entre personajes)
â€¢ Cada lÃ­nea: mÃ¡x 12 palabras, muy directa, cargada de emociÃ³n
â€¢ ProgresiÃ³n: calma tensa â†’ confrontaciÃ³n â†’ revelaciÃ³n â†’ cliffhanger o giro inesperado
â€¢ Tono melodramÃ¡tico y absurdo a la vez
â€¢ El cliffhanger final DEBE dejar al espectador con ganas de parte 2

EMOCIONES DISPONIBLES:
neutral, surprised, angry, crying, laughing, suspicious, loving, disgusted, scared, confident

FORMATO JSON PURO:
{
  "seriesTitle": "${serTitle}",
  "episode": ${episode},
  "theme": "${theme.id}",
  "characterA": "${pair.a.name}",
  "characterB": "${pair.b.name}",
  "hook": "frase de gancho para el tÃ­tulo del vÃ­deo (max 8 palabras, en mayÃºsculas, sin emojis)",
  "scenes": [
    {
      "speaker": "${pair.a.name}",
      "line": "texto del diÃ¡logo",
      "emotion": "angry",
      "durationHint": 3
    }
  ],
  "cliffhanger": "frase de cierre que aparece en pantalla (max 10 palabras)",
  "nextEpisodeHook": "tÃ­tulo tentador del prÃ³ximo episodio"
}`;

  try {
    llmMetrics.llm_total_calls += 1;
    const message = await callAnthropicWithTimeout(client, {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages:   [{ role: 'user', content: prompt }],
    }, { label: 'fruit-drama-generator.generateFruitDrama' });

    const raw = message.content[0].text.trim();
    const { data: script, meta } = await parseModelJsonWithRecovery(raw, {
      label: 'fruit-drama-generator.generateFruitDrama',
      recover: (failedRaw) => requestJsonRecovery(prompt, failedRaw, 'fruit-drama-generator.generateFruitDrama', llmMetrics),
    });
    mergeLlmMetrics(llmMetrics, meta);

    script.pair = pair;
    script.theme = theme.id;
    script.isFruitDrama = true;
    attachLlmMetrics(script, llmMetrics);
    script.generationSource = 'generateFruitDrama';
    script.llmPath = ['generateFruitDrama'];

    logger.info(`FruitDrama OK | "${script.hook}" | ${script.scenes.length} escenas`);
    return script;
  } catch (err) {
    markLlmHardFail(llmMetrics, err);
    err.llmMetrics = { ...llmMetrics };
    throw err;
  }
}

module.exports = { generateFruitDrama, FRUIT_PAIRS, DRAMA_THEMES };
