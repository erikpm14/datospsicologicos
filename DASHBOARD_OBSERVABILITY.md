# Dashboard Observability — Video Status & Publishing System

**Date:** 2026-04-27  
**Status:** ✅ COMPLETE  
**Scope:** Observability only — NO pipeline changes

---

## OVERVIEW

Added comprehensive **dashboard visibility** into video status and publishing system without modifying any rendering, caption, OAuth, or scheduler logic.

New tab: **"Estado"** in the dashboard with real-time system health and video metrics.

---

## BACKEND IMPLEMENTATION

### 1. Dashboard Stats Service
**File:** `backend/src/services/dashboard-stats.service.js` ✅ CREATED

**Functions:**
- `getVideoStatus()` — Complete system snapshot
- `getNextSlot()` — Next scheduled publication
- `getHealth()` — System health metrics

**Data Sources:**
- `output/*/render-metadata.json` — Render info
- `output/*/captions-debug.json` — Caption metrics
- `output/*/qc.json` — QC results
- `output/*/script.json` — Video title
- `.env` — AUTO_PUBLISH_ENABLED, YOUTUBE_REFRESH_TOKEN

**Graceful Degradation:** Returns `unknown` status if data missing, never crashes dashboard

---

### 2. REST Endpoints

#### `GET /api/dashboard/video-status`
Returns complete system state and last 50 videos.

**Response:**
```json
{
  "system": {
    "autoPublishEnabled": false,
    "youtubeOAuthValid": true,
    "lastCheckAt": "2026-04-27T16:00:00Z"
  },
  "summary": {
    "published": 12,
    "ready": 2,
    "queued": 1,
    "rendering": 0,
    "blocked": 1,
    "failed": 0
  },
  "nextSlot": {
    "time": null,
    "minutesUntil": null,
    "candidateVideoId": "...",
    "status": "ready"
  },
  "videos": [
    {
      "videoId": "...",
      "title": "...",
      "status": "published|ready|queued|rendering|blocked|failed",
      "createdAt": "...",
      "publishedAt": null,
      "scheduledFor": null,
      "youtubeUrl": "...",
      "captionStatus": {
        "source": "final-audio-speech-segment",
        "driftStatus": "excellent",
        "driftSeconds": 0.02,
        "captionCount": 24
      },
      "assetStatus": {
        "status": "pass|replaced|missing|failed",
        "missingAssets": []
      },
      "visualQc": {
        "status": "pass|blocked|unknown",
        "reason": null
      },
      "publishBlockReason": null
    }
  ]
}
```

---

#### `GET /api/dashboard/next-slot`
Returns next scheduled publication slot.

**Response:**
```json
{
  "time": "2026-04-27T18:00:00Z",
  "minutesUntil": 120,
  "candidateVideoId": "d101f12c-...",
  "candidateTitle": "Tu móvil te droga y lo sabes perfectamente",
  "isReady": true,
  "blockReason": null
}
```

---

#### `GET /api/dashboard/health`
System health snapshot.

**Response:**
```json
{
  "autoPublishEnabled": false,
  "youtubeOAuth": "valid|invalid|unknown",
  "assetGate": "enabled",
  "visualQc": "enabled",
  "captionSync": "enabled",
  "lastPublishedVideo": "abc123...",
  "readyVideos": 2,
  "blockedVideos": 1,
  "lastError": null,
  "timestamp": "2026-04-27T16:00:00Z"
}
```

---

## FRONTEND IMPLEMENTATION

### New Tab: "Estado" (Status)

**File:** `frontend/src/components/VideoStatusDashboard.jsx` ✅ CREATED

**Components:**

1. **System Status Cards** (top row)
   - Auto-Publish toggle (green/red)
   - YouTube OAuth status (green/red)
   - Next publication countdown

2. **Summary Metrics** (card grid)
   - Publicados (green border)
   - Listos (green border)
   - En Cola (yellow border)
   - Renderizando (blue border)
   - Bloqueados (red border)
   - Fallidos (dark red border)

3. **Videos Table** (scrollable)
   - Estado badge (color-coded)
   - Título + VideoId
   - Fecha de creación
   - Caption status (drift + quality)
   - Asset status (pass/replaced/missing)
   - Visual QC status
   - YouTube link

4. **Auto-Refresh** (every 30s)
5. **Manual Refresh Button**

---

### Styling

**File:** `frontend/src/components/VideoStatusDashboard.css` ✅ CREATED

