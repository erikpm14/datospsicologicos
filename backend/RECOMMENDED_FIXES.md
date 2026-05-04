# Fixes Recomendados para Sistema

## Fix #1: Subtitle-Audio Coherence Validator

**Archivo:** `src/services/production-quality-checker.service.js`

**Qué agregar:**

```javascript
// Nueva función de validación
async function validateSubtitleAudioCoherence(videoDir, script) {
  try {
    const subtitlePath = path.join(videoDir, 'subtitles.srt');
    if (!fs.existsSync(subtitlePath)) {
      return { ok: false, reason: 'subtitles_missing', score: 0 };
    }

    // Leer subtítulos
    const subtitleContent = fs.readFileSync(subtitlePath, 'utf-8');
    const subtitleWords = extractWordsFromSRT(subtitleContent)
      .slice(0, 25) // Primeras 25 palabras
      .join(' ')
      .toLowerCase();

    // Leer script esperado
    const scriptText = (script.explanation || script.hook || '')
      .slice(0, 200)
      .split(' ')
      .slice(0, 25)
      .join(' ')
      .toLowerCase();

    // Calcular similitud (palabras en común / total)
    const scriptWords = new Set(scriptText.split(' '));
    const subtitleWordsSet = new Set(subtitleWords.split(' '));
    
    const intersection = [...scriptWords].filter(w => subtitleWordsSet.has(w)).length;
    const union = new Set([...scriptWords, ...subtitleWordsSet]).size;
    const similarity = union > 0 ? intersection / union : 0;

    return {
      ok: similarity >= 0.8,
      reason: similarity < 0.8 ? 'subtitle_mismatch' : null,
      score: Math.round(similarity * 100),
      details: {
        expectedWords: scriptText.split(' ').filter(w => w.length > 2),
        actualWords: subtitleWords.split(' ').filter(w => w.length > 2),
        similarity: similarity
      }
    };
  } catch (err) {
    logger.warn(`Subtitle coherence check failed: ${err.message}`);
    return { ok: false, reason: 'check_failed', score: 0 };
  }
}

// Helper
function extractWordsFromSRT(srtContent) {
  return srtContent
    .split('\n')
    .filter(line => line.trim() && !/^\d+$/.test(line.trim()) && !line.includes('-->'))
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .flatMap(line => line.split(/\s+/));
}
```

**Integrar en QC checks:**

```javascript
// En checkProductionQuality():
const subtitleCoherence = await validateSubtitleAudioCoherence(videoDir, script);
checks.subtitleCoherence = subtitleCoherence;

if (!subtitleCoherence.ok) {
  score -= 20; // Major penalty
  reasons.push(subtitleCoherence.reason);
}
```

---

## Fix #2: Hook-Audio Presence Validator

**Archivo:** `src/services/production-quality-checker.service.js`

**Qué agregar:**

```javascript
// Nueva función de validación
async function validateHookAudioPresence(videoDir, script) {
  try {
    const subtitlePath = path.join(videoDir, 'subtitles.srt');
    if (!fs.existsSync(subtitlePath)) {
      return { ok: false, reason: 'subtitles_missing', score: 0 };
    }

    // Extraer palabras clave del hook
    const hookKeywords = (script.hook || '')
      .toLowerCase()
      .split(' ')
      .filter(w => w.length > 3) // Solo palabras > 3 caracteres
      .slice(0, 5); // Primeras 5 palabras principales

    if (hookKeywords.length === 0) {
      return { ok: false, reason: 'hook_empty', score: 0 };
    }

    // Leer primeros 15 segundos de subtítulos (aproximadamente 5 palabras)
    const subtitleContent = fs.readFileSync(subtitlePath, 'utf-8');
    const firstSubtitles = subtitleContent
      .split('\n')
      .filter(line => line.trim() && !/^\d+$/.test(line.trim()) && !line.includes('-->'))
      .slice(0, 3) // Primeras 3 líneas de subtítulos
      .join(' ')
      .toLowerCase();

    // Verificar presencia de keywords
    const foundKeywords = hookKeywords.filter(kw => firstSubtitles.includes(kw));
    const presence = foundKeywords.length / hookKeywords.length;

    return {
      ok: presence >= 0.6, // Al menos 60% de keywords presentes
      reason: presence < 0.6 ? 'hook_not_in_audio' : null,
      score: Math.round(presence * 100),
      details: {
        hookKeywords,
        foundKeywords,
        firstSubtitles: firstSubtitles.slice(0, 100)
      }
    };
  } catch (err) {
    logger.warn(`Hook audio presence check failed: ${err.message}`);
    return { ok: false, reason: 'check_failed', score: 0 };
  }
}
```

