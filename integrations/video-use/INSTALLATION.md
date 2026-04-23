# Video-Use Installation

Instrucciones para instalar video-use como motor alternativo de renderizado.

## Quick Start (5 minutos)

### 1. Clonar repo

```bash
cd integrations/video-use
git clone https://github.com/browser-use/video-use.git .
```

Expected output:
```
Cloning into '.'...
remote: Enumerating objects...
```

### 2. Verificar estructura

```bash
ls -la
# Debe mostrar:
# - pyproject.toml
# - video_use/
# - skills/
# - cli.py (o similar)
```

### 3. Instalar Python dependencies

```bash
# Opción A: Instalar globalmente (simple)
pip install -e .

# Opción B: Entorno virtual (recomendado)
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -e .
```

### 4. Verificar instalación

```bash
python3 -c "import video_use; print('✓ OK')"
```

Si funciona, ver: `✓ OK`

### 5. Configurar .env

Editar `backend/.env`:

```bash
VIDEO_USE_ENABLED=true
VIDEO_USE_DRY_RUN=true
PYTHON_BIN_VIDEO_USE=python3
# (en Windows: C:\Users\...\python.exe)
```

### 6. Test

```bash
cd backend
npm run render:video-use:test
```

Output esperado:
```
═════════════════════════════════════════
  VIDEO-USE TEST | Render sin publicar
═════════════════════════════════════════
✓ Output dir: ...
✓ Audio ready: ...
✓ Video rendered: ...
✓ DRY_RUN: Vídeo generado pero NO publicado
```

Video saved: `output/video-use/test-{timestamp}/output.mp4`

---

## Troubleshooting

### Python 3.10+ requerido

```bash
python3 --version
# Debe ser 3.10 o superior

# En Windows, asegúrate de instalar Python desde python.org
# NO usar versiones de Microsoft Store
```

### FFmpeg no encontrado

```bash
# video-use requiere FFmpeg instalado
ffmpeg -version  # Verificar

# Si no está:
# Windows: choco install ffmpeg  (o usar ffmpeg-installer npm)
# macOS: brew install ffmpeg
# Linux: apt-get install ffmpeg
```

### ElevenLabs API Key (opcional)

```bash
# Si quieres transcripción automática:
ELEVENLABS_API_KEY=sk_... (en backend/.env)

# Si no lo pones, video-use fallback a FFmpeg automáticamente
```

### Windows Python Path

Si ves: `Python not found` en Windows:

```bash
# Encontrar ruta exacta
python3 -c "import sys; print(sys.executable)"
# Output: C:\Users\Erik\AppData\Local\Programs\Python\Python310\python.exe

# En backend/.env
PYTHON_BIN_VIDEO_USE=C:\Users\Erik\AppData\Local\Programs\Python\Python310\python.exe
```

### Skill not found

```
Error: Skill viral_psychology_short not found
→ Asegúrate que skills/viral-psychology-short/ existe
→ Verificar: integrations/video-use/skills/viral-psychology-short/SKILL.md
```

---

## Verificación

```bash
# Comando para verificar que todo está listo
python3 -c "
import sys
print(f'✓ Python {sys.version}')

try:
    import video_use
    print('✓ video-use importable')
except:
    print('✗ video-use NOT found')

try:
    import ffmpeg
    print('✓ ffmpeg available')
except:
    print('✗ ffmpeg NOT found')
"
```

---

## Rollback

Si quieres desinstalar sin romper nada:

```bash
# Opción 1: Desactivar (mantener instalado)
# En backend/.env
VIDEO_USE_ENABLED=false

# Opción 2: Eliminar instalación
pip uninstall video-use -y
rm -rf integrations/video-use/*

# Pipeline actual sigue funcionando sin problemas
```

---

## Siguiente paso

Lee `../../docs/video-use-integration.md` para la guía completa.
