# Activación Manual de Remotion para Pruebas

## Estado Actual

- **Configuración activa:** `.env` → RENDER_MODE=video_use (estable, sin Remotion)
- **Configuración Remotion:** `.env.remotion` (lista, pero NO activa)
- **Fallback:** Intacto. Si Remotion falla, automáticamente usa video_use

## Cómo Activar Remotion Manualmente

### Opción 1: Copiar Variables (Recomendado para pruebas puntuales)

```bash
# 1. Leer variables de .env.remotion
cat backend/.env.remotion | grep "RENDER_MODE\|REMOTION" | grep -v "^#"

# 2. Agregar estas líneas al final de backend/.env (o reemplazar las existentes):
RENDER_MODE=remotion
RENDER_MODE_V2=remotion
REMOTION_RENDERER_ENABLED=true
REMOTION_FALLBACK_VIDEO_USE=true
REMOTION_TEMPLATE_DEFAULT=avatar_explainer
REMOTION_CONCURRENCY=4

# 3. Asegurar que NO se permite publicación automática:
AUTO_PUBLISH_ENABLED=false
ALLOW_MANUAL_PUBLISH=false  # ← Cambiar si estaba en true

# 4. Ejecutar prueba
cd backend
node generate-remotion-final-test.js

# 5. Restaurar a estable (después):
git checkout .env
# o restaurar desde backup:
cp .env.backup.pre-remotion-test .env
```

### Opción 2: Usar .env.remotion como archivo separado (Para CI/CD)

```bash
# 1. Crear archivo temporal con config combinada
cat backend/.env backend/.env.remotion > backend/.env.test

# 2. Ejecutar con ese archivo
export $(cat backend/.env.test | xargs)
node backend/generate-remotion-final-test.js

# 3. Limpiar
rm backend/.env.test
```

### Opción 3: Export de Variables (Para terminal específica)

```bash
# En PowerShell o bash, exportar variables sin modificar .env
$env:RENDER_MODE="remotion"
$env:RENDER_MODE_V2="remotion"
$env:REMOTION_RENDERER_ENABLED="true"
$env:REMOTION_FALLBACK_VIDEO_USE="true"
$env:AUTO_PUBLISH_ENABLED="false"
$env:ALLOW_MANUAL_PUBLISH="false"

# Luego ejecutar
cd D:\Proyectos\VideosIA\backend
node generate-remotion-final-test.js

# Las variables se descartan al cerrar la terminal
```

---

## Variables Críticas para Remotion

| Variable | Valor | Propósito |
|----------|-------|----------|
| `RENDER_MODE` | `remotion` | Selector principal de renderer |
| `RENDER_MODE_V2` | `remotion` | Alternativa/v2 de selector |
| `REMOTION_RENDERER_ENABLED` | `true` | Habilitar módulo Remotion |
| `REMOTION_FALLBACK_VIDEO_USE` | `true` | **CRÍTICO:** Fallback automático |
| `REMOTION_TEMPLATE_DEFAULT` | `avatar_explainer` | Plantilla por defecto |
| `REMOTION_CONCURRENCY` | `4` | Threads de renderizado |
| `AUTO_PUBLISH_ENABLED` | `false` | **SEGURIDAD:** No publicar |
| `ALLOW_MANUAL_PUBLISH` | `false` | **SEGURIDAD:** No publicación manual |

---

## Qué Pasará Cuando Actives Remotion

### Flujo Normal
1. Router selecciona `remotion-renderer-router.js`
2. Intenta ejecutar Remotion CLI
3. Si éxito → video.mp4 via Remotion
4. Si falla → fallback automático a video_use → video.mp4 via hyperframe

### Con Seguridad Habilitada
- AUTO_PUBLISH_ENABLED=false → No publica automáticamente
- ALLOW_MANUAL_PUBLISH=false → No permite `publish-manual.js`
- Resultado: Video se genera pero NO se publica a YouTube

