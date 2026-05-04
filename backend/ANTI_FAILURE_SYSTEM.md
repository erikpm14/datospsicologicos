# Anti-Failure Publishing System

## Objetivo
**CERO slots perdidos**: El sistema debe publicar SIEMPRE si existe al menos 1 vídeo con MP4 válido.

## Regla de Oro

```
IF hardPassed=true (MP4 válido + audio/video stream + duración 8-60s)
THEN: Video DEBE publicarse
AND: QC nunca bloquea
AND: Captions nunca bloquean
AND: Metadata nunca bloquea
```

---

## Arquitectura Anti-Fallos

### 1. Wrapper de Reintentos: `anti-failure-publish-wrapper.js`

**Función:** `publishWithRetries()`

```javascript
Intenta publicar hasta MAX_PUBLISH_RETRIES (2) veces
│
├─ Intento 1: Publicar normal
├─ Intento 2: Retry después de 1s backoff
└─ Si ambos fallan: retorna false

Verificaciones previas:
- MP4 existe
- MP4 size >= 1MB
- Validaciones hard blocks pasadas
```

### 2. Cascada de Fallback en Scheduler

```
SI publishedThisSlot == 0:

1. QC_PASSED videos
   └─ publishWithRetries(strategy='normal')
   
2. QC_FAILED pero hardPassed videos
   └─ QC_OVERRIDE_FALLBACK
   └─ publishWithRetries(strategy='force')
   
3. Best-valid-output (>300KB, >=8s)
   └─ FALLBACK_PUBLISH_ATTEMPT
   └─ publishWithRetries(strategy='fallback')
   
4. Auto-import desde output/*
   └─ Crear queue entry si MP4 válido
   └─ Intentar publicar
```

### 3. Logs Obligatorios (TODOS Los Puntos de Decisión)

#### Activación del Slot
```
[SLOT_TRIGGERED] slotTime=14:30 CET | phase=initial | AUTO_PUBLISH_ENABLED=true
```

#### Selección de Candidato
```
[CANDIDATE_SELECTED] videoId=3a2d8a39 | strategy=normal | hardPassed=true
[PUBLISH_ATTEMPT] videoId=3a2d8a39 | attempt=1/2 | strategy=normal
```

#### Éxito de Publicación
```
[SLOT_PUBLISHED] videoId=3a2d8a39 | youtubeId=abc123 | attempt=1 | strategy=normal
```

#### Fallback en Cascada
```
[QC_FAILED_SAVE_FOR_FALLBACK] videoId=5a81501b | motivo=low_virality | STATUS=will_use_if_no_qc_pass
[QC_OVERRIDE_PUBLISH] videoId=5a81501b | qc_fail_reason=low_virality | reason=hardpassed_override
[QC_OVERRIDE_EXECUTED] videoId=5a81501b | slot_protected_by_hardpassed
```

#### Último Recurso
```
[FALLBACK_PUBLISH_ATTEMPT] strategy=best_valid_output | videoId=bdd6c681 | virality=0
[FALLBACK_PUBLISH_USED] strategy=best_valid_output | videoId=bdd6c681
```

#### Fracaso Total (Alerta Crítica)
```
[SLOT_FAILED] slot=14:30 CET | reason=no_valid_candidates | action=TELEGRAM_CRITICAL
[SLOT_SKIPPED_NO_VALID_VIDEO] slot=14:30 CET | totalDiscarded=56 | reasons=...
```

---

## Reintentos Inteligentes

### Estrategia de Backoff
```javascript
Intento 1: Publicar inmediatamente
Intento 2: Esperar 1000ms, reintentar
Intento 3: Esperar 2000ms, reintentar
(máx 2 reintentos por video)
```

### Verificaciones Pre-Publicación
```javascript
ANTES de cada intento:
1. ¿MP4 existe?
2. ¿MP4 size >= 1MB?
3. ¿hardPassed validó bien?
```

### Manejo de Errores
```javascript
Error de API → retry (up to MAX_RETRIES)
Error de validación → skip (no retry)
Error de archivo → skip (no retry)
No youtubeId en respuesta → retry
```

---

## Auto-Import Automático

### Trigger: Cada 5 Minutos (Watchdog)

```javascript
runSync() en anti-failure-publish-wrapper.js
│
├─ Escanea: output/* para MP4 válidos
├─ Filtra: sin entry en queue/done
├─ Valida: hardPassed=true
└─ Crea: entry automáticamente si válido
```

### Ejemplo de Auto-Import

```
Dir: output/video-abc123/
Archivos:
  ✅ output.mp4 (10MB)
  ✅ audio stream
  ✅ video stream
  ✅ duración 35s

Acción: Crear entrada en queue/done/video-abc123.json
Log: [AUTO_IMPORT_SUCCESS] scanned=56 | imported=3 | skipped=0
```

---

## Garantías Anti-Fallos

### Garantía #1: Si hay 1 MP4 válido → Se publica
```
Verificado por: validatePublishCandidate(hardPassed=true)
Garantizado por: Cascada de fallback (4 niveles)
Testeable por: Logs [SLOT_PUBLISHED] o [FALLBACK_PUBLISH_USED]
```

