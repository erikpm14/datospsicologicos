#!/bin/bash
# Crear un vídeo de prueba simple (26s) con texto en pantalla

OUTPUT_DIR="./exports/2026-04-25"
mkdir -p "$OUTPUT_DIR"

# Crear archivo de video de prueba (26 segundos, color rojo sólido con texto)
ffmpeg -f lavfi -i "color=c=FF1493:s=1080x1920:d=26" \
       -f lavfi -i "sine=frequency=440:duration=26" \
       -pix_fmt yuv420p \
       -c:v libx264 -preset ultrafast -crf 28 \
       -c:a aac -q:a 9 \
       "$OUTPUT_DIR/23-47__test_retention_spikes.mp4" -y 2>&1 | tail -20

echo "Video created: $OUTPUT_DIR/23-47__test_retention_spikes.mp4"
