# QC Override Guarantee

## Garantía Obligatoria

**GUARANTEE: Si un vídeo pasa `hardPassed = true`, NUNCA será bloqueado por QC.**

This is the central promise: hardPassed videos are never blocked by QC.

QC puede:
- ✅ Bajar prioridad
- ✅ Marcar como warning
- ✅ Loggear problemas
- ❌ **NUNCA** bloquear publicación
- ❌ **NUNCA** descartar candidato

## Implementación en Scheduler

### Paso 1: Hard Block Filter
```javascript
if (!validation.coreValidation?.hardPassed) {
  // RECHAZA: Errores técnicos (MP4 missing, audio missing, etc)
  return;
}
```
**Resultado:** Solo videos técnicamente válidos continúan

### Paso 2: Candidates List Segregation
```javascript
const validCandidates = []; // hardPassed + QC_PASSED
const qcFailedCandidates = []; // hardPassed + QC_FAILED (pero válidos)

if (!qc.pass) {
  // NO DESCARTAR: guardar para fallback
  qcFailedCandidates.push({ video, qg });
  continue;
}
validCandidates.push(video);
```
**Resultado:** Videos con fallo de QC NO se descartan, se guardan para fallback

### Paso 3: Primary Publish (QC Passed)
```javascript
// Intentar publicar primero los que pasaron QC
for (const video of validCandidates) {
  const published = await publishCandidate(video, ...);
  if (published) return; // Slot cubierto
}
```
**Resultado:** Si hay un video que pasó QC, se publica

### Paso 4: QC Override Fallback (Guaranteed)
```javascript
if (publishedThisSlot === 0 && qcFailedCandidates.length > 0) {
  const picked = qcFailedCandidates.sort(...)[0];
  logger.warn(
    `🔄 [QC_OVERRIDE_PUBLISH] videoId=${picked.video.videoId} | ` +
    `qc_fail_reason=${picked.qg.discardReason} | ` +
    `reason=hardpassed_override`
  );
  const published = await publishCandidate(picked.video, {
    fallbackReason: 'qc_override_hardpassed'
  });
  if (published) {
    logger.info(`✅ [QC_OVERRIDE_EXECUTED] videoId | slot_protected_by_hardpassed`);
    return; // Slot cubierto
  }
}
```
**Resultado:** Si QC bloqueó todos, se publica el mejor hardPassed de todas formas

### Paso 5: Last Resort (Best Valid Output)
```javascript
const fallbackCandidate = await findFallbackCandidate();
if (fallbackCandidate) {
  const published = await publishCandidate(fallbackCandidate, {
    fallbackReason: 'fallback_best_valid_output'
  });
  if (published) {
    logger.info(`✅ [FALLBACK_PUBLISH_USED] strategy=best_valid_output`);
    return;
  }
}
```
**Resultado:** Último intento si todo lo anterior falló

## Garantías Confirmadas

### ✅ Confirmación 1: Hard Blocks ≠ QC Issues
```javascript
// hardPassed = true significa:
✅ MP4 existe y >1MB
✅ ffprobe funciona
✅ Duration 8-60s
✅ Video stream presente
✅ Audio stream presente
✅ No publicado
✅ YouTube OAuth OK

// Estos SON bloqueantes técnicos
// QC issues son SEPARADOS y NO pueden bloquear hardPassed
```

### ✅ Confirmación 2: Fallback Obligatorio
```javascript
Flujo de publicación:
1. QC_PASSED videos? → Publicar
2. Si no: QC_FAILED (hardPassed) videos? → QC_OVERRIDE_PUBLISH
3. Si no: Best valid output? → FALLBACK_PUBLISH
4. Si no: SLOT_SKIPPED (sin opciones técnicas válidas)

// Una vez que hardPassed=true, al menos una de 1-3 se ejecutará
```

### ✅ Confirmación 3: Logs y Auditoría
```
[QC_FAILED_SAVE_FOR_FALLBACK] {videoId} → Video salvado
[QC_OVERRIDE_PUBLISH] {videoId} | qc_fail_reason=... | reason=hardpassed_override
[QC_OVERRIDE_EXECUTED] {videoId} | slot_protected_by_hardpassed

// Todos los overrides loggean de forma auditable
```

### ✅ Confirmación 4: Validación en Hard Block Filter
```javascript
// SOLO hard blocks rechazan inmediatamente
if (!validation.coreValidation?.hardPassed) {
  logger.warn('[CANDIDATE_HARD_REJECTED]');
  continue;
}

// QC issues van a fallback, NO rechazo
if (!qc.pass) {
  logger.warn('[QC_FAILED_SAVE_FOR_FALLBACK]');
  qcFailedCandidates.push(...);
  continue;
}
```

## Ejemplos de Comportamiento

| Escenario | MP4 | Audio | Duration | QC | Resultado | Log |
|-----------|-----|-------|----------|-----|-----------|-----|
| Perfecto | ✅ 10MB | ✅ | 35s | ✅ PASS | **PUBLICA** (paso 1) | [QC_PASSED] |
| Sin audio | ❌ falta | ❌ | 35s | ✅ | **RECHAZA** (hard block) | [CANDIDATE_HARD_REJECTED] |
| Truncado | ✅ 10MB | ✅ | 5s | ✅ | **RECHAZA** (hard block) | [CANDIDATE_HARD_REJECTED] |
| QC falla | ✅ 10MB | ✅ | 35s | ❌ FAIL | **PUBLICA** (paso 4, override) | [QC_OVERRIDE_EXECUTED] |
| Metadata falta | ✅ 10MB | ✅ | 35s | ⚠️ LOW | **PUBLICA** (fallback pool) | [FALLBACK_PUBLISH_USED] |

## Regla de Oro

```
IF validation.coreValidation.hardPassed === true
THEN:
  Garantizado que al menos una opción de publicación será intentada
  QC nunca será el factor bloqueante
  Slot será cubierto a menos que falle la API de YouTube
```

## Integración en Código

Ubicación: `src/services/publish-scheduler.service.js`

Funciones afectadas:
- `validateReadyCandidate()` — Now uses centralized validator
- Loop principal (línea ~652) — Segregates into validCandidates vs qcFailedCandidates
- Primary publish (línea ~719) — QC-passed videos
- Fallback (línea ~755) — QC-override for hardPassed

## Test

Verificar que:
```bash
# Test 1: Video sin QC falla pero hardPassed
node test-validation-filters.js

# Test 2: Dry-run muestra que fallback está disponible
node dry-run-slot-decision.js

# Test 3: Scheduler logs muestran [QC_OVERRIDE_EXECUTED] cuando aplica
pm2 logs backend | grep "QC_OVERRIDE"
```

## Cambios Desde Antes

### Antes
```javascript
if (!qc.pass) {
  logger.warn('DESCARTADO');
  discardVideo(...); // ❌ BLOQUEA hardPassed
  continue;
}
```

### Ahora
```javascript
if (!qc.pass) {
  logger.warn('[QC_FAILED_SAVE_FOR_FALLBACK]');
  qcFailedCandidates.push(...); // ✅ SALVA hardPassed
  continue;
}
// Fallback loop intentará publicar
```

## Implicaciones

✅ Slots están protegidos: Si hay un MP4 válido, se publicará
✅ QC es consultivo: Informa pero no bloquea
✅ Degradation graceful: Mejor con QC, OK sin QC
✅ Observable: Logs muestran cada decisión
✅ Non-breaking: validateReadyCandidate() mantiene misma interfaz
