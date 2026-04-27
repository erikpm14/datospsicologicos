# ⚠️  YOUTUBE OAUTH RENEWAL — URGENTE

**Status**: 🔴 REFRESH TOKEN EXPIRED  
**Current State**: invalid_grant (token has been expired or revoked)  
**Affected Video**: d101f12c-3658-4a35-9923-687e59351744 (VALID, pero bloqueado por OAuth)

---

## 📊 Diagnóstico

```
YOUTUBE_OAUTH_VALID=false
reason=invalid_grant
```

El vídeo `d101f12c-3658-4a35-9923-687e59351744` tiene:
- ✅ Captions válidos: `captionSource=final-audio-speech-segment`, `driftStatus=excellent`
- ✅ output.mp4 presente y válido
- ✅ Script cumple V4.1
- ❌ YouTube Refresh Token EXPIRADO

---

## 🔐 Renovar Token OAuth

### Opción 1: Script Interactivo (Recomendado)

```bash
cd backend
node scripts/youtube-auth-renew.js
```

**Pasos:**
1. Script genera URL de autorización
2. Abre en navegador y autoriza
3. Copia authorization code
4. Pega en script
5. Script intercambia por tokens
6. Actualiza .env automáticamente

**Scopes Solicitados:**
- `https://www.googleapis.com/auth/youtube.upload` — subir vídeos
- `https://www.googleapis.com/auth/youtube` — acceso general

### Opción 2: Manual (Google Cloud Console)

1. Ir a https://myaccount.google.com/permissions
2. Buscar "Generador de vídeos" o tu app
3. Revocar acceso
4. Ejecutar script interactivo nuevamente
5. Autorizar nuevamente

---

## ✅ Verificar Token

Después de renovar, validar que funciona:

```bash
node scripts/check-youtube-oauth.js
```

Output esperado:
```
✅ YOUTUBE OAUTH VALID

   YOUTUBE_OAUTH_VALID=true
   token_type=Bearer
   expires_in=3599
   scope=...youtube.upload...
```

---

## 🚀 Reintentar Publicación

Una vez renovado el token:

```bash
node scripts/retry-publish-video.js d101f12c-3658-4a35-9923-687e59351744
```

**Sin regenerar vídeo.** El vídeo ya es válido en captions, solo necesita se reintente upload.

Output esperado:
```
✅ VIDEO PUBLISHED

   ✅ youtube: <VIDEO_ID>
```

---

## 📋 Checklist

- [ ] Ejecutar: `node scripts/youtube-auth-renew.js`
- [ ] Autorizar en navegador
- [ ] Pegar authorization code
- [ ] Permitir actualización de .env
- [ ] Verificar: `node scripts/check-youtube-oauth.js`
- [ ] Reintentar: `node scripts/retry-publish-video.js d101f12c-3658-4a35-9923-687e59351744`
- [ ] Confirmar video publicado en YouTube

---

## 🛠️ Flujo Técnico

### Antes (sin protección)
```
publishAll() → OAuth fail (invalid_grant)
  ↓
Video marcado como DISCARDED
  ↓
❌ No se puede reintentar sin regenerar
```

### Ahora (con protección)
```
publishAll() → OAuth fail (invalid_grant)
  ↓
Video NO marcado como discarded
  ↓
Video permanece en ready
  ↓
Renovar token + retry-publish-video.js
  ↓
✅ Video se publica sin regeneración
```

---

## 🔍 Variables de Entorno

Verificar que .env contiene:

```env
YOUTUBE_CLIENT_ID=<your-client-id>
YOUTUBE_CLIENT_SECRET=<your-client-secret>
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth/youtube/callback
YOUTUBE_REFRESH_TOKEN=<NEW-TOKEN-AQUI>
```

⚠️ **Importante**: No compartir secrets en logs ni commits

---

## 📝 Logs Relevantes

Buscar en logs:

```
YOUTUBE_OAUTH_CHECK_FAILED | error=invalid_grant
RETRY_PUBLISH_SUCCESS | videoId=d101f12c-3658-4a35-9923-687e59351744
YouTube: OAuth token expired — video preserved for retry
```

---

## ❓ Preguntas Frecuentes

### ¿Cada cuánto hay que renovar?
Google refresh tokens tienen vida indefinida, pero se invalidan si:
- 6 meses sin usar
- Usuario revoca acceso
- Credenciales cambian

### ¿Se pierden vídeos?
No. El vídeo permanece en ready. Solo requiere reintentar una vez renovado el token.

### ¿Puedo revocar el token manualmente?
Sí: https://myaccount.google.com/permissions

### ¿Qué pasa si falla TikTok pero YouTube OK?
`publishAll()` devuelve resultado parcial. El vídeo se considera publicado (YouTube = principal).

---

## 🎬 Próximos Pasos

1. **Ahora**: Renovar token
2. **Después**: Reintentar video d101f12c...
3. **Futuro**: Renovar anualmente como mantenimiento preventivo