**Integrar en QC checks:**

```javascript
// En checkProductionQuality():
const hookPresence = await validateHookAudioPresence(videoDir, script);
checks.hookAudioPresence = hookPresence;

if (!hookPresence.ok) {
  score -= 25; // Very high penalty
  reasons.push(hookPresence.reason);
}
```

---

## Fix #3: Never Reuse Subtitle Files

**Archivo:** `src/services/render-engines/index.js`

**Qué cambiar:**

```javascript
async function renderVideoWithRouter(options) {
  const {
    script,
    audioPath,
    outputPath,
    outputDir,
    audioDuration,
    themeId,
    wordBoundaries = [],
    sectionDurations = []
  } = options;

  // NUEVO: Limpiar subtítulos viejos
  const subtitleExt = ['.srt', '.ass', '.vtt'];
  if (outputDir) {
    for (const ext of subtitleExt) {
      const oldSubPath = path.join(outputDir, `subtitles${ext}`);
      if (fs.existsSync(oldSubPath)) {
        fs.unlinkSync(oldSubPath); // Borrar subtítulos viejos
        logger.info(`Cleaned old subtitle: ${oldSubPath}`);
      }
    }
  }

  // Continuar con render normal...
  const renderMode = process.env.RENDER_MODE || 'video_use';
  // ... resto del código
}
```

**Rationale:** Asegurar que NUNCA se reutilicen archivos de renders anteriores.

---

## Fix #4: Force Fresh Render in Recovery Mode

**Archivo:** `quick-recovery-video.js`

**Qué cambiar:**

```javascript
async function generateRecovery() {
  try {
    logger.info('[Recovery] Iniciando generación de vídeo de recuperación');

    // NUEVO: NO reutilizar output existente
    // SIEMPRE regenerar fresco
    
    // 1. Generar script NUEVO (no reutilizar)
    const script = await generateBestScript();
    const videoId = 'recovery_' + Date.now();
    
    // NUEVO: Limpiar directorio si existe
    const dir = path.join('./output', videoId);
    if (fs.existsSync(dir)) {
      // Crear directorio nuevo limpio
      fs.rmSync(dir, { recursive: true });
    }
    fs.mkdirSync(dir, { recursive: true });

    script.id = videoId;
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(script, null, 2));

    // 2. Audio NUEVO
    const audioPath = path.join(dir, 'voice.mp3');
    logger.info('[Recovery] Sintetizando audio...');
    await synthesizeVoice({
      text: script.explanation || script.hook || 'Video de recuperación',
      outputPath: audioPath
    });

    // 3. Render NUEVO con output dir limpio
    const videoPath = path.join(dir, 'output.mp4');
    logger.info('[Recovery] Renderizando vídeo...');
    await renderVideoWithRouter({
      script,
      audioPath,
      outputPath: videoPath,
      outputDir: dir, // IMPORTANTE: pasar outputDir para cleaning
      audioDuration: 30,
      themeId: 'psychology_dark',
      wordBoundaries: [],
      sectionDurations: []
    });

    // 4. QC en directorio limpio
    logger.info('[Recovery] Validando QC...');
    const qc = await checkProductionQuality(dir, script);

    // ... resto del código
  } catch(err) {
    // ...
  }
}
```

---

## Fix #5: Add New Gates to publish() function

**Archivo:** `src/services/publisher.js` (o donde esté la lógica de publicación)

