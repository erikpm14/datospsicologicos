# AGENTS.md — Reglas globales del proyecto

## Estilo de respuesta
- Respuestas cortas y técnicas. Sin resúmenes al final.
- Código directo, sin explicar lo obvio.
- Si hay duda sobre el alcance, ejecuta el cambio mínimo válido.
- No añadas manejo de errores, comentarios ni refactorizaciones no solicitadas.

## Estrategia de lectura (ahorro de tokens)
1. Antes de leer un archivo, comprueba si ya tienes el contexto necesario.
2. Para cambios de una sola función: lee solo el rango de líneas relevante.
3. Para cambios de pipeline: lee `video-processor.js` primero — orquesta todo el flujo.
4. Nunca releas archivos ya leídos en la sesión a menos que sean necesarios.

## Cambio mínimo válido
- Modifica solo lo que se pide. No limpies código adyacente.
- Si una función no se toca, no la documentes ni la renombres.
- Prefiere Edit sobre Write para archivos existentes.

## Contexto de sesión
- Carga `context/architecture.md` si no conoces la estructura del repo.
- Carga `context/conventions.md` antes de escribir código nuevo.
- Carga `memory/decisions.md` antes de proponer cambios de arquitectura.

## Plataforma
- Windows 11, shell bash (via Git Bash). Rutas con `/` no `\`.
- Node.js backend en `backend/`, React en `frontend/`.
- PM2 gestiona el proceso: `pm2 restart all`.
- Puerto único: 3001 (Express sirve API + frontend estático).
