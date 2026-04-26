# Development Tools Archive

This folder contains all non-production development, analysis, and experimental files.

**These files are NOT used in production. Production code is in root directories like `backend/src/`, `content-engine/`, `frontend/`.**

---

## 📁 Structure

### `/analysis/`
**Internal analysis and validation documents**
- `ANALISIS_GLOBAL_CANAL.md` — Channel performance analysis
- `ANALISIS_VIDEO_GANADOR.md` — Winning video analysis
- `VALIDACION_CAMBIOS_GENERADOR.md` — Generator changes validation
- `VALIDACION_RUNTIME.md` — Runtime validation results
- `REGLAS_SISTEMA_GENERADOR.md` — Generator system rules
- `RESUMEN_EJECUTIVO.txt` — Executive summary
- `VARIEDAD_HOOKS_IMPLEMENTACION.md` — Hook variety implementation notes

### `/diagnostics/`
**Runtime diagnostics and test results**
- Test render outputs
- Quality control reports
- Runtime validation logs
- Diagnostic data from failed operations

### `/docs/`
**Development documentation**
- Technical notes
- Experimental implementations
- Research documentation
- Integration guides (non-production)

### `/releases/`
**Archived releases and versioning**
- Old version zips
- Release notes
- Version history

### `/scripts-global/`
**Utility scripts for development**
- `analizar_hooks.sh` — Hook analysis script
- Other development utility scripts

### `/backend/dev-tools/` (see backend/dev-tools/README.md)
**Backend-specific development files**
- 45+ test scripts
- Retention spike research
- Analysis and reporting scripts
- Validation utilities

---

## 🎯 What NOT to Do

❌ **Do NOT** import from this folder in production code  
❌ **Do NOT** rely on these scripts for production operations  
❌ **Do NOT** modify production code based on analysis documents here  
✅ **DO** use for:
  - Understanding system history
  - Development/testing
  - Analyzing past performance
  - Researching new approaches

---

## 🔒 Safety

- Zero production dependencies on dev-tools/
- These files can be deleted without affecting live system
- They're preserved for reference and future learning
- Production backup—all real code is in main directories

---

## 📂 When to Add Files Here

Add files to dev-tools/ if they are:
- ✓ Test scripts or test data
- ✓ Analysis or research documents
- ✓ Temporary debugging scripts
- ✓ Old versions or archived code
- ✓ Internal validation reports

Keep in main directories if they are:
- ✓ Actively used in production
- ✓ Part of the core pipeline
- ✓ Required for scheduled operations
- ✓ Configuration files

---

Generated: 2026-04-26  
Purpose: Project professionalization and cleanup  
Status: Archive of development activity
