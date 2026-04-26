# Project Cleanup Manifest

**Date:** 2026-04-26  
**Goal:** Production-ready project structure  
**Status:** ✅ Complete

---

## What Was Moved

### Test & Validation Scripts (20+)
```
test-confessional-hooks.js
test-content-generation.js
test-final-complete.js
test-full-video.js
test-retention-spikes.js
test-word-timestamps-*
test-sync.js
test-production-sync.js
test-voice-speed.js
test-audio-sync.js
test-retention-validation.js
test-full-sync.js
```

### Retention Spike Research (12+)
```
generate_corrected_spikes.js
generate_finetuned_prespikeramp.js
generate_prespikeramp_structure.js
generate_perception_adjusted_spikes.js
generate_unpredictable_spikes.js
generate_test_export.js
introduce_unpredictability.js
```

### Analysis & Reporting (6+)
```
final_retention_report.js
final_corrected_report.js
final_finetuned_report.js
final_prespikeramp_report.js
final_perception_report.js
final_unpredictability_report.js
finalize_finetuned_export.js
finalize_prespikeramp_export.js
finalize_unpredictable_export.js
```

### Validation & Tuning
```
confirm-v41-videos.js
create-valid-v41-videos.js
calculate_correct_spikes.js
calculate_prespikeramp.js
adjust_pause_perception.js
audit-queue.js
analyze-emotional-timing.js
validate-hooks-in-generator.js
validate_prespikeramp_timing.js
update_export_with_corrected_spikes.js
```

### Legacy Production Scripts
```
prod-video-generator.js (replaced by content-generator.js)
```

### Development Reports (JSON)
```
queue-audit-report.json
v41-confirmation-report.json
```

### Experimental Documentation (MD)
```
EMOTIONAL_TTS_UPGRADE.md
HUMANIZED_VOICE_SYSTEM.md
HOOK-SYSTEM-INTEGRATION.md
integrate-hooks-content-generator.md
```

### Utility Scripts
```
create_test_video.sh
```

---

## Why This Structure

### ✅ Benefits

1. **Clean Root** — Only config and production utilities
2. **Clear Separation** — Dev tools don't clutter production code
3. **Easy Navigation** — Find production code instantly
4. **No Broken Dependencies** — Zero imports from dev-tools in src/
5. **Professional** — Matches industry standards
6. **Maintainable** — Future developers understand structure immediately

### 🔒 Safety

- ✓ No production code was modified
- ✓ All imports verified (no circular deps)
- ✓ PM2 processes run unchanged
- ✓ Pipeline fully functional
- ✓ All tests still available (in dev-tools/)

---

## Production Files Still in Root

```
✓ send-telegram-notification.js — Production utility
✓ package.json — Dependencies
✓ .env — Configuration
```

These remain because they're actively used by the production system.

---

## How to Use dev-tools

### Run a test
```bash
node dev-tools/test-confessional-hooks.js
```

### Validate hooks
```bash
node dev-tools/validate-hooks-in-generator.js
```

### Check queue
```bash
node dev-tools/audit-queue.js
```

### Generate test data
```bash
node dev-tools/create-valid-v41-videos.js
```

---

## Verification Checklist

✅ dev-tools/ folder created  
✅ 45+ files moved to dev-tools/  
✅ No production imports from dev-tools  
✅ Backend root cleaned (only config files)  
✅ All services intact in src/  
✅ Queue/export/data directories functional  
✅ PM2 running (pid: 215924)  
✅ Git history preserved  

---

## Future Development

When adding new scripts:

1. **Production code** → `backend/src/`
2. **Tests** → `backend/dev-tools/`
3. **Experiments** → `backend/dev-tools/`
4. **Config** → `backend/.env`

Keep the root clean. Keep production focused.

---

Generated during project professionalization  
For questions, see `backend/dev-tools/README.md`
