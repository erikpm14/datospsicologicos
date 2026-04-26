# Video-Use Integration

Motor alternativo de renderizado para shorts de psicología con mejor retención y edición.

## Resumen

Video-use es un editor de vídeos impulsado por IA (Python) que:
- Transcribe audio con ElevenLabs Scribe (timestamps a nivel palabra)
- Quita filler words y silencios
- Aplica color grading y fades de audio de 30ms
- Quema subtítulos con estilos personalizados
- Genera overlays con Manim, Remotion o PIL

Se integra como **motor opcional** sin romper el pipeline actual.

## Estado Actual

### Motor Actual (FFmpeg)
- Default: `VIDEO_RENDER_ENGINE=current`
- ✓ Funciona con stock footage de Pexels
- ✓ Subtítulos estilos con colores
- ✓ Publicación automática a YouTube/TikTok

### Motor Video-Use
- Alternativo: `VIDEO_RENDER_ENGINE=video_use`
- ⏳ Requiere instalación de dependencias Python
- ⏳ Requiere ElevenLabs API key (opcional, fallback a FFmpeg)
- 🔒 Modo dry-run para pruebas (no publica)

## Instalación

### Paso 1: Clonar video-use

```bash
cd integrations/video-use
git clone https://github.com/browser-use/video-use.git .
```

### Paso 2: Instalar dependencias Python

```bash
# Recomendado: entorno virtual
python3 -m venv venv
source venv/bin/activate  # o: venv\Scripts\activate en Windows

# Instalar video-use
pip install -e .

# Verificar
python3 -c "import video_use; print('✓ OK')"
```

### Paso 3: Configurar .env

```bash
# Motor de renderizado (current | video_use)
VIDEO_RENDER_ENGINE=current

# Activar video-use
VIDEO_USE_ENABLED=false

# Modo dry-run (true = genera local, no publica)
VIDEO_USE_DRY_RUN=true

# Directorio de salida
VIDEO_USE_OUTPUT_DIR=./output/video-use

# Estilo personalizado (debe existir en skills/)
VIDEO_USE_STYLE=viral_psychology_short

# ElevenLabs (opcional, sin esto fallback a FFmpeg)
ELEVENLABS_API_KEY=sk_...

# Python ejecutable (Windows: C:\Python310\python.exe)
PYTHON_BIN_VIDEO_USE=python3
```

## Uso

### Opción 1: Test Local (SIN publicar)

```bash
npm run render:video-use:test
```

**Output**: `output/video-use/test-{timestamp}/output.mp4`

Este comando:
- Genera 1 vídeo de ejemplo realista
- Usa `VIDEO_USE_DRY_RUN=true` (no publica)
- Guarda metadata en `test-metadata.json`
- Ideal para comparar con motor actual

### Opción 2: Generación Autónoma

```bash
# En .env
VIDEO_RENDER_ENGINE=video_use
VIDEO_USE_ENABLED=true
VIDEO_USE_DRY_RUN=true
```

Luego, el growth engine generará vídeos con video-use automáticamente.

**Importante**: Mientras `VIDEO_USE_DRY_RUN=true`, **los vídeos NO se publicarán** en YouTube/TikTok. Se guardarán en:
```
output/video-use/{videoId}/output.mp4
```

### Opción 3: Publicar con Video-Use

```bash
# En .env
VIDEO_RENDER_ENGINE=video_use
VIDEO_USE_ENABLED=true
VIDEO_USE_DRY_RUN=false
```

**ADVERTENCIA**: `VIDEO_USE_DRY_RUN=false` permitirá publicación automática. Asegúrate de que los vídeos cumplen tu estándar de calidad.

## Flujo de Decisión

```
Generar vídeo
    ↓
VIDEO_RENDER_ENGINE = ?
    ├─ current    → FFmpeg + Pexels (motor actual)
    └─ video_use  → video-use Python
        ├─ VIDEO_USE_ENABLED = false
        │   └─ Fallback a motor actual
        └─ VIDEO_USE_ENABLED = true
            ├─ Renderizar con video-use
            ├─ VIDEO_USE_DRY_RUN = true
            │   └─ BLOQUEAR publicación ✓
            └─ VIDEO_USE_DRY_RUN = false
                └─ Publicar normalmente
```

## Skill Personalizado

### Ubicación
```
integrations/video-use/skills/viral-psychology-short/SKILL.md
```

### Reglas
- **Formato**: 1080x1920 vertical, 45-65s
- **Retención**: cambio visual cada 2-3 segundos
- **Subtítulos**: 2-4 palabras, grandes, legibles
- **Edición**: cortes rápidos, fades de 30ms, micro zooms
- **Psicología**: curiosidad, tensión, sorpresa, identificación
- **Estructura**: Hook → Open Loop → Value → Escalation → Reengage → Peak → Open Ending → CTA

Ver `SKILL.md` para detalles completos.

## Comparación: Actual vs Video-Use

