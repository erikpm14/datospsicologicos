# Skill: Datos / Persistencia

## No hay base de datos — sistema file-based

## Archivos de estado
| Archivo | Contenido |
|---|---|
| `backend/data/videos.json` | Registro de todos los videos generados |
| `backend/data/publish-log.json` | Historial de publicaciones (freshness check) |
| `backend/data/publish-state.json` | Estado del scheduler de publicación |
| `backend/data/metrics.json` | Métricas agregadas |
| `backend/data/trends.json` | Tendencias detectadas |
| `backend/data/hook-patterns.json` | Patrones de hooks de alto rendimiento |
| `backend/data/ab-experiments.json` | Experimentos A/B activos |

## Marcadores por video (en `output/{uuid}/`)
- `published.json` → publicado (excluye del siguiente ciclo)
- `discarded.json` → descartado con razón y detalle
- `qc.json` → resultado del quality check (8 criterios, score 0-100)

## Reglas de lectura/escritura
- Leer: `JSON.parse(fs.readFileSync(path, 'utf8'))`
- Escribir: `fs.writeFileSync(path, JSON.stringify(data, null, 2))`
- Siempre con try/catch — los archivos pueden no existir en primera ejecución
- No migrar a SQLite/PostgreSQL: la arquitectura file-based es deliberada

## Cola de trabajos
```
backend/queue/
├── pending/   ← jobs esperando procesarse
├── active/    ← job en curso
├── done/      ← completados
└── failed/    ← fallidos con stack trace
```
Cada job es un archivo `{uuid}.json` con `{ id, script, status, createdAt, ... }`.
