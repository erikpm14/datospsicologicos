# Kokoro TTS Audio Truncation Fix - Complete

## Problem Identified
Kokoro was generating only 2.32 seconds of audio for scripts with legacy format (hook, claim, explanation, cta) instead of the expected 28 seconds.

## Root Cause
The `prepareNarrationForTTS` function was hardcoded to use EXPANDED segment keys (hook, open_loop, micro_value, escalation, reengage, peak, open_ending, soft_cta) regardless of the script format. Legacy scripts (hook, claim, explanation, cta) were being ignored, resulting in only the 'hook' field being synthesized.

Additionally, `hasExpandedStructure` in script-segments.js returned true whenever ANY expanded key existed, but 'hook' is present in both formats, making the detection unreliable.

## Fixes Implemented

### 1. Fixed hasExpandedStructure in script-segments.js (Line 56-59)
**Before:**
```javascript
function hasExpandedStructure(script = {}) {
  return EXPANDED_SEGMENT_KEYS.some((key) => Boolean(String(script[key] || '').trim()));
}
```

**After:**
```javascript
function hasExpandedStructure(script = {}) {
  // Check for expanded-only keys (excluding hook which is in both formats)
  const expandedOnlyKeys = ['open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'];
  return expandedOnlyKeys.some((key) => Boolean(String(script[key] || '').trim()));
}
```

### 2. Fixed prepareNarrationForTTS in voice-synthesizer.js (Line 186-252)
Now detects script format (legacy vs. expanded) and uses appropriate segment keys:
- Legacy format: ['hook', 'claim', 'explanation', 'cta']
- Expanded format: ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta']

Also updated blockDefinitions to match the format.

### 3. Added Post-TTS Validation in synthesizeVoice (Line 798-822)
Validates that Kokoro generated sufficient audio:
```javascript
const wordCount = text.split(/\s+/).length;
const minAudioDuration = (wordCount / 3.5) * 0.65;

logger.info(`TTS_REQUEST_TEXT_WORDS=${wordCount}, minExpectedDuration=${minAudioDuration.toFixed(2)}s`);

if (actualDuration < minAudioDuration) {
  logger.warn(`TTS_TOO_SHORT_FALLBACK_TO_EDGE: Kokoro generated ${actualDuration.toFixed(2)}s`);
  throw new Error(`Kokoro audio too short`);
}
```

### 4. Fixed audio duration in renderVideoWithRouter calls
Now passes actual synthesized audio duration instead of script.duration placeholder:
```javascript
const actualAudioDuration = audioResult?.estimatedDuration || script.duration;
await renderVideoWithRouter({
  ...options,
  audioDuration: actualAudioDuration,  // Use actual instead of script.duration
});
```

## Test Results

### Before Fix
- Script: hook (4 words) + claim (6 words) + explanation (45 words) + cta (2 words) = 57 words total
- Kokoro output: Only hook synthesized = 1.71s audio
- Video: 2.4 seconds (fails QC - needs 8s minimum)

### After Fix
- Script: Same 57 words
- Kokoro output: All 4 blocks synthesized = 20.1 seconds audio
  - Block 1 (hook): 1.71s
  - Block 2 (claim): 2.07s
  - Block 3 (explanation): 14.59s
  - Block 4 (cta): 0.87s
- Audio validation: PASSED (20.1s > 10.59s minimum)
- Provider: Kokoro
- Narration plan blocks: 4
- Section durations: 4

## Verification Command
```bash
node test-tts-only.js
```

Output shows:
- success: true
- estimatedDuration: 20.102667s
- wordCount: 57
- provider: 'kokoro'
- narrationPlanBlocks: 4
- sectionDurations: 4

## Impact
✅ Kokoro TTS now correctly synthesizes all script fields for legacy format
✅ Automatic fallback to Edge TTS if Kokoro audio is too short
✅ Detailed logging of TTS validation (TTS_REQUEST_TEXT_WORDS, KOKORO_AUDIO_DURATION)
✅ Audio duration mismatch detection prevents publication of short videos
