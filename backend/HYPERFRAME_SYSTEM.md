# Hyperframe Visual Simulation System

## Overview

The hyperframe engine simulates a "hyperframe" visual style (similar to ciencia_visual / animated UI) without breaking existing architecture. It works by:

1. **Mapping script segments** → Real audio timestamps (via caption-sync)
2. **Generating pseudo-hyperframes** → Visual emphasis levels per segment
3. **Creating overlay metadata** → Text, zoom, and brightness configurations
4. **Logging everything** → Zero-breaking integration with QC and scheduling

## System Architecture

### Components

```
video-renderer.js (main entry point)
  ├─ caption-sync.js (get real audio timings)
  ├─ hyperframe-engine.js (NEW - generate visual configs)
  │  └─ SEGMENT_VISUAL_CONFIG (8 visual presets)
  └─ prepublish-visual-qc.service.js (validate, no changes)

Output Files:
  output/{videoId}/
    ├─ output.mp4 (same as before)
    ├─ subtitles.ass (same as before)
    ├─ render-metadata.json (now includes hyperframeSegmentsUsed)
    ├─ hyperframe-debug.json (NEW - all segment configs)
    └─ hyperframe-filtergraph-integration.md (NEW - FFmpeg instructions)
```

### Data Flow

```
Script (hook, open_loop, peak, etc.)
    ↓
caption-sync: Get real audio timestamps
    ↓
hyperframe-engine: Map segments → visual configs
    ↓
Metadata saved:
    - hyperframeSegmentsUsed: 8
    - hyperframeTextOverlays: 8
    - hyperframeEnabled: true
    ↓
QC: Pass/Fail (same criteria as before, no changes)
    ↓
opportunistic publish: Can use hyperframe metadata
```

## Usage

### Basic Integration (Currently Active)

The system is **already integrated** in `video-renderer.js` (lines 945-963):

```javascript
// After caption-sync completes:
const { hyperframes, metadata: hfMetadata } = buildHyperframes({
  script,
  captions: syncedCaptions,
  videoDuration: realDuration,
  outputDir,
  videoId: script.videoId,
});
```

This runs **automatically** when:
- Caption-sync is active (no Whisper, Kokoro voice)
- Captions are successfully generated
- Video duration > 0

### Output Verification

After a video renders, check:

```bash
# 1. Hyperframe metadata in render-metadata.json
cat output/{videoId}/render-metadata.json | grep hyperframe

# 2. Segment details and timing
cat output/{videoId}/hyperframe-debug.json

# 3. Visual effect instructions for FFmpeg
cat output/{videoId}/hyperframe-filtergraph-integration.md
```

### Example Output

**hyperframe-debug.json:**
```json
{
  "metadata": {
    "videoId": "abc123",
    "segmentsUsed": 8,
    "textOverlaysCreated": 8,
    "totalDuration": 45.2,
    "avgSegmentDuration": 5.65
  },
  "hyperframes": [
    {
      "segmentId": "abc123_hook_50",
      "section": "hook",
      "start": 0.500,
      "end": 2.600,
      "duration": 2.100,
      "keyPhrase": "Did you know this trick?",
      "emphasisLevel": "high",
      "configUsed": {
        "zoomIntensity": 1.35,
        "textSize": 72
      }
    },
    // ... more segments
  ]
}
```

## Visual Configuration

### Segment Types and Emphasis

| Segment | Zoom | Pan Speed | Text Size | Emphasis | Entry | Exit |
|---------|------|-----------|-----------|----------|-------|------|
| **hook** | 1.35x | fast | 72 | HIGH | 0.2s | 0.15s |
| **reengage** | 1.20x | fast | 60 | HIGH | 0.2s | 0.15s |
| **peak** | 1.40x | fast | 80 | HIGH | 0.18s | 0.12s |
| **escalation** | 1.15x | medium | 52 | MEDIUM | 0.25s | 0.2s |
| **open_loop** | 1.12x | medium | 56 | MEDIUM | 0.25s | 0.2s |
| **micro_value** | 1.08x | slow | 48 | LOW | 0.3s | 0.25s |
| **open_ending** | 1.10x | slow | 50 | LOW | 0.3s | 0.3s |
| **soft_cta** | 1.05x | slow | 48 | LOW | 0.35s | 0.4s |

### Visual Effects Per Segment

Each segment includes:

- **Zoom + Pan**: Dynamic camera motion (scale interpolation + sinusoidal pan)
- **Brightness**: +4% to +20% based on emphasis
- **Text Overlay**: Key phrase (3-6 words) with fade in/out
- **Timing**: Entry/exit durations for smooth transitions

## Integration Roadmap

### Level 0: Current State ✅ ACTIVE

- Hyperframe metadata generated and logged
- `hyperframe-debug.json` created per video
- No visual changes yet; purely informational

### Level 1: FFmpeg Visual Effects (Recommended Next)

**Effort:** Medium | **Impact:** High  
**Location:** `concat-builder.js` buildSegmentFilter()

Apply per-segment:
- Zoom effect (scale 1.0 → 1.35x over duration)
- Pan motion (sinusoidal smooth movement)
- Brightness boost (+5% to +20%)

**Implementation:**
```javascript
// In buildSegmentFilter(), check if segment matches hyperframe timing
// Apply zoom/pan/brightness filters from hyperframe config
const zoomFilter = `scale=iw*${scaleExpr}:ih*${scaleExpr}`;
const panFilter = `crop=...+${panExpr}:...`;
const brightnessFilter = `eq=brightness=${brightness}`;
```

