# INSTRUCCIONES PARA VERIFICACIÓN DEL SLOT 2026-05-11 14:30

## 📋 ESTADO ACTUAL

El sistema está **LISTO Y ARMADO** para ejecutar automáticamente el slot programado:

```
Fecha:      2026-05-11
Hora:       14:30 Europe/Madrid (UTC+2)
Principal:  9e3208ce-04d9-47b1-9b7a-d3c2b7025867 (READY, CHECK_19 PASS)
Backup:     2b260bb2-0a8c-4ac6-ad54-14ba64ceae4e (READY, CHECK_19 PASS)
Status:     UNFROZEN, AUTO_PUBLISH_ENABLED=true, Scheduler ACTIVE
```

Ver: `READY-FOR-SLOT-2026-05-11-1430.md` para documentación completa.

---

## ⏰ TIMELINE

| Hora | Evento | Acción |
|------|--------|--------|
| **14:25** | Scheduler inicia verificación | (automático) |
| **14:30** | Slot ejecuta publicación | (automático) |
| **14:40** | ✅ Ejecutar script de verificación | `node backend/scripts/check-slot-result-20260511-1430.js` |

---

## ✅ CÓMO USAR EL SCRIPT DE VERIFICACIÓN

### Ejecución básica (después de 14:40):

```bash
cd backend
node scripts/check-slot-result-20260511-1430.js
```

**Salida esperada:** Informe completo con resultado del slot.

### Ejecución con modo verbose (para más detalles):

```bash
cd backend
node scripts/check-slot-result-20260511-1430.js --verbose
```

**Salida adicional:** Logs completos, metadatos, historial de publicaciones.

---

## 📊 INTERPRETACIÓN DEL RESULTADO

El script genera un informe en formato:

```
RESULTADO SLOT 2026-05-11 14:30

Estado:                    ✅ ÉXITO - Publicado
Vídeo publicado:           9e3208ce-04d9-47b1-9b7a-d3c2b7025867
YouTube ID:                [ID de YouTube]
Principal usado:           ✓ SÍ
Backup usado:              ✗ NO
Fallback usado:            ✗ NO

─ CHECK 19 AV_DURATION_SYNC:
  Ejecutado:               ✓ SÍ
  Resultado:               ✓ PASS

─ Publish Guard:
  Pasó:                    ✓ SÍ

─ Duplicate Hard Block:
  Pasó:                    ✓ SÍ

─ YouTube OAuth:
  Error:                   ✓ NO

─ Errores detectados:
  AV_DURATION_MISMATCH:    ✓ NO
  SLOT_LOST_FINAL:         ✓ NO
  NO_VALID_CANDIDATES:     ✓ NO

─ Estado final:
  Freeze status:           UNFROZEN
  AUTO_PUBLISH_ENABLED:    true
  Próximo slot calculado:  2026-05-11 21:15

ACCIÓN RECOMENDADA:
✅ PUBLICACIÓN EXITOSA
Video 9e3208ce-04d9-47b1-9b7a-d3c2b7025867 publicado como:
https://www.youtube.com/shorts/[youtubeId]
```

---

## 📋 POSIBLES RESULTADOS

### ✅ ÉXITO (Publicación exitosa)

**Indicadores:**
- ✓ Estado: ÉXITO
- ✓ Vídeo publicado: (principal o backup)
- ✓ YouTube ID: presente
- ✓ CHECK_19: PASS
- ✓ Publish Guard: Pasó
- ✓ Freeze: UNFROZEN

**Acciones después:**
1. Confirmar que no hay doble-publicación (revisar published.json)
2. Verificar que published.json existe en directorio del video
3. Documentar el éxito
4. Sistema continúa ARMADO para próximo slot 21:15

---

### ⚠️ FALLBACK (Backup utilizado porque principal falló)

**Indicadores:**
- ✓ Estado: ÉXITO
- ✓ Vídeo publicado: 2b260bb2... (backup)
- ✓ YouTube ID: presente
- Principal usado: ✗ NO
- Backup usado: ✓ SÍ
- ✓ CHECK_19: PASS (para backup)

**Acciones después:**
1. Investigar por qué principal falló
2. Revisar logs para detectar la causa
3. Documentar el fallback
4. Sistema continúa ARMADO para próximo slot 21:15

---

### ❌ FALLO (No se publicó nada)

**Indicadores:**
- ✗ Estado: FALLO
- ✗ Vídeo publicado: (ninguno)
- ✗ YouTube ID: N/A
- Principal usado: ✗ NO
- Backup usado: ✗ NO

**Posibles causas:**

#### Causa: CHECK_19 falló en ambos candidatos
```
CHECK 19 AV_DURATION_SYNC:
  Ejecutado: ✓ SÍ
  Resultado: ✗ FAIL
```
**Acción:** Ambos videos tienen AV gap > 0.35s. Investigar render pipeline.

