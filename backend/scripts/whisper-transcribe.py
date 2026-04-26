#!/usr/bin/env python
"""
Whisper word-level transcription script.
Emits ONLY JSON to stdout for reliable parsing.
"""
import sys
import json
import warnings

# Suppress ctranslate2 warnings
warnings.filterwarnings('ignore')

try:
    from faster_whisper import WhisperModel

    if len(sys.argv) < 3:
        json.dump({"error": "Usage: python whisper-transcribe.py <audio_path> <language> <model>"}, sys.stdout)
        sys.exit(1)

    audio_path = sys.argv[1]
    language = sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "base"

    # Load model with warnings suppressed
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = WhisperModel(model_name, device='cpu')

    # Transcribe with word-level timestamps
    segments, info = model.transcribe(
        audio_path,
        language=language,
        word_timestamps=True,
        vad_filter=True
    )

    # Extract word-level data from segments
    words = []
    for segment in segments:
        if segment.words:
            for word in segment.words:
                words.append({
                    'word': word.word.strip(),
                    'start': float(word.start),
                    'end': float(word.end),
                    'confidence': getattr(word, 'probability', None)
                })

    # Emit ONLY JSON
    json.dump(words, sys.stdout)
    sys.exit(0)

except Exception as e:
    # Emit error as JSON
    json.dump({"error": str(e)}, sys.stdout)
    sys.exit(1)
