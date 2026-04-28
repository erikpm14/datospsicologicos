# 🚨 PRODUCTION EMERGENCY REPORT

**Date:** 2026-04-27  
**Video ID:** d101f12c-3658-4a35-9923-687e59351744  
**YouTube ID:** JUU5aWr0V_8  
**Status:** ⛔ PUBLISHED WITH BLACK SCREEN — IMMEDIATE ACTION REQUIRED

---

## INCIDENT SUMMARY

A video was published to YouTube Shorts with **COMPLETE BLACK SCREEN, NO AUDIO, NO CAPTIONS**. This was a critical production failure that bypassed all validation gates.

---

## ROOT CAUSE ANALYSIS

### Primary Cause: Missing Stock Footage Asset

```
FFmpeg Error (2026-04-27 15:00:23):
  "ffmpeg exited with code 1: 
   C:\Users\Erik\Desktop\Generador_videos\assets\stock-footage\pexels_7234075.mp4:
   No such file or directory"
```

**What happened:**
1. Video renderer (`video-use` mode) attempted to load `pexels_7234075.mp4` from stock footage
2. File does not exist in local assets
3. FFmpeg failed with file-not-found error
4. Renderer fell back to: `color=black:s=1080x1920:r=30` (black screen generator)
5. Subtitles never burned (video completely replaced by black)
6. Quality check passed despite null content
7. Published as-is to YouTube

---

## FAILED VALIDATIONS

### What Should Have Blocked This:

| Check | Expected | Got | Status |
|-------|----------|-----|--------|
| Video stream (ffprobe) | ✅ YES | ❌ Black generator | ❌ FAILED |
| Black frame detection | ❌ NO | ✅ 46.26s black | ❌ FAILED |
| File size sanity | > 2MB | 1.6MB | ⚠️  MARGINAL |
| Captions burned | ✅ YES | ❌ None | ❌ FAILED |
| Visual QC pre-publish | ❌ NONE EXISTED | — | ❌ CRITICAL GAP |

---

## IMMEDIATE ACTIONS TAKEN

### 1. ✅ AUTO_PUBLISH DISABLED
```env
AUTO_PUBLISH_ENABLED=false
```
**Effect:** No further automatic uploads until visual QC passes.

### 2. ✅ PRE-PUBLISH VISUAL QC SERVICE CREATED
**File:** `backend/src/services/prepublish-visual-qc.service.js`

**Validations implemented:**
- ✅ File exists and size > 2MB
- ✅ ffprobe: duration > 8s
- ✅ ffprobe: video stream present
- ✅ ffprobe: audio stream present
- ✅ **Black frame detection**: Scans for > 1s black frames
- ✅ captions-debug.json exists
- ✅ captionCount > 0
- ✅ driftStatus: excellent/acceptable

**Blocking reasons if any fail:**
```
BLACK_FRAMES_DETECTED          → Blocks immediately
NO_VIDEO_STREAM                → Blocks immediately
NO_AUDIO_STREAM                → Blocks immediately
EMPTY_CAPTIONS                 → Blocks immediately
FILE_TOO_SMALL                 → Blocks immediately
DURATION_TOO_SHORT             → Blocks immediately
NO_CAPTIONS_DEBUG              → Blocks immediately
```

### 3. ✅ INTEGRATED VISUAL QC INTO PUBLISHER
**File:** `backend/src/services/publisher.js` (GATE 0.5)

**Before any platform upload:**
```javascript
const visualQcResult = await validatePrepublish(videoPath, outputDir, videoId);
if (!visualQcResult.ok) {
  // BLOCK and return detailed error
  // DO NOT publish
}
```

**Logged as:**
```
PREPUBLISH_VISUAL_QC_PASS videoId=...
PREPUBLISH_VISUAL_QC_BLOCKED videoId=... reasons=BLACK_FRAMES_DETECTED
```

---

## ROOT CAUSE: MISSING STOCK FOOTAGE

The immediate cause was a missing Pexels asset file. This suggests:

1. **Asset Download Failure:** Pexels clip download timed out or failed silently
2. **No Validation:** Renderer didn't validate asset existence before using
3. **Silent Fallback:** FFmpeg fallback to black wasn't caught

