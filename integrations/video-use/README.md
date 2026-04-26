# video-use

`video-use` es el motor de edición/render integrado dentro de `Generador_videos`.

## Qué es

- Motor nativo en Node
- Usa el renderer principal del proyecto
- Mantiene contrato compatible con QC y publish
- No usa Python
- No usa bridges externos

## Entry points

- módulo: `integrations/video-use/index.js`
- CLI: `integrations/video-use/cli.js`
- skill: `integrations/video-use/skills/viral-psychology-short/SKILL.md`

## Uso desde Node

```js
const { renderWithVideoUse } = require('../../integrations/video-use');
await renderWithVideoUse({ script, audioPath, audioDuration, outputPath, themeId });
```

## Salida

Siempre debe producir:

- `output.mp4`
- `render-metadata.json`

Con `renderMode: "video_use"` y metadata compatible con `production-quality-checker`.
