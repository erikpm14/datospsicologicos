# Unified Validation System Integration

## Objective
Unified publication validation across all system components to prevent valid videos from being rejected due to overly strict or confusing validation criteria.

## Solution Implemented

### Core Validator: `publish-candidate-validator.service.js`
Single source of truth for video publication eligibility with clear distinction between:

**8 HARD BLOCKS** (real errors that block publishing):
1. MP4 file doesn't exist
2. MP4 file < 1MB (corrupted)
3. ffprobe fails or cannot analyze file
4. Video duration < 8s or > 60s (truncated or too long)
5. No video stream detected
6. No audio stream detected
7. Already published (published.json exists)
8. YouTube OAuth token not configured

**7 WARNINGS** (non-blocking metadata issues):
1. captions-debug.json missing (-5 quality points)
2. subtitles.ass missing (-3 quality points)
3. render-metadata.json missing (-3 quality points)
4. qcPassed flag absent (ignored)
5. publishable flag absent (ignored)
6. importedFromExistingOutput=true (accepted)
7. Queue flags incomplete (informational)

### Integration Points

#### 1. late-publish-recovery.js ✅
Uses `validatePublishCandidate()` to verify recovery videos are publishable before attempting publication.

**Implementation:**
```javascript
const { validatePublishCandidate } = require('./publish-candidate-validator.service');
const result = validatePublishCandidate({ videoId }, true);

if (!result.hardPassed) {
  // Reject and log hard blocks
  return false;
}
// Video is publishable despite warnings
```

#### 2. dry-run-slot-decision.js ✅
Uses `validatePublishCandidate()` to simulate scheduler decisions for next slot.

**Implementation:**
```javascript
const validation = validatePublishCandidate({ videoId }, true);
const statusIcon = validation.hardPassed ? '✅ OK' : '🔴 REJECT';
```

#### 3. publish-scheduler.service.js ✅
`validateReadyCandidate()` now uses core validator as foundation, then layers scheduler-specific checks.

**Validation Flow:**
```
validateReadyCandidate()
  ├─ STEP 1: validatePublishCandidate() → Hard blocks check
  ├─ STEP 2: If hard blocks fail → REJECT
  ├─ STEP 3: checkProductionQuality() → QC checks
  ├─ STEP 4: validateCaptionsForPublish() → Caption validation
  └─ RETURN: ok = hardPassed AND (noQCIssues OR allowFallback)
```

**Guarantees:**
- Videos with valid MP4, audio, video streams, and proper duration are publishable
- QC and caption issues don't block publication if allowFallback=true
- Clear separation between technical blocks and quality concerns

## Benefits

### Before
- ❌ Videos with valid MP4 rejected due to missing metadata
- ❌ Slots lost because validation criteria were unclear
- ❌ No distinction between critical errors and warnings
- ❌ Different parts of system used different validation logic

### After
- ✅ Videos with valid MP4 publish despite missing metadata
- ✅ Slots protected by clear, centralized criteria
- ✅ 8 hard blocks are technical impossibilities, 7 warnings are informational
- ✅ Unified validation: late-publish, dry-run, and scheduler use same core logic
- ✅ Quality metrics (QC, render mode) separate from technical validation
- ✅ Fallback mechanism allows graceful degradation

## Test Coverage

All validation scenarios tested in `test-validation-filters.js`:
- Test 1: Valid video without captions-debug → ✅ PASS WITH WARNINGS
- Test 2: Nonexistent video → ✅ CORRECTLY REJECTED
- Test 3: Already published video → ✅ CORRECTLY REJECTED
- Test 4: Valid with incomplete metadata → ✅ PASS (metadata non-blocking)

Result: **4/4 tests passed** ✅

## Monitoring

### Check validation decisions:
```bash
# Late-publish validations
pm2 logs backend | grep "LATE_PUBLISH_CANDIDATE"

# Dry-run analysis
node dry-run-slot-decision.js

# Test suite
node test-validation-filters.js
```

### Key log patterns:
```
[LATE_PUBLISH_CANDIDATE_PASS_CLEAN] {videoId} | quality=100 | duration=35.1s
[LATE_PUBLISH_CANDIDATE_PASS_WITH_WARNINGS] {videoId} | quality=97 | warnings=1
[LATE_PUBLISH_CANDIDATE_REJECTED] {videoId} | hard_blocks=1
  → HARD_BLOCK: no audio stream found
```

## Impact

- **Non-breaking**: Existing code continues to work, scheduler behavior unchanged
- **Backward compatible**: validateReadyCandidate() maintains same interface
- **Observable**: All criteria documented in logs and validation policy
- **Unifying**: Same core validator used by all components
- **Safe**: Hard blocks ensure no obviously-broken videos are published

## Files Modified

1. ✅ `src/services/publish-candidate-validator.service.js` — Core validator (created)
2. ✅ `src/services/late-publish-recovery.js` — Integration with core validator
3. ✅ `dry-run-slot-decision.js` — Uses core validator for analysis
4. ✅ `src/services/publish-scheduler.service.js` — validateReadyCandidate now uses core validator as base
5. ✅ `VALIDATION_POLICY.md` — Complete documentation of policy
6. ✅ `test-validation-filters.js` — Test suite for validation logic

## Next Steps (Optional)

1. Monitor publish logs to track how many videos pass with warnings vs rejected
2. Add dashboard metrics: candidates hardPassed vs rejected, warnings distribution
3. Consider telemetry to measure how many videos were "saved" by non-blocking approach
4. Update `publisher.js` to use validator as quick eligibility check
