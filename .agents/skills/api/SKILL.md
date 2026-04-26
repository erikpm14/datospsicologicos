# Skill: API

## Base
Express 4 en `backend/src/server.js`, puerto 3001.
Todos los endpoints bajo `/api/`.

## Endpoints existentes (verificar en server.js)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servidor |
| GET | `/api/videos` | Lista de videos generados |
| GET | `/api/queue` | Estado de la cola |
| GET | `/api/analytics` | Métricas agregadas |
| GET | `/api/quality/latest` | Último resultado QC |
| GET | `/api/quality/check/:videoId` | QC de un video específico |
| GET | `/api/templates` | Templates de hooks disponibles |
| GET | `/api/assets/debug` | Estado de assets |
| POST | `/api/generate` | Generar video bajo demanda |
| POST | `/api/publish/:videoId` | Publicar video manualmente |

## Convenciones
- Respuestas: `res.json({ success: true, data: ... })` o `res.json({ success: false, error: '...' })`
- Errores: `res.status(4xx/5xx).json({ success: false, error: msg })`
- Sin middleware de auth (sistema privado, red local)
- CORS habilitado para dev (`cors()`)

## Añadir endpoint
```javascript
app.get('/api/nuevo', async (req, res) => {
  try {
    const data = await servicio.funcion();
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`GET /api/nuevo: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});
```
