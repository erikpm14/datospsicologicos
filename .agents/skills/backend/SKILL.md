# Skill: Backend

## Stack
Node.js 20, Express 4, CommonJS, PM2, FFmpeg, Kokoro TTS, Edge TTS, Codex API

## Archivos clave
| Archivo | Responsabilidad |
|---|---|
| `video-processor.js` | Orquestador del pipeline — leer primero |
| `voice-synthesizer.js` | TTS + silencedetect → sectionDurations con segments |
| `subtitle-styler.js` | Bloques de subtítulo → drawtext + SRT |
| `video-renderer.js` | FFmpeg: split-screen, motion, drawtext |
| `content-quality-gate.js` | Gate 3-etapas antes de publicar |
| `publish-scheduler.service.js` | Cron de publicación con quality gate |
| `server.js` | API REST + static frontend |

## Reglas de implementación
- Spawn de procesos externos: siempre con timeout y catch explícito
- FFmpeg: usar `@ffmpeg-installer` no PATH del sistema
- Rutas: `path.join(outputDir, 'file.ext')` — nunca concatenación de strings
- Logs de etapa: `logger.info('NombreServicio: descripción | key=value')`
- `sectionDurations` siempre incluye `{start, duration, segments}` en Kokoro

## No hacer
- No usar `apad=pad_dur` (no compatible con la versión de FFmpeg del sistema)
- No aplicar TIMING_OFFSET negativo en subtítulos (bug conocido — causa texto adelantado)
- No reducir MIN_VIRALITY_SCORE_TO_PUBLISH ni añadir fallback de publicación
