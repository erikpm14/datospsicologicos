# FASE 1 Y FASE 2 — LIMPIEZA Y SCRIPT REAL

**Fecha:** 2026-05-12 10:35 UTC  
**Status:** ✅ FASE 1 COMPLETADA, FASE 2 SCRIPT CREADO  
**Sistema:** 🔴 FROZEN CRITICAL (sin cambios)  

---

## FASE 1 — LIMPIAR REGISTROS FALSOS

### ✅ Backup Creado

**Ubicación:** `backend/backup-clean-simulated-publish-20260512-103342/`

Archivos respaldados:
- ✓ .env
- ✓ publish-log.json
- ✓ slot-publication-locks.json
- ✓ published.json (falso)
- ✓ publication-freeze.json

Permite restauración completa si es necesario.

### ✅ published.json Falso Renombrado

**Antes:** `published.json` (con youtubeId TEST_dfbe032d_556038)  
**Después:** `published.simulated.json` (evidencia preservada)  

Ubicación: `backend/output-fase1-test/dfbe032d-98c3-4a03-954a-0410f6f83de2/published.simulated.json`

**Contenido:**
```json
{
  "videoId": "dfbe032d-98c3-4a03-954a-0410f6f83de2",
  "youtubeId": "TEST_dfbe032d_556038",
  "publishedAt": "2026-05-12T08:29:16.039Z",
  "method": "manual-publish-single-controlled",
  "sha256": "BF6BD062E7B1330ED8E6D7CE0FAE412C24A77B0021CC15F51E52C58AA197F397"
}
```

### ✅ publish-log.json Corregido

**Entrada actualizada para dfbe032d:**

| Campo | Valor |
|-------|-------|
| videoId | dfbe032d-98c3-4a03-954a-0410f6f83de2 |
| youtubeId | TEST_dfbe032d_556038 |
| status | **SIMULATED** (era PUBLISHED) |
| realUpload | **false** (agregado) |
| simulated | **true** (agregado) |
| invalidYoutubeId | **true** (agregado) |
| reason | SIMULATED_MANUAL_PUBLISH_NOT_REAL_YOUTUBE_UPLOAD (agregado) |

**Ahora:** No cuenta como publicación real en dashboard/scheduler.

### ✅ slot-publication-locks.json Corregido

**Entry para dfbe032d:**

| Campo | Valor |
|-------|-------|
| youtubeId | TEST_dfbe032d_556038 (fake, no real) |
| realUpload | **false** |
| simulated | **true** |
| invalidYoutubeId | **true** |
| unlocked_for_real_publish | **true** (permite publicación real futura) |
| idempotencyLocked | true (pero solo para TEST_, no para ID real) |

**Ahora:** Permite publicación real futura sin conflictos.

### ✅ Evidencia Preservada

Copia de published.simulated.json en:
`incident-bad-upload-20260512/simulated-publish-evidence/published.simulated.json`

Mantiene auditoría completa del incidente.

### ✅ Estado Final Confirmado

| Aspecto | Estado |
|---------|--------|
| **published.json real** | ❌ NO EXISTE (correcto) |
| **dfbe032d candidato** | ✅ DISPONIBLE (validado) |
| **publish-log** | ✅ Marcado como SIMULATED |
| **slot-lock** | ✅ Permite publicación real |
| **AUTO_PUBLISH_ENABLED** | ✅ false (sin cambios) |
| **publication-freeze.json** | ✅ FROZEN (sin cambios) |
| **Scheduler** | ✅ Pausado (sin cambios) |

---

## FASE 2 — CREAR SCRIPT REAL DE PUBLICACIÓN CONTROLADA

### ✅ Script Creado

**Archivo:** `backend/scripts/manual-publish-single-real-private.js`

**Propósito:** Publicación real controlada a YouTube en PRIVADO usando YouTube Data API real.

### Características del Script

#### ✅ Restricciones de Seguridad

- Solo publica: `dfbe032d-98c3-4a03-954a-0410f6f83de2`
- Rechaza cualquier otro videoId (error fatal)
- Requiere `--confirm-private-upload` explícito para upload real
- Soporta `--dry-run` para simular sin subir

#### ✅ Validaciones Pre-Publicación

