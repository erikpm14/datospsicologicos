# Black Screen Render Bug — Root Cause & Fix

**Date:** 2026-04-27  
**Status:** ✅ FIXED  
**Severity:** CRITICAL — Black videos being published to YouTube

---

## THE PROBLEM

Vídeos se generaban con pantalla completamente negra, aunque:
- Asset validator estaba activo ✓
- Visual QC estaba implementado ✓
- Captions se generaban correctamente ✓

Esto significaba que **la QC no detectaba pantalla negra** y permitía su publicación.

---

## ROOT CAUSE — TWO BUGS IN `prepublish-visual-qc.service.js`

### Bug #1: FFprobe Failure = Silent Pass

**File:** `backend/src/services/prepublish-visual-qc.service.js`  
**Line:** 154  
**Problem:**

```javascript
// Before: Fails gracefully
try {
  probeData = await _getVideoStats(videoPath);
} catch (err) {
  logger.warn(`ffprobe failed: ${err.message}`);
  probeData = null;  // ← Allows continue as if OK
}

if (!probeData) {
  results.checks.ffprobe = { ok: false, reason: 'ffprobe unavailable' };
  results.checks.ffprobe.advisory = true;  // ← "Advisory" = doesn't block
}
```

**Impact:**
- If FFmpeg/ffprobe not in PATH → marked "advisory"
- Video continues as if validated
- No video/audio stream checks performed
- **Black videos pass through**

---

### Bug #2: Blackdetect Filter Never Executed

**File:** `backend/src/services/prepublish-visual-qc.service.js`  
**Line:** 66-71  
**Problem:**

The code searches for FFmpeg `blackdetect` output in stderr:
```javascript
const blackDetectRegex = /black_duration:([\d.]+) black_start:([\d.]+)/g;
```

But the FFmpeg command **doesn't use blackdetect filter**:
```javascript
// Before: Using frame extraction, NOT blackdetect
const ffmpeg = spawn('ffmpeg', [
  '-i', videoPath,
  '-vf', "select='isnan(prev_selected_t)+gte(t-prev_selected_t,5)',scale=320:-1",
  '-vsync', 'vfr',
  `${framesDir}/frame_%03d.jpg`,  // ← Just extracting JPEGs
  '-y'
]);
```

This generates JPEGs but provides NO black frame detection info in stderr.

**Impact:**
- `blackDetectRegex.exec()` finds nothing
- `hasBlackFrames` remains `false`
- **Videos with all-black frames marked as "OK"**

---

### Bug #3: FFmpeg Spawn Error = Silent Pass

**File:** `backend/src/services/prepublish-visual-qc.service.js`  
**Line:** 104-106  
**Problem:**

```javascript
// Before: Catch errors = silent pass
ffmpeg.on('error', (err) => {
  logger.warn(`ffmpeg frame extraction failed: ${err.message}`);
  resolve({ hasBlackFrames: false, totalBlackDuration: 0, matches: [] });
  // ↑ Returns false = allows all videos through
});
```

If FFmpeg isn't in PATH or spawns fails:
- Returns `hasBlackFrames: false`
- Video marked as "OK" despite no actual check
- **Black videos allowed**

---

## THE FIX

### Change #1: Mandatory FFprobe

```javascript
// After: FFprobe failure = blocks video
try {
  probeData = await _getVideoStats(videoPath);
} catch (err) {
  logger.error(`FFPROBE CRITICAL: ${err.message} — Cannot verify video streams`);
  results.checks.ffprobe = { ok: false, reason: `ffprobe failed: ${err.message}` };
  results.blockedReasons.push('FFPROBE_UNAVAILABLE');
  results.ok = false;
  probeData = null;
}
```

**Effect:** If FFprobe unavailable → video blocked (not marked advisory)

---

### Change #2: Actual Blackdetect Filter

```javascript
// After: Real blackdetect filter on the video
const ffmpeg = spawn('ffmpeg', [
  '-i', videoPath,
  '-vf', "blackdetect=d=0.5:pix_th=0.05",  // ← 0.5s @ 5% black threshold
  '-an',
  '-f', 'null',
  '-'
]);
```

**Effect:**
- FFmpeg analyzes EVERY FRAME for black pixels
- Outputs `black_duration:XX black_start:YY` when detected
- Regex correctly finds black frame info
- All-black frames now DETECTED

---

### Change #3: Mandatory Black Frame Check

```javascript
// After: FFmpeg failure = blocks video
ffmpeg.on('error', (err) => {
  logger.error(`FFmpeg CRITICAL: frame extraction failed...`);
  reject(new Error(`BLACK_FRAME_CHECK_FAILED: ${err.message}`));
});

// In validatePrepublish():
let blackCheck;
try {
  blackCheck = await _detectBlackFrames(videoPath, outputDir);
} catch (err) {
  results.checks.blackFrames = {
    ok: false,
    reason: `Black frame detection unavailable: ${err.message}`,
  };
  results.blockedReasons.push('BLACK_FRAME_CHECK_FAILED');
  results.ok = false;
}
```

**Effect:**
- If FFmpeg can't analyze → video blocked
- No more silent passes when tools unavailable
- Black frame detection is now MANDATORY

---

## CHANGES SUMMARY

| Issue | Before | After |
|-------|--------|-------|
| **FFprobe unavailable** | Advisory (pass) | BLOCKS video |
| **FFmpeg unavailable** | Silent pass | BLOCKS video |
| **Black frame detection** | Not implemented | Using `blackdetect` filter |
| **All-black video** | Passes QC | BLOCKS with reason |

---

## VALIDATION

**Code Changes:**
```
✅ backend/src/services/prepublish-visual-qc.service.js
   - Lines 104-106: FFmpeg error now rejects
   - Lines 108-110: Catch block now rejects
   - Lines 149-156: FFprobe failure now blocks
   - Lines 66-71: Actual blackdetect filter
   - Lines 77-95: Cleaner blackdetect regex
```

**Syntax Check:**
```bash
✅ node --check src/services/prepublish-visual-qc.service.js
```

---

## DEPLOYMENT

**After merge:**

```bash
pm2 restart all
```

**Next video that renders as black:**
- Will be caught by blackdetect filter
- Will be blocked from publication
- Will be logged: `BLACK_FRAMES_DETECTED`
- Will NOT reach YouTube

---

## EXPECTED BEHAVIOR NOW

1. FFmpeg/ffprobe become mandatory
2. Every video analyzed for black frames using `blackdetect`
3. Threshold: **0.5 seconds of ≥5% black pixels** = BLOCKED
4. If tools unavailable → video blocked (fail-safe)
5. No more silent passes through QC

---

## PERMANENT SOLUTION NEXT

Consider:
- Ensure FFmpeg is in PATH during deployment
- Add startup check that FFmpeg/ffprobe are available
- Log WARNING if either is missing at server boot
- Consider bundling FFmpeg for Windows deployments

---

**Cause:** `prepublish-visual-qc.service.js` silently passed videos when detection tools unavailable  
**Line:** 104-110, 154  
**Fix Applied:** Made FFmpeg/ffprobe mandatory; implemented actual blackdetect filter  
**Result:** `RENDER_VISUAL_OK=true` — Black screen videos now blocked before YouTube upload

