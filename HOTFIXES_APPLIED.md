# 🔧 HOTFIXES APLICADOS - 2026-04-29

## Objetivo
Recuperar publicaciones automáticas HOY y evitar slots vacíos. Hotfixes operativos sin refactors.

---

## ✅ 1. YOUTUBE OAUTH HOTFIX

**Archivo:** `backend/src/services/publisher.js`

### Cambios
- ✓ Mejorados logs en `getYouTubeAccessToken()`
- ✓ Diferenciación de errores: `invalid_grant` vs otros
- ✓ Logs claros: qué está mal y cómo regenerar el token
- ✓ Instrucción automática: "Visita http://localhost:3001/auth/youtube"

### Estado Actual
```
YouTube OAuth: ✓ Token válido
```

### Si falla
```bash
node backend/scripts/check-youtube-oauth.js
# O visita: http://localhost:3001/auth/youtube
```

---

## ✅ 2. TTS HOTFIX (Kokoro + Edge Fallback)

**Archivo:** `backend/src/services/voice-synthesizer.js`

### Cambios

#### Timeout mejorado
```javascript
- const TTS_TIMEOUT_MS = 120000  // Viejo: demasiado tiempo
+ const TTS_TIMEOUT_MS = 60000   // Nuevo: fallback rápido si Kokoro memory crash
+ const KOKORO_TIMEOUT_MS = 45000  // Nuevo: timeout individual de Kokoro
```

**Por qué:** Kokoro fallaba por OOM pero esperaba 120s antes de probar Edge TTS. Ahora falla rápido.

#### Edge TTS mejorado
```javascript
// Viejo: retries = 2, sin validación de duración
// Nuevo: retries = 5, con validación robusta
- for (let attempt = 1; attempt <= 2 && fileSize < 1000; attempt++)
+ for (let attempt = 1; attempt <= 5 && fileSize < 5000; attempt++)

// Agregado: validación de duración con ffprobe
+ const duration = await getSegmentDuration(outputPath);
+ if (duration < 2) throw new Error(`Edge TTS audio too short...`)
```

**Por qué:** Edge TTS devolvía audio 0 bytes. Ahora:
- Retry 5 veces (no 2)
- Validar tamaño > 5KB (no 1KB)
- Validar duración > 2s con ffprobe
- Delay incremental entre retries

---

## ✅ 3. QC RECOVERY MODE

**Archivo:** `backend/src/services/production-quality-checker.js`

### Cambios

#### Thresholds duales
```javascript
// Modo NORMAL (default)
MIN_VIRALITY = 70    // Exigente
MIN_FORMAT = 70      // Exigente
MIN_AUDIO_DURATION = 8   // Exigente
MIN_QUALITY_SCORE = 55

// Modo RECOVERY (RECOVERY_MODE=true)
MIN_VIRALITY = 40    // Leniente
MIN_FORMAT = 60      // Leniente
MIN_AUDIO_DURATION = 4   // Leniente
MIN_QUALITY_SCORE = 30
```

#### Hard fails flexibles
```javascript
// Modo NORMAL: todos los checks
hardFailChecks = ['videoExists', 'renderVisuals', 'scriptComplete', 
                  'publishableFile', 'subtitleScriptCoherence', 
                  'hookAudioPresence', 'packageIntegrity']

// Modo RECOVERY: solo lo esencial
hardFailChecks = ['videoExists', 'scriptComplete', 'publishableFile']
```

### Activar RECOVERY_MODE
```bash
# Opción 1: Variable de entorno
RECOVERY_MODE=true npm start

# Opción 2: Editar .env
echo "RECOVERY_MODE=true" >> backend/.env
npm start
```

### Desactivar (volver a normal)
```bash
# Opción 1: Remover variable
RECOVERY_MODE=false npm start

# Opción 2: Editar .env
# Comenta o borra: RECOVERY_MODE=true
npm start
```

---

## ✅ 4. BUFFER / TOP-UP URGENTE

**Archivo:** `backend/src/services/scheduler.service.js`

### Cambios

#### Nueva función de cálculo de slots
```javascript
+ function getNextPublishSlot() {
+   // Calcula próximo slot de publicación
+   // Retorna: { time: "HH:MM", minutesUntil: N, today: boolean }
+ }
```