#### Causa: Publish Guard bloqueó ambos
```
Publish Guard:
  Pasó: ✗ BLOQUEADO
```
**Acción:** Revisar logs para detectar qué validación bloqueó.

#### Causa: YouTube OAuth falló
```
YouTube OAuth:
  Error: ✗ SÍ - invalid_grant
```
**Acción:** Token expirado. Regenerar en http://localhost:3001/auth/youtube

#### Causa: No había vídeos READY válidos
```
NO_VALID_CANDIDATES: ✗ SÍ
```
**Acción:** No hay candidatos listos. Revisar estado de cola.

#### Causa: Sistema perdió el slot
```
SLOT_LOST_FINAL: ✗ SÍ
```
**Acción:** Backend se congió o timeout. Revisar logs de deadlock.

**Acciones después de fallo:**
1. ⚠️ NO ejecutar late-recovery automático
2. ⚠️ Contactar a operador para análisis
3. Revisar logs: `tail -200 logs/error.log`
4. Sistema sigue ARMADO para próximo slot 21:15 (si está disponible)
5. Late-recovery disponible dentro de 24h si es autorizada

---

## 🚫 RESTRICCIONES DURANTE EL SLOT

**NO HACER mientras se ejecuta el slot (14:25-14:40):**

- ❌ Publicar vídeos manualmente
- ❌ Ejecutar scripts de generación
- ❌ Reiniciar backend/worker
- ❌ Cambiar .env variables
- ❌ Modificar publication-freeze.json
- ❌ Tocar archivos de principal/backup
- ❌ Ejecutar late-recovery
- ❌ Ver dashboard por más de unos segundos (puede interferir)

**Está permitido:**
- ✓ Ver logs en tiempo real (lectura solamente)
- ✓ Monitorear procesos con `pm2 logs`
- ✓ Ejecutar este script después de 14:40

---

## 🔧 TROUBLESHOOTING

### El script dice "PRE-SLOT"

**Causa:** El slot aún no ha ocurrido.  
**Solución:** Ejecutar después de 14:40.

### El script no encuentra publish-log.json

**Causa:** Archivo corrupto o ausente.  
**Solución:** 
```bash
ls -la data/publish-log.json
cat data/publish-log.json  # Revisar si es JSON válido
```

### Error: "Cannot find module"

**Causa:** Ejecutando desde directorio incorrecto.  
**Solución:** 
```bash
cd backend
node scripts/check-slot-result-20260511-1430.js
```

### Salida confusa o incompleta

**Causa:** Logs aún se están escribiendo.  
**Solución:** Esperar 30 segundos y ejecutar de nuevo:
```bash
sleep 30 && node scripts/check-slot-result-20260511-1430.js
```

---

## 📞 ESCALACIÓN

Si después de ejecutar el script detectas:

1. **Fallo (No publicado)** → Contacta al operador para investigación
2. **Fallback (Backup usado)** → Revisar por qué falló principal
3. **Éxito (Publicado)** → Confirmar que no hay doble-publicación
4. **Indeterminado (Estado confuso)** → Ejecutar con `--verbose` y revisar logs

---

## 📝 PLANTILLA DE REPORTE POST-SLOT

Después de ejecutar el script, documentar usando esta plantilla:

```markdown
# REPORTE SLOT 2026-05-11 14:30

**Fecha de verificación:** [fecha/hora]
**Resultado:** [✅ ÉXITO / ⚠️ FALLBACK / ❌ FALLO / ? INDETERMINADO]

## Resultado script
```bash
$ node scripts/check-slot-result-20260511-1430.js
[pegar salida aquí]
```

## Verificación manual
- [ ] YouTube ID verifica en youtube.com/shorts/[ID]
- [ ] published.json existe en directorio del video
- [ ] publish-log.json tiene una sola entrada nueva
- [ ] No hay doble-publicación
- [ ] Próximo slot está calculado correctamente

## Acciones tomadas
[Documentar qué se hizo después]

## Notas
[Cualquier observación adicional]
```

---

## ℹ️ INFORMACIÓN ADICIONAL

- **Documentación de estado:** `READY-FOR-SLOT-2026-05-11-1430.md`
- **Logs en tiempo real:** `tail -f logs/error.log | grep -iE "2026-05-11|CHECK_19|publish"`
- **Estado del scheduler:** `pm2 logs` (buscar "PublishScheduler")
- **Scripts de emergencia disponibles:**
  - `scripts/freeze-publication.js`
  - `scripts/audit-av-sync.js`
  - `scripts/regenerate-subtitles.js`

---

**Generado:** 2026-05-10 23:23  
**Versión:** 1.0  
**Estado:** Sistema LISTO Y ARMADO ✅
