# POST-MORTEM: DOBLE PUBLICACIÓN DE VÍDEOS DEFECTUOSOS
**Fecha:** 2026-05-12  
**Incidente:** Dos vídeos malos publicados en YouTube  
**Estado:** CONGELADO (AUTO_PUBLISH_ENABLED=false)

---

## 1. ESTADO DE SEGURIDAD ACTUAL

| Medida | Estado | Verificado |
|--------|--------|-----------|
| AUTO_PUBLISH_ENABLED | ✅ false | .env |
| publication-freeze.json | ✅ FROZEN (CRITICAL) | data/ |
| Backend Process | ✅ ONLINE (PID 209520) | pm2 status |
| Worker Process | ✅ ONLINE (PID 188148) | pm2 status |
| Nueva publicación | ✅ IMPOSIBLE | guard + freeze |

---

## 2. MAPEO PUBLICACIONES

### Publicación 1 — PRINCIPAL (14:56:45)

| Campo | Valor |
|-------|-------|
| YouTube ID | hWL72kiFkdM |
| Local VideoId | 9e3208ce-04d9-47b1-9b7a-d3c2b7025867 |
| Timestamp | 2026-05-11T14:56:45.671Z |
| Slot | 2026-05-11 14:30 Europe/Madrid |
| Tipo | PRINCIPAL (slot preparado) |
| Source | late-slot-recovery (manual recovery) |
| Operator | Erik |
| Estado | ✓ Publicado |

**Archivos:**
- `/backend/output-fase1-test/9e3208ce.../output.mp4` (35 MB)
- `/backend/output-fase1-test/9e3208ce.../subtitles.vtt` (1.4 KB)
- `/backend/output-fase1-test/9e3208ce.../subtitles.ass` (2.3 KB)

### Publicación 2 — BACKUP (14:56:51)

| Campo | Valor |
|-------|-------|
| YouTube ID | -4j9AxR1veI |
| Local VideoId | 2b260bb2-0a8c-4ac6-ad54-14ba64ceae4e |
| Timestamp | 2026-05-11T14:56:51.384Z |
| Slot | 2026-05-11 14:30 Europe/Madrid |
| Tipo | BACKUP (fallback de principal) |
| Source | late-slot-recovery (manual recovery) |
| Operator | Erik |
| Estado | ✓ Publicado |

**Archivos:**
- `/backend/output-fase1-test/2b260bb2.../output.mp4` (35 MB)
- `/backend/output-fase1-test/2b260bb2.../subtitles.vtt` (1.4 KB)
- `/backend/output-fase1-test/2b260bb2.../subtitles.ass` (2.3 KB)

---

## 3. POR QUÉ SE PUBLICARON DOS (ROOT CAUSE)

### Causa Inmediata: Bug en Script de Recuperación

**Script:** `/backend/scripts/slot-publish-auto-14-30.js` (creado por Claude)

**Bug:** Parsing incorrecto de respuesta de publishAll()

```javascript
// LÍNEA 62-67: CÓDIGO INCORRECTO
const youtubeResult = result?.results?.find(r => r.platform === 'youtube');
if (youtubeResult && youtubeResult.videoId) {
  // Principal se publicó exitosamente
  return youtubeResult;
}
```

**Lo que sucedió:**
1. Principal publishAll() devolvió: `{ results: [ { videoId: "hWL72kiFkdM", ... } ] }`
2. Script buscaba correctamente `result.results[0].videoId`
3. Encontraba "hWL72kiFkdM"
4. Retornaba youtubeResult !== null
5. main() debería haber ejecutado `process.exit(0)`
6. ✗ Pero había un bug ANTERIOR en mi versión primera

**En la PRIMERA ejecución del script (14:56):**
- Yo había código buggy que buscaba `result.youtubeId` (incorrecto)
- No encontraba nada (porque era result.results[0].videoId)
- Retornaba null
- Principal se consideraba "fallido" aunque SÍ se había publicado
- Script continuaba a backup
- Backup también se publicaba

**En la SEGUNDA ejecución del script (después de congelar):**
- Código fue corregido a `result?.results?.find(r => r.platform === 'youtube')`
- Principal se intentó de nuevo pero DUPLICATE_HARD_BLOCK lo bloqueó
- Entonces SÍ continuó a backup (como era esperado)

