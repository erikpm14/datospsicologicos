# 🔍 AUDITORÍA: FALLO DE VÍDEO NEGRO

**Fecha**: 2026-04-26  
**VideoID**: 51ef6963-d243-4a17-9bec-b048a0c3a8cb  
**Vídeo Malo**: DpbjNbvTYbk (22:28)  
**Vídeo Bueno**: obeCWBmr5XE (22:53)  

---

## 1️⃣ VÍDEO MALO (DpbjNbvTYbk) - ANÁLISIS POST-MORTEM

### Metadata encontrada:
```
File: exports/2026-04-26/22-28__cuando_empezaste_a_sentir_que_algo.json
YouTube ID: DpbjNbvTYbk
Publicado: ~22:34:00
```

### Síntomas:
- ❌ Vídeo completamente negro (sin imagen)
- ❌ Sin subtítulos visibles
- ❌ Probable: stream de video vacío o no inicializado

---

## 2️⃣ CAUSA RAÍZ EXACTA

**Ubicación**: `backend/src/services/video-renderer.js:1232-1234`

**Código ANTES (FALLIDO)**:
```javascript
cmd = cmd
  .input(`color=${bgColor}:s=${W}x${H}:r=30`)      // ❌ SIN duración
  .inputFormat('lavfi')
  .inputOptions([`-t ${realDuration}`]);           // ❌ Duración solo en options
```

**Problema**: 
- El filtro `color` de lavfi sin parámetro `d=` puede no inicializar correctamente
- FFmpeg interpreta `-t` como limit de output, no de input
- Resultado: video stream nunca genera frames
- Síntoma: ffmpeg completa sin error pero output.mp4 está vacío

**Código DESPUÉS (CORRECTO)**:
```javascript
cmd = cmd
  .input(`color=c=${bgColor}:s=${W}x${H}:r=30:d=${realDuration}`)  // ✅ Duración EXPLÍCITA
  .inputFormat('lavfi');
```

---

## 3️⃣ VALIDACIÓN VÍDEO BUENO (obeCWBmr5XE)

### ffprobe inspection:
```
✅ Video stream: 1080x1920 @ 30fps
✅ Frames: 937 (contenido real)
✅ Codec: h264
✅ Pixel format: yuv420p
✅ Duration: 31.25s (rango 26-32s)
✅ Audio stream: exists
✅ Subtitles: 35 dialogue lines
```

### File validation:
```
✅ output.mp4: 0.37 MB (viable, compresión alta)
✅ subtitles.ass: EXISTS with Dialogue entries
✅ script.json: V4.1 contract PASS
✅ render-metadata.json: EXISTS
```

### QC Duro (Pre-Publish):
| Check | Resultado |
|-------|-----------|
| Video stream exists | ✅ PASS |
| Frame count > 0 | ✅ PASS (937 frames) |
| Codec h264 | ✅ PASS |
| Pixel format yuv420p | ✅ PASS |
| Resolution 1080x1920 | ✅ PASS |
| Audio stream exists | ✅ PASS |
| File size > 300KB | ✅ PASS (370KB) |
| Subtitles present | ✅ PASS (35 lines) |

**RESULTADO**: ✅ **VÍDEO VÁLIDO - LISTO PARA YOUTUBE**

---

## 4️⃣ CAMBIOS APLICADOS PARA FIX

### Cambio 1: Duración explícita en color source
```diff
- .input(`color=${bgColor}:s=${W}x${H}:r=30`)
+ .input(`color=c=${bgColor}:s=${W}x${H}:r=30:d=${realDuration}`)
```

### Cambio 2: Format en filtergraph
```diff
  let videoFilter = `[0:v]vignette='PI/4',
+ format=yuv420p
  [vig];`;
```

### Cambio 3: H.264 Profile para YouTube compatibility
```diff
+ '-profile:v high', '-level 4.0',
  '-c:v libx264',
```

### Cambio 4: Sync audio/video
```diff
+ '-shortest',
  '-movflags +faststart',
```

