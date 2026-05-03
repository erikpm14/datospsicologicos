# Performance Tracking — Análisis de Rendimiento de Vídeos

## Descripción

Sistema de tracking no-invasivo que captura información de cada vídeo generado y publicado para analizar rendimiento sin modificar el pipeline.

**Ubicación:** `backend/data/video-performance.json`

---

## Datos Capturados

Cada vídeo registra:

```json
{
  "videoId": "abc123def456",
  "hook": "Tu cerebro está saboteando tu relación",
  "pattern_used": "Tu cerebro está haciendo esto",
  "topic": "relationships",
  "viralityTier": "TIER_1_VIRAL",
  "duration": 23.5,
  "generatedAt": "2026-05-03T14:30:45.123Z",
  "renderedAt": "2026-05-03T14:31:30.456Z",
  "publishedAt": "2026-05-03T14:32:00.789Z",
  "youtubeId": "xyz789abc123",
  "source": "script_generation"
}
```

### Campos

| Campo | Fuente | Descripción |
|-------|--------|-------------|
| `videoId` | content-generator | ID único del vídeo (UUID) |
| `hook` | content-generator | Hook utilizado (primeras palabras) |
| `pattern_used` | content-generator | Patrón psicológico (ej: "sesgo cognitivo") |
| `topic` | content-generator | Tema (relationships, habits, etc.) |
| `viralityTier` | video-renderer | Clasificación viral (TIER_1_VIRAL, TIER_2_HIGH, etc.) |
| `duration` | video-renderer | Duración del vídeo en segundos |
| `generatedAt` | content-generator | Timestamp de generación de script |
| `renderedAt` | video-renderer | Timestamp de renderización |
| `publishedAt` | publisher | Timestamp de publicación |
| `youtubeId` | publisher | ID de YouTube del vídeo publicado |

---

## Integración en Pipeline

### 1. Content Generator (Script Generation)
```javascript
// src/services/content-generator.js (línea ~885)
await performanceTracker.trackScriptGeneration({
  videoId: script.videoId,
  hook: script.hook,
  pattern_used: script.viralTrigger,
  topic: script.topic,
});
```

**Captura:** Hook + pattern + topic cuando se genera el script

---

### 2. Video Renderer (Rendering)
```javascript
// src/services/video-renderer.js (línea ~1190)
await performanceTracker.trackVideoRender(script.videoId, realDuration);
```

**Captura:** Duración del vídeo renderizado

---

### 3. Publisher (Publishing)
```javascript
// src/services/publisher.js (línea ~505)
await performanceTracker.trackPublish(videoId, ytResult.videoId, new Date().toISOString());
```

**Captura:** youtubeId + fecha de publicación

---

## Uso

### Ver Análisis de Performance

```bash
# Resumen completo
node scripts/analyze-performance.js

# Solo análisis de hooks
node scripts/analyze-performance.js hooks

# Solo análisis de topics
node scripts/analyze-performance.js topics

# Datos crudos (JSON)
node scripts/analyze-performance.js raw
```

### Integrar en NPM Scripts

Agregar a `backend/package.json`:
```json
{
  "scripts": {
    "perf:analyze": "node scripts/analyze-performance.js",
    "perf:hooks": "node scripts/analyze-performance.js hooks",
    "perf:topics": "node scripts/analyze-performance.js topics"
  }
}
```

Luego usar:
```bash
npm run perf:analyze
npm run perf:hooks
npm run perf:topics
```

---

## Análisis Disponibles

### 1. Por Hook
Responde: **¿Qué hook genera más publicaciones?**

```
Hook                                    Count  Published  Pub.Rate  Avg Duration
──────────────────────────────────────  ─────  ──────────  ────────  ────────────
Tu cerebro está saboteando...           12     11         91.7%     23.4s
¿Por qué SIEMPRE te pasa esto?         10     8          80.0%     22.1s
TODO lo que crees es mentira            8      6          75.0%     24.2s
```

### 2. Por Topic
Responde: **¿Qué tema funciona mejor?**

```
Topic            Count  Published  Pub.Rate  Avg Duration
────────────────  ─────  ──────────  ────────  ────────────
relationships     28     24         85.7%     23.2s
habits            15     12         80.0%     22.8s
cognitive_biases  12     10         83.3%     23.9s
```

### 3. Por Virality Tier
Responde: **¿TIER_1 realmente funciona mejor?**

