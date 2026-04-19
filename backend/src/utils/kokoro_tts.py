"""
kokoro_tts.py
Wrapper CLI para Kokoro TTS.
Llamado desde voice-synthesizer.js via child_process.

Uso:
  python3 kokoro_tts.py <text> <output_wav> [voice] [speed]

Salida stdout (JSON):
  {"ok": true, "duration": 12.34, "sample_rate": 24000}
  {"ok": false, "error": "mensaje"}
"""

import sys
import json
import os

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "uso: kokoro_tts.py <text|-> <output_wav> [voice] [speed]"}))
        sys.exit(1)

    text_arg   = sys.argv[1]
    output_wav = sys.argv[2]
    voice      = sys.argv[3] if len(sys.argv) > 3 else "ef_dora"
    speed      = float(sys.argv[4]) if len(sys.argv) > 4 else 1.05

    # Acepta texto desde stdin si el primer argumento es "-" (evita problemas de encoding en Windows CLI)
    if text_arg == "-":
        text = sys.stdin.read().strip()
    else:
        text = text_arg

    # Rutas de modelos relativas al directorio de este script
    script_dir  = os.path.dirname(os.path.abspath(__file__))
    assets_dir  = os.path.join(script_dir, '..', '..', '..', 'backend', 'assets', 'kokoro')
    model_path  = os.path.join(assets_dir, 'kokoro-v1.0.onnx')
    voices_path = os.path.join(assets_dir, 'voices-v1.0.bin')

    if not os.path.exists(model_path):
        print(json.dumps({"ok": False, "error": f"modelo no encontrado: {model_path}"}))
        sys.exit(1)

    try:
        from kokoro_onnx import Kokoro
        import soundfile as sf

        os.makedirs(os.path.dirname(os.path.abspath(output_wav)), exist_ok=True)

        k = Kokoro(model_path, voices_path)
        samples, sample_rate = k.create(text, voice=voice, speed=speed, lang="es")
        sf.write(output_wav, samples, sample_rate)

        duration = len(samples) / sample_rate
        print(json.dumps({"ok": True, "duration": round(duration, 3), "sample_rate": sample_rate}))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