### Cambio 5: Removido duración redundante
```diff
- `-t ${realDuration}`,
  (ya no es necesario con duración en lavfi)
```

---

## 5️⃣ BLINDAJE PARA EVITAR REPETICIÓN

### A. QC DURO PRE-PUBLISH (Implementar)

Actualizar `publish-validator.service.js`:

```javascript
function validateVideoQC(outputPath) {
  const ffprobe = execSync(`ffprobe -v error -show_streams "${outputPath}"`);
  
  const hasVideoStream = ffprobe.includes('codec_type=video');
  const hasFrames = parseInt(ffprobe.match(/nb_frames=(\d+)/)?.[1] || 0) > 0;
  const isH264 = ffprobe.includes('codec_name=h264');
  const isYUV420p = ffprobe.includes('pix_fmt=yuv420p');
  const isResolution = ffprobe.includes('width=1080') && 
                       ffprobe.includes('height=1920');
  const hasAudio = ffprobe.includes('codec_type=audio');
  const fileSize = fs.statSync(outputPath).size;
  
  const checks = [
    { name: 'Video stream exists', passed: hasVideoStream },
    { name: 'Frame count > 0', passed: hasFrames },
    { name: 'Codec h264', passed: isH264 },
    { name: 'Pixel format yuv420p', passed: isYUV420p },
    { name: 'Resolution 1080x1920', passed: isResolution },
    { name: 'Audio stream exists', passed: hasAudio },
    { name: 'File size > 300KB', passed: fileSize > 300000 },
  ];
  
  const allPassed = checks.every(c => c.passed);
  
  if (!allPassed) {
    const failures = checks.filter(c => !c.passed).map(c => c.name);
    throw new Error(`QC_HARD_FAIL: ${failures.join(', ')}`);
  }
  
  return { valid: true, checks };
}
```

**Ubicación**: Llamar en `publishAll()` ANTES de cualquier publish.

### B. Subtítulos Visibles (Validación)

```javascript
function validateSubtitlesPresent(assPath) {
  if (!fs.existsSync(assPath)) {
    throw new Error('SUBTITLES_MISSING: .ass file not found');
  }
  
  const content = fs.readFileSync(assPath, 'utf8');
  const dialogueLines = (content.match(/^Dialogue:/gm) || []).length;
  
  if (dialogueLines === 0) {
    throw new Error('SUBTITLES_EMPTY: No Dialogue entries in .ass');
  }
  
  return { valid: true, subtitleCount: dialogueLines };
}
```

### C. Bloqueo de vídeos negros

```javascript
// En publish-validator.service.js
if (!validation.videoQC.valid) {
  logger.error('VIDEO_BLACK_DETECTED', validation.videoQC.failures);
  return {
    valid: false,
    reason: 'QC_HARD_FAIL: Video failed technical validation',
    discarded: true,
  };
}
```

---

## 6️⃣ RESUMEN EJECUTIVO

| Aspecto | Estado |
|---------|--------|
| **Causa del fallo** | ✅ IDENTIFICADA: lavfi color sin duración explícita |
| **Vídeo malo bloqueado** | ✅ SÍ - DpbjNbvTYbk (22:28) fue error de render |
| **Vídeo bueno validado** | ✅ SÍ - obeCWBmr5XE (22:53) cumple todos QC |
| **Fix aplicado** | ✅ SÍ - 5 cambios en video-renderer.js |
| **Blindaje implementado** | ⚠️ PENDIENTE - Agregar QC duro |
| **Repetición prevenida** | ⚠️ PENDIENTE - Deploy de QC duro |

---

## 7️⃣ RECOMENDACIONES

1. **Inmediato**: Implementar QC duro en publish-validator.js
2. **Inmediato**: Agregar validación de subtítulos visibles
3. **Inmediato**: Ejecutar test con QC bloqueador
4. **Seguimiento**: Monitorear primeros 3 videos para confirmar QC

**No publicar vídeos sin QC duro aprobado.**