```
Tier            Count  Published  Publication Rate
──────────────  ─────  ──────────  ────────────────
TIER_1_VIRAL    35     31         88.6%
TIER_2_HIGH     18     13         72.2%
TIER_3_GOOD     8      5          62.5%
```

---

## Casos de Uso

### 1. Identificar Hooks Ganadores
```bash
npm run perf:hooks | head -5
```
→ Ver cuál de los 10 hooks virales funciona mejor

### 2. Optimizar por Topic
```bash
npm run perf:topics
```
→ Saber si debo enfocarse más en `relationships` o `habits`

### 3. Validar Virality Ranking
Comparar TIER_1 vs TIER_2 vs TIER_3 para confirmar que el ranking funciona

### 4. Monitorear Duration
Verificar que la duración promedio esté en rango óptimo (18-25s)

### 5. Detectar Problemas
- Si `Published = 0`: problema en publicación a YouTube
- Si `Hook = NULL`: problema en captura de hook en generator
- Si `Duration = NULL`: problema en captura de duración en renderer

---

## Estructura del Archivo

```json
{
  "videos": [
    { videoId, hook, pattern_used, topic, viralityTier, duration, ... },
    { ... },
    { ... }
  ],
  "metadata": {
    "lastUpdate": "2026-05-03T14:32:00.789Z",
    "totalTracked": 55
  }
}
```

**Tamaño aproximado:**
- 1 vídeo ≈ 500 bytes
- 100 vídeos ≈ 50KB
- 1,000 vídeos ≈ 500KB
- 10,000 vídeos ≈ 5MB

---

## API de Performance Tracker

```javascript
const tracker = require('./src/services/performance-tracker.service');

// Registrar generación de script
await tracker.trackScriptGeneration({
  videoId: "abc123",
  hook: "Tu cerebro...",
  pattern_used: "sesgo cognitivo",
  topic: "relationships"
});

// Registrar renderización
await tracker.trackVideoRender("abc123", 23.5, {
  viralityTier: "TIER_1_VIRAL"
});

// Registrar publicación
await tracker.trackPublish("abc123", "xyz789", new Date().toISOString());

// Obtener análisis
const analysis = tracker.getPerformanceAnalysis();
// {
//   totalVideos: 55,
//   published: 48,
//   byHook: { ... },
//   byTopic: { ... },
//   byTier: { ... }
// }

// Obtener hooks ganadores
const topHooks = tracker.getTopHooks(5);
// [ { hook, count, published, publicationRate, avgDuration }, ... ]

// Obtener topics ganadores
const topTopics = tracker.getTopTopics(5);
// [ { topic, count, published, publicationRate, avgDuration }, ... ]

// Exportar para dashboard
const dashboard = tracker.exportDashboardData();
// { summary, analysis, topHooks, topTopics, rawData }
```

---

## Garantías

✅ **Non-invasive:** No modifica pipeline ni lógica de generación/publicación
✅ **Non-blocking:** Si el tracking falla, el vídeo se sigue generando/publicando
✅ **Persistent:** Los datos se guardan en `backend/data/video-performance.json`
✅ **Reversible:** Se puede eliminar sin afectar el sistema
✅ **Auto-escalable:** Maneja miles de vídeos sin degradación de performance

---

## Próximos Pasos (Opcional)

### Dashboard en Vivo
Crear endpoint `/api/performance` que retorne los análisis en tiempo real

### Alertas Automáticas
Enviar notificación si:
- Publication rate cae debajo de 80%
- Algún hook tiene 0 publicaciones (broken hook)
- Topic está underperforming (< 50% pub rate)

### A/B Testing
Experimentar con nuevos hooks y comparar contra baseline

### Exportar a CSV
```bash
node scripts/export-performance.js --format=csv
```

---

## Troubleshooting

### El archivo video-performance.json no existe
→ Se crea automáticamente en el primer tracking
→ Si no se crea, verificar permisos en `backend/data/`

### Los datos son NULL/undefined
→ Verificar que el tracking se está llamando (buscar "[tracking]" en logs)
→ Si no aparece, el campo no se está capturando en el script

### Publication rate es 0%
→ Los vídeos se generan pero no se publican
→ Verificar que YOUTUBE_REFRESH_TOKEN está configurado

---

**Status:** ✅ IMPLEMENTADO
**Archivos:** 
- `src/services/performance-tracker.service.js` (tracker)
- `scripts/analyze-performance.js` (CLI)
- Integrado en: content-generator, video-renderer, publisher

**Uso:** `node scripts/analyze-performance.js`
