# Background Diversity System — Guía de Referencia

## Descripción General

Sistema completo de rotación y diversidad visual para evitar que los Shorts del canal parezcan clonados. Mantiene historial de fondos usados e implementa scoring inteligente para seleccionar activos visuales distintos.

## Componentes

### 1. **Servicio Principal**
- **Archivo**: `backend/src/services/background-diversity.service.js`
- **Funciones**: 
  - `selectBackground(videoId)` - Selecciona el mejor fondo según diversidad
  - `getRecentUsageStats()` - Retorna estadísticas de uso
  - `validateBackgroundDiversity(script)` - Valida diversidad de un vídeo
  - `applyBackgroundRotation(script)` - Aplica plan de rotación

### 2. **Estado Persistente**
- **Archivo**: `backend/data/background-usage-state.json`
- **Contenido**: 
  - Historial de últimos fondos usados (últimas 20)
  - Distribución de categorías
  - Distribución de colores dominantes
  - Timestamps de uso

### 3. **Scripts de Ejecución**

#### Generación Manual
```bash
npm run manual:generate
# O completo:
npm run emergency:publish
```
Integra automáticamente selección de fondo.

#### Estadísticas
```bash
npm run stats:background-diversity
```
Muestra estado actual de diversidad visual del canal.

## Categorías Visuales

14 categorías disponibles:
1. **abstract** - Redes neurales/energía abstracta
2. **dark_texture** - Texturas oscuras
3. **particles** - Efectos de partículas
4. **city_night** - Ciudades de noche
5. **human_silhouette** - Siluetas humanas
6. **social_scenes** - Escenas sociales/personas
7. **emotional_portrait** - Retratos emocionales
8. **nature_moody** - Naturaleza/moody
9. **glitch_digital** - Glitch/digital
10. **minimal_dark** - Minimalista oscuro
11. **psychology_symbolic** - Simbología psicológica
12. **geometric_motion** - Movimiento geométrico
13. **document_textural** - Texturas documentales
14. **neutral_cinematic** - Cinemático neutral

## Algoritmo de Scoring

Cada fondo recibe una puntuación basada en:

```
finalScore = (colorDiversity × 0.3) + 
             (categoryDiversity × 0.3) + 
             (noveltyScore × 0.4) - 
             temporalPenalty
```

### Componentes del Score:

1. **colorDiversity** (30%)
   - Penaliza si colores dominantes coinciden con últimos 3 vídeos
   - Rango: 0-100

2. **categoryDiversity** (30%)
   - Penaliza reutilización de categoría reciente
   - 100 si no se usó recientemente
   - 70 si se usó una vez
   - 30 si se usó dos o más veces

3. **noveltyScore** (40%)
   - 100 si el asset no se usó en últimos 10 vídeos
   - 10 si se usó recientemente (fuerte penalización)

4. **temporalPenalty**
   - 60 puntos para "abstract purple" (veto temporal de 10 vídeos)
   - Otros: 0

## Reglas de Diversidad

1. **No reutilizar** el mismo asset exacto en últimos 10 vídeos
2. **No repetir** la misma categoría en 2 vídeos seguidos
3. **No clonar colores**: evitar dominantColors similares en últimos 3
4. **Veto temporal**: purple/pink abstract penalizado fuertemente
5. **Threshold mínimo**: diversityScore ≥ 40 para publicación

## Flujo de Selección

```
1. Cargar historial de fondos usados
2. Calcular score para cada asset disponible
3. Penalizar categorías/colores recientes
4. Aplicar veto temporal si aplica
5. Seleccionar asset con mayor score
6. Actualizar historial
7. Guardar estado persistente
```

## Integración en Flujos

### Manual Generation
```javascript
const { selectBackground } = require('../src/services/background-diversity.service');

const result = selectBackground(videoId);
// result.success: boolean
// result.selected: { assetId, category, dominantColors, motionType }
// result.scoring: { colorDiversity, categoryDiversity, noveltyScore, diversityScore }
```

### Generation Metadata
```json
{
  "backgroundPlan": {
    "primaryCategory": "particles",
    "selectedAssets": ["bg_particles_gold_001"],
    "diversityScore": 100.0
  }
}
```

## Logs Generados

```
[BACKGROUND_SELECTION_STARTED]
[BACKGROUND_DIVERSITY_PASS]        // Score >= 40
[BACKGROUND_DIVERSITY_LOW]         // Score < 40
[BACKGROUND_SELECTION_COMPLETED]   // assetId | category | score
```

## Estadísticas

Ver estado actual:
```bash
npm run stats:background-diversity
```

Retorna:
- Últimos 5 fondos usados
- Distribución de categorías
- Distribución de colores
- Porcentaje de diversidad
- Advertencias sobre repetición

## Configuración Temporal

### Veto de 10 Vídeos: Purple Abstract
Para revertir después de 10 vídeos, editar:
```javascript
// En background-diversity.service.js línea ~200
if (asset.category === 'abstract' && asset.dominantColors.includes('purple')) {
  temporalPenalty = 0; // Cambiar de 60 a 0
}
```

## Assets Disponibles

| ID | Categoría | Colores | Descripción |
|---|---|---|---|
| bg_abstract_purple_001 | abstract | purple, pink | Redes neurales moradas |
| bg_abstract_blue_001 | abstract | blue, cyan | Redes neurales azules |
| bg_particles_gold_001 | particles | gold, black | Partículas doradas |
| bg_geometric_motion_001 | geometric | white, black | Formas geométricas |
| bg_dark_texture_001 | dark_texture | gray, black | Textura oscura |
| bg_city_night_001 | city_night | blue, black | Luces de ciudad |
| bg_minimal_dark_001 | minimal_dark | black, dark_gray | Movimiento minimalista |
| bg_psychology_symbolic_001 | psychology_symbolic | red, purple | Simbología psicológica |

## Notas de Implementación

1. **Sin toques a **Duplicate Hard Block** - Sistema independiente
2. **Sin toques a PublishScheduler** - Aplica antes del render
3. **Persistencia automática** - Estado se guarda con cada selección
4. **Extensible** - Agregar nuevos assets en `BACKGROUND_ASSETS`
5. **Robusto** - Fallback automático si no hay suficiente diversidad

## Próximas Mejoras Potenciales

1. Rotación DENTRO del vídeo (3-6 clips por Short)
2. Transiciones de fondo sincronizadas con narrativa
3. Descarga automática de nuevos assets visuales
4. ML para predecir colores/categorías optimas por tema
5. A/B testing de fondos vs engagement

## Comando Rápido

Generar vídeo nuevo con diversidad automática:
```bash
npm run emergency:publish
```

Ver estadísticas:
```bash
npm run stats:background-diversity
```