**Qué agregar ANTES de `publishToYouTube()`:**

```javascript
async function validateBeforePublish(videoDir, script) {
  const checks = {
    subtitle_audio_coherence: null,
    hook_audio_presence: null,
    subtitle_visibility: null,
    content_coherence_score: null
  };

  // Gate 1: Subtitle-Audio Coherence
  const subtitleCoherence = await validateSubtitleAudioCoherence(videoDir, script);
  checks.subtitle_audio_coherence = subtitleCoherence;
  if (!subtitleCoherence.ok) {
    return {
      approved: false,
      reason: 'subtitle_audio_mismatch',
      details: subtitleCoherence
    };
  }

  // Gate 2: Hook Audio Presence
  const hookPresence = await validateHookAudioPresence(videoDir, script);
  checks.hook_audio_presence = hookPresence;
  if (!hookPresence.ok) {
    return {
      approved: false,
      reason: 'hook_not_in_audio',
      details: hookPresence
    };
  }

  // Gate 3: Subtitle Visibility (heuristic)
  const subtitleFiles = [
    path.join(videoDir, 'subtitles.srt'),
    path.join(videoDir, 'subtitles.ass')
  ];
  const hasSubtitles = subtitleFiles.some(f => fs.existsSync(f));
  checks.subtitle_visibility = {
    ok: hasSubtitles,
    reason: !hasSubtitles ? 'no_subtitle_file' : null,
    score: hasSubtitles ? 100 : 0
  };
  if (!hasSubtitles) {
    return {
      approved: false,
      reason: 'no_subtitles',
      details: checks.subtitle_visibility
    };
  }

  // Gate 4: Content Coherence Score (combined)
  const coherenceScore = 
    (subtitleCoherence.score * 0.4 +
     hookPresence.score * 0.3 +
     100 * 0.3) / 100; // visibility = 100
  
  checks.content_coherence_score = {
    ok: coherenceScore >= 0.70,
    reason: coherenceScore < 0.70 ? 'low_coherence' : null,
    score: Math.round(coherenceScore * 100)
  };

  return {
    approved: coherenceScore >= 0.70,
    reason: 'coherence_check_passed',
    details: checks
  };
}

// Usar en publish():
// ANTES de calling publishToYouTube():
const prePublishValidation = await validateBeforePublish(videoDir, script);
if (!prePublishValidation.approved) {
  logger.error(`Publish gate FAILED: ${prePublishValidation.reason}`);
  throw new Error(`Publish rejected: ${prePublishValidation.reason}`);
}
```

---

## Timeline de Implementación

| Fix | Archivo | Esfuerzo | Prioridad |
|-----|---------|----------|-----------|
| #1 (Subtitle Coherence) | production-quality-checker.js | 2 horas | 🔴 URGENT |
| #2 (Hook Audio) | production-quality-checker.js | 2 horas | 🔴 URGENT |
| #3 (No Reuse Subtitles) | render-engines/index.js | 0.5 horas | 🔴 URGENT |
| #4 (Fresh Render in Recovery) | quick-recovery-video.js | 1 hora | 🔴 URGENT |
| #5 (New Gates) | publisher.js | 2 horas | 🟠 HIGH |

**Total estimado:** 7.5 horas = 1 día de trabajo intenso

---

## Testing después de implementar

**Use tools/rufler/workflows/validate-3-videos.yml:**

```bash
python tools/rufler/flow-executor.py tools/rufler/workflows/validate-3-videos.yml
```

Esto:
1. Genera 3 videos nuevos
2. Corre QC + nuevos gates en cada uno
3. Verifica que NONE pass con subtítulos desaliñados
4. Valida que hook aparece en primeros 5 segundos

---

## Resultado Esperado

Después de implementar estos fixes:

✅ **Videos con subtítulos desaliñados serán RECHAZADOS ANTES de publicar**
✅ **Recovery mode generará video FRESCO, no reutilizará old files**
✅ **Hook-Audio validator detectará mismatches automáticamente**
✅ **Casos como DrABIgSBAa0 NO volverán a ocurrir**
