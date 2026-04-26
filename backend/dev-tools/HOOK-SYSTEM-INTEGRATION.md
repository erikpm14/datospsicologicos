# Hook Quality System — Integration Guide

## Overview

Sistema de validación y generación de hooks confesionales que:
- **Rechaza** hooks genéricos tipo Instagram ("la gente...", "aprendes de...")
- **Penaliza** con -25-30 puntos en viralityScore
- **Prioriza** hooks confesionales en primera persona
- **Genera** automáticamente hooks íntimos si los propuestos no son válidos

## Components

### 1. `hook-validator.service.js`
**Valida si un hook es confesional/íntimo**

```javascript
const { validateHookConfessional } = require('./services/hook-validator.service');

const validation = validateHookConfessional("No sé por qué hago esto");
// Returns: { valid: true, score: 95, penalties: [], hasFirstPerson: true, vulnerabilityScore: 1 }
```

**Penalidades automáticas:**
- Generic pattern (la gente, aprende, etc): -30
- Instagram motivational tone: -20
- Too short/long: -10/-15
- Excessive CAPS: -10

**Bonuses automáticos:**
- Primera persona/implícito: +15
- Indicadores de vulnerabilidad: +5 por cada

### 2. `confessional-hook-generator.js`
**Genera hooks confesionales auténticos**

```javascript
const { generateConfessionalHook } = require('./services/confessional-hook-generator');

const generated = generateConfessionalHook('relationships');
// Returns: {
//   hook: "No sé por qué hago como que no pasa nada.",
//   validation: { valid: true, score: 100 },
//   category: 'denial'
// }
```

**Templates disponibles (8 categorías × 5 templates cada una):**
- `denial` - Negación/fingimiento
- `hidden_behavior` - Comportamiento oculto
- `contradiction` - Contradicción interna
- `uncomfortable_truth` - Verdades incómodas
- `vulnerability` - Miedo/vulnerabilidad
- `self_betrayal` - Traición interna
- `automatic_pattern` - Patrón automático
- `silenced_truth` - Verdades silenciadas
- `internal_confrontation` - Conflicto interno

### 3. `hook-quality-filter.js`
**Integración con content-generator**

```javascript
const { improveHook, rankHooks, selectTopHooks } = require('./services/hook-quality-filter');

// Evaluar un hook
const eval = improveHook("La gente tóxica te enseña...", 'relationships');
// Si es genérico, lo reemplaza automáticamente con uno confesional

// Rankear lista de hooks por calidad
const ranked = rankHooks(hookList);
// Retorna ordenado por confessional + score

// Seleccionar top N
const top5 = selectTopHooks(hookList, 5);
```

## Integration in Content Generator

### Opción 1: Validación post-generación (recomendado)
```javascript
const { selectTopHooks } = require('./hook-quality-filter');

// En content-generator.js, después de generar hooks:
const hookVariants = generateHookVariants(topic);
const topHooks = selectTopHooks(hookVariants, 5);
// Automáticamente penaliza genéricos y prioriza confesionales
```

### Opción 2: Reemplazo automático
```javascript
const { improveHook } = require('./hook-quality-filter');

// En cualquier punto donde asignes un hook:
const hook = prefabScript.hook;
const improved = improveHook(hook, topic, currentViralityScore);
if (improved.improved) {
  logger.info(`Replaced generic hook with confessional`);
  prefabScript.hook = improved.hook;
  prefabScript.viralityScore = improved.score;
}
```

### Opción 3: Generación directa de confesionales
```javascript
const { generateConfessionalHook } = require('./confessional-hook-generator');

// Generar directamente hook confesional para un topic:
const confessional = generateConfessionalHook(topic);
// Garantiza que sea válido confesional
```

## Examples

### ✅ HOOKS VÁLIDOS (Confesionales)
```
❌ Genérico: "La gente tóxica te enseña más que..."
✅ Confesional: "No sé por qué permito gente tóxica en mi vida."

❌ Genérico: "Aprendes de tus errores cuando..."
✅ Confesional: "Sé que estoy cometiendo el mismo error y no puedo parar."

❌ Genérico: "Deberías escuchar tu intuición"
✅ Confesional: "Mi intuición me dice algo, pero le hago caso omiso."

❌ Genérico: "¿Por qué SIEMPRE compras cosas que no necesitas?"
✅ Confesional: "Hay algo que compro cuando nadie me ve."

❌ Genérico: "Descubre el secreto de la confianza"
✅ Confesional: "Nunca lo admitiría, pero no confío completamente."
```

## Score Impact

Ejemplo de ajuste de scores:
```
Original hook: "La gente tóxica te enseña..."
  Virality score: 60 → 35 (-25 por patrón genérico)
  Status: RECHAZADO para publicación

Reemplazo: "No sé por qué permito esto"
  Virality score: 75 (confesional)
  Status: ACEPTADO
```

## Testing

Ejecutar test completo:
```bash
node backend/test-confessional-hooks.js
```

Output:
- Valida 11 hooks de prueba (6 genéricos, 5 confesionales)
- Genera nuevos hooks por topic
- Batch generation con estadísticas
- Resumen de templates disponibles

## Patterns to Reject

**Generic patterns** (automatic -30 penalty):
- `^la gente` - "la gente hace..."
- `^algunos` - "algunos dicen..."
- `^aprende|^descubre` - "aprende de...", "descubre el..."
- `^deberías|^debes|^tienes que` - Consejos
- `/aprendes (?:más|de)/` - "aprendes más de..."
- `/te hace|te vuelve|te convierte` - "te hace mejor..."
- `/secreto (?:científico|de|que)` - "secreto científico..."
- `/¿sabías que|¿por qué (?:siempre|nunca)` - Preguntas retóricas genéricas
- `/lo que nadie te dice|nadie te cuenta` - Frases clickbait

## Patterns to Prioritize

**Confessional patterns** (automatic +15 bonus):
- `^(no sé|no entiendo|no entiendo) por qué` - Incertidumbre
- `^(hago|digo|creo) como que` - Fingimiento
- `^no (lo digo|lo admito|me doy cuenta)` - Negación
- `^(hay|tengo) algo que` - Comportamiento oculto
- `^(estoy|ando) (haciendo|fingiendo)` - Estado confesional
- `^(me pasa|me sucede) que` - Impotencia

**Vulnerability indicators** (+5 cada una):
- miedo, mienten, fingir, escondo, oculto, controlo
- pierdo, fallo, decepciono, traición, solo, vacío
- mentira, negación, pretendo, aparento, nunca digo

## Next Steps

1. ✅ Validador implementado
2. ✅ Generador implementado  
3. ✅ Test completo
4. ⏳ Integrar en content-generator (hook selection)
5. ⏳ Integrar en publisher (pre-publish validation)
6. ⏳ Monitor: logs de hooks rechazados/mejorados

## Impact Metrics

Para medir efectividad:
```
- Hooks generados con patrón confesional: target 80%+
- Hooks rechazados por genéricos: target 0 en publish
- Virality score promedio: target +10-15 vs hooks genéricos
- Viewer retention: monitor après changes
```