#### Regla de urgencia por proximidad de slot
```javascript
// Si faltan < 90 minutos para slot Y hay < 3 videos listos
// → Genera contenido de urgencia sin esperar al cron

+ const nextSlot = getNextPublishSlot();
+ let urgentSlotProximity = false;
+ if (nextSlot && nextSlot.minutesUntil < 90 && publishable < 3) {
+   urgentSlotProximity = true;
+   logger.warn(`GenerationScheduler: URGENT top-up by slot proximity`);
+ }

+ const needsUrgent = urgent || urgentSlotProximity || belowMinimumReady || ...
```

---

## 🆕 SCRIPTS NUEVOS

### 1. `backend/scripts/check-youtube-oauth.js`
Verifica OAuth status y da instrucciones si está roto.

```bash
node backend/scripts/check-youtube-oauth.js
```

### 2. `backend/scripts/system-status.js`
Reporte completo de sistema: OAuth, queue, QC mode, próximo slot.

```bash
node backend/scripts/system-status.js
```

---

## 📊 ESTADO ACTUAL (2026-04-29 09:10)

```
YouTube OAuth:        ✓ Token válido
Queue:               Pending: 1 | Done: 50 | Failed: 62
Success Rate:        45% (crítico)
QC Mode:             Normal (listo para RECOVERY_MODE)
Next Slot:           14:30 (en 314 minutos)
```

---

## 🎯 INSTRUCCIONES DE RECUPERACIÓN

### Paso 1: Activar RECOVERY_MODE
```bash
cd backend
RECOVERY_MODE=true npm start
```

### Paso 2: Monitorear
```bash
# En otra terminal
tail -f backend/logs/combined.log | grep -E "TTS|QC|GenerationScheduler|YouTube"
```

### Paso 3: Esperar a que se generen videos
- Verás logs como: `GenerationScheduler: success | jobId=...`
- Videos aparecerán en `backend/queue/done/`
- Cuando veas 3+ videos listos, pasar a Paso 4

### Paso 4: Desactivar RECOVERY_MODE (volver a normal)
```bash
# Ctrl+C en la terminal del servidor
RECOVERY_MODE=false npm start
```

---

## ⚠️ SI ALGO SIGUE FALLANDO

### TTS sigue fallando
```bash
# Verificar logs
tail -f backend/logs/error.log | grep TTS

# Posibles causas:
# 1. Kokoro: memoria del sistema < 2GB disponible
# 2. Edge TTS: sin conexión o throttled
# 3. Ambos: probar reinicio

npm restart  # Si usas PM2
# O Ctrl+C + npm start
```

### YouTube sigue dando error
```bash
# Ejecutar check
node backend/scripts/check-youtube-oauth.js

# Si dice invalid_grant:
# 1. Abre http://localhost:3001/auth/youtube en navegador
# 2. Autoriza YouTube
# 3. El token se guarda automáticamente en .env
```

### Queue llena de failed
```bash
# Limpiar failed jobs (CUIDADO: ver primero qué hay dentro)
rm backend/queue/failed/*.json

# O si quieres examinar
ls -la backend/queue/failed/ | head -5

# Reiniciar
npm restart
```

---

## 📝 RESUMEN DE CAMBIOS TÉCNICOS

| Archivo | Línea | Cambio | Razón |
|---------|-------|--------|-------|
| publisher.js | 282-315 | Mejor logging OAuth | Detectar invalid_grant rápido |
| voice-synthesizer.js | 32-33 | Timeout 120s→60s | Fallback a Edge si Kokoro falla |
| voice-synthesizer.js | 938-971 | Edge TTS retries 2→5 | Aumentar chance de éxito |
| voice-synthesizer.js | 971+ | Validación duración ffprobe | Detectar audio 0 bytes |
| production-quality-checker.js | 30-60 | RECOVERY_MODE thresholds | Buffer temporal leniente |
| production-quality-checker.js | 350-365 | hardFailChecks flexible | Solo checks esenciales en RECOVERY |
| scheduler.service.js | 99-117 | getNextPublishSlot() + urgencia | Top-up automático antes de slot |

---

## ✅ VALIDACIONES EJECUTADAS

```bash
✓ publisher.js: syntax OK
✓ voice-synthesizer.js: syntax OK
✓ production-quality-checker.js: syntax OK
✓ scheduler.service.js: syntax OK
✓ YouTube OAuth: Token válido
✓ System status: checks passing
```

---

**Hotfixes aplicados:** 5 archivos modificados + 2 scripts nuevos + 1 script de recuperación
**Tiempo de implementación:** ~30 minutos
**Estado:** Listo para RECOVERY_MODE
