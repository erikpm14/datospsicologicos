# Video Renderer

## Arquitectura final

`Generador_videos` usa un único sistema de generación y publicación.

Flujo real:

`generateBestScript`
-> `TTS`
-> `audio-postprocess`
-> `subtitle-styler`
-> `video-use`
-> `render-metadata.json`
-> `production-quality-checker`
-> `ready queue`
-> `publish scheduler`

## Cómo funciona video-use dentro del proyecto

- `video-use` vive en `integrations/video-use/`
- `integrations/video-use/index.js` es el entrypoint Node
- `integrations/video-use/cli.js` es el entrypoint CLI
- `backend/src/services/video-renderer.js` es el renderer real que ejecuta la edición
- `backend/src/services/render-engines/index.js` solo delega al motor `video_use`

No hay Python. No hay bridge externo. No hay segundo motor activo.

## Cómo se genera un vídeo

1. `video-processor.js` crea o recibe el script
2. `voice-synthesizer.js` genera la voz
3. `audio-postprocess.js` normaliza y recorta silencios
4. `subtitle-styler.js` genera subtítulos cortos
5. `video-renderer.js` compone clips, overlays, zooms y exporta `output.mp4`
6. `render-metadata.json` se escribe con contrato compatible
7. `production-quality-checker.js` valida
8. si pasa, queda `ready`
9. `publish-scheduler.service.js` lo publica en slot

## Contrato de salida

Siempre debe existir:

- `output.mp4`
- `render-metadata.json`

Metadata mínima esperada:

```json
{
  "renderMode": "video_use",
  "visibleVisuals": true,
  "hasSubtitles": true,
  "duration": 42.3,
  "segmentsUsed": 8,
  "overlayEvents": 4,
  "renderWarnings": []
}
```

## Validación

- `production-quality-checker.js` valida existencia, streams, duración y metadata
- si `visibleVisuals=false`, el render no es publicable
- si falta metadata crítica, no entra en publish

## Publicación

- `AUTO_PUBLISH_ENABLED=true` deja la publicación automática por slot
- `VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH=true` bloquea publicación para pruebas
- `npm run publish:now -- --dry-run` valida candidatos sin subirlos

## Comandos

Desde `backend/`:

```bash
npm run render:video-use:test
npm run publish:now -- --dry-run
```

## Diagnóstico

Mirar:

- `output/<videoId>/render-metadata.json`
- `output/<videoId>/qc.json`
- logs de `video-processor`
- logs de `PublishScheduler`

Si falla render:

- revisar `renderWarnings`
- revisar si faltan clips o subtítulos
- revisar que `output.mp4` exista y tenga duración válida
