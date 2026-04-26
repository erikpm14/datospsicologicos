# REGLAS CONCRETAS PARA TU GENERADOR

Basadas en análisis de 8 videos reales. Implementar inmediatamente.

---

## ✅ CHECKLIST DE ACEPTACIÓN

Cada video generado DEBE cumplir:

### Tier 1: MUST HAVE (rechazar si no)
- [ ] `emotionalTrigger === "validation"` (no curiosity, no urgency)
- [ ] `viralTrigger === "identificacion"`
- [ ] `durationSeconds < 55` (target 50-53)
- [ ] `reengage_timing >= 10 AND reengage_timing <= 15` segundos
- [ ] `qcScore >= 80`
- [ ] `formatMatchScore >= 65`

### Tier 2: STRONGLY RECOMMENDED
- [ ] `topic IN ["relationships", "habits", "social_patterns", "body_language"]`
- [ ] Hook matches pattern: `[observable_verb] + [micro_change] + [temporal_marker]`
- [ ] `viralityScore >= 70` (minimum acceptable in your channel)
- [ ] CTA is soft (invitation, not command)

### Tier 3: NICE TO HAVE
- [ ] `viralityScore >= 85` (target 95+)
- [ ] `durationSeconds <= 52`
- [ ] `reengage_timing between 11-14`

---

## 🎣 HOOK VALIDATOR

### VALID HOOKS (Your winners)
```
✅ "Fíjate en esto justo antes de volver a hacerlo"
✅ "Mira esto cuando algo pequeño te cambie el cuerpo"
✅ "Nota cuando [observable_change] [temporal_context]"

Pattern: [OBSERVATION_VERB] + [MICRO_SIGNAL] + [WHEN_CLAUSE]
Verbs: "Fíjate", "Mira", "Nota", "Observa"
Signal: "cambio", "pequeño gesto", "pausa", "tono"
Temporal: "cuando", "justo antes", "justo después"
```

### INVALID HOOKS (Your failures)
```
❌ "Crees que..." (abstract, not observable)
❌ "Si explicas..." (conditional, not universal)
❌ "El 73% elige..." (statistic, not observational)
❌ "Tu cerebro ve peligro..." (intellectual, not behavioral)
```

### VALIDATION RULE
```javascript
function validateHook(hook) {
  const observableVerbs = ["fíjate", "mira", "nota", "observa"];
  const hasVerb = observableVerbs.some(v => hook.toLowerCase().includes(v));
  
  const hasMicroSignal = /cambio|pequeño|gesto|pausa|tono/.test(hook);
  
  const hasWhenClause = /cuando|justo|antes|después/.test(hook);
  
  return hasVerb && hasMicroSignal && hasWhenClause;
}

// Only accept if validateHook(hook) === true
```

---

## ⏱️ TIMING VALIDATOR

### DURATION CHECK
```javascript
const DURATION_MIN = 45;
const DURATION_MAX = 55;
const DURATION_TARGET = 50;

if (durationSeconds < DURATION_MIN || durationSeconds > DURATION_MAX) {
  REJECT("Duration out of range");
}

if (durationSeconds > 53) {
  WARN("Consider trimming to <53s for better virality");
}
```

### REENGAGE TIMING CHECK
```javascript
function calculateReengageRange(duration) {
  const target = duration * 0.22;  // 22% of video
  const min = duration * 0.19;     // 19%
  const max = duration * 0.28;     // 28%
  
  return { min, target, max };
}

// For 53s video: min=10.07, target=11.66, max=14.84
// MUST fall between 10-15s

if (reengage_timing < 10 || reengage_timing > 15) {
  REJECT("Reengage timing out of range");
}

// Warn if not in ideal 11-14s range
if (reengage_timing < 11 || reengage_timing > 14) {
  WARN("Reengage timing suboptimal");
}
```

---

## 📊 TOPIC WHITELIST / BLACKLIST

### ✅ WHITELIST (Preferred)
```
relationships (especially about reading signals)
habits (especially auto-sabotage, repetitive patterns)
social_patterns (if about correct interpretation)
body_language (validation angle, signal reading)
emotional_patterns (self-reflection angle)
```

### ⚠️ CAUTION
```
decision_making (low virality in your data)
perception (requires context)
communication (must emphasize validation, not utility)
```