### Causa Raíz: Falta de Idempotencia de Slot

**Problema arquitectónico:**
- Sistema tiene idempotencia a nivel de VIDEOID (no se sube dos veces el mismo vídeo)
- NO tiene idempotencia a nivel de SLOT (permite dos vídeos en el mismo slot)
- Script de fallback no verificaba si ya se publicó para este slot

**Evidencia:**
- Ambas publicaciones tienen `slotDate: "2026-05-11"` y `slotTime: "14:30"`
- Pero no hay lock que diga "slot 14:30 ya tiene publicación"
- Solo hay lock que diga "videoId 9e3208ce-... ya se está subiendo"

---

## 4. ANÁLISIS DE AUDIO REAL

### Principal (9e3208ce-04d9-47b1-9b7a-d3c2b7025867)

```
ffmpeg -af volumedetect:
  mean_volume: -15.3 dB
  max_volume: -1.2 dB

ffmpeg -af silencedetect=noise=-35dB:d=0.5:
  (no significant silence segments reported)

ffprobe -select_streams a:0:
  codec: aac
  bitrate: 210343 bps (~210 kbps)
  duration: 35.41s
  sample_rate: 44100 Hz
```

**Análisis:**
- ✓ Stream de audio existe
- ✓ Tiene volumen audible (mean -15.3 dB es bajo pero audible)
- ✓ Peak está bien (-1.2 dB)
- ✓ No hay silencio prolongado

**Conclusión:** Audio sí existe en el archivo local. La pregunta es: ¿YouTube recibió una versión diferente?

**Hipótesis:** YouTube API puede haber transcodeado/comprimido el archivo y el audio se degradó significativamente. O el usuario simplemente no escuchó debido a volumen bajo en su dispositivo.

### Backup (2b260bb2-0a8c-4ac6-ad54-14ba64ceae4e)

Idéntico al principal:
- mean_volume: -15.3 dB
- max_volume: -1.2 dB
- Silencio: none detected

---

## 5. ANÁLISIS DE SUBTÍTULOS

### Ambos vídeos

**ffprobe -select_streams s (subtitle streams):**
```
(empty output — no subtitle streams found)
```

**Archivos:**
- subtitles.vtt: 1.4 KB, 53 líneas (existen)
- subtitles.ass: 2.3 KB, 27 líneas (existen)

**Metadata dice:**
- `subtitlesBurnedIn: true`
- `prepublishQcPassed: true`

**Realidad:**
- ❌ NO hay subtitle streams en el MP4
- ❌ Subtítulos NO están quemados en el vídeo
- ❌ Metadata MIENTE

**Conclusión:** Falso positivo crítico. El sistema reportó "subtítulos quemados" pero nunca lo hizo. El comando ffmpeg que renderizó el vídeo final NO incluyó el paso de quemar subtítulos (drawtext filter o embedded subtitles).

---

## 6. ANÁLISIS VISUAL

### Background Plan (metadata)

```
Primary categories:
  - minimal_dark (slow_motion)
  - geometric_motion (geometric_transform)
  - dark_texture (subtle_texture)
  - abstract_blue (neural_flow)
  - particles_gold (particle_drift)
  - city_night (cinematic_pan)

Dominant colors: black, dark_gray, blue, cyan, gold

diversityScore: 100
```

### Frames Extraídos

Se extrajeron frames en t=3s, 8s, 15s, 25s, 33s de ambos vídeos.

Análisis visual (inspección):
- Fondos dinámicos abstractos ✓
- Colores cambiantes ✓
- Geometría y partículas ✓
- PERO: Sin contenido real (personas, escenas, objetos)

**Conclusión:** Visual es técnicamente correcto (fondos renderizados) pero semánticamente pobre (sin contenido útil). Esto concuerda con reporte del usuario: "fondos de colores cambiando".

---

## 7. VERIFICACIÓN DE ARCHIVO EXACTO SUBIDO

**publishToYouTube() en publisher.js línea 381:**
```javascript
const videoBuffer = fs.readFileSync(videoPath);
// Luego se sube a YouTube API exactamente este buffer
```

