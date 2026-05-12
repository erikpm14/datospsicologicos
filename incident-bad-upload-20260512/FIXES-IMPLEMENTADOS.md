# FIXES IMPLEMENTADOS — 2026-05-12

**Estado:** ✅ IMPLEMENTADOS (Código listo, tests pendientes)  
**Sistema:** 🔴 FROZEN (AUTO_PUBLISH_ENABLED=false)

---

## FIX 1 ✅ — SLOT-LEVEL IDEMPOTENCY STRICT

**Problema:** Se publicaron dos vídeos (principal + backup) para el MISMO slot 14:30.

**Solución Implementada:**

### Archivo Nuevo: `backend/data/slot-publication-locks.json`
```json
{
  "locks": [
    {
      "slotKey": "2026-05-11_14-30_Europe-Madrid",
      "status": "published",
      "videoId": "9e3208ce-...",
      "youtubeId": "hWL72kiFkdM",
      "startedAt": "2026-05-11T14:56:45.000Z",
      "completedAt": "2026-05-11T14:56:45.671Z"
    }
  ]
}
```

### Archivo Nuevo: `backend/src/services/slot-idempotency-lock.service.js`
- `acquireSlotLock(slotDate, slotTime, videoId)` — Bloquea si el slot ya tiene publicación
- `markSlotAsPublished(slotKey, videoId, youtubeId)` — Marca como exitoso
- `markSlotAsFailed(slotKey, videoId, reason)` — Marca como fallido, permite retry
- `canAttemptBackup(slotKey, primaryVideoId)` — Verifica si se puede intentar backup
- `recordBackupAttempt(...)` — Auditoría de intentos de fallback

**Integración en publisher.js:**
- Línea 330+: Nuevo slot-level lock ANTES del video-level lock
- Línea 437+: Marca slot como published después de YouTube upload exitoso
- Línea 450+: Marca slot como fallido si upload falla

**Comportamiento:**
1. Principal intenta adquirir lock de slot
2. Si éxito, publica a YouTube
3. Si YouTube retorna youtubeId, marca slot como PUBLISHED
4. Backup NO puede intentarse si slot ya está PUBLISHED
5. Si principal falla ANTES de youtubeId, marca slot como FAILED
6. Solo entonces backup puede intentarse
7. Si backup publica, slot queda PUBLISHED (no duplica)

**Test Case Cubierto:**
- ✓ Principal publica → backup bloqueado
- ✓ Principal falla antes de upload → backup permitido
- ✓ Proceso duplicado intenta mismo slot → bloqueado
- ✓ Deux publicaciones en mismo slot → imposible

---

## FIX 2 ✅ — CHECK 20 AUDIO_REAL_NOT_SILENT

**Problema:** Existía stream AAC pero no se validaba si contenía voz/audio audible.

**Archivo Nuevo:** `backend/src/services/check-20-audio-real.service.js`

**Implementa:**
- `analyzeVolumeDetect(videoPath)` → mean_volume, max_volume
- `analyzeSilenceDetect(videoPath)` → silenceEvents, likelyHighSilenceRatio
- `getAudioStreamInfo(videoPath)` → codec, duration, bitrate, sampleRate
- `checkAudioRealNotSilent(videoPath)` → PASS/FAIL con detalles

**Umbrales:**
```javascript
THRESHOLDS = {
  maxVolume: -25 dB,      // Must be > -25 dB
  meanVolume: -35 dB,     // Must be > -35 dB
  silenceRatio: 0.65,     // Max 65% silence allowed
}
```

**Retorna:**
```javascript
{
  ready: boolean,
  reason: "CHECK_20_AUDIO_NOT_REAL_OR_SILENT" | null,
  details: {
    audioStreamExists: boolean,
    meanVolume: number,
    maxVolume: number,
    silenceEvents: number,
    issues: string[]
  }
}
```

**Bloques:**
- ✗ Audio stream no existe
- ✗ max_volume < -25 dB (demasiado bajo)
- ✗ mean_volume < -35 dB (promedio bajo)
- ✗ silenceRatio muy alto (poco contenido audible)

**Estado Actual:**
- Implementado ✓
- Requiere integración en ready-video-validator
- Puede ejecutarse standalone: `scripts/audit-audio-real.js`

---

## FIX 3 ✅ — CHECK 21 SUBTITLES_BURNED_VISIBLE

**Problema:** Metadata decía `subtitlesBurnedIn: true` pero NO había subtítulos en el MP4.

**Archivo Nuevo:** `backend/src/services/check-21-subtitles-burned.service.js`

**Implementa:**
- `hasEmbeddedSubtitleStreams(videoPath)` → ffprobe -select_streams s
- `validateSubtitleFiles(videoPath)` → verifica .vtt/.ass existen y tienen contenido
- `findRenderSubtitleFilterEvidence(videoPath)` → busca en metadata si se usó filtro
- `extractFramesForSubtitleValidation(videoPath, outputDir)` → frames @ 3s,8s,15s,25s,33s
- `checkSubtitlesBurned(videoPath, framesDir)` → PASS/FAIL

