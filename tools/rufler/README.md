# Rufler - Workflow Automation para Desarrollo

Herramienta de automatización de workflows **solo para desarrollo y debugging**, no afecta el runtime del generador de vídeos.

## ¿Qué es Rufler?

Ejecutor de workflows declarativos en YAML inspirado en claude-flow/ruflo. Permite automatizar tareas de desarrollo (validación, testing, debugging) sin tocar el código de producción.

## Instalación

### Requisitos
- Python 3.7+
- pip
- PyYAML

```bash
pip install pyyaml
```

## Uso

```bash
# Desde la carpeta tools/rufler/
python flow-executor.py workflows/<workflow-name>.yml
```

### Workflows Disponibles

#### 1. `validate-render.yml` - Validar Renderer Hyperframe
Verifica que el renderer Hyperframe funciona correctamente.

```bash
python flow-executor.py workflows/validate-render.yml
```

Valida:
- ✅ Generación de 3 vídeos de prueba
- ✅ Archivo output.mp4 existe y tiene tamaño mínimo
- ✅ Metadata correcta
- ✅ Sin pantalla negra

**Salida:** `test-hyperframe-output/validation-report.json`

---

#### 2. `validate-qc.yml` - Validar QC en Vídeos
Ejecuta validación QC en vídeos generados.

```bash
python flow-executor.py workflows/validate-qc.yml
```

Verifica:
- ✅ Ausencia de pantalla negra (ffmpeg blackdetect)
- ✅ Presencia de audio
- ✅ Duración correcta
- ✅ Metadata QC presente

**Requiere:** Vídeos en `output/prod-video/output.mp4`

---

#### 3. `validate-3-videos.yml` - Generar 3 Vídeos Hyperframe
Genera 3 vídeos nuevos con Hyperframe y valida que todos pasen.

```bash
python flow-executor.py workflows/validate-3-videos.yml
```

Flujo:
1. Configura `RENDER_MODE=hyperframe_html`
2. Genera 3 contenidos nuevos
3. Renderiza con Hyperframe
4. Valida QC en cada uno
5. Verifica que **fallback NO se activó**
6. Genera reporte final

**Salida:**
```json
{
  "hyperframeDefaultEnabled": true,
  "fallbackRendererAvailable": true,
  "validatedVideos": 3,
  "allPassedQc": true
}
```

---

#### 4. `audit-prepublish.yml` - Auditoría Pre-Publish
Valida que vídeos cumplan todos los requisitos antes de publicación.

```bash
python flow-executor.py workflows/audit-prepublish.yml
```

Checklist:
- ✅ QC pass (score >= threshold)
- ✅ Duración 25-35 segundos
- ✅ Audio presente y correcto
- ✅ No pantalla negra
- ✅ Metadata completa
- ✅ Script tiene campos requeridos (hook, topic, etc.)

---

#### 5. `debug-stuck-queue.yml` - Debug Cola Atascada
Diagnostica problemas en la cola de procesamiento.

```bash
python flow-executor.py workflows/debug-stuck-queue.yml
```

Verifica:
- ✅ Trabajos pendientes/activos/fallidos
- ✅ Vídeos atascados (>30 min en queue/active)
- ✅ Errores en logs
- ✅ Estado de PM2
- ✅ Últimas fallos de render

---

## Estructura de Workflows

Los workflows son archivos YAML con estructura declarativa:

```yaml
name: Nombre del workflow
description: Descripción

steps:
  - name: "Paso 1"
    type: exec                    # Tipos: exec, script, validate, assert
    command: "comando shell"
    continue_on_error: true       # Opcional: continuar si falla

  - name: "Paso 2"
    type: script
    script: "path/to/script.js"

  - name: "Paso 3"
    type: validate
    files:
      - "path/to/file.txt"
      - path: "path/to/file.mp4"
        min_size: 100000          # Tamaño mínimo en bytes

  - name: "Paso 4"
    type: assert
    condition: "file-exists:path/to/file"
```

### Tipos de Steps

| Tipo | Descripción | Ejemplo |
|------|-------------|---------|
| `exec` | Ejecuta comando shell | `command: "npm test"` |
| `script` | Ejecuta script JS o Python | `script: "test.js"` |
| `validate` | Valida existencia de archivos | `files: ["file.txt"]` |
| `assert` | Verifica condiciones | `condition: "file-exists:path"` |

---

## Reportes

Cada workflow genera un `.report.json` con:
- Timestamp de inicio/fin
- Duración
- Número de pasos
- Output de cada paso

```bash
cat workflows/validate-render.report.json
```

---

## Casos de Uso

### Desarrollo Local
```bash
# Validar que Hyperframe funciona
python flow-executor.py workflows/validate-render.yml

# Revisar QC en vídeo generado
python flow-executor.py workflows/validate-qc.yml
```

### CI/CD (Futuro)
```bash
# En pipeline de CI
python flow-executor.py workflows/validate-3-videos.yml
python flow-executor.py workflows/audit-prepublish.yml
```

### Debugging
```bash
# Diagnosticar cola atascada
python flow-executor.py workflows/debug-stuck-queue.yml
```

---

## Notas Importantes

⚠️ **Rufler solo es para DESARROLLO**

- ❌ NO modifica runtime
- ❌ NO toca scheduler/publisher/OAuth
- ❌ NO afecta pipeline de producción
- ✅ Solo validación y debugging
- ✅ Completamente aislado en `tools/rufler/`

---

## Archivos

```
tools/rufler/
├── flow-executor.py              # Ejecutor de workflows
├── README.md                      # Esta documentación
└── workflows/
    ├── validate-render.yml       # Test renderer Hyperframe
    ├── validate-qc.yml           # Validar QC
    ├── validate-3-videos.yml     # Generar 3 vídeos
    ├── audit-prepublish.yml      # Auditoría pre-publish
    └── debug-stuck-queue.yml     # Debug cola
```

---

## Troubleshooting

### Error: "Command not found"
```bash
# Asegúrate de estar en backend/ para comandos que lo requieren
cd ../..  # Volver a repo root
python tools/rufler/flow-executor.py tools/rufler/workflows/validate-render.yml
```

### Error: "YAML parse error"
```bash
# Valida sintaxis YAML
python -m yaml workflows/validate-render.yml
```

### Timeout en step
Los comandos de larga duración pueden timeout (120-180s). Aumentar si necesario en `flow-executor.py`:
```python
timeout=300  # 5 minutos
```

---

## Extensión (Crear Workflows Nuevos)

Crear `workflows/my-custom-flow.yml`:

```yaml
name: Mi Custom Workflow

steps:
  - name: "Paso 1"
    type: exec
    command: "node -e \"console.log('Hello')\""

  - name: "Paso 2"
    type: validate
    files:
      - "output/prod-video/output.mp4"
```

Ejecutar:
```bash
python flow-executor.py workflows/my-custom-flow.yml
```

---

## Status

✅ **Integrated as Dev Tool**
- Workflows declarativos funcionales
- 5 workflows para casos principales
- Reporte JSON per workflow
- Sin afectar runtime

🔄 **Future Improvements**
- [ ] API HTTP para ejecutar workflows
- [ ] Dashboard web de workflow status
- [ ] Integración con GitHub Actions
- [ ] Notificaciones Slack
