# Análisis y Fix: Vídeo Negro Sin Subtítulos `1cc054c0...`

**Fecha**: 2026-04-27  
**Status**: ✅ FIXED  
**Root Cause**: Publicación PRE-FIX (sin validación de archivos locales)

---

## 📊 Resumen Ejecutivo

### El Problema
- **VideoID**: `1cc054c0-de34-4689-aa18-3401d8008306`
- **Publicado**: 2026-04-26T12:30:05Z a YouTube
- **Estado**: Pantalla negra sin subtítulos, sin notificación Telegram
- **Causa**: Se publicó SIN archivos locales (sin output.mp4, sin subtitles.ass)

### Línea de Tiempo
```
12:30:05 → 1cc054c0... publicado (SIN archivos, SIN validación)
  ↓ +10 horas ↓
22:53:00 → obeCWBmr5XE publicado (CON archivos, CON validación V4.1)
```

---

## 🔍 Root Cause Analysis

### Por Qué Pasó

| Check | Resultado | Impacto |
|-------|-----------|--------|
| viralityScore >= 70 | ❌ 43 | NO cumplía V4.1 |
| humanityScore >= 85 | ❌ MISSING | NO cumplía V4.1 |
| Archivos locales | ❌ NO | NO validable |
| Sistema activo | ❌ Pre-fix | SIN QC hard |

**Timeline crítico**:
- Vídeo publicado: 12:30:05 (sistema antiguo, pre-validación)
- QC hard implementado: ~22:00 (10+ horas después)
- Vídeo bueno publicado: 22:53:00 (post-fix, todas validaciones)

### El Pipeline Antiguo (Pre-Fix)
```
generate() → renderVideo() → publishAll()
  ✅ Script válido (pero viralityScore=43)
  ❌ NO validaba V4.1 contracts
  ❌ NO validaba archivos locales pre-publish
  ❌ NO bloqueaba vídeos sin output.mp4
  → Publicó vídeo vacío a YouTube
```

### El Pipeline Nuevo (Post-Fix)
```
generate() → render() → validateQCHard() → publishAll()
  ✅ Script válido
  ✅ QC hard: frames > 0, audio exists, subtitles present
  ✅ V4.1: viralityScore >= 70, humanityScore >= 85
  ✅ FILE VALIDATION: output.mp4 + subtitles.ass MUST exist
  → Bloques TODOS los vídeos inválidos PRE-publish
```

---

## ✅ Fixes Implementados

### 1. **Validación de Archivos OBLIGATORIA** (HECHO)

**Archivo**: `backend/src/services/publisher.js`  
**Gate**: Gate 0 (línea 305-335)

```javascript
// GATE 0: VALIDAR ARCHIVOS LOCALES (PREVIO A TODO)
if (!videoPath || !fs.existsSync(videoPath)) {
  logger.error('FILES_MISSING | publish', { videoId, error: 'output.mp4 no existe' });
  return { success: false, error: 'FILES_MISSING', discarded: true };
}

const assPath = path.join(path.dirname(videoPath), 'subtitles.ass');
if (!fs.existsSync(assPath)) {
  logger.error('FILES_MISSING | publish', { videoId, error: 'subtitles.ass no existe' });
  return { success: false, error: 'FILES_MISSING', discarded: true };
}
```

**Ejecución**:
- ✅ Video-processor.js línea 366 → publishAll()
- ✅ Video-processor.js línea 479 → publishAll()
- ✅ Publish-scheduler.service.js línea 235 → publishAll()

### 2. **Diagnostic Script** (HECHO)

**Archivo**: `backend/diagnose-black-video.js`

Analiza:
- Archivos locales presentes/ausentes
- Entrada en publish-log.json
- Historial en colas
- Compliance V4.1
- Timeline vs fixes

**Resultado para `1cc054c0...`**:
```
❌ Archivos locales: NINGUNO
❌ viralityScore: 43 (< 70)
❌ humanityScore: MISSING (< 85)
⚠️  Publicado PRE-FIX (623 minutos antes del fix)
```

---

## 🧪 Testing

### Test de Validación de Archivos

```
✅ Test 1: Sin videoPath → FILES_MISSING error
✅ Test 2: videoPath inexistente → FILES_MISSING error  
✅ Test 3: Archivo inexistente + script válido → BLOQUEADO pre-publish
```

**Resultado**: 3/3 PASS — Validación está ACTIVA

---

## 🛡️ Garantías Posteriores

### Vídeos NO pueden publicarse sin:
1. ✅ **output.mp4** en disco local
2. ✅ **subtitles.ass** en disco local
3. ✅ **viralityScore >= 70**
4. ✅ **humanityScore >= 85**
5. ✅ **frames > 0** (QC hard previene vídeos negros)
6. ✅ **audio stream presente** (QC hard)

### Si falla cualquier validación:
- ❌ Vídeo RECHAZADO pre-publish
- 📝 Logged con videoId específico
- 📦 Movido a `discarded-invalid-current/` si en queue

---

## 📋 Checklist de Implementación

- ✅ Gate 0 (File validation) implementado en publishAll()
- ✅ Aplicado a TODAS las rutas de publish (video-processor + scheduler)
- ✅ Sintaxis validada: `node --check` OK
- ✅ Tests ejecutados: 3/3 PASS
- ✅ Diagnostic script creado para auditoría post-fallo
- ✅ Documentación completada

---

## 🚀 Próximos Pasos

### Urgente:
- [ ] Revisar si hay otros vídeos sin archivos en publish-log.json anterior a 2026-04-26T22:00
- [ ] Implementar alerta si vídeo publicado pero sin archivos locales

### Importante:
- [ ] Monitorear logs de `FILES_MISSING` en próximas publicaciones
- [ ] Validar que Telegram notifier se envíe correctamente

### Futuro:
- [ ] Dashboard de "vídeos publicados sin archivos" (historical audit)
- [ ] Metricas de QC pass rate por día

---

## 📌 Conclusión

**El vídeo `1cc054c0...` se publicó sin validación porque:**
1. Se publicó con el sistema PRE-FIX (12:30, antes de implementar QC hard)
2. Faltaban los archivos locales (output.mp4, subtitles.ass)
3. No cumplía V4.1 (viralityScore=43, humanityScore=missing)

**Ahora IMPOSIBLE que ocurra porque:**
- Gate 0 valida archivos OBLIGATORIAMENTE
- Si falta output.mp4 o subtitles.ass → RECHAZA pre-publish
- Si no cumple V4.1 → RECHAZA en Gate 1
- Vídeos negros bloqueados por QC hard (frames=0)

**Status**: ✅ **SISTEMA BLINDADO CONTRA ESTE FALLO**