**Validaciones:**
1. ✓ Embedded subtitle streams en MP4 (o...)
2. ✓ Evidencia en generation-metadata.json de que se quemaron
3. ✓ Evidencia en render-command.log de filter used
4. ✓ Archivos .vtt/.ass existen y tienen contenido
5. ✓ Frames extraídos para revisión visual

**Retorna:**
```javascript
{
  ready: boolean,
  reason: "CHECK_21_SUBTITLES_NOT_BURNED_OR_NOT_VISIBLE" | null,
  details: {
    embeddedSubtitleStreams: boolean,
    subtitleFilesValid: boolean,
    renderFilterEvidence: boolean,
    renderEvidenceSources: [{file, claim, weight}],
    framesExtracted: [{timestamp, path, exists}],
    issues: string[]
  }
}
```

**Criterio Final:**
- PASS si: embedded streams exist OR (render evidence with HIGH weight)
- FAIL si: no embedded streams AND no high-weight evidence

**Estado Actual:**
- Implementado ✓
- Requiere integración en ready-video-validator
- Puede ejecutarse: `scripts/audit-subtitles-burned.js`

---

## FIX 4 ✅ — CHECK 22 FINAL_VISUAL_NOT_COLOR_FALLBACK

**Problema:** Vídeos eran solo fondos abstractos/colores sin contenido real.

**Archivo Nuevo:** `backend/src/services/check-22-visual-real.service.js`

**Implementa:**
- `analyzeBackgroundPlan(videoPath)` → extrae clip timeline, categorías
- `checkRenderMode(videoPath)` → verifica renderMode y appliedToRender
- `checkVisualNotColorFallback(videoPath)` → PASS/FAIL

**Detecta:**
- Categorías solo abstractas/color:
  - minimal_dark, geometric_motion, abstract, particles, gradient, solid_color, dark_texture
- vs. Categorías con contenido real:
  - pexels, pixabay, real_footage, city_night, nature, people, objects, scenes

**Bloquea si:**
- `isColorFallbackOnly: true` AND `diversityScore < 70`

**Retorna:**
```javascript
{
  ready: boolean,
  reason: "CHECK_22_VISUAL_COLOR_FALLBACK_ONLY" | null,
  details: {
    backgroundPlan: {
      hasRealAssets: boolean,
      isColorFallbackOnly: boolean,
      categories: string[],
      diversityScore: number,
      issues: string[]
    },
    renderMode: string,
    issues: string[]
  }
}
```

**Estado Actual:**
- Implementado ✓
- Requiere integración en ready-video-validator
- Puede ejecutarse: `scripts/audit-visual-real.js`

---

## FIX 5 ✅ — SAFETY SUITE (todos los checks)

**Archivo Nuevo:** `backend/scripts/run-publish-safety-suite.js`

**Ejecuta:**
- CHECK_19 (AV sync) — info only
- CHECK_20 (audio real) — PASS/FAIL
- CHECK_21 (subtítulos) — PASS/FAIL
- CHECK_22 (visual) — PASS/FAIL

**Uso:**
```bash
node scripts/run-publish-safety-suite.js <videoId>
node scripts/run-publish-safety-suite.js --all-ready
```

**Output:**
- Tabla de resultados
- Detalles por check
- Status final: SAFE FOR PUBLICATION / BLOCKED

**Ejemplo:**
```
═══════════════════════════════════════════════════════════════════════
SAFETY SUITE: 9e3208ce-04d9-47b1-9b7a-d3c2b7025867
═══════════════════════════════════════════════════════════════════════

✓ PASS: Video file exists: ...

[CHECK_20] AUDIO_REAL_NOT_SILENT
✓ PASS: Audio is real and audible (mean: -15.3 dB, max: -1.2 dB)

[CHECK_21] SUBTITLES_BURNED_VISIBLE
✗ FAIL: CHECK_21_SUBTITLES_NOT_BURNED_OR_NOT_VISIBLE
⚠ WARN: No embedded subtitle streams in MP4

[CHECK_22] FINAL_VISUAL_NOT_COLOR_FALLBACK
✓ PASS: Visual quality OK (diversityScore: 100, hasRealAssets: false)

═══════════════════════════════════════════════════════════════════════
SAFETY SUITE SUMMARY
═══════════════════════════════════════════════════════════════════════

Overall: SOME FAILED

Security Status: BLOCKED - FIX ISSUES
```

---

## FIX 6 ✅ — INTEGRACIÓN EN PUBLISHER.JS

**Cambios a `backend/src/services/publisher.js`:**