### Level 2: Text Overlay Integration

**Effort:** Medium | **Impact:** High  
**Location:** `render-executor.js` executeRender()

Render key phrase overlays:
- Central position (x/y centered)
- Large font (48-80px based on emphasis)
- Fade in with segment start
- Fade out before segment end
- Proper opacity handling

**Implementation:**
```javascript
// Layer drawtext AFTER color grading, BEFORE vignette
// Use hyperframe.filters.textOverlay from metadata
const textOverlay = hyperframe.filters.textOverlay;
// ... add to FFmpeg filter chain
```

### Level 3: Smart Color Grading Per Segment

**Effort:** High | **Impact:** Medium  
**Location:** `color-grader.js` selectColorGrade()

Vary color preset dynamically:
- `HIGH` emphasis → Saturated, warm, intense
- `MEDIUM` emphasis → Balanced
- `LOW` emphasis → Subtle, cool, calm

### Level 4: Motion Graphics & Transitions

**Effort:** High | **Impact:** Medium  
**Location:** New module `motion-graphics.js`

Advanced visual polish:
- Scale transitions between segments
- Rotate effects on segment boundaries
- Particle effects or overlays
- Rhythm timing (beat-sync)

---

## Testing

### Run Full System Validation

```bash
cd backend
node test-hyperframe-system.js
```

**Validates:**
- ✓ Imports and dependencies
- ✓ buildHyperframes with real data
- ✓ Report generation
- ✓ No syntax errors
- ✓ No QC regressions

### Generate Test Video with Hyperframes

```bash
# Normal video generation (hyperframes auto-enable when caption-sync active)
node src/services/video-processor.js

# Check output
ls -la output/{videoId}/hyperframe-*.json
```

---

## Logs

### New Log Messages

```
HYPERFRAME_SEGMENT_CREATED segmentId=... section=hook start=0.5 duration=2.1
HYPERFRAME_BUILD_COMPLETE segmentsUsed=8 textOverlays=8
HYPERFRAME_VISUAL_APPLIED type=zoom_pan intensity=1.35
HYPERFRAME_ENHANCE_DEFERRED segments=8 (requires integration)
```

### Existing Logs (No Changes)

```
CAPTION_SYNC: ... captions generated
PREPUBLISH_VISUAL_QC_PASS videoId=...
OPPORTUNISTIC_PUBLISH_SUCCESS
```

---

## FAQ

### Q: Does this break existing functionality?

**A:** No. Hyperframe is purely informational at Level 0. It generates metadata but doesn't modify the video rendering pipeline. All QC checks remain unchanged.

### Q: When does hyperframe activate?

**A:** Automatically when:
- `caption-sync` is active (no Whisper, Kokoro voice with >0 captions)
- Real audio timing is available
- Video duration > 0.5s

### Q: Can I disable hyperframes?

**A:** Yes:
- Modify `video-renderer.js` line 948-968 to skip hyperframe block
- Or set `captions = null` to disable caption-sync (not recommended)

### Q: How do I implement Level 1 visual effects?

**A:** See roadmap section above. Start with `concat-builder.js` buildSegmentFilter():
1. Read hyperframes metadata
2. For each segment, check if it matches a hyperframe
3. Apply zoom/pan/brightness filters
4. Test with QC (should pass unchanged)

### Q: What's the performance impact?

**A:** Minimal:
- ~50ms to generate hyperframes
- 0ms during actual FFmpeg rendering (just metadata)
- No additional FFmpeg filters at Level 0

### Q: Can hyperframes work with Whisper/word timestamps?

**A:** Currently: No (hyperframes only activate when caption-sync is active).  
Future: Yes, could be adapted to use Whisper timestamps instead of caption-sync.

---

## Files Modified/Created

### Created
- `backend/src/utils/hyperframe-engine.js` - Main engine
- `backend/test-hyperframe-system.js` - Validation suite
- `backend/HYPERFRAME_SYSTEM.md` - This documentation

### Modified
- `backend/src/services/video-renderer.js` - Integration (2 locations)
  - Import: `const { buildHyperframes } = ...`
  - Integration: Lines 945-968 (hyperframe build block)
  - Metadata: Lines 1120-1122 (hyperframe fields)

### Unchanged (Zero-Breaking)
- `prepublish-visual-qc.service.js`
- `opportunistic-publish.js`
- `publish-scheduler.service.js`
- `caption-sync.js`
- All QC, OB, scheduling systems

---

## Next Steps

1. **Verify Level 0 is working:**
   ```bash
   node test-hyperframe-system.js
   ```

2. **Generate a test video:**
   ```bash
   node src/services/video-processor.js
   ```

3. **Check output:**
   ```bash
   cat output/{videoId}/hyperframe-debug.json
   ```

4. **Plan Level 1 implementation:**
   - Review `concat-builder.js` buildSegmentFilter()
   - Map hyperframe filters to FFmpeg syntax
   - Integrate zoom/brightness effects
   - Test with QC validation

5. **Optional: Implement Level 2-4** based on priority

---

## Support

For issues:
1. Check `hyperframe-debug.json` for segment timings
2. Verify `caption-sync` generated captions successfully
3. Review logs for `HYPERFRAME_*` messages
4. Ensure `CAPTION_SYNC` mode is active (not WORD_TIMESTAMPS)

---

**Last Updated:** 2026-04-28  
**Status:** Level 0 - Metadata Generation ✅ ACTIVE  
**Next Level:** Level 1 - FFmpeg Visual Effects (Ready to implement)
