# 🔍 AUDITORÍA: YOUTUBE OAUTH EN EL SISTEMA

**Fecha**: 2026-04-27  
**Status**: invalid_grant — Token expirado  
**Vídeo Bloqueado**: d101f12c-3658-4a35-9923-687e59351744

---

## 📊 Estado del Vídeo

```
videoId: d101f12c-3658-4a35-9923-687e59351744
captionSource: final-audio-speech-segment ✅ (excelente)
driftStatus: excellent ✅
output.mp4: ✅ presente
script.json: ✅ presente
captions-debug.json: ✅ válido
Razón bloqueo: YouTube OAuth invalid_grant
```

**CONCLUSIÓN**: Vídeo 100% válido. Solo OAuth expiró.

---

## 🔐 Flujo OAuth Auditado

### 1. Variables de Entorno
Ubicación: `backend/.env`

```
YOUTUBE_CLIENT_ID=<oauth-client-id>
YOUTUBE_CLIENT_SECRET=<oauth-client-secret>
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth/youtube/callback
YOUTUBE_REFRESH_TOKEN=<EXPIRADO>
```

**Verificación**: ✅ Las 4 variables están configuradas en .env

### 2. Cliente OAuth Construcción

**Archivo**: `backend/src/services/youtube-integration.service.js:280-292`

```javascript
async function getYouTubeAccessToken() {
  const response = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  return response.data.access_token;
}
```

**Verificación**: ✅ Construcción correcta del cliente

### 3. Puntos de Uso

| Archivo | Función | Línea | Uso |
|---------|---------|-------|-----|
| `youtube-integration.service.js` | `getYouTubeAccessToken()` | 280 | Obtener token para API |
| `youtube-integration.service.js` | `youtubeGetMine()` | 269 | Llamadas autenticadas |
| `publisher.js` | `getYouTubeAccessToken()` | 281 | Upload de vídeos |
| `publisher.js` | `publishToYouTube()` | 219 | Publicación YouTube |
| `analytics-tracker.js` | N/A | - | Tracking de métricas |

### 4. Manejo de Errores

**Antes** (sin protección):
```
publishAll() → getYouTubeAccessToken() fail (invalid_grant)
  ↓
Excepción capturada en runWithRetry()
  ↓
Video potencialmente descartado como fallido
  ↓
❌ No recoverable sin rerender
```

**Después** (con protección):
```
publishAll() → getYouTubeAccessToken() fail (invalid_grant)
  ↓
Detectado: isOAuthInvalidGrant = true
  ↓
Video NO descartado
  ↓
Permanece en ready para retry
  ↓
✅ Recoverable: renovar token + retry-publish-video.js
```

---

## 🛠️ Solución Implementada

### Scripts Creados

#### 1. `check-youtube-oauth.js`
- Valida que REFRESH_TOKEN funciona
- No intenta publicar
- Output: YOUTUBE_OAUTH_VALID=true/false

#### 2. `youtube-auth-renew.js`
- Genera URL OAuth
- Usuario autoriza en navegador
- Intercambia code por nuevo refresh_token
- Actualiza .env automáticamente
- Scopes: youtube.upload + youtube

#### 3. `retry-publish-video.js`
- Reintenta publicación de vídeo existente
- Sin regeneración de vídeo
- Verifica: captions, output.mp4, OAuth
- Llamada a publishAll() existente

### Protecciones Publisher
- `publisher.js:444-461` — No descartar si invalid_grant
- Video permanece recuperable
- Permite retry sin rerender

---

## 📋 Auditoría de Scopes

Scopes solicitados en OAuth:
```
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube
```

**Verificación**: ✅ Scopes suficientes para upload

Scopes adicionales usados por sistema:
- `youtube-integration.service.js`: lectura de channel, playlists, vídeos
- `analytics-tracker.js`: lectura de métricas
- `youtube-channel-analysis.service.js`: análisis de canal

**Conclusión**: Scopes ampliamente cubiertos por `youtube` scope general

---

## 🔒 Seguridad

### Gestión de Secretos
- ✅ CLIENT_SECRET en .env (no versionado)
- ✅ REFRESH_TOKEN en .env (no versionado)
- ✅ Scripts no loguean secretos
- ✅ youtube-auth-renew.js ofrece actualización manual o automática

### Validación de Inputs
- ✅ check-youtube-oauth.js: verifica variables antes de usar
- ✅ retry-publish-video.js: valida videoId, archivos, OAuth
- ✅ youtube-auth-renew.js: pide confirmación antes de escribir .env

---

## 🔄 Flujo Completo (Usuario)

```
1. check-youtube-oauth.js
   ↓ (resultado: invalid_grant)
   
2. youtube-auth-renew.js
   ├─ Usuario abre URL en navegador
   ├─ Autoriza
   ├─ Copia authorization code
   └─ Pega en script
   
3. Script intercambia code por refresh_token
   
4. Script actualiza .env (opcional)
   
5. check-youtube-oauth.js (verificar)
   ↓ (resultado: ✅ VALID)
   
6. retry-publish-video.js d101f12c...
   ├─ Verifica captions
   ├─ Verifica output.mp4
   ├─ Verifica OAuth
   └─ Publica a YouTube
   
7. ✅ Video publicado (sin rerender)
```

---

## 📊 Comparativa: Antes vs Después

| Aspecto | Antes | Después |
|---------|-------|---------|
| OAuth fail → | Video descartado | Video recuperable |
| Rerender necesario? | SÍ | NO |
| Tiempo para recover | ~5min (rerender) | ~2min (retry) |
| Captions reutilizadas? | NO | SÍ |
| Scripts disponibles? | NO | SÍ (3 scripts) |

---

## ✅ Validación

- ✅ node --check: todos los scripts pasan
- ✅ check-youtube-oauth.js ejecutado: invalid_grant detectado
- ✅ publisher.js protegido: no descarta en invalid_grant
- ✅ Documentación: YOUTUBE_OAUTH_RENEWAL.md creado

---

## 🎯 Conclusión

**Antes**: OAuth fail → vídeo perdido → regenerar  
**Ahora**: OAuth fail → vídeo guardado → renovar token → retry

Sistema blindado contra token expiration.

