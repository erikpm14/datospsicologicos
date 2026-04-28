# Rufler - Integración como Herramienta de Desarrollo

## Garantías de Seguridad

✅ **Rufler NO afecta el runtime del pipeline**

### Lo que Rufler NO hace:
```
❌ No modifica backend/ (excepto lectura)
❌ No toca .env (solo lee para variables)
❌ No afecta Node.js processes
❌ No interfiere con PM2
❌ No modifica base de datos
❌ No toca OAuth/tokens
❌ No toca scheduler de publicación
❌ No toca renderer/publisher
```

### Lo que Rufler SÍ hace:
```
✅ Ejecuta workflows de validación
✅ Lee logs y metadata
✅ Ejecuta tests en ambiente aislado
✅ Genera reportes de diagnóstico
✅ Valida archivos existentes
✅ Ejecuta ffprobe/ffmpeg para validación
✅ Lee JSON metadata
```

---

## Aislamiento

```
Estructura:
├── backend/               ← PRODUCCIÓN (untouched)
├── frontend/              ← PRODUCCIÓN (untouched)
├── tools/
│   └── rufler/            ← DESARROLLO (read-only access)
│       ├── flow-executor.py
│       ├── workflows/
│       └── README.md
└── .env                   ← Sin modificar por Rufler
```

**Rufler corre en tools/rufler/ y SOLO LEE desde backend/**

---

## Validación de No-Impact

### 1. Cambios a Código de Producción: CERO

```bash
# Verificar que tools/ no tiene dependencias en runtime
grep -r "tools/rufler" backend/ package.json || echo "No references found"
```

Expected: "No references found"

### 2. Cambios a Package.json: NINGUNO

```bash
# Rufler no añade dependencias a backend
grep "rufler" backend/package.json || echo "Not in package.json"
```

Expected: "Not in package.json"

### 3. Cambios a .env: NINGUNO (por diseño)

```bash
# Rufler solo LEE .env, no lo modifica
# Verificable: flow-executor.py nunca escribe a .env
```

### 4. PM2/Runtime: NO AFFECTED

```bash
# PM2 processes no se ven afectados
pm2 list
# (same as before installing Rufler)
```

---

## Casos de Uso

### ✅ PERMITIDO (Seguro)

```bash
# Validar Hyperframe render
python tools/rufler/flow-executor.py tools/rufler/workflows/validate-render.yml

# Auditoría pre-publish
python tools/rufler/flow-executor.py tools/rufler/workflows/audit-prepublish.yml

# Debug cola
python tools/rufler/flow-executor.py tools/rufler/workflows/debug-stuck-queue.yml
```

### ❌ PROHIBIDO (No implementado)

```bash
# Estos NO están en flow-executor.py
# - Modificar database
# - Cambiar .env
# - Kill processes
# - Restartar PM2
# - Publicar vídeos
# - Eliminar vídeos
```

---

## Arquitectura

### Flow Executor (Python)
```
flow-executor.py
├── Load YAML workflow
├── Parse steps
├── Execute each step:
│   ├── exec: shell command (read-only)
│   ├── script: node.js/python script (read-only context)
│   ├── validate: check files exist
│   └── assert: check conditions
└── Generate report (JSON)

NO write access to:
  - backend/ code
  - .env files
  - database
  - PM2
```

### Workflows (YAML)
```
Each workflow:
- Reads from output/, logs/, data/
- Executes validation commands
- Generates reports
- Never modifies backend/

Example:
  steps:
    - exec: "cat file.json"           ✅ Read
    - validate: files exist           ✅ Check
    - assert: condition true          ✅ Verify
    - script: "node test.js"          ✅ Test (isolated)
```

---

## Verificación Pre-Deployment

Antes de usar Rufler en CI/CD:

```bash
# 1. Verificar que ningún workflow modifica backend/
grep -r ">" tools/rufler/workflows/ | grep -v ".report"
# Expected: Empty (no output redirection to backend/)

# 2. Verificar que flow-executor.py no tiene write operations
grep -E "writeFile|mkdir|rm|mv" tools/rufler/flow-executor.py
# Expected: Only in expand_vars and save_report (local)

# 3. Verificar que .env no es touched
grep "\.env" tools/rufler/flow-executor.py
# Expected: Empty or only read operations
```

---

## Performance Impact

- **Runtime overhead:** CERO (no corre en pipeline)
- **Disk space:** ~50KB (flow-executor + workflows)
- **Dependencies:** pyyaml (dev-only)
- **Python version:** 3.7+ (non-blocking)

---

## Cleanup

Si necesitas desinstallar Rufler completamente:

```bash
# 1. Remove tools directory
rm -rf tools/

# 2. No other cleanup needed (no entries in package.json, .env, etc.)
```

---

## Monitoring

Para verificar que Rufler está funcionando correctamente:

```bash
# Check that workflow reports are created
ls -la tools/rufler/workflows/*.report.json

# Sample report content
cat tools/rufler/workflows/validate-render.report.json
```

Expected content:
```json
{
  "flow": "Validar Render Hyperframe",
  "start_time": "2026-04-28T...",
  "end_time": "2026-04-28T...",
  "duration_seconds": 45.23,
  "steps": 5
}
```

---

## Future Roadmap

### Phase 1 (Done)
- ✅ Flow executor implementation
- ✅ 5 core workflows
- ✅ YAML parsing
- ✅ Report generation

### Phase 2 (Optional)
- [ ] HTTP API for workflows
- [ ] Web dashboard
- [ ] GitHub Actions integration
- [ ] Slack notifications
- [ ] Cron scheduling

### Phase 3 (Future)
- [ ] Multi-machine execution
- [ ] Workflow composition
- [ ] Conditional steps
- [ ] Parallel steps

---

## Conclusion

✅ **Rufler está completamente aislado y seguro**

- No afecta runtime
- Solo para desarrollo/debugging
- Read-only access a backend/
- Cero dependencias en producción
- Fácil de remover si no se necesita

**Status:** Safe to integrate as dev tool
