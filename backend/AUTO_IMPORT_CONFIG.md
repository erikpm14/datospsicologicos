# Auto-Import: Sincronización Output ↔ Queue

## Objetivo
Nunca perder un slot porque el scheduler no ve vídeos que existen en `output/`.

Cada vídeo renderizado en `output-fase1-test/{videoId}/output.mp4` se detecta automáticamente y se crea una entry en `queue/done/{videoId}.json` si no existe.

## Arquitectura

### Servicio Principal: `auto-import-from-output.service.js`
- **runSync()** - Ejecuta sync única (busca, valida, crea entries)
- **startAutoSync()** - Inicia sync periódico (configurable)
- **stopAutoSync()** - Detiene sync periódico
- **validateVideo()** - Valida que MP4 sea publicable
- **createQueueEntry()** - Crea entry en queue/done

### Startup: `auto-import-startup.js`
- Se llama automáticamente al arrancar la app
- Inicia sync periódico en background
- Graceful shutdown

### Integración en video-processor.js
```javascript
// Después de moveJob a done:
try {
  const { runSync } = require('../services/auto-import-from-output.service');
  setImmediate(() => runSync());
} catch (err) { /* ignorar */ }
```

### Ejecución Manual
```bash
# Single run
node run-auto-import.js

# Continuous (every 5 min)
node run-auto-import.js --continuous

# Custom interval (every 3 min)
node run-auto-import.js --continuous --interval 3
```

## Configuración (.env)

```env
# Habilitar/deshabilitar auto-import (default: true)
AUTO_IMPORT_ENABLED=true

# Intervalo de sync en minutos (default: 5, mínimo: 1)
AUTO_IMPORT_INTERVAL_MINUTES=5
```

## Validación

Para que un vídeo sea importado, debe cumplir:

1. **Archivo existe**: `output/{videoId}/output.mp4`
2. **Tamaño**: `> 1MB`
3. **Duración**: `8-120s` (verificado con ffprobe)
4. **No publicado**: No existe `published.json`
5. **No duplicado**: No existe entry en `queue/done/{videoId}.json`

## Logs

```
[AUTO_IMPORT] Created queue entry for 3a2d8a39... (35.1s)
[AUTO_IMPORT] videoId skipped: duration out of range: 2.4s
[AUTO_IMPORT_COMPLETE] scanned=56 imported=3 skipped=5 errors=2
```

## Ejemplo: Flujo Completo

```
1. Video renderizado en output-fase1-test/abc123/output.mp4 ✓
2. moveJob → queue/done ✓
3. auto-sync detecta output.mp4 sin entry
4. Valida: 35.1s, 26MB, audio/video OK ✓
5. Crea: queue/done/abc123.json
   [AUTO_IMPORT] Created queue entry for abc123 (35.1s)
6. Scheduler ve entry y puede publicarla
```

## Garantías

- ✓ No duplica entries existentes
- ✓ No importa vídeos ya publicados
- ✓ No importa vídeos truncados (<8s)
- ✓ No importa vídeos demasiado largos (>120s)
- ✓ Valida ffprobe antes de crear entry
- ✓ Non-blocking (runs in background)
- ✓ Graceful error handling

## Troubleshooting

### "output.mp4 not found"
→ Vídeo no finalizó la renderización

### "size too small: 500KB"
→ Archivo incompleto o corrupto

### "ffprobe failed"
→ Video corrupto, no se puede detectar duración

### "duration out of range: 2.4s"
→ Video truncado (se renderizó a menos de 8s)

### "already exists in queue/done"
→ Silenciosamente saltado (no es error)

### "already published"
→ Video ya tiene published.json, se ignora

## Monitoreo

Ver logs con:
```bash
pm2 logs backend --lines 100 | grep AUTO_IMPORT
```

Ejecutar sync manual y ver resultados:
```bash
node run-auto-import.js
```

## Integración Futura

Posibles mejoras:
- [ ] Webhooks al crear entries
- [ ] Notificaciones a Telegram cuando imports ocurren
- [ ] Dashboard de auto-import stats
- [ ] Retry policy para failed validations
- [ ] Batch import con limite de rate