**Conclusión:**
- ✓ Se leyó exactamente el output.mp4 del directorio
- ✓ Sin modificación, compresión intermedia, o sustitución
- ✓ El archivo que YouTube recibió WAS el que está en output-fase1-test/
- ✓ Hash/size/mtime coinciden con archivos actuales

**Discrepancia no explicada:**
- Archivo local: audio presente (mean_volume -15.3 dB)
- YouTube: usuario reporta "sin voz"
- Posible: YouTube transcodeó y degradó audio significativamente

---

## 8. VALIDADORES QUE FALLARON

Ver: `VALIDADORES-FALLIDOS.md`

### Resumen Crítico

| Check | Resultado | Problema |
|-------|-----------|----------|
| CHECK_19 AV_SYNC | PASS | Solo valida duración, no contenido audible |
| subtitlesBurnedIn | TRUE (falso) | Metadata miente; subtítulos nunca se quemaron |
| prepublishQcPassed | TRUE (falso) | Solo valida archivos, no contenido renderizado |
| Audio Quality | NO VERIFICADO | Nunca se mide volumedetect |
| Visual Quality | NO VERIFICADO | Nunca se extrae frames para análisis |
| Slot Idempotency | NO VERIFICADO | Permite dos vídeos en mismo slot |

---

## 9. ROOT CAUSE FINAL

### Cadena de Fallos

1. **Bug de script:**
   - slot-publish-auto-14-30.js tuvo parsing incorrecto
   - Principal publicó pero script lo consideró fallido
   - Script continuó a backup

2. **Falta de idempotencia de slot:**
   - No hay verificación "¿ya hay publicación para slot 14:30?"
   - Publish guard solo valida por videoId, no por slot

3. **Validadores incompletos:**
   - CHECK_19 no detecta audio mudo (solo duración)
   - Subtitle burning nunca se verificó realmente
   - Metadata miente sobre "subtitlesBurnedIn: true"
   - Visual quality nunca se audita

4. **Falta de pre-upload audit:**
   - No se verifica que el archivo EXACTO que se va a subir sea válido
   - No se extrae ffprobe, frames, volumedetect justo antes del upload

### Arquitectura Defectuosa

Sistema valida "archivos correctos" NO "contenido útil":
- ✓ Archivo exists
- ✓ JSON válido
- ✓ Duraciones match
- ✓ Checksums OK

Pero NUNCA verifica:
- ❌ ¿Audio tiene volumen audible?
- ❌ ¿Subtítulos están visibles?
- ❌ ¿Visual tiene contenido real?
- ❌ ¿Un slot no tiene ya publicación?

---

## 10. PLAN DE FIX (ANTES DE REACTIVAR)

### A. Bloquear Doble Publicación en Slot

**Archivo:** `backend/src/services/publish-guard.service.js`
**Cambio:** Agregar check de idempotencia por SLOT

```javascript
// Nuevo check
const publishedForSlot = checkIfSlotAlreadyPublished(slotDate, slotTime);
if (publishedForSlot) {
  return { allowed: false, reason: 'SLOT_ALREADY_HAS_PUBLICATION' };
}
```

**Almacenamiento:** slot-lock-state.json o tabla en DB

### B. CHECK 20 — Audio Real Not Silent

**Archivo:** `backend/src/services/ready-video-validator.service.js`
**Nueva validación:**

```javascript
function CHECK_20_audioRealNotSilent(videoPath) {
  // ffmpeg -af volumedetect
  // mean_volume < -30 dB → FAIL
  // OR max_volume < -10 dB → FAIL
  // OR silencedetect ratio > 30% → FAIL
}
```

### C. CHECK 21 — Subtitles Actually Burned

**Archivo:** `backend/src/services/ready-video-validator.service.js`
**Nueva validación:**

```javascript
function CHECK_21_subtitlesBurned(videoPath) {
  // ffprobe -select_streams s
  // Si no hay subtitle streams:
  //   - Extraer frames (3s, 10s, 20s, 30s)
  //   - OCR o análisis para detectar texto visible
  //   - Si no hay texto visible → FAIL
}
```

### D. Pre-Upload Audit

**Archivo:** `backend/src/services/publisher.js` (publishToYouTube)
**Cambio:** Agregar auditoría justo antes del upload

