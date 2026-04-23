# Video-Use Integration

Motor alternativo de edición/renderizado para shorts de psicología.

## Instalación

```bash
# Clonar video-use desde GitHub
cd integrations/video-use
git clone https://github.com/browser-use/video-use.git .

# Instalar dependencias Python
pip install -r pyproject.toml  # o: pip install -e .

# Verificar instalación
python3 -c "import video_use; print('✓ video-use ready')"
```

## Estructura

```
video-use/
├── pyproject.toml          # Dependencias Python
├── video_use/              # Módulo principal
│   ├── core.py
│   ├── transcribe.py       # ElevenLabs Scribe
│   ├── editor.py           # Lógica de edición
│   └── ...
├── skills/                 # Skills personalizados
│   └── viral-psychology-short/
│       └── SKILL.md        # Reglas de este skill
└── ...
```

## Configuración

### Variables .env requeridas

- `ELEVENLABS_API_KEY` — para transcripción automática
- `VIDEO_USE_OUTPUT_DIR` — carpeta de salida
- `VIDEO_USE_STYLE` — nombre del skill (ej: `viral_psychology_short`)
- `PYTHON_BIN_VIDEO_USE` — ruta a Python 3.10+ (ej: `python3` o `C:\Python310\python.exe`)

### Activación

Desde backend, editar `.env`:

```bash
VIDEO_RENDER_ENGINE=video_use
VIDEO_USE_ENABLED=true
VIDEO_USE_DRY_RUN=true  # true = genera local, no publica
```

## Uso desde Node Backend

El adaptador `backend/src/services/render-engines/video-use-renderer.js` maneja la integración:

```javascript
const { renderWithVideoUse } = require('./render-engines/video-use-renderer');

const videoPath = await renderWithVideoUse({
  script: { ... },
  audioPath: 'path/to/audio.mp3',
  outputPath: 'path/to/output.mp4',
});
```

## Testing Local

```bash
# Test sin publicar
npm run render:video-use:test

# Genera un vídeo en ./output/video-use/test-{timestamp}/
# No sube a YouTube
```

## Troubleshooting

| Error | Solución |
|-------|----------|
| Python not found | Establecer `PYTHON_BIN_VIDEO_USE` correctamente |
| ElevenLabs error | Verificar `ELEVENLABS_API_KEY` |
| FFmpeg error | Verificar que FFmpeg está en PATH |
| Skill not found | Asegurar que `VIDEO_USE_STYLE` coincide con carpeta en `skills/` |

## Rollback

Para volver al motor actual:

```bash
# En .env:
VIDEO_RENDER_ENGINE=current
VIDEO_USE_ENABLED=false
```

Todos los vídeos con `VIDEO_RENDER_ENGINE=current` ignoran video-use completamente.
