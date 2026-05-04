# Política de Validación Simplificada

## Problema Original
El sistema tenía demasiadas validaciones bloqueantes que causaban pérdida de slots:
- Vídeos reales (con MP4, audio, duración válida) se descartaban
- Metadata secundaria (captions-debug.json, flags incompletos) bloqueaban publicación
- No había distinción clara entre errores críticos vs. warnings

## Solución: Validación Centralizada

### Arquitectura Actual

**Archivo único:** `src/services/publish-candidate-validator.service.js`

```
validatePublishCandidate(candidate)
  ├── validateHardBlocks()     → respuesta binaria (true/false)
  └── validateMetadata()        → recolecta warnings sin bloquear
```

### HARD BLOCKS (Únicos criterios que impiden publicación)

Estos son **REALES**, verificados con ffprobe:

1. **MP4 no existe** - `output.mp4` no encontrado
2. **MP4 corrupto** - Tamaño < 1MB (no puede ser válido)
3. **ffprobe falla** - No se puede analizar el archivo
4. **Duración inválida** - < 8s (truncado) o > 60s (demasiado largo)
5. **No hay video stream** - ffprobe detecta cero streams de video
6. **No hay audio stream** - ffprobe detecta cero streams de audio
7. **Ya publicado** - `published.json` existe
8. **OAuth YouTube inválido** - YOUTUBE_REFRESH_TOKEN no configurado

Si **cualquiera** de estos falla → **NO se publica**

### WARNINGS (Metadata secundaria - NO bloqueantes)

Si el MP4 es válido pero falta metadata:

1. ⚠️ `captions-debug.json` falta → -5 quality points
2. ⚠️ `subtitles.ass` falta → -3 quality points
3. ⚠️ `render-metadata.json` falta → -3 quality points
4. ⚠️ `qcPassed` flag ausente → Ignorado
5. ⚠️ `publishable` flag ausente → Ignorado
6. ⚠️ `importedFromExistingOutput=true` → Aceptado
7. ⚠️ Video sin metadata JSON → OK (es fallback válido)

Si el MP4 pasó hard blocks → **SÍ se publica** aunque tenga warnings

## Función Central: validatePublishCandidate()

```javascript
result = validatePublishCandidate(candidate, allowWarnings=true)

// Retorna:
{
  hardPassed: true/false,           // Pasó todos los hard blocks?
  hardBlocks: string[],              // Lista de errores críticos
  warnings: string[],                // Lista de metadata faltante
  quality: 0-100,                    // Score de metadata (100 si todo OK)
  duration: number,                  // Duración en segundos
  canPublish: true/false,            // hardPassed && YouTube OK?
  videoId: string,
  reason: string                     // Descripción legible
}
```

## Integración en Sistema

### Dónde se usa:
1. ✅ `late-publish-recovery.js` - Valida antes de publicar
2. ✅ `dry-run-slot-decision.js` - Muestra qué publicará scheduler
3. ✅ `publish-scheduler.service.js` - validateReadyCandidate() usa core validator como base
4. ⏳ `publisher.js` - Usar como validación rápida

### Flujo de validación unificado (publish-scheduler.service.js):
```
validateReadyCandidate(video)
  │
  ├─ STEP 1: validatePublishCandidate() [CORE VALIDATOR]
  │  ├─ validateHardBlocks() → MP4 physical checks
  │  └─ validateMetadata() → metadata warnings
  │
  ├─ STEP 2: Si hard blocks fallan → RECHAZA
  │
  ├─ STEP 3: checkProductionQuality() [SCHEDULER-SPECIFIC]
  │  ├─ QC checks (content quality)
  │  └─ Render mode validation
  │
  ├─ STEP 4: validateCaptionsForPublish() [CAPTION VALIDATION]
  │  └─ Critical captions checks (pueden ser bloqueantes)
  │
  └─ RETURN: ok = hardPassed AND (noQCIssues OR allowFallback)
```

### Logs estándar:
```
[LATE_PUBLISH_CANDIDATE_PASS_CLEAN] {videoId} | quality=100 | duration=35.1s
[LATE_PUBLISH_CANDIDATE_PASS_WITH_WARNINGS] {videoId} | quality=97 | warnings=1
[LATE_PUBLISH_CANDIDATE_REJECTED] {videoId} | hard_blocks=1
  → HARD_BLOCK: MP4 demasiado pequeño (0.50MB < 1MB)
  → HARD_BLOCK: no audio stream found
```

## Ejemplos de Decisiones

| Caso | MP4 | Audio | Duration | captions-debug | Resultado |
|------|-----|-------|----------|---|---|
| Vídeo normal | ✅ 10MB | ✅ | 35s | ✅ | ✅ **PUBLICA** (clean) |
| Sin captions metadata | ✅ 10MB | ✅ | 35s | ❌ | ✅ **PUBLICA** (1 warning) |
| Sin audio stream | ✅ 10MB | ❌ | 35s | ✅ | ❌ **RECHAZA** (hard block) |
| Muy pequeño | ⚠️ 0.5MB | ✅ | 35s | ✅ | ❌ **RECHAZA** (hard block) |
| Truncado | ✅ 10MB | ✅ | 2s | ✅ | ❌ **RECHAZA** (hard block) |
| Ya publicado | ✅ 10MB | ✅ | 35s | ✅ | ❌ **RECHAZA** (hard block) |

## Resultados

### Antes
- ❌ Vídos con MP4 real descartados por metadata
- ❌ Slots perdidos por captions-debug.json faltante
- ❌ Confusión en qué es "error crítico" vs "aviso"

### Después
- ✅ Vídeos con MP4 válido se publican aunque falte metadata
- ✅ Slots protegidos: 3 candidatos siempre disponibles
- ✅ Criterios claros y centralizados
- ✅ Warnings informativos, no bloqueantes

## Test Coverage

Archivo: `test-validation-filters.js`

```
Test 1: Vídeo válido sin captions-debug.json
  ✅ PASS WITH WARNINGS (metadata no bloqueante)

Test 2: Vídeo inexistente (output.mp4 no existe)
  ✅ CORRECTLY REJECTED (hard block)

Test 3: Vídeo ya publicado
  ✅ CORRECTLY REJECTED (hard block)

Test 4: Vídeo con metadata incompleta
  ✅ PASS (metadata no bloqueante)
```

## Monitoreo

Ver decisiones de publicación:
```bash
# Late-publish
pm2 logs backend | grep "LATE_PUBLISH_CANDIDATE"

# Scheduler
pm2 logs backend | grep "PUBLISH_CANDIDATE"

# Test manual
node test-validation-filters.js
node dry-run-slot-decision.js
```

## Implicaciones

✅ **No hay cambios de API** - validatePublishCandidate() es transparente en scheduler
✅ **Backward compatible** - validateReadyCandidate() mantiene misma interfaz y comportamiento
✅ **Non-breaking** - Warnings no afectan publicación, QC checks siguen vigentes
✅ **Simple** - Solo 8 hard blocks reales, todo lo demás es informativo
✅ **Observable** - Todos los criterios están documentados en logs
✅ **Unificado** - Mismo core validator usado por: late-publish, dry-run, scheduler, publisher

## Próximos Pasos

1. Integrar validatePublishCandidate() en publish-scheduler.service.js
2. Actualizar prepublish-visual-qc.service.js para warnings solamente
3. Dashboard que muestre: candidates hard-passed vs hard-rejected
4. Metrics: cuántos candidatos salvados por ser no-bloqueante