```javascript
async function publishToYouTube(videoPath, ...) {
  // ANTES de subir:
  
  // 1. ffprobe completo
  const probe = await ffprobe(videoPath);
  
  // 2. volumedetect + silencedetect
  const audioStats = await getAudioStats(videoPath);
  
  // 3. Frame extraction + OCR
  const frames = await extractCriticalFrames(videoPath);
  const hasVisibleText = await detectTextInFrames(frames);
  
  // 4. Final gate
  if (audioStats.meanVolume < -30 || !hasVisibleText) {
    throw new Error('FINAL_AUDIT_FAILED');
  }
  
  // Ahora sí subir
  const uploadResponse = await ...
}
```

### E. Slot-Level Idempotency

**Archivo:** `backend/src/services/publish-scheduler.service.js`
**Cambio:** Lock atómico por slot antes de fallback

```javascript
// Antes de intentar backup:
const slotLock = acquireSlotLock(slotDate, slotTime);
if (!slotLock.acquired) {
  // Ya hay publicación para este slot
  logger.info('Slot already has publication, skipping backup');
  return;
}

// Intentar principal
const principalResult = await publishVideo(...);
if (principalResult) {
  recordSlotPublication(slotDate, slotTime, principalResult);
  return;
}

// Backup solo si principal falló Y slot aún no tiene publicación
const backupResult = await publishVideo(...);
if (backupResult) {
  recordSlotPublication(slotDate, slotTime, backupResult);
}
```

---

## 11. DECISIÓN FINAL

### ❌ NO SE PUEDE REACTIVAR HOY

**Blockers:**
1. Subtítulos nunca se queman (metadata falsa)
2. No hay detección de audio mudo
3. No hay idempotencia de slot
4. No hay pre-upload audit

**Orden de FIX:**
1. CRÍTICO: Implementar CHECK 21 (subtítulos realmente quemados)
2. CRÍTICO: Implementar slot-level idempotency
3. ALTO: Implementar CHECK 20 (audio audible)
4. ALTO: Implementar pre-upload audit

**Validación antes de reactivar:**
- [ ] Dry-run con vídeo bueno (CHECK 21 pasa)
- [ ] Dry-run bloquea vídeo sin subtítulos
- [ ] Dry-run bloquea vídeo con audio muy bajo
- [ ] Test slot idempotency: no permite dos para mismo slot
- [ ] Test pre-upload audit: detecta vídeos malos antes de subir

### Vídeos a Bloquear

- 9e3208ce-04d9-47b1-9b7a-d3c2b7025867 → MANTENER EN REJECTED (no regenear todavía)
- 2b260bb2-0a8c-4ac6-ad54-14ba64ceae4e → MANTENER EN REJECTED (no regenear todavía)

### Timeline Estimado

| Task | Tiempo |
|------|--------|
| Implementar CHECK 21 | 30 min |
| Implementar CHECK 20 | 20 min |
| Slot idempotency | 20 min |
| Pre-upload audit | 30 min |
| Testing/validation | 40 min |
| **Total** | **~2.5 horas** |

---

## 12. ARTEFACTOS PRESERVADOS

```
incident-bad-upload-20260512/
├── VALIDADORES-FALLIDOS.md
├── POST-MORTEM-COMPLETO.md (este archivo)
├── frames-principal/
│   ├── frame-3s.png
│   ├── frame-8s.png
│   ├── frame-15s.png
│   ├── frame-25s.png
│   └── frame-33s.png
├── frames-backup/
│   ├── frame-3s.png
│   ├── frame-8s.png
│   ├── frame-15s.png
│   ├── frame-25s.png
│   └── frame-33s.png
```

**Logs preservados:**
- `/backend/output-fase1-test/9e3208ce.../` (completo)
- `/backend/output-fase1-test/2b260bb2.../` (completo)
- `/backend/data/publish-log.json` (con entradas de incidente)
- `/backend/data/slot-lock-state.json` (con historial)

---

**Informe preparado:** 2026-05-12  
**Sistema:** CONGELADO (AUTO_PUBLISH_ENABLED=false)  
**Siguiente paso:** Implementar fixes antes de reactivación

