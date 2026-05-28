# AI Avatar / AI Tools Video Generator

Este repo es un **fork reseteado**: ya **NO** es un generador de shorts de psicología/motivación.

Nuevo objetivo: base para generar vídeos verticales (shorts/reels) sobre **IA, automatización, herramientas, workflows, agentes y productividad digital**, con voz IA, captions y render automático.

## Qué se conserva
- Worker/cola + schedulers (`backend/src/queue/` + servicios asociados)
- Render pipeline (FFmpeg) + captions ASS (`backend/src/services/video-renderer.js`, `backend/src/services/render-engines/`)
- TTS base (`backend/src/services/voice-synthesizer.js`)
- QC/validadores (`backend/src/services/production-quality-checker.js`)
- Publishing stack (TikTok/IG/YouTube) **pero en modo seguro por defecto** (`AUTO_PUBLISH_ENABLED=false`)
- Dashboard (`frontend/`) con taxonomía nueva

## Estructura nueva (base)
- `backend/src/avatar/` (config/expresiones/scene builder/adapters)
- `backend/src/content/ai-tools/` (idea/hook/script generator + taxonomy)

## Setup rápido

### 1) Requisitos
```bash
node --version   # >= 18
ffmpeg -version  # (opcional si tu entorno ya lo tiene)
```

### 2) Instalar dependencias
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 3) Variables de entorno
```bash
cp backend/.env.example backend/.env
```
Obligatoria (si quieres guiones por LLM): `ANTHROPIC_API_KEY`.

Defaults importantes (modo seguro):
- `PROJECT_MODE=AI_AVATAR`
- `CONTENT_DOMAIN=ai_tools`
- `AVATAR_ENABLED=true`
- `AUTO_PUBLISH_ENABLED=false`
- `DEFAULT_VIDEO_STYLE=avatar_explainer`

### 4) Arrancar sistema
Terminal 1 (API):
```bash
cd backend && npm start
```
Terminal 2 (worker):
```bash
cd backend && npm run worker
```
Terminal 3 (dashboard):
```bash
cd frontend && npm run dev
```

## Generar vídeo de prueba (sin publicar)
```bash
node scripts/generate-avatar-test-video.js
```
Salida esperada: `backend/output/<videoId>/output.mp4` (o `backend/output/...` según `OUTPUT_DIR`).

## Estado del reset
Ver `docs/PROJECT_RESET_AUDIT.md`.
