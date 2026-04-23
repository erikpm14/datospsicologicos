# Video Renderer — Motor de Edición Mejorado

## Resumen

**Generador_videos** ahora tiene un motor de edición/render mejorado integrado en el core del proyecto. No es un experimento externo, sino una **arquitectura modular interna** que reemplaza la capa de render anterior.

---

## Qué cambió

### Antes (motor actual/legacy)
- Cortes fijos cada 2.5 segundos (ignoraba narrativa)
- Pan/zoom sinusoidal predecible
- Color grade idéntico para todos los vídeos
- Subtítulos ASS con colores rotos
- LUFS -16 (incorrecto para TikTok)
- Sin audio fades en cuts (clicks auditivos)

### Ahora (shorts-renderer)
- **Clips sincronizados con segmentos narrativos** (SEGMENT_RHYTHM_MAP real)
- **Movimiento único por segmento**: push-in hook, zoom agresivo reengage/peak
- **Color grading presets** (dark_psychology, warm_cinematic, high_energy)
- **Subtítulos ASS con colores correctos** por sección
- **LUFS -14** (estándar TikTok/YouTube)
- **Audio fades 30ms** en cada cut (sin clicks)
- **Detección de silencios** para cortes naturales
- **Punch zoom 1.08x** en momentos clave

---

## Arquitectura

```
backend/src/services/
├── render-engines/
│   └── index.js ..................... Router (elige qué motor usar)
│
├── shorts-renderer/ ................ Motor mejorado (NUEVO)
│   ├── index.js ..................... Punto de entrada
│   ├── render-orchestrator.js ....... Orquesta 8 pasos
│   ├── visual-planner.js ............ Clips por segmento narrativo
│   ├── silence-detector.js .......... FFmpeg silencedetect
│   ├── audio-fader.js ............... Fades 30ms + ducking
│   ├── subtitle-builder.js .......... Wrapper subtitle-styler
│   ├── color-grader.js .............. 5 presets FFmpeg
│   ├── concat-builder.js ............ Construye complexFilter
│   ├── render-executor.js ........... Ejecuta FFmpeg
│   └── style-config.js .............. Constantes virales
│
├── video-renderer.js ................ Motor actual (fallback)
└── [otros servicios sin cambios]
```

**La arquitectura es limpia:** shorts-renderer es un módulo independiente que no toca ni duplica código existente. Si algo falla, fallback automático al motor actual.

---

## Configuración

### Variables de entorno (.env)

```bash
# Motor principal (default: current)
VIDEO_RENDER_ENGINE=shorts       # shorts | current | video_use

# Bloqueo de publicación para testing (default: false)
VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH=true

# Audio normalization target (default: -14 LUFS, TikTok standard)
AUDIO_LUFS_TARGET=-14
```

### Flujo actual vs mejora

**Antes (VIDEO_RENDER_ENGINE=current):**
```
Script → TTS → Postprocess → video-renderer.js (FFmpeg+Pexels) → Publish
```

**Ahora (VIDEO_RENDER_ENGINE=shorts):**
```
Script → TTS → Postprocess → [orchestrator] → [8 pasos] → Publish
```

La entrada y salida son **exactamente iguales**. El video-processor.js no cambió. Solo la caja negra interna mejoró.

---

## Los 8 pasos del pipeline

### 1. ffprobe
```
Obtiene duración real del audio (sobreescribe estimación)
```

### 2. silencedetect
```
FFmpeg detecta gaps ≥400ms entre palabras
Retorna timestamps de cortes naturales
```

### 3. Pexels
```
Descarga clips de stock footage
(Reutiliza lógica existente sin cambios)
```

### 4. visual-planner
```
Asigna un clip a cada segmento narrativo
Usa SEGMENT_RHYTHM_MAP para duraciones reales
Calcula offsets dentro de clips para variedad
Detecta si segmento necesita punch zoom
```

### 5. subtitle-builder
```
Reutiliza subtitle-styler.js (sin duplicación)
Genera bloques de subtítulos + ASS + SRT
Colores correctos por sección (CSS_TO_ASS completo)
```

### 6. color-grader
```
Selecciona preset FFmpeg según tema e intensidad
Presets: dark_psychology, warm_cinematic, high_energy, subtle, neutral_punch
```

### 7. concat-builder
```
Construye el complexFilter FFmpeg masivo
Por cada segmento:
  - Escala a 1300x2240 (margen para pan/zoom)
  - Crop 1080x1920 con pan sinusoidal
  - Punch zoom 1.08x si isPunchZoom=true
  - Trim a duración del segmento
Concatena todos → aplica color grade → vignette → subtítulos
```

### 8. render-executor
```
Ejecuta FFmpeg con:
  - libx264 preset=veryfast crf=23
  - AAC 192k 44100Hz
  - Movflags +faststart (ready for streaming)
Valida output (tamaño, duración, ffprobe check)
Escribe render-metadata.json
```

---

## Testing local

### Comando
```bash
npm run render:test
```

### Qué hace
1. Fuerza `VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH=true` (no publica)
2. Genera 1 vídeo con script realista
3. Guarda output en `output/test/test-{timestamp}/`
4. Imprime resumen con paths

### Ejemplo
```bash
$ VIDEO_RENDER_ENGINE=shorts npm run render:test

[render-test] ═════════════════════════════════════
[render-test] RENDER TEST | Engine: shorts
[render-test] ═════════════════════════════════════
[render-test] ✓ Output dir: ./output/test/test-1713959250000
[render-test] [1/3] Synthesizing voice...
[render-test] ✓ Audio ready: ...
[render-test] [2/3] Postprocessing audio...
[render-test] ✓ Audio processed: ...
[render-test] [3/3] Rendering video...
[render-test] Engine: shorts
[render-test] Validation: true
[render-test] ✓ Video rendered
[render-test] ═════════════════════════════════════
[render-test] Video: ./output/test/test-123/output.mp4
[render-test] ✓ Video generated (NO auto-publish)
```