Falla si:
- ❌ falta `--confirm-private-upload` (para upload real)
- ❌ videoId no coincide con dfbe032d-98c3-4a03-954a-0410f6f83de2
- ❌ AUTO_PUBLISH_ENABLED=true
- ❌ publication-freeze.json NO está FROZEN
- ❌ ya existe published.json con youtubeId real
- ❌ existe slot lock para youtubeId real previo
- ❌ SHA256 no coincide (archivo corrupto)
- ❌ pre-upload audit falla
- ❌ safety suite falla (CHECK_19, 20, 21, 22, 23)
- ❌ YouTube credentials faltan
- ❌ el archivo exacto no existe

#### ✅ Usa YouTube API Real

```javascript
const {google} = require('googleapis');
const youtube = google.youtube({
  version: 'v3',
  auth: oauth2Client,
});

const response = await youtube.videos.insert({
  part: 'snippet,status',
  requestBody: {...},
  media: {
    body: fs.createReadStream(videoPath)
  }
});
```

Características:
- ✓ Autentica con YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
- ✓ Llama `youtube.videos.insert` real
- ✓ Media upload con `fs.createReadStream`
- ✓ Obtiene YouTube ID real (11 caracteres)

#### ✅ Publica Como PRIVADO

```javascript
status: {
  privacyStatus: 'private',  // ← PRIVADO, no public
  madeForKids: false,
}
```

**Propósito:** Permitir revisión manual en YouTube Studio antes de público.

#### ✅ Valida YouTube ID Real

```javascript
function validateYoutubeId(youtubeId) {
  // No puede empezar por TEST_
  if (!youtubeId || youtubeId.startsWith('TEST_')) {
    return false;
  }
  // Debe parecer ID real: 11 caracteres alfanuméricos
  return /^[A-Za-z0-9_-]{11}$/.test(youtubeId);
}
```

Si YouTube API retorna ID inválido, falla fatal.

#### ✅ Guarda Registros Reales

Si el upload real es exitoso:

**published.json real:**
```json
{
  "videoId": "dfbe032d-98c3-4a03-954a-0410f6f83de2",
  "youtubeId": "<REAL_ID_11_CHARS>",
  "publishedAt": "...",
  "method": "manual-publish-single-real-private",
  "privacyStatus": "private",
  "sha256": "BF6BD062E7B1330ED8E6D7CE0FAE412C24A77B0021CC15F51E52C58AA197F397",
  "realUpload": true,
  "simulated": false,
  "apiResponse": { ... }
}
```

**publish-log.json:** Entrada con realUpload=true  
**slot-publication-locks.json:** Lock real activo, previene doble publicación  

#### ✅ Mantiene Sistema FROZEN

Después de publicar real:
- AUTO_PUBLISH_ENABLED=false (sin cambios)
- publication-freeze.json=FROZEN (sin cambios)
- Scheduler NO se activa
- No hay auto-publicación
- No hay backup
- No hay late-recovery

### Cómo Ejecutar

#### DRY-RUN (simulación, NO sube nada)

```bash
node backend/scripts/manual-publish-single-real-private.js dfbe032d-98c3-4a03-954a-0410f6f83de2 --dry-run
```

**Lo que hace:**
- ✓ Ejecuta todas las validaciones
- ✓ Verifica credenciales YouTube
- ✓ Simula upload (NO llama YouTube API)
- ✓ Reporta si todo está listo

**Lo que NO hace:**
- ❌ No sube a YouTube
- ❌ No genera published.json real
- ❌ No modifica registros

**Salida esperada:**
```
✓ Todas las validaciones pasaron
✓ Credenciales YouTube API: ✓ Detectadas
✓ Archivo listo para upload: ...
✓ Privacidad sería: private
✓ Sistema seguiría FROZEN tras publicación real

✅ DRY-RUN EXITOSO - Listo para publicación real controlada
```

#### UPLOAD REAL A YOUTUBE (privado)

```bash
node backend/scripts/manual-publish-single-real-private.js dfbe032d-98c3-4a03-954a-0410f6f83de2 --confirm-private-upload
```