| Aspecto | Actual (FFmpeg) | Video-Use |
|---------|-----------------|-----------|
| Tecnología | FFmpeg + Pexels | Python + ElevenLabs |
| Retención visual | Media | Alta (cambios cada 2-3s) |
| Subtítulos | Estilizados | Adaptados a filler words |
| Audio | Postprocess (+16 LUFS) | Fades 30ms automáticos |
| Filler words | Mantiene todo | Quita automáticamente |
| Color grading | Tema → colores | Custom por segmento |
| Overlays | Stock footage | Manim/PIL personalizados |
| Velocidad | Rápido (~30s) | Más lento (~60s+) |
| Coste | Gratis | Free (Pexels) → Premium (ElevenLabs) |
| Fallback | N/A | Auto fallback a actual |

## Troubleshooting

### Error: "video-use CLI not found"

```
integrations/video-use/ está vacío
→ Clonar: git clone https://github.com/browser-use/video-use.git .
```

### Error: "Python not found" o exit code 3221225786

Windows + PM2:
```bash
# Encontrar ruta de Python
python3 -c "import sys; print(sys.executable)"
# Output: C:\Users\...\Python310\python.exe

# En .env
PYTHON_BIN_VIDEO_USE=C:\Users\...\Python310\python.exe  (ruta absoluta)
```

### Error: "ElevenLabs API error"

```bash
# Opción 1: Agregar key
ELEVENLABS_API_KEY=sk_...

# Opción 2: Fallback automático a FFmpeg
# Dejar ELEVENLABS_API_KEY vacío → video-use usará FFmpeg
```

### Vídeos se publican aunque DRY_RUN=true

```
✗ Problema: render-metadata.json no se creó
✓ Solución: Verificar que renderVideoWithRouter crea el archivo
→ Check backend/src/services/render-engines/index.js
```

## Rollback

### Volver a Motor Actual

```bash
# En .env
VIDEO_RENDER_ENGINE=current
VIDEO_USE_ENABLED=false
```

**Todos los vídeos nuevos usarán FFmpeg**. Los vídeos anteriores de video-use no se modifican.

### Desinstalar Video-Use

```bash
# Conservar carpeta (fallback disponible)
rm -rf integrations/video-use/*

# O eliminar completamente
rm -rf integrations/video-use
```

## Próximos Pasos Recomendados

1. **Instalación mínima**
   - Clonar video-use
   - Instalar dependencias Python
   - Configurar .env

2. **Test local**
   - `npm run render:video-use:test`
   - Comparar 2-3 vídeos vs motor actual
   - Evaluar calidad + tiempo de render

3. **Ajustar skill**
   - Editar `viral-psychology-short/SKILL.md` según resultado
   - Cambiar duraciones, colores, estilos

4. **Batch test**
   - `VIDEO_RENDER_ENGINE=video_use` + `VIDEO_USE_DRY_RUN=true`
   - Generar 5-10 vídeos
   - No publicar, solo evaluar

5. **Validación en live**
   - Si calidad ≥ actual: `VIDEO_USE_DRY_RUN=false`
   - Publicar 2-3 vídeos
   - Monitorear métricas (CTR, views, retention)

6. **Decisión final**
   - Si performance > actual: Adoptar video-use como default
   - Si performance < actual: Mantener actual, video-use como fallback
   - Si similar: Elegir por preferencia de assets

## Performance Esperado

### Render Time
- **Actual**: ~30-40 segundos por vídeo
- **Video-Use**: ~60-120 segundos (más procesamiento)

### Calidad Visual
- **Actual**: Buena, consistente, stock footage
- **Video-Use**: Potencialmente mejor retención, assets personalizados

### Publicación
- **Actual**: Inmediata o diferida según config
- **Video-Use**: Diferida (dry-run) o inmediata si `DRY_RUN=false`

## Arquitectura

```
backend/src/queue/video-processor.js
    ↓ (llama a renderVideo)
backend/src/services/render-engines/index.js (router)
    ├─ if VIDEO_RENDER_ENGINE=current → video-renderer.js (FFmpeg)
    └─ if VIDEO_RENDER_ENGINE=video_use → video-use-renderer.js (Python)
        ├─ buildVideoUseInput(script)
        ├─ executeVideoUseProcess()
        └─ Check shouldBlockPublish() en línea 315 de video-processor.js
```

## API Esperadas

### ElevenLabs Scribe
```
POST https://api.elevenlabs.io/v1/audio-to-text
payload: { audio_file }
response: { timestamps, words, speaker_diarization }
```

### Video-Use CLI
```bash
python3 ./cli.py < input.json
input: { audioPath, outputPath, segments, metadata, config }
output: output.mp4
```

## Contacto / Reporte

Si hay problemas:
1. Verificar logs: `tail -f data/logs.log`
2. Check .env variables
3. Verificar video-use repo: https://github.com/browser-use/video-use
4. Fallback a motor actual mientras se investiga

---

**Última actualización**: Abril 2026  
**Status**: Integración Beta  
**Default**: `VIDEO_RENDER_ENGINE=current` (no activar video-use automáticamente)
