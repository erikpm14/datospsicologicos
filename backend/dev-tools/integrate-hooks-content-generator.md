# Integration: Hook Quality Filter in Content Generator

## Quick Start

En `content-generator.js`, después de generar/seleccionar hooks, aplicar filtro:

```javascript
const { selectTopHooks, improveHook } = require('./services/hook-quality-filter');

// OPCIÓN 1: Seleccionar top hooks con validación integrada
function selectBestHooks(hookVariants, count = 5) {
  const topHooks = selectTopHooks(hookVariants, count);
  return topHooks.filter(h => h.score >= 70); // Threshold mínimo
}

// OPCIÓN 2: Mejorar un hook específico
function ensureConfessionalHook(hookText, topic, baseScore) {
  const improved = improveHook(hookText, topic, baseScore);
  if (improved.improved) {
    logger.info(`Hook mejorado: "${improved.hook}"`);
  }
  return improved.hook;
}
```

## Integration Points in Content Generator

### Point 1: After Challenge Hook Generation
```javascript
// Actual code (línea ~155 en content-generator.js)
const challengeHooks = generateChallengeHooks(topic);
  
// ADD: Filter by quality
const validChallengeHooks = challengeHooks.filter(h => {
  const validation = validateHookConfessional(h.hook);
  return validation.score >= 70;
});
```

### Point 2: When Selecting Hook from Pool
```javascript
// Actual code (línea ~170)
const selectedHook = hookVariants[0];

// ADD: Validate and optionally improve
const { selectTopHooks } = require('./services/hook-quality-filter');
const topHooks = selectTopHooks(hookVariants, 1);
const selectedHook = topHooks[0]?.hook || hookVariants[0].hook;
```

### Point 3: Final Hook Assignment
```javascript
// Actual code (línea ~180)
script.hook = selectedHook;
script.viralityScore = calculateVirality(script);

// ADD: Apply hook quality penalty
const { validateHookConfessional, applyHookPenalty } = require('./services/hook-validator.service');
const hookValidation = validateHookConfessional(script.hook);
script.viralityScore = applyHookPenalty(script.viralityScore, hookValidation);
```

## Scores & Priorities

```
Hook Score | Virality Penalty | Status      | Comment
──────────────────────────────────────────────────────────
< 70       | -30             | REJECTED    | Rechazado, no se publica
70-79      | -10             | ACCEPTABLE  | Aceptable pero subóptimo
>= 80      | 0               | PRIORITY    | Prioritario, sin penalización
```

## Examples from New Templates

### ✅ HIGH QUALITY (Score >= 80)
```
"Digo que no me importa, pero sí."
→ Primera persona, vulnerabilidad, simple, cotidiano
→ Score: 85-95 | Penalty: 0

"Hay algo que hago cuando nadie me ve."
→ Implícito (alguien está viendo), vulnerable
→ Score: 80-90 | Penalty: 0

"Sé que está mal y lo hago igual."
→ Contradicción clara, cotidiana
→ Score: 75-85 | Penalty: -10 (borderline)
```

### ⚠️ MEDIUM QUALITY (Score 70-79)
```
"No sé por qué vuelvo ahí."
→ Vulnerable pero podría ser más primera persona
→ Score: 72-78 | Penalty: -10

"La verdad que guardo es que..."
→ Incompleto (falta terminar), pero estructura válida
→ Score: 70-75 | Penalty: -10
```

### ❌ REJECTED (Score < 70)
```
"Tengo miedo de que descubran quién soy realmente."
→ Fails reality test (demasiado dramático)
→ Score: 40 | Penalty: -30

"Lucho contra una parte de mí."
→ Too theatrical, fails reality
→ Score: 35 | Penalty: -30
```

## Implementation Steps

### Step 1: Add Import
```javascript
// At top of content-generator.js
const { selectTopHooks, improveHook } = require('./services/hook-quality-filter');
const { validateHookConfessional, applyHookPenalty } = require('./services/hook-validator.service');
```

### Step 2: Create Helper Function
```javascript
function validateAndSelectHook(hookVariants, topic, baseScore) {
  // Rank by quality
  const ranked = selectTopHooks(hookVariants, 5);
  
  // Get first valid hook (score >= 70)
  const bestHook = ranked.find(h => h.score >= 70);
  
  if (!bestHook) {
    // Fallback: generate new one
    const { generateConfessionalHook } = require('./services/confessional-hook-generator');
    return generateConfessionalHook(topic).hook;
  }
  
  return bestHook.hook;
}
```

### Step 3: Apply in Script Generation
```javascript
// Where script.hook is assigned (around line 180-200)
const hookText = validateAndSelectHook(hookVariants, topic, viralityScore);
script.hook = hookText;

// Apply quality penalty
const validation = validateHookConfessional(hookText);
script.viralityScore = applyHookPenalty(viralityScore, validation);

logger.info(`Hook selected with quality score ${validation.score}/100`, {
  hook: hookText.substring(0, 60),
  priority: validation.priority,
  viralityAdjustment: viralityScore - script.viralityScore,
});
```

## Testing Integration

After changes, run:
```bash
node backend/test-confessional-hooks.js
```

Expected output:
- All 6 generic hooks REJECTED (score < 70)
- All confessional hooks >= 70 ACCEPTED
- Generated hooks mostly >= 75

## Monitoring

Log metrics:
- % hooks with score >= 80 (target: 60%+)
- % hooks rejected (target: 0% in publish)
- Average hook quality score (target: 75+)
- Virality penalty distribution (average: -5 to -10)

## Common Issues & Fixes

### Issue: Too Many Fallbacks
**Cause:** Generated hooks not passing quality threshold
**Fix:** Update `confessional-hook-generator.js` templates if patterns are weak

### Issue: False Negatives (Valid hooks rejected)
**Cause:** Validation too strict
**Fix:** Adjust DRAMATIC_PATTERNS or vulnerability thresholds

### Issue: High Virality Penalty
**Cause:** Many hooks scoring 70-79 (getting -10 penalty)
**Fix:** Improve template quality or regenerate hooks

## Performance

Expected impact:
- Generation time: +2-3ms per hook (validation)
- Memory: +minimal (caches validation results)
- Quality improvement: +10-15% better virality scores for confessional hooks
- Reduction: 100% of generic hooks rejected