---

## Test Scripts Disponibles

### Script 1: generate-final-test-video.js (Usa TTS real)
```bash
cd backend
node generate-final-test-video.js
# ⚠️ NOTA: Tiene bug de duración de audio (pre-existente)
```

### Script 2: generate-remotion-final-test.js (Audio preexistente)
```bash
cd backend
node generate-remotion-final-test.js
# ✅ RECOMENDADO: Evita bug TTS
```

---

## Restaurar a Estable

```bash
# Opción 1: Desde backup
cp backend/.env.backup.pre-remotion-test backend/.env

# Opción 2: Git checkout
cd backend
git checkout .env

# Opción 3: Manual
# Editar .env y cambiar:
# RENDER_MODE=video_use
# AUTO_PUBLISH_ENABLED=false
# ALLOW_MANUAL_PUBLISH=true
```

---

## Archivos Asociados

```
backend/.env                          ← Configuración ACTIVA (video_use)
backend/.env.remotion                 ← Configuración Remotion (lista, no activa)
backend/.env.backup.pre-remotion-test ← Backup seguro
backend/generate-remotion-final-test.js ← Script de prueba
remotion-video/                       ← Proyecto Remotion (separado)
REMOTION_VALIDATION_REPORT.md         ← Reporte de validación
REMOTION_REAL_PIPELINE_TEST_REPORT.md ← Reporte de prueba real
```

---

## Checklist Antes de Prueba Manual

- [ ] .env tiene RENDER_MODE=video_use (estable, antes de cambiar)
- [ ] Backup .env.backup.pre-remotion-test existe
- [ ] AUTO_PUBLISH_ENABLED=false
- [ ] ALLOW_MANUAL_PUBLISH=false (máxima seguridad)
- [ ] REMOTION_FALLBACK_VIDEO_USE=true (fallback intacto)
- [ ] No hay commits pendientes (`git status`)
- [ ] Node.js y npx en PATH (o usar workaround)

---

## Resolución: Windows PATH (npx ENOENT)

Si obtienes `spawn npx ENOENT`:

### Solución 1: Agregar Node.js a PATH
```powershell
# PowerShell (como admin)
$NodePath = (Get-Command node.exe).Source | Split-Path
[Environment]::SetEnvironmentVariable("PATH", "$env:PATH;$NodePath", "User")
# Reiniciar PowerShell
```

### Solución 2: Usar npx.cmd explícitamente
Editar `backend/src/renderers/remotion-renderer.js`:
```javascript
// Cambiar:
spawn('npx', cmdArgs, ...)
// A:
spawn('npx.cmd', cmdArgs, ...)  // Windows-específico
```

### Solución 3: Usar API de Remotion (No CLI)
```javascript
// En lugar de CLI, usar:
const { RenderInternals, BrowserSafeApis } = require('@remotion/core');
// Esto requiere cambio arquitectónico
```

---

## Logs a Monitorear

Cuando actives Remotion, busca estos logs:

```
✅ ÉXITO
[render-router] Using Remotion renderer
[remotion-router] Attempting Remotion render
[remotion-renderer] Render complete

⚠️ FALLBACK (Normal si PATH bloqueado)
[remotion-renderer] Render failed: spawn npx ENOENT
[remotion-router] Falling back to video_use

❌ ERROR (Investigar)
[remotion-renderer] Render failed: [otro error]
[remotion-router] Fallback to video_use also failed
```

---

## Contacto de Issues Conocidos

1. **npx ENOENT:** Windows PATH issue - agregar Node.js a PATH
2. **TTS Duration Bug:** voice-synthesizer genera archivos muy grandes - separate ticket
3. **Captions Vacíos:** Test minimal, no problema de Remotion

---

**Última actualización:** 2026-05-27  
**Estado:** Documentación para pruebas manuales  
**Seguridad:** NO publicación automática, fallback intacto