### ❌ BLACKLIST (Avoid)
```
cognitive_biases (abstract + curiosity = failure)
memory (too intellectual)
philosophy (not observable)
concepts without behavioral examples
```

### IMPLEMENTATION
```javascript
const WHITELIST_TOPICS = [
  "relationships",
  "habits",
  "social_patterns",
  "body_language",
  "emotional_patterns"
];

const BLACKLIST_TOPICS = [
  "cognitive_biases",
  "philosophy",
  "abstract_concepts"
];

if (BLACKLIST_TOPICS.includes(topic)) {
  REJECT("Topic in blacklist");
}

// Not required to be in whitelist, but warn if not
if (!WHITELIST_TOPICS.includes(topic)) {
  WARN("Topic not in preferred list, expect lower virality");
}
```

---

## 💭 EMOTIONAL TRIGGER VALIDATOR

### ✅ REQUIRED: validation
```
MUST: emotionalTrigger === "validation"

What it means:
- Hook triggers self-recognition ("I do this!")
- Content makes viewer feel understood
- CTA invites (not commands)
- Question mark at end of many segments

Examples of validation:
- "Te has visto haciendo esto?"
- "Lees más de lo que te dicen?"
- "Te pasa cuando..."
```

### ❌ FORBIDDEN: urgency or pure curiosity
```
DO NOT use:
- emotionalTrigger === "urgency"
- emotionalTrigger === "curiosity" (unless hook extremely strong)

Why:
- urgency kills monetization (shows desperation)
- curiosity alone = low virality in your channel (59 vs 111)
- Validation scores 97-111 consistently
```

### VIRAL TRIGGER MUST BE identificacion
```
MUST: viralTrigger === "identificacion"

NOT:
- "utilidad" (too rational, not validation)
- "entertainment" (not resonant)
- "shock" (doesn't fit your pattern)
```

---

## 🏗️ STRUCTURE TEMPLATE

Every video should follow this timeline (for 53s video):

```
[0-2s] HOOK (2 seconds)
  Fíjate en esto justo antes de volver a hacerlo.
  
[2-8s] OPEN LOOP + SETUP (6 seconds)
  "Estás cansado y dices que verás solo un vídeo..."
  
[8-11s] ESCALATION SLOW BUILD (3 seconds)
  "Le pasa a quien..."
  
[11-14s] REENGAGE ⚡ (3 seconds) - CRITICAL MOMENT
  "No buscabas entretenimiento..."
  Movement: zoom agresivo
  Audio: emotional peak
  
[14-18s] PEAK 🔥 (4 seconds) - MAXIMUM IMPACT
  "[Most powerful statement]"
  
[18-40s] EXPANSION + EXAMPLES (22 seconds)
  Multiple scenarios showing the pattern
  
[40-48s] OPEN ENDING (8 seconds)
  Reflection, not resolution
  
[48-53s] SOFT CTA (5 seconds)
  "Si tú también... sígueme"
  Invitation, not command
```

### TIMING CHECK
```javascript
const timeline = {
  hook: { start: 0, end: 2, duration: 2 },
  open_loop: { start: 2, end: 8, duration: 6 },
  escalation: { start: 8, end: 11, duration: 3 },
  reengage: { start: 11, end: 14, duration: 3 },
  peak: { start: 14, end: 18, duration: 4 },
  expansion: { start: 18, end: 40, duration: 22 },
  open_ending: { start: 40, end: 48, duration: 8 },
  cta: { start: 48, end: 53, duration: 5 }
};

// Validate timing matches expected ranges
for (let segment in timeline) {
  if (actual_timing[segment] != timeline[segment]) {
    WARN(`${segment} timing off by ${actual_timing[segment] - timeline[segment]}s`);
  }
}
```

---

## 💾 SCORING THRESHOLDS

### VIRALITY SCORE
```
viralityScore >= 85:  ✅ EXCELLENT (publish immediately)
viralityScore >= 70:  ✅ ACCEPTABLE (publish)
viralityScore >= 50:  📊 BORDERLINE (review manually)
viralityScore < 50:   ❌ REJECT (don't publish)

Your channel average: 70+
Your winners: 95-111
```

