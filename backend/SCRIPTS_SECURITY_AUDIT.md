# Scripts & Package.json Security Audit
**Fecha:** 2026-05-05 16:00 UTC  
**Status:** ⚠️ REQUIRES FIXES

---

## VERIFICACIÓN 4: npm Scripts Audit

### ✅ SAFE Commands (Approved for production)
```json
"start": "node src/server.js",
"dev": "nodemon src/server.js",
"worker": "node src/queue/video-processor.js",
"manual:generate": "node scripts/manual-generate-video.js",
"slot:lock": "node scripts/test-e2e-slot-final.js",
"stats:background-diversity": "node scripts/background-diversity-stats.js"
```

**Reason:** 
- No direct publication
- Require ALLOW_MANUAL_PUBLISH=true
- Have publish guard protection

---

### ❌ DANGEROUS Commands (Must be disabled)

#### 1. `manual:generate-and-publish` (LINE 28)
```json
"manual:generate-and-publish": "node scripts/manual-generate-video.js && node scripts/manual-late-publish.js",
```

**Risk:** 
- Combines generation + publication in single command
- Can bypass user intent (user may want to generate, not publish)
- Chains two operations without confirmation between

**Action:** REMOVE or RENAME to:
```json
"manual:prepare-batch": "node scripts/manual-generate-video.js",
```

---

#### 2. `emergency:publish` (LINE 31)
```json
"emergency:publish": "node scripts/emergency-generate-no-llm.js && node scripts/manual-late-publish.js",
```

**Risk:** 
- Name suggests "emergency" but performs publication
- No LLM generation + immediate publication
- Could be executed accidentally in crisis situations
- Used as fallback without user awareness

**Action:** RENAME AND BLOCK
```json
"emergency:prepare": "node scripts/emergency-generate-no-llm.js",
```

Separate publishing:
```json
"recovery:publish-if-allowed": "node scripts/manual-late-publish.js"
```

---

### ⚠️ QUESTIONABLE Commands (Restricted usage)

#### 3. `manual:late-publish` (LINE 27)
```json
"manual:late-publish": "node scripts/manual-late-publish.js",
```

**Current protection:**
- ✅ Guard checks ALLOW_MANUAL_PUBLISH=false (blocks by default)
- ✅ Requires MANUAL_AUTHORIZATION_CONFIRMED=true
- ✅ Requires publication-freeze.json status != FROZEN

**Verdict:** ACCEPTABLE if env vars remain default (false)

---

#### 4. `manual:publish-until-success` (LINE 29)
```json
"manual:publish-until-success": "node scripts/manual-publish-until-success.js",
```

**Current protection:**
- ✅ Guard checks both allow flags
- ✅ Retries up to 3 times before giving up

**Verdict:** ACCEPTABLE if env vars remain default (false)

---

## Findings Summary

| Command | Status | Risk | Fix |
|---------|--------|------|-----|
| start, dev, worker | ✅ SAFE | Low | Keep |
| manual:generate | ✅ SAFE | Low | Keep |
| manual:late-publish | ✅ ACCEPTABLE | Medium | Keep (with env guards) |
| manual:publish-until-success | ✅ ACCEPTABLE | Medium | Keep (with env guards) |
| **manual:generate-and-publish** | ❌ **DANGEROUS** | **HIGH** | **REMOVE** |
| **emergency:publish** | ❌ **DANGEROUS** | **HIGH** | **RENAME + DISABLE** |
| stats/test commands | ✅ SAFE | Low | Keep |

---

## Required Fixes for Production

### FIX 1: Remove `manual:generate-and-publish`
```diff
- "manual:generate-and-publish": "node scripts/manual-generate-video.js && node scripts/manual-late-publish.js",
```

**Reason:** No legitimate use case - generation and publication must be explicit separate steps.

---

### FIX 2: Disable `emergency:publish`
```diff
- "emergency:publish": "node scripts/emergency-generate-no-llm.js && node scripts/manual-late-publish.js",
+ "emergency:prepare": "node scripts/emergency-generate-no-llm.js",
```

**New flow:**
1. `npm run emergency:prepare` - Only generates video
2. Manual decision to publish later
3. `npm run manual:late-publish` - With explicit confirmation

**Reason:** Emergency scenarios shouldn't auto-publish.

---

## Verification Checklist

- [ ] `manual:generate-and-publish` removed from package.json
- [ ] `emergency:publish` renamed to `emergency:prepare`
- [ ] No other commands publish directly
- [ ] `ALLOW_MANUAL_PUBLISH=false` in .env (default)
- [ ] `MANUAL_AUTHORIZATION_CONFIRMED=false` in .env (default)
- [ ] `publication-freeze.json status=FROZEN` (default)

When all checked: Scripts audit PASSES ✅

---

## Post-Reactivation Procedure

When ready to reactivate production:

1. **Explicit manual approval required:**
   ```bash
   export ALLOW_MANUAL_PUBLISH=true
   export MANUAL_AUTHORIZATION_CONFIRMED=true
   npm run manual:late-publish  # Publish ONE video
   ```

2. **Verify publication:**
   - Check publish-log.json for source="manual-late-publish"
   - Confirm YouTube link works
   - Monitor for any errors

3. **Revert to locked state:**
   ```bash
   unset ALLOW_MANUAL_PUBLISH
   unset MANUAL_AUTHORIZATION_CONFIRMED
   npm run stats:background-diversity  # Safe operation to confirm system still works
   ```

---

## Conclusion

**Current Status:** ⚠️ UNSAFE - 2 dangerous commands exist

**Required Before Reactivation:**
1. Remove `manual:generate-and-publish`
2. Rename/disable `emergency:publish`
3. Confirm all env vars default to FALSE
4. Re-run this audit to verify

**Timeline:** FIX immediately, do NOT reactivate until complete
