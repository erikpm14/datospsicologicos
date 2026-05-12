# VALIDADORES QUE FALLARON — POST-MORTEM INCIDENTE

## 1. CHECK_19 - AV_DURATION_SYNC ❌ INSUFICIENTE

**Resultado reportado:** PASS (0.07s gap < 0.35s)
**Realidad:** Audio stream existe, pero:
- Solo verifica DURACIÓN de pista, no CONTENIDO real
- Nunca verifica si el audio tiene volumen audible (volumedetect)
- Nunca detecta silencio prolongado (silencedetect)
- CHECK_19 pasó pero no es suficiente

**Auditoría:** 
- audio mean_volume: -15.3 dB (audible pero bajo)
- audio max_volume: -1.2 dB (bueno)
- silencedetect: No reportó silencios significativos
- **HALLAZGO:** Audio sí existe en archivo local

---

## 2. prepublishQcPassed: true — FALSO POSITIVO CRÍTICO ❌

**Metadata reporta:** `"subtitlesBurnedIn": true` y `"prepublishQcPassed": true`
**Realidad:** 
- `ffprobe -select_streams s` en MP4: CERO subtitle streams
- subtitles.vtt existe pero NO renderizado en MP4
- subtitles.ass existe pero NO renderizado en MP4

**¿Qué validó?**
- Que archivos subtitles.* existen (check de archivo)
- QUE NO que estén quemados en el vídeo

**Conclusión:** Sistema valida existencia de archivos, no contenido renderizado. **CRÍTICO.**

---

## 3. validateReadyVideo() — PASÓ PERO INCOMPLETO ❌

Combinación de checks que pasó pero no detectó:
- ✗ Audio de volumen muy bajo o mudo
- ✗ Subtítulos no quemados en video
- ✗ Fondos abstractos sin contenido real
- ✗ Diferencia entre "archivo existe" y "contenido es útil"

---

## 4. Publish Guard — NO BLOQUEÓ DOBLE PUBLICACIÓN ❌

**Problema:** Se publicó PRINCIPAL y BACKUP en el MISMO SLOT
- Principal publicó a 14:56:45 ✓
- Backup publicó a 14:56:51 (6 segundos después) ✓
- Ambos en slot 2026-05-11 14:30

**¿Por qué se publicó backup?**
- Script slot-publish-auto-14-30.js parseó mal la respuesta
- Principal se publicó pero script pensó que falló
- Guard no bloqueó segundo candidato para mismo slot

**Conclusión:** Falta idempotencia a nivel de SLOT, no solo a nivel de VIDEOID.

---

## CHECKS QUE NUNCA EXISTIERON:

### ❌ CHECK 20 — AUDIO_REAL_NOT_SILENT
**Debería:** Bloquear si audio no tiene voz real o contenido audible
- `ffmpeg -af volumedetect`: mean_volume < -30 dB → BLOQUEAR
- `ffmpeg -af silencedetect`: silencio > 30% → BLOQUEAR
- Peak amplitude muy bajo → BLOQUEAR

**Implementación:** NO EXISTE

### ❌ CHECK 21 — SUBTITLES_BURNED_VISIBLE
**Debería:** Verificar que subtítulos están renderizados EN EL MP4, no solo como archivo
- `ffprobe -select_streams s`: debe encontrar subtitle stream
- O si no: extraer frames y hacer OCR/análisis para confirmar texto visible

**Implementación:** NO EXISTE

### ❌ CHECK 22 — FINAL_VISUAL_SEMANTIC_QUALITY
**Debería:** Bloquear si visual es solo abstracto/color sin contenido real
- diversityScore de metadata vs. análisis de frames real
- Exigir al menos X% de contenido "real" (no solo colores/particles)

**Implementación:** NO EXISTE

### ❌ CHECK 23 — PRE_UPLOAD_FINAL_AUDIT
**Debería:** Auditoría completa justo ANTES de subir a YouTube
- ffprobe completo del output.mp4 exacto que se va a subir
- Volumedetect, silencedetect, frame extraction
- Guardar hash del archivo y metadatos

**Implementación:** NO EXISTE

---

## RESUMEN EJECUTIVO

| Componente | Estado | Problema |
|-----------|--------|---------|
| CHECK_19 AV_SYNC | ✓ IMPLEMENTADO | Insuficiente: solo duración, no contenido |
| Subtitle Burning | ✓ "HECHO" (metadata) | Falso: NO están en MP4 |
| Prepublish QC | ✓ IMPLEMENTADO | Superficial: valida archivos, no render |
| Audio Quality | ❌ NO VERIFICADO | Nunca se mide volumen/contenido |
| Visual Quality | ❌ NO VERIFICADO | Nunca se extrae frames para validar |
| Slot Idempotency | ❌ INCOMPLETO | Permite backup si principal "falla" |
| Pre-Upload Audit | ❌ NO EXISTE | Sube sin auditoría final |

---

## ROOT CAUSE

**Arquitectura:** Sistema diseñado para validar "archivos válidos" NO "contenido útil"
- Valida: "¿existe output.mp4?" "¿JSON es válido?" "¿duraciones match?"
- NO valida: "¿audio es audible?" "¿subtítulos son visibles?" "¿visual es útil?"

**Resultado:** Vídeos técnicamente válidos pero perceptualmente nulos.