**Color Scheme:**
- ✅ Green (#10b981) — published/ready/pass
- ⏳ Yellow (#f59e0b) — queued/warning
- 🎬 Blue (#3b82f6) — rendering
- ⛔ Red (#ef4444) — blocked
- ✗ Dark Red (#dc2626) — failed
- ❓ Gray (#6b7280) — unknown

**Responsive Design:**
- Desktop: 3-column status cards, full table
- Tablet: 2-column cards, scrollable table
- Mobile: 1-column cards, minimal table

---

## INTEGRATION

**File:** `frontend/src/App.jsx` ✅ MODIFIED

**Changes:**
- Added import for Activity icon (lucide-react)
- Added VideoStatusDashboard import
- Added new "Estado" tab with Activity icon
- Added tab case for rendering VideoStatusDashboard

**Navigation:**
Desktop: Top navigation bar with "Estado" button  
Mobile: Bottom tab bar with Activity icon

---

## FEATURES

### Real-time Metrics
- Video count by status
- Next publication countdown
- OAuth validity
- Auto-publish toggle state

### Video Details
- Current status (with color)
- Creation timestamp
- Caption sync quality + drift
- Asset recovery status
- Visual QC results
- YouTube link (if published)

### System Health
- Auto-publish enabled/disabled
- OAuth token validity
- All gates enabled (asset, visual QC, caption sync)
- Last published video
- Ready/blocked/failed counts

### Safe Defaults
- Missing data → `unknown` status (no crash)
- API errors → graceful fallback
- Auto-refresh every 30s
- Manual refresh button always available

---

## WHAT'S NOT CHANGED

✅ NO changes to:
- video-renderer.js (render pipeline)
- caption-sync.js (caption generation)
- OAuth flows (refresh tokens)
- publisher.js (publishing logic)
- scheduler.service.js (scheduling)
- asset-validator.service.js (asset validation)

Only **reading** metadata for visibility.

---

## TESTING CHECKLIST

- [x] Backend syntax check: `node --check backend/src/server.js` ✓
- [x] Dashboard loads even with missing data
- [x] Endpoints respond with valid JSON
- [x] Auto-refresh doesn't spam logs
- [x] Colors clearly indicate status
- [x] Table is horizontally scrollable on mobile
- [x] No console errors

---

## ENDPOINT USAGE

### From Dashboard
```javascript
// Auto-fetches every 30 seconds
fetch('/api/dashboard/video-status')
fetch('/api/dashboard/next-slot')
fetch('/api/dashboard/health')
```

### From CLI (for testing)
```bash
curl http://localhost:3001/api/dashboard/video-status
curl http://localhost:3001/api/dashboard/next-slot
curl http://localhost:3001/api/dashboard/health
```

---

## NEXT STEPS (OPTIONAL)

If desired later (NOT required):
1. Add "Retry Publish" button (requires safe endpoint)
2. Add graphs (publish history, viral score over time)
3. Add filters (by date, status, topic)
4. Add export (CSV of video metrics)
5. Persist metrics to analytics DB (for trending)

---

## FILES CREATED

| File | Type | Purpose |
|------|------|---------|
| `backend/src/services/dashboard-stats.service.js` | Service | Read video metadata, compile stats |
| `frontend/src/components/VideoStatusDashboard.jsx` | Component | Display dashboard UI |
| `frontend/src/components/VideoStatusDashboard.css` | Styles | Layout + colors + responsive |

---

## FILES MODIFIED

| File | Change | Lines |
|------|--------|-------|
| `backend/src/server.js` | Added dashboard stats import + 3 endpoints | +44 |
| `frontend/src/App.jsx` | Added Status tab + component | +4 |

---

## DEPLOYMENT

1. **Backend:** Already added to `server.js`
2. **Frontend:** Already added to `App.jsx`
3. **No DB migrations needed** (reads existing files only)
4. **No env vars needed** (uses existing AUTO_PUBLISH_ENABLED)

### To Deploy
```bash
# Backend already has endpoints running
# Frontend — if using build:
npm run build  # if applicable

# Then restart server
pm2 restart all
```

---

## MONITORING

**Monitor these logs:**
```
[info]: Dashboard video-status endpoint called
[info]: Dashboard next-slot endpoint called
[info]: Dashboard health endpoint called
```

If you see errors in these endpoints, check:
- `output/` directory structure
- render-metadata.json files exist
- captions-debug.json files exist

---

**Status:** ✅ READY FOR PRODUCTION  
**Risk Level:** MINIMAL (read-only observability)  
**Fallback:** Dashboard still works even if no video data exists
