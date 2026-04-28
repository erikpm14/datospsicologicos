# Hyperframe/HTML Renderer Implementation Status

## ✅ Completado

### 1. Renderer Base (`backend/src/renderers/hyperframe-renderer.js`)
- ✅ Archivo renderer creado y funcional
- ✅ Generación de fondos color animados (1080x1920, 30fps)
- ✅ Audio input con MP3/WAV
- ✅ FFmpeg integration para renderización
- ✅ Metadata generation con `render-metadata.json`
- ✅ ASS subtitle generation (estructura)
- ✅ 3 vídeos de prueba generados exitosamente (0.56 MB cada)

### 2. Integración en Pipeline (`backend/src/services/render-engines/index.js`)
- ✅ Router de renderers actualizado con soporte Hyperframe
- ✅ Fallback automático a video_use si Hyperframe falla
- ✅ Metadata de fallback incluida en output
- ✅ Logging de decisiones de renderer

### 3. Configuración
- ✅ Variable `RENDER_MODE` en .env (actualmente `video_use`)
- ✅ `AUTO_PUBLISH_ENABLED=false` (sin publicación automática durante pruebas)

### 4. Testing
- ✅ Script de validación (`test-hyperframe.js`) funcional
- ✅ 3 vídeos de prueba generados correctamente
- ✅ Validación de output file size
- ✅ QC integration (aunque con resultado fail esperado por test incompleto)

## ⏳ En Progreso

### 1. Subtítulos
- ❌ ASS filter en Windows tiene issues (espera imagen en lugar de ruta)
- 🔄 Opciones:
  - [ ] Usar `drawtext` en lugar de `subtitles` filter
  - [ ] Generar SRT + burn con ffmpeg `-scodec`
  - [ ] Usar Bitmap subtítulos (PNG)
  - [ ] Prescindir de subtítulos en versión inicial

### 2. Animaciones Visuales
- ⏳ Fondos color estático funcional
- ⏳ Falta:
  - [ ] Gradientes animados
  - [ ] Partículas CSS (vía frame generation)
  - [ ] Glow/shadow effects
  - [ ] Cambios de color según segmento (HOOK, PEAK, etc.)

### 3. Escenas por Segmento
- ⏳ Estructura SCENE_CONFIG definida (HOOK, OPEN_LOOP, etc.)
- ⏳ Falta:
  - [ ] Lógica para detectar segmentos en script
  - [ ] Aplicar estilos visuales específicos por segmento
  - [ ] Transiciones entre escenas

## ❌ No Iniciado

### 1. QC Adaptation
- Hyperframe QC necesita:
  - [ ] Validar que video NO es negro
  - [ ] Validar que audio está presente
  - [ ] Validar que formato es correcto
  - [ ] (Opcional) Subtítulos visibles si están presentes

### 2. Validación de 3 Vídeos Reales
- [ ] Generar con pipeline completo (no test)
- [ ] Validar QC pass
- [ ] Validar que fallback no se activó innecesariamente

### 3. Rendimiento
- [ ] Comparar velocidad vs video_use renderer
- [ ] Optimizar settings de FFmpeg

## Próximos Pasos (Recomendados)

### Corto plazo (24h)
1. **Subtítulos**: Usar SRT + burn directo en FFmpeg (opción más estable)
   - Generar SRT en lugar de ASS
   - Usar: `-vf subtitles='file.srt'` (más compatible que ASS en Windows)

2. **Activar Hyperframe en Pipeline**
   ```bash
   RENDER_MODE=hyperframe_html
   ```

3. **Generar 3 vídeos reales** y validar QC

### Mediano plazo (48-72h)
1. **Añadir animaciones básicas**:
   - Gradientes animados con `-vf scale + colorspace filters`
   - Pulsos de color durante PEAK

2. **Mejorar visual**:
   - Bordes/marcos animados
   - Fondos dinámicos por segmento

## Comando de Activación

```bash
# Para usar Hyperframe como default:
echo "RENDER_MODE=hyperframe_html" >> backend/.env

# Para usar video_use como fallback (actual):
echo "RENDER_MODE=video_use" >> backend/.env
```

## Archivos Modificados

- `backend/src/renderers/hyperframe-renderer.js` (NUEVO)
- `backend/src/services/render-engines/index.js` (MODIFICADO)
- `backend/.env` (MODIFICADO)
- `backend/test-hyperframe.js` (NUEVO, para validación)

## Notas Técnicas

- **FFmpeg version**: N-92722 (compatible with subtitles/libass)
- **Audio**: MP3 a 44100Hz mono → AAC 128k
- **Video**: 1080x1920 @ 30fps, H.264, CRF 22
- **Duration**: ~5 segundos de renderizado para 30s de vídeo
- **Size**: ~0.5-0.7 MB por vídeo (comprimido)

## Problemas Conocidos

1. **ASS subtitles en Windows**: FFmpeg malinterpreta la ruta como parámetro de imagen
   - Solución: Usar SRT o drawtext en su lugar
   
2. **QC score bajo**: Esperado en tests, validar con pipeline real

3. **Color hex format**: Verificar que `0a0e27` se interpreta como `#0a0e27` en FFmpeg