### Why This Happened:

The `video-use` renderer mode depends on external APIs (Pexels) to download stock footage. When network/API fails:
- Download doesn't retry
- Missing file isn't caught
- FFmpeg falls back to black screen
- No error propagates to QC

---

## WHAT THIS REPORT MEANS

### For This Video (d101f12c-...):
- ❌ Cannot be fixed by republishing same file
- ❌ Output.mp4 is corrupted (black screen)
- ✅ Captions exist and are valid (source: captions-debug.json)
- ✅ Audio exists (voice_proc.mp3 = 1.1MB, 46.26s)
- 🔴 **MUST be re-rendered** with available assets

### For Future Videos:
- ✅ Visual QC will **block** any similar black-screen videos
- ✅ All uploads now require: video stream + audio stream + captions + no black frames
- ✅ Detailed logs for every failed check

---

## REMEDIATION STEPS

### Step 1: Disable Auto-Publish (✅ DONE)
```bash
AUTO_PUBLISH_ENABLED=false  # Already set in .env
```

### Step 2: Deploy Visual QC (✅ DONE)
- Created `prepublish-visual-qc.service.js`
- Integrated into `publisher.js` (GATE 0.5)
- No code changes to rendering pipeline

### Step 3: Re-render This Video
The video must be **completely re-rendered** because output.mp4 is black:

**Option A: Force regenerate from queue**
```bash
# Manually move video back to pending queue
# Let auto-generation pick it up and re-render with working assets
```

**Option B: Re-render via script**
```bash
node scripts/force-rerender.js d101f12c-3658-4a35-9923-687e59351744
```

### Step 4: Verify Assets
Check that stock footage downloads are working:
```bash
ls -lah backend/assets/stock-footage/ | head -20
# Should show recently modified .mp4 files from Pexels API
```

### Step 5: Re-enable Auto-Publish
```env
AUTO_PUBLISH_ENABLED=true
```
**Only after:** 5+ videos successfully pass visual QC.

---

## CONFIGURATION SUMMARY

| Setting | Value | Effect |
|---------|-------|--------|
| AUTO_PUBLISH_ENABLED | false | 🛑 Manual publish only |
| AUTO_GENERATION_ENABLED | true | ✅ Generation continues |
| PREPUBLISH_VISUAL_QC | true | ✅ Active (integrated) |
| BLACK_FRAME_THRESHOLD | 1.0s | ✅ Blocks > 1s black |
| MIN_FILE_SIZE | 2MB | ✅ Blocks tiny files |

---

## LOGS GENERATED

**Search these for detailed audit:**

```bash
# All QC failures
grep PREPUBLISH_VISUAL_QC_BLOCKED backend/logs/combined.log

# All QC passes
grep PREPUBLISH_VISUAL_QC_PASS backend/logs/combined.log

# Render failures (asset issues)
grep "FFmpeg split error\|No such file or directory" backend/logs/combined.log
```

---

## NEXT STEPS

1. **Immediate (now):** ✅ Done
   - Auto-publish disabled
   - Visual QC implemented and integrated
   - This report created

2. **Short-term (next 2 hours):**
   - Delete bad YouTube video (JUU5aWr0V_8)
   - Verify asset downloads are working
   - Re-render d101f12c-... if possible

3. **Medium-term (next 24 hours):**
   - Test visual QC with 5 new videos
   - Monitor for ANY failed QC checks
   - Re-enable auto-publish only if all pass

4. **Long-term (next 7 days):**
   - Add asset download retry logic to renderer
   - Add renderer validation: check assets exist before FFmpeg
   - Add metrics: track asset failure rate

---

## CRITICAL: DO NOT FORGET

⚠️  **The video published to YouTube is corrupted.**  
✅ **New validation prevents this from happening again.**  
🔴 **Video d101f12c must be re-rendered OR manually deleted from YouTube.**

---

**Report generated:** 2026-04-27 15:00-15:30 CET  
**Reporter:** Claude Code Emergency Response  
**Status:** ⏸️  PAUSED — Awaiting manual asset/re-render verification