### FORMAT SCORE
```
formatMatchScore >= 75:  ✅ EXCELLENT
formatMatchScore >= 65:  ✅ ACCEPTABLE
formatMatchScore >= 55:  📊 BORDERLINE (if virality high)
formatMatchScore < 55:   ❌ REJECT
```

### COMBINED DECISION
```
If viralityScore >= 70 AND formatMatchScore >= 65 
  AND emotionalTrigger === "validation"
  AND reengage_timing in [10, 15]:
  → PUBLISH

If any of above false:
  → HOLD FOR MANUAL REVIEW or REJECT
```

---

## 🚫 HARD REJECTS

These trigger **AUTOMATIC REJECTION**, no review:

```javascript
const HARD_REJECTS = [
  durationSeconds > 55,
  reengage_timing < 10 || reengage_timing > 18,
  emotionalTrigger !== "validation",
  viralTrigger !== "identificacion",
  topic in BLACKLIST_TOPICS,
  viralityScore < 40,
  qcScore < 75
];

if (HARD_REJECTS.some(x => x)) {
  REJECT();
  log("Hard reject triggered");
}
```

---

## ⚠️ SOFT WARNINGS

These trigger **REVIEW OR OPTIMIZATION**, not automatic reject:

```javascript
const SOFT_WARNINGS = [
  durationSeconds > 52 && durationSeconds <= 55,
  reengage_timing < 11 || reengage_timing > 14,
  viralityScore >= 50 && viralityScore < 70,
  formatMatchScore >= 55 && formatMatchScore < 65,
  !hook.matches(VALID_HOOK_PATTERN),
  topic not in WHITELIST_TOPICS
];

SOFT_WARNINGS.forEach(warning => {
  log(`⚠️ WARNING: ${warning}`);
  suggestOptimization();
});
```

---

## 📋 GENERATOR CONFIG UPDATES

Apply these to your decision engine:

### 1. EMOTIONAL TRIGGER OVERRIDE
```
If generated emotionalTrigger !== "validation":
  → Force to "validation"
  → Regenerate script if necessary
```

### 2. DURATION ENFORCEMENT
```
If durationSeconds > 55:
  → Trim script
  → Reject if can't trim without losing integrity
```

### 3. REENGAGE TIMING ENFORCEMENT
```
If reengage_timing outside [10, 15]:
  → Adjust escalation/buildup timing
  → Reject if can't fix structurally
```

### 4. TOPIC ROUTING
```
If topic in BLACKLIST:
  → Log as error
  → Don't generate
  
If topic not in WHITELIST:
  → Allow but flag for review
  → Show warning in dashboard
```

### 5. VIRALITY MINIMUM
```
If viralityScore < 70:
  → Review hook (check if validation trigger applied)
  → Review structure (check if timing correct)
  → Consider rejecting
```

---

## 🔄 FEEDBACK LOOP

After publishing videos, track these metrics:

```
For each published video:
1. Log: hook, topic, duration, reengage_timing, virality_score
2. Wait 24-48 hours
3. Measure: actual views, likes, retention
4. Compare: predicted virality vs actual performance
5. Adjust rules if pattern breaks

Initial hypothesis (based on 8 videos):
- validation + relationships/habits → 97+ virality ✓
- curiosity + cognitive_biases → 59 or less ✓
- duration >55 → NULL virality ✓
- reengage >18s → NULL virality ✓
```

---

## 📌 QUICK REFERENCE

### DO ✅
```
✅ Hook: observable + temporal + micro-change
✅ Emotional: validation only
✅ Duration: 50-53s
✅ Reengage: 11-14s
✅ Topic: relationships, habits
✅ Virality: target 85+
✅ CTA: soft invitation
```

### DON'T ❌
```
❌ Hook: abstract, conditional, theoretical
❌ Emotional: curiosity, urgency
❌ Duration: >55s
❌ Reengage: <10s or >15s
❌ Topic: cognitive_biases pure
❌ Virality: accept <70
❌ CTA: aggressive command
```

---

**Implementation Priority**: 
1. Tier 1 (MUST HAVE) - implement within 24 hours
2. Tier 2 (STRONGLY RECOMMENDED) - implement within 48 hours
3. Tier 3 (NICE TO HAVE) - optimize progressively

**Testing**: 
Generate 5 test videos following all rules.
Target: all 5 should score 85+ virality.
If not, adjust rules based on failures.
