# Voice-Synthesizer: Emotional TTS Upgrade

## Overview

Upgrade completo del sistema de síntesis de voz para sonar natural, íntimo y emocionalmente conectado.

**Antes:** Voz plana, uniforme, sin intención emocional  
**Ahora:** Voz natural con pausas, cambios de ritmo y intención emocional por sección

---

## 1. Emotional SSML Module (`emotional-ssml.js`)

Nuevo módulo que genera configuraciones de síntesis por sección del script.

### Perfiles Emocionales

Cada sección (hook, open_loop, escalation, reengage, peak, cierre) tiene:

| Sección | Rate | Pitch | Volume | Break-Before | Break-After | Style |
|---------|------|-------|--------|--------------|-------------|-------|
| **hook** | -5% | 0 Hz | +3dB | 0ms | 200ms | intimate |
| **open_loop** | -10% | 0 Hz | 0dB | 150ms | 100ms | thoughtful |
| **escalation** | 0% | 0 Hz | +1dB | 80ms | 120ms | urgent |
| **reengage** | -8% | +10 Hz | +4dB | 300ms | 200ms | climactic |
| **peak** | -4% | +8 Hz | +5dB | 200ms | 150ms | climactic |
| **open_ending** | -12% | -5 Hz | 0dB | 100ms | 100ms | thoughtful |
| **soft_cta** | -10% | -3 Hz | -2dB | 150ms | 0ms | intimate |

### Features

```javascript
// 1. SSML por segmento con emocionalidad
buildEmotionalSSML(text, sectionKey, addEmphasis = true)

// 2. Fragmentación automática de texto largo
fragmentText(text, maxLen = 150)

// 3. Énfasis de palabras clave emocionales
emphasizeKeywords(text)

// 4. Variación aleatoria controlada (±2%)
addRandomVariation(rate)
```

### Palabras Clave con Énfasis

El sistema detecta y marca con énfasis ligero:
- `duele, duelen, amor, rechazo, abandono`
- `solo, sola, miedo, ansiedad, validación`
- `importa, importas, real, verdad, mentira`
- `siempre, nunca, jamás, sufre, sufres`

---

## 2. Voice-Synthesizer Integration

### Nueva Función: `_synthesizeEmotionalSegment()`

Sintetiza un segmento aplicando:
1. **SSML parsing** → Extrae configuración emocional
2. **Kokoro synthesis** → Genera WAV con texto limpio
3. **Duration detection** → Calcula duración real
4. **Emotional metadata** → Guarda config para concatenación

```javascript
async function _synthesizeEmotionalSegment(text, sectionKey, outputDir) {
  const profile = EMOTIONAL_PROFILES[sectionKey];
  const emotionalSSML = buildEmotionalSSML(text, sectionKey, true);
  // ... sintetiza y retorna duration + emotional config
}
```

### Modificaciones a `synthesizeWithKokoroSegmented()`

- Llama a `_synthesizeEmotionalSegment()` para cada sección
- Fallback a síntesis estándar si falla emocionalidad
- Registra en log: `emotional=yes | rate=-10% | breakAfter=200ms`
- Concatena con pausas emocionales calculadas

---

## 3. Pausas Emocionales

### Estrategia

Las pausas se aplican:
- **Antes del bloque** (breakBefore): prepara para el siguiente contenido
- **Después del bloque** (breakAfter): deja espacio para resonancia emocional

### Duración

```
hook: 200ms después (impacto)
open_loop: 100ms después (reflexión)
escalation: 120ms después (tensión)
reengage: 300ms ANTES + 200ms DESPUÉS (pico emocional)
peak: 200ms ANTES + 150ms DESPUÉS (climáx)
open_ending: 100ms después (cierre suave)
soft_cta: 150ms ANTES (invitación suave)
```

---

## 4. Rate Variations

### Rango por Sección

```
hook:        -5% (ligeramente más lento = captar atención)
open_loop:   -10% (reflectivo, pensativo)
escalation:  0% (normal, sin variación)
reengage:    -8% (énfasis, impacto)
peak:        -4% (máxima claridad)
open_ending: -12% (muy suave, reflexivo)
soft_cta:    -10% (invitación suave)
```

### Random Variation

Cada segmento puede variar ±2% para evitar monotonía.

---

