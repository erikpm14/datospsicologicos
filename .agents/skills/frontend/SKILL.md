# Skill: Frontend

## Stack
React 18, Vite, Tailwind CSS, CommonMark routing manual (sin React Router)

## Estructura
```
frontend/src/
├── App.jsx          # Router principal + bottom nav (5 tabs)
├── index.css        # Tailwind base
└── components/
    ├── OverviewDashboard.jsx   # Tab principal
    ├── OperationsDashboard.jsx # Estado del pipeline
    ├── VideoQueue.jsx          # Cola de videos pendientes
    ├── VideoList.jsx           # Videos generados
    ├── VideoStats.jsx          # Estadísticas de un video
    ├── AnalyticsDashboard.jsx  # Métricas agregadas
    ├── PerformancePanel.jsx    # Performance por slot horario
    ├── ContentCalendar.jsx     # Calendario de publicaciones
    ├── ViralInsights.jsx       # Insights de viralidad
    └── ResearchInsights.jsx    # Investigación de tendencias
```

## Patrones
- Componentes: functional con hooks (`useState`, `useEffect`)
- Fetch: `fetch('/api/...')` — base URL relativa (Express sirve el frontend)
- Estilo: Tailwind utility classes, dark theme (`bg-gray-900`, `text-white`)
- Mobile-first: bottom navigation, diseño vertical

## API base
El backend Express sirve el frontend desde `frontend/dist/` en producción.
En desarrollo: `npm run dev` en `frontend/` (proxy en `vite.config.js` → `:3001`).

## No hacer
- No añadir React Router ni librerías de routing
- No hacer fetch a URLs absolutas — usar rutas relativas `/api/...`