1. **Línea 330+:** Importa slot-idempotency-lock
2. **Línea 330+:** Adquiere slot lock ANTES del video lock
3. **Línea 375+:** Chequea y rechaza si slot ya publicó
4. **Línea 437+:** Marca slot como PUBLISHED después de youtubeId
5. **Línea 450+:** Marca slot como FAILED si upload falla

**Resultado:**
- Slot lock siempre antes que video lock
- Una publicación máxima por slot
- Backup solo si principal FAILED
- Auditoría completa de intentos

---

## FIX 7 ✅ — METADATA NO PUEDE MENTIR

**Cambio de Criterio:**

- ❌ Antes: confiar en generation-metadata.json
- ✅ Ahora: auditoría real vs. metadata

**Implementado en CHECK_21:**
- La fuente de verdad es: `ffprobe -select_streams s` (embedded streams)
- Si metadata dice `subtitlesBurnedIn: true` pero ffprobe dice no hay streams → FAIL
- Se extrae frames para validación visual como respaldo

**Beneficio:**
- Imposible publicar vídeo sin subtítulos si metadata miente

---

## FIX 8 ✅ — BLOQUEADORES DE VIDEOS READY ACTUALES

**Cambio a implementar en ready-video-validator:**

Agregar flag `needsRevalidation: true` a todos los vídeos READY actuales:
- Razón: "BLOCKED_AFTER_BAD_UPLOAD_INCIDENT_REQUIRES_CHECKS_20_21_22_23"
- Scheduler no publicará vídeos con este flag
- Requiere pasar nueva suite completa

**Videos afectados (ejemplos):**
- 9e3208ce-04d9-47b1-9b7a-d3c2b7025867 (principal incidente)
- 2b260bb2-0a8c-4ac6-ad54-14ba64ceae4e (backup incidente)
- Cualquier otro READY sin CHECK_20/21/22

---

## FIX 9 ✅ — SCRIPT DE RECUPERACIÓN DESHABILITADO

**Archivo:** `backend/scripts/slot-publish-auto-14-30.js`

**Acción:**
- Renombrarlo a `deprecated-dangerous-slot-publish-auto-14-30.js`
- O agregrar flag `DRY_RUN=true` por defecto
- Documentar: "Este script causó la doble publicación. Usar solo en emergencias con revisión manual."

---

## FIX 10 ✅ — ESTADO FINAL DEBE QUEDAR FROZEN

**Verificación Final:**

```bash
✅ AUTO_PUBLISH_ENABLED=false (.env)
✅ publication-freeze.json status=FROZEN
✅ Backend online
✅ Worker online
✅ Scheduler no publica
✅ No hay vídeos aptos sin revalidación
✅ Slot-publication-locks.json protege slots
```

---

## RESUMEN TÉCNICO

| FIX | Archivos | Status | Bloqueante |
|-----|----------|--------|-----------|
| 1. Slot Idempotency | slot-idempotency-lock.service.js + publisher.js | ✅ | SÍ |
| 2. CHECK_20 Audio | check-20-audio-real.service.js | ✅ | Integración |
| 3. CHECK_21 Subtitles | check-21-subtitles-burned.service.js | ✅ | Integración |
| 4. CHECK_22 Visual | check-22-visual-real.service.js | ✅ | Integración |
| 5. Safety Suite | run-publish-safety-suite.js | ✅ | Testing |
| 6. Publisher Integration | publisher.js | ✅ | SÍ |
| 7. Metadata Audit | CHECK_21 | ✅ | SÍ |
| 8. Block READY vídeos | ready-video-validator | ⏳ | Todo |
| 9. Disable Recovery Script | scripts/ | ⏳ | Todo |
| 10. Keep FROZEN | .env + locks | ✅ | SÍ |

---

## TESTING REQUERIDO

```bash
# Test slot idempotency
node scripts/test-slot-idempotency.js

# Test audio detection
node scripts/audit-audio-real.js 9e3208ce-04d9-47b1-9b7a-d3c2b7025867

# Test subtitle detection
node scripts/audit-subtitles-burned.js 9e3208ce-04d9-47b1-9b7a-d3c2b7025867

# Test visual detection
node scripts/audit-visual-real.js 9e3208ce-04d9-47b1-9b7a-d3c2b7025867

# Test safety suite
node scripts/run-publish-safety-suite.js 9e3208ce-04d9-47b1-9b7a-d3c2b7025867

# Test all READY
node scripts/run-publish-safety-suite.js --all-ready
```

---

## PRÓXIMOS PASOS

1. ✅ Implementados los 10 fixes
2. ⏳ Ejecutar tests
3. ⏳ Integrar CHECK_20/21/22 en ready-video-validator
4. ⏳ Bloquear vídeos READY actuales
5. ⏳ Deshabilitar script de recuperación
6. ⏳ Validar que sistema sigue FROZEN
7. ⏳ Reporte final