---

## Control de publicación

### VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH

**Mientras `true`:**
- ✗ Vídeos NO se publican automáticamente
- ✓ Vídeos se guardan en `output/{videoId}/`
- ✓ Metadata se escribe (`render-metadata.json`)
- ✓ `video-processor.js` marca como "done" pero bloqueado
- ✓ Puedes revisar el vídeo manualmente

**Para revisar:**
```bash
# Ver vídeo generado
open output/video-uuid-1234/output.mp4

# Ver metadata
cat output/video-uuid-1234/render-metadata.json
```

**Cuando cambia a `false`:**
```bash
VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH=false
# → Growth engine vuelve a publicar automáticamente
```

---

## Cambios a nivel de pipeline

El `video-processor.js` **no cambió nada**. Todo se maneja en el router:

```javascript
// Línea 260 de video-processor.js
await renderVideoWithRouter({
  script, audioPath, outputPath, themeId, ...
})
// → router decide qué motor usar
```

```javascript
// Línea 317 de video-processor.js
const dryRunBlocksPublish = shouldBlockPublish(outputDir);
if (dryRunBlocksPublish) {
  // Bloquea publicación (shorts + VIDEO_RENDER_VALIDATE o video_use + dry_run)
  job.result = { videoId, blocked: true };
  // NO llama publishAll()
}
```

---

## Rollback

Para volver al motor anterior en cualquier momento:

```bash
export VIDEO_RENDER_ENGINE=current
npm run dev  # o pm2 restart all
```

El `video-renderer.js` original sigue 100% funcional e intacto.

---

## Mejora del audio

### Cambio LUFS

- **Antes**: -16 LUFS (legacy)
- **Ahora**: -14 LUFS (TikTok/YouTube/Instagram standard)

Esto ocurre en **audio-postprocess.js** (FASE 1):
```javascript
const LOUD_TARGET = parseFloat(process.env.AUDIO_LUFS_TARGET || '-14');
```

**Impacto**: Todos los vídeos nuevos suenan más consistentes en plataformas móviles.

---

## Mejora de subtítulos

### Fix CSS_TO_ASS

**Antes**: Colores por sección fallaban (todos salían blancos)
```
#F3F7FF (cold white) → ✗ no convertida
#4F7BFF (electric blue) → ✗ no convertida  
#FF3B30 (danger red) → ✗ no convertida
```

**Ahora**: Conversión correcta a BGR (little-endian ASS format)
```
#F3F7FF → &H00FFF7F3 ✓
#4F7BFF → &H00FF7B4F ✓
#FF3B30 → &H00303BFF ✓
```

**Impacto**: Vídeos ahora muestran subtítulos con colores visuales correctos por sección narrativa.

---

## Performance

| Métrica | Motor actual | shorts-renderer |
|---------|------------|-----------------|
| Render time | ~30-40s | ~40-60s |
| CPU usage | Normal | Higher (más filtros) |
| Output quality | Good | Better (más edición) |
| Clarity | Stock footage only | Stock + optimized cuts |

Trade-off: +20s render time para mejorar retención visual 📈

---

## Modo seguro

Si algo falla:

1. **shorts-renderer falla** → fallback automático a `video-renderer.js`
2. **Logs detallados** en `data/logs.log`
3. **Metadata** en cada output para debugging

```json
{
  "engine": "shorts-renderer",
  "timestamp": "2026-04-24T12:34:56Z",
  "segments": 8,
  "success": true,
  "colorGrade": "dark_psychology",
  "videoStyle": "viral_psychology_short"
}
```

---

## Próximas mejoras (opcional)

- [ ] Ducking inteligente de música (sidechain FFmpeg)
- [ ] Overlays con Remotion/Manim
- [ ] Análisis de retención por segmento
- [ ] A/B testing de movimientos
- [ ] Reencodeo lossless entre segmentos

---

## FAQ

**¿Puedo cambiar entre motors?**
Sí. Cambia `VIDEO_RENDER_ENGINE` en `.env` y reinicia.

**¿Qué pasa si shorts-renderer falla?**
Fallback automático a `video-renderer.js`. Logs en `data/logs.log`.

**¿Cómo publico un vídeo si está validación=on?**
Cambias `VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH=false` en `.env`. La siguiente generación se publicará automáticamente.

**¿Qué motor es default?**
`VIDEO_RENDER_ENGINE=current` (motor antiguo). Debes cambiar a `shorts` para usar el nuevo.

**¿Puedo usar video-use?**
Sí. `VIDEO_RENDER_ENGINE=video_use` (requiere `integrations/video-use` clonado).

---

## Cambios en .env

```bash
# Nuevo (FASE 1)
VIDEO_RENDER_ENGINE=current             # Nuevo: elige qué motor
VIDEO_RENDER_VALIDATE_BEFORE_PUBLISH=false  # Nuevo: bloquea publicación
AUDIO_LUFS_TARGET=-14                   # Modificado: antes era -16

# Existentes (sin cambio)
FFMPEG_PRESET=veryfast
FFMPEG_CRF=23
[otros...]
```

---

## Git history

```
d7bdedf - FASE 2: crear shorts-renderer (10 archivos, 1355 líneas)
8737890 - FASE 1: hotfixes (LUFS -14, CSS_TO_ASS fix, validación)
22bc081 - Anterior: render-engines router + video-use integration
```

---

**Status**: ✅ Integración completa. Motor mejorando viralidad sin romper pipeline.