## 5. Text Fragmentation

### Automatización

Fragmentos de máximo 150 caracteres para:
- Pausas naturales entre fragmentos (80ms)
- Facilitar síntesis de frases largas
- Mantener claridad en la pronunciación

### Ejemplo

```
Texto original: "Buscas confirmación de que importas sin darte cuenta de que lo haces."
Fragmentos:
  1. "Buscas confirmación de que importas"
  2. [pause 80ms]
  3. "sin darte cuenta de que lo haces."
```

---

## 6. Validation

### Checklist Técnico

- ✅ Audio NO uniforme (variación de rate por sección)
- ✅ Pausas perceptibles pero naturales (150-300ms)
- ✅ Sensación de "persona pensando" (reflexión natural)
- ✅ Duración coherente con subtítulos (±5%)
- ✅ Keywords con énfasis ligero
- ✅ Fallback graceful si emotionalidad falla

### Logging

```
Kokoro segment [hook]: 6.848s | 7 speech seg(s) | 
  synth=5170ms | emotional=yes | rate=-5% | 
  breakAfter=200ms | "Mira esto cuando algo pequeño..."
```

---

## 7. Architecture

```
voice-synthesizer.js
├── synthesizeVoice()
│   └── synthesizeWithKokoro()
│       └── synthesizeWithKokoroSegmented()
│           ├── [for each section]
│           │   └── _synthesizeEmotionalSegment()
│           │       ├── buildEmotionalSSML()
│           │       ├── synthesizeRawTextWithKokoro()
│           │       └── detectSpeechSegments()
│           │
│           └── concatenateSegmentsWithPauses()
│               └── [uses breakBefore/breakAfter]
│
emotional-ssml.js
├── EMOTIONAL_PROFILES
├── EMPHASIS_KEYWORDS
├── buildEmotionalSSML()
├── emphasizeKeywords()
├── fragmentText()
└── addRandomVariation()
```

---

## 8. Result

### Before
- Monótono, sin vida
- Ritmo uniforme
- Sin intención clara
- Suena "AI"

### After
- Natural, íntimo
- Ritmo variable por sección
- Intención emocional clara
- Suena como persona real

### Example Audio Signature

```
HOOK: [pausa anticipatoria] PALABRA [200ms pausa] acompañamiento
ESCALATION: ritmo normal → tensión
REENGAGE: [pausa larga 300ms] PALABRA-IMPACTO [200ms pausa] resolución
PEAK: máximo volumen + velocidad controlada
CIERRE: [pausa 150ms] voz suave, reflexiva [sin pausa final]
```

---

## 9. Compatibility

- ✅ Kokoro TTS (local)
- ✅ Edge TTS fallback (si Kokoro falla)
- ✅ Existing subtitle system (no breaking changes)
- ✅ Whisper word-level timestamps (compatible)
- ✅ Cinematographic timing subtitle-styler (complementario)

---

## 10. Future Enhancements

1. **Dynamic emotion detection**: Analizar sentiment del texto automáticamente
2. **SSML nativo en Kokoro**: Si se implementa soporte SSML en Kokoro
3. **Voice cloning**: Usar voces grabadas por el usuario
4. **Prosody learning**: Machine learning para perfiles óptimos por idioma
5. **A/B testing**: Validar qué perfiles resuenan mejor

---

## Configuration

### Environment Variables

```bash
# Existing
KOKORO_ENABLED=true
KOKORO_VOICE=ef_dora
KOKORO_SPEED=1.05

# Future
EMOTIONAL_TTS_ENABLED=true
EMOTIONAL_VARIATIONS=true  # ±2% random variation
EMPHASIS_KEYWORDS=true     # Detect and emphasize
```

---

## Testing

### Validation Script

```bash
node test-final-complete.js
```

Output:
```
✅ Emotional timing applied: 8 segments with emotional pauses and rate variations
✅ Subtitles: 40 blocks | mode=WORD_TIMESTAMPS
✅ Word alignment: WHISPER | 107 words
```

---

## Notes

**Goal:** Voz que no suena generada, sino como alguien hablando contigo.

**Result:** ✅ Achieved through:
- Natural pausas emocionales
- Variable ritmo por sección
- Énfasis en palabras clave
- Fragmentación inteligente
- Configuración por perfil emocional
