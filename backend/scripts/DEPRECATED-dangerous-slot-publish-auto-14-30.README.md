# ⚠️ DEPRECATED: slot-publish-auto-14-30.js

**Status:** 🔴 DISABLED (2026-05-12)

## Why Disabled?

This script caused the **double publication incident** of 2026-05-12:
- **Primary video:** hWL72kiFkdM (11:56:45 UTC)
- **Backup video:** -4j9AxR1veI (11:56:51 UTC)
- **Same slot:** 2026-05-11 14:30 Europe/Madrid

## Root Cause

The script had a parsing bug when checking YouTube upload results:

```javascript
// BROKEN CODE (line 156)
if (result.youtubeId) { ... }  // ❌ Wrong field path
```

The actual structure was:
```javascript
result.results[0].videoId  // ✓ Correct field path
```

Because the parsing failed, the script thought the principal publish had failed and proceeded with the backup publication, resulting in **two videos in the same slot**.

## What Went Wrong

1. **Principal** published successfully at 14:56:45 and got `youtubeId: hWL72kiFkdM`
2. Script checked `result.youtubeId` (empty/undefined) instead of `result.results[0].videoId`
3. Script thought principal failed and allowed backup to proceed
4. **Backup** published the same content again at 14:56:51 with `youtubeId: -4j9AxR1veI`
5. **Result:** Same slot had two different videos (violates idempotency guarantee)

## Replacements

For safe slot recovery, use:
- `late-slot-recovery-manual.js` — Manual verification + DRY_RUN mode
- `monitor-slot-until-publish.js` — Monitor without publishing
- `publish-scheduler.service.js` — Main scheduler (handles retries safely)

## If You Need To Run This

**⚠️ WARNING: Only after:**
1. ✅ Verifying slot lock status: `cat data/slot-publication-locks.json`
2. ✅ Confirming no published.json exists in video directory
3. ✅ Manual inspection that slot truly needs recovery
4. ✅ DRY_RUN=true to preview before executing

**NEVER:**
- ❌ Run without understanding the exact state
- ❌ Run without DRY_RUN=true first
- ❌ Run in parallel with other recovery scripts
- ❌ Run without checking slot locks

## How to Re-Enable (If Absolutely Necessary)

```bash
# 1. Rename back
mv DEPRECATED-dangerous-slot-publish-auto-14-30.js.bak slot-publish-auto-14-30.js

# 2. Fix the parsing bug in the code

# 3. Always run with DRY_RUN=true first
DRY_RUN=true node scripts/slot-publish-auto-14-30.js

# 4. Only then run actual publication if dry-run succeeds
node scripts/slot-publish-auto-14-30.js
```

---

**Incident Date:** 2026-05-12  
**Incident Report:** incident-bad-upload-20260512/POST-MORTEM-COMPLETO.md  
**Fixes Implemented:** FIX 1 - Slot-Level Idempotency Lock prevents recurrence
