/**
 * fruit-drama-generator.js
 *
 * Genera guiones de drama de frutas virales con Claude.
 * Formato: 2 personajes fruta con diálogos de infidelidad / celos / traición.
 * Estrategia documentada: 300M vistas en 15 días (@ai.cinema021 "Fruit Love Island").
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Pares de frutas con sus nombres y queries Pexels
const FRUIT_PAIRS = [
  { a: { name: 'Fresa',   voice: 'es-ES-ElviraNeural', pexels: 'strawberry close up' },
    b: { name: 'Limón',   voice: 'es-ES-AlvaroNeural', pexels: 'lemon close up'      } },
  { a: { name: 'Mango',   voice: 'es-MX-DaliaNeural',  pexels: 'mango close up'      },
    b: { name: 'Coco',    voice: 'es-MX-JorgeNeural',  pexels: 'coconut close up'    } },
  { a: { name: 'Cereza',  voice: 'es-ES-ElviraNeural', pexels: 'cherry close up'     },
    b: { name: 'Uva',     voice: 'es-AR-TomasNeural',  pexels: 'grape close up'      } },
  { a: { name: 'Naranja', voice: 'es-ES-ElviraNeural', pexels: 'orange fruit close'  },
    b: { name: 'Kiwi',    voice: 'es-ES-AlvaroNeural', pexels: 'kiwi fruit close up' } },
  { a: { name: 'Melocotón',voice:'es-ES-ElviraNeural', pexels: 'peach fruit close up'},
    b: { name: 'Plátano', voice: 'es-AR-TomasNeural',  pexels: 'banana close up'     } },
];

const DRAMA_THEMES = [
  { id: 'cheating',       label: 'Infidelidad',   prompt: 'uno de los personajes fue infiel' },
  { id: 'jealousy',       label: 'Celos extremos', prompt: 'celos enfermizos que destruyen la relación' },
  { id: 'revenge',        label: 'Venganza',       prompt: 'el traicionado se venga de forma inesperada' },
  { id: 'toxic_ex',       label: 'Ex tóxico',      prompt: 'el ex aparece queriendo retomar la relación' },
  { id: 'secret_child',   label: 'Hijo secreto',   prompt: 'aparece un hijo secreto que lo cambia todo' },
  { id: 'money_lies',     label: 'Mentiras de dinero', prompt: 'uno mintió sobre el dinero y el otro lo descubre' },
];

/**
 * Genera un guión de drama de frutas.
 * @param {{ pairIndex?: number, themeId?: string, episode?: number, seriesTitle?: string }} opts
 */
async function generateFruitDrama(opts = {}) {
  const pair      = FRUIT_PAIRS[opts.pairIndex ?? Math.floor(Math.random() * FRUIT_PAIRS.length)];
  const theme     = DRAMA_THEMES.find(t => t.id === opts.themeId)
                 || DRAMA_THEMES[Math.floor(Math.random() * DRAMA_THEMES.length)];
  const episode   = opts.episode   || 1;
  const serTitle  = opts.seriesTitle || `${pair.a.name} y ${pair.b.name}: ${theme.label}`;

  logger.info(`FruitDrama | ${pair.a.name} & ${pair.b.name} | Theme: ${theme.label} | Ep ${episode}`);

  const prompt = `Eres un guionista de dramas virales de TikTok. Escribe un corto dramático de 60 segundos protagonizado por frutas que tienen emociones humanas.

PERSONAJES:
- ${pair.a.name} (voz femenina): el personaje traicionado/afectado
- ${pair.b.name} (voz masculina): el culpable / que tiene que dar explicaciones

TEMA DEL EPISODIO: ${theme.prompt}
EPISODIO: ${episode} de la serie "${serTitle}"

REGLAS DRAMÁTICAS:
• 8-12 líneas de diálogo en total (alternando entre personajes)
• Cada línea: máx 12 palabras, muy directa, cargada de emoción
• Progresión: calma tensa → confrontación → revelación → cliffhanger o giro inesperado
• Tono melodramático y absurdo a la vez (la gracia es que son FRUTAS siendo dramáticas)
• El cliffhanger final DEBE dejar al espectador con ganas de parte 2
• Frases que generen reacción: shock, "¿qué acaba de pasar?", ganas de comentar

EMOCIONES DISPONIBLES (usa una por línea):
neutral, surprised, angry, crying, laughing, suspicious, loving, disgusted, scared, confident

FORMATO JSON PURO (sin markdown):
{
  "seriesTitle": "${serTitle}",
  "episode": ${episode},
  "theme": "${theme.id}",
  "characterA": "${pair.a.name}",
  "characterB": "${pair.b.name}",
  "hook": "frase de gancho para el título del vídeo (max 8 palabras, en mayúsculas, sin emojis)",
  "scenes": [
    {
      "speaker": "${pair.a.name}",
      "line": "texto del diálogo",
      "emotion": "angry",
      "durationHint": 3
    }
  ],
  "cliffhanger": "frase de cierre que aparece en pantalla (max 10 palabras)",
  "nextEpisodeHook": "título tentador del próximo episodio"
}`;

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1200,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw    = message.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const script = JSON.parse(raw);

  // Adjuntar info técnica de voces e imágenes
  script.pair     = pair;
  script.theme    = theme.id;
  script.isFruitDrama = true;

  logger.info(`FruitDrama OK | "${script.hook}" | ${script.scenes.length} escenas`);
  return script;
}

module.exports = { generateFruitDrama, FRUIT_PAIRS, DRAMA_THEMES };