**Lo que hace:**
- ✓ Ejecuta todas las validaciones
- ✓ Llama youtube.videos.insert real
- ✓ Sube MP4 a YouTube (en PRIVADO)
- ✓ Obtiene YouTube ID real
- ✓ Genera published.json real
- ✓ Actualiza publish-log.json
- ✓ Activa slot lock real

**Salida esperada:**
```
✓ Upload exitoso a YouTube
  YouTube ID: <REAL_11_CHAR_ID>
  Privacidad: private
  Timestamp: 2026-05-12T...

✅ PUBLICACIÓN REAL CONTROLADA COMPLETADA CON ÉXITO

📺 Ver en YouTube Studio (privado):
https://studio.youtube.com/video/<REAL_ID>/edit
```

### Seguridades del Script

1. ✅ **Requiere confirmación explícita:** `--confirm-private-upload` debe escribirse exactamente
2. ✅ **Solo un videoId permitido:** Rechaza cualquier otro
3. ✅ **Validaciones estrictas:** Falla si algo no cumple
4. ✅ **Privacidad por defecto:** Sube como PRIVATE, no PUBLIC
5. ✅ **YouTube ID validado:** Rechaza IDs fake (TEST_)
6. ✅ **Sistema FROZEN protegido:** No activa scheduler, no AUTO_PUBLISH_ENABLED
7. ✅ **Doble publicación imposible:** Slot lock previene re-publicación
8. ✅ **Dry-run disponible:** Prueba sin riesgo antes de real

---

## FASE 3 — DRY-RUN (SIN EJECUTAR TODAVÍA)

El script está listo. Para ejecutar dry-run cuando lo autorices:

```bash
node backend/scripts/manual-publish-single-real-private.js dfbe032d-98c3-4a03-954a-0410f6f83de2 --dry-run
```

**Requisitos previos:**
- Sistema debe estar FROZEN (actual: ✓ FROZEN)
- AUTO_PUBLISH_ENABLED debe ser false (actual: ✓ false)
- Credenciales YouTube API deben estar en .env

---

## INFORME FINAL

### LIMPIEZA SIMULACIÓN (FASE 1)

| Item | Estado |
|------|--------|
| Backup creado | ✅ backend/backup-clean-simulated-publish-20260512-103342/ |
| published falso | ✅ Renombrado a published.simulated.json |
| publish-log | ✅ Marcado como SIMULATED |
| slot-lock | ✅ Marcado como SIMULATED |
| dfbe032d disponible | ✅ SÍ, sin bloqueos reales |
| Evidencia preservada | ✅ SÍ, en incident-bad-upload-20260512/ |

### SCRIPT REAL PRIVATE (FASE 2)

| Item | Valor |
|------|-------|
| Archivo | backend/scripts/manual-publish-single-real-private.js |
| Usa YouTube API real | ✅ youtube.videos.insert |
| Usa privacy private | ✅ privacyStatus='private' |
| Confirmación requerida | ✅ --confirm-private-upload |
| Bloqueos de seguridad | ✅ 10+ validaciones |
| Dry-run disponible | ✅ --dry-run |
| Mantiene FROZEN | ✅ SÍ |

### ESTADO FINAL

| Config | Valor |
|--------|-------|
| AUTO_PUBLISH_ENABLED | false (sin cambios) |
| publication-freeze.json | FROZEN CRITICAL (sin cambios) |
| Scheduler | Pausado (sin cambios) |
| published.json real | ❌ No existe |
| youtubeId real | ❌ No existe (aún) |
| Publicación real realizada | ❌ No (esperando autorización) |
| Riesgo | ✅ CERO |

### DECISIÓN

✅ **Está listo para que yo autorice upload real privado**

**Comando exacto para upload real privado (NO ejecutado todavía):**
```bash
node backend/scripts/manual-publish-single-real-private.js dfbe032d-98c3-4a03-954a-0410f6f83de2 --confirm-private-upload
```

**Comando exacto para dry-run (simulación segura, puede ejecutarse):**
```bash
node backend/scripts/manual-publish-single-real-private.js dfbe032d-98c3-4a03-954a-0410f6f83de2 --dry-run
```

---

**Status:** ✅ FASE 1 Y FASE 2 COMPLETADAS  
**Sistema:** 🔴 FROZEN CRITICAL (protegido)  
**Próximo paso:** Autorizar FASE 3 (dry-run o upload real)  