### Garantía #2: QC nunca bloquea hardPassed
```
QC puede:
✅ Bajar prioridad
✅ Marcar warning
✅ Loggear

QC NUNCA:
❌ Bloquear si hardPassed=true
❌ Descartar candidato
```

### Garantía #3: Captions no bloquean
```
Permitido:
✅ Warning si captions-debug falta
✅ Log y baja de score

Prohibido:
❌ Bloquear publicación
❌ Descartar por captions
```

### Garantía #4: Metadata no bloquea
```
No bloqueante:
✅ subtitles.ass falta
✅ render-metadata.json falta
✅ queue flags incompletos

Bloqueante:
❌ NUNCA (metadata es informativa)
```

---

## Escenarios Cubiertos

| Escenario | Acción | Resultado |
|-----------|--------|-----------|
| QC-passed | Publicar directo | ✅ SLOT_PUBLISHED |
| QC falla, hardPassed | QC_OVERRIDE | ✅ QC_OVERRIDE_EXECUTED |
| Todos fallan, existe best-valid | FALLBACK | ✅ FALLBACK_PUBLISH_USED |
| Publish API error | Retry 2x | ✅ SLOT_PUBLISHED o fallback |
| No hay MP4 válido | Late-publish armed | ⏸️ SLOT_SKIPPED (recoverable) |
| Video falta captions | Publica igual | ✅ SLOT_PUBLISHED |
| Video sin metadata | Publica igual | ✅ SLOT_PUBLISHED |

---

## Alertas Críticas

### Cuándo Enviar Telegram CRITICAL
```
✅ Slot saltado AND no hay candidatos disponibles
✅ Reintentos agotados AND no hay fallback

❌ NO enviar por:
   - Captions faltantes
   - Metadata faltante
   - QC falla (hay fallback)
   - Spacing mínimo no alcanzado
```

### Ejemplo de Alerta
```
🚨 CRITICAL: Slot 14:30 perdido — no hay videos publicables
   • Candidatos: 56 ready
   • Válidos (hardPassed): 0
   • Motivo: ???
   • Acción: Late-publish armed
```

---

## Prohibiciones Explícitas

```javascript
PROHIBIDO:

1. Bloquear por captions
   if (!captions.json) return REJECT; // ❌ NO

2. Bloquear por metadata
   if (!render-metadata.json) return REJECT; // ❌ NO

3. Bloquear por QC si hardPassed
   if (!qc.pass && hardPassed) return REJECT; // ❌ NO

4. Descartar sin fallback
   discard(video);
   return; // ❌ SIN intento fallback

5. Perder slot sin alertar
   if (publishedThisSlot == 0) {
     return; // ❌ DEBE guardar estado y alerta
   }
```

---

## Implementación: Archivos Modificados

### 1. Nuevo: `src/services/anti-failure-publish-wrapper.js`
- `publishWithRetries()` - 2 intentos con backoff
- `publishWithAntiFailure()` - Cascada de estrategias
- `isPublishable()` - Verificar hardPassed
- `attemptAutoImport()` - Scan automático output/
- `ensureAtLeastOnePublishable()` - Validar disponibilidad

### 2. Modificado: `src/services/publish-scheduler.service.js`
- Importar anti-failure wrapper
- `[SLOT_TRIGGERED]` log al inicio
- `[CANDIDATE_SELECTED]` log por video
- Reemplazar `publishCandidate()` con `publishWithRetries()`
- `[SLOT_PUBLISHED]` log en éxito
- `[SLOT_FAILED]` log en fracaso

---

## Monitoreo y Testing

### Command para ver logs anti-fallos
```bash
pm2 logs backend | grep -E "SLOT_TRIGGERED|CANDIDATE_SELECTED|SLOT_PUBLISHED|QC_OVERRIDE|FALLBACK|SLOT_FAILED"
```

### Test: Simular slot sin candidatos
```bash
# 1. Vaciar queue/done o generar videos inválidos
# 2. Esperar slot (14:30, 21:15, etc)
# 3. Ver logs:
#    - [SLOT_TRIGGERED]
#    - [SLOT_SKIPPED_NO_VALID_VIDEO]
#    - Late-publish armed
```

### Test: QC override fallback
```bash
# 1. Crear vídeo que pasa hardPassed pero falla QC
# 2. Esperar slot
# 3. Ver logs:
#    - [CANDIDATE_SELECTED] hardPassed=true
#    - [QC_FAILED_SAVE_FOR_FALLBACK]
#    - [QC_OVERRIDE_EXECUTED]
#    - [SLOT_PUBLISHED]
```

---

## Status Final

✅ **Sistema Anti-Fallos: IMPLEMENTADO**

- [x] Reintentos en cascada (2 intentos + backoff)
- [x] QC override garantizado (hardPassed never blocked)
- [x] Fallback chain de 4 niveles
- [x] Auto-import cada 5 min
- [x] Logs obligatorios en todos los puntos
- [x] Alertas críticas solo cuando es crítico
- [x] Prohibiciones explícitas (captions, metadata, QC no bloquean)

**Resultado: CERO slots perdidos si existe 1 MP4 válido**
