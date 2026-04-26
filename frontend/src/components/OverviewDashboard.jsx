import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ChevronRight, Loader2, Play, TrendingUp } from 'lucide-react';

const TOPIC_ES = {
  body_language: 'Lenguaje corporal',
  cognitive_biases: 'Sesgos cognitivos',
  relationships: 'Relaciones',
  workplace: 'Trabajo',
  first_impressions: '1ª impresión',
  social_skills: 'Hab. sociales',
  habits: 'Hábitos',
  communication: 'Comunicación',
  emotions: 'Emociones',
  memory: 'Memoria',
  motivation: 'Motivación',
  dark_psychology: 'Psic. oscura',
  self_esteem: 'Autoestima',
};

function useCountdown() {
  const [secs, setSecs] = useState(0);
  const [label, setLabel] = useState('');

  useEffect(() => {
    function calc() {
      const slots = ['15:00', '18:00', '21:00'];
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const next = slots.find((slot) => slot > hhmm);
      const target = new Date(now);

      if (next) {
        const [hour, minute] = next.split(':');
        target.setHours(+hour, +minute, 0, 0);
        setLabel(`Hoy · ${next}`);
      } else {
        target.setDate(target.getDate() + 1);
        target.setHours(15, 0, 0, 0);
        setLabel('Mañana · 15:00');
      }

      setSecs(Math.max(0, Math.floor((target - now) / 1000)));
    }

    calc();
    const timer = setInterval(calc, 1000);
    return () => clearInterval(timer);
  }, []);

  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return { display: `${h}:${m}:${s}`, label };
}

function Card({ label, value, detail, tone = 'text-white' }) {
  return (
    <div className="app-kpi">
      <p className="app-kpi-label">{label}</p>
      <p className={`app-kpi-value ${tone}`}>{value}</p>
      <p className="app-kpi-meta">{detail}</p>
    </div>
  );
}

export default function OverviewDashboard({ onNavigate }) {
  const { display, label } = useCountdown();
  const [analytics, setAnalytics] = useState(null);
  const [queue, setQueue] = useState(null);
  const [research, setResearch] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get('/api/analytics'),
      axios.get('/api/queue'),
      axios.get('/api/research/insights').catch(() => ({ data: { data: null } })),
    ])
      .then(([a, q, r]) => {
        setAnalytics(a.data.data);
        setQueue(q.data.data);
        setResearch(r.data.data);
      })
      .finally(() => setLoading(false));

    const timer = setInterval(() => {
      axios.get('/api/queue').then((response) => setQueue(response.data.data)).catch(() => {});
    }, 7000);

    return () => clearInterval(timer);
  }, []);

  const kpis = analytics?.kpis || {};
  const topVideos = analytics?.topVideos || [];
  const topTopics = analytics?.topicPerformance?.slice(0, 3) || [];
  const researchTopics = research?.insights?.topicsRanking?.slice(0, 3) || [];
  const hasData = (kpis.totalViews || 0) > 0;

  const trend = useMemo(() => {
    const trend7 = analytics?.trend7 || [];
    if (trend7.length < 2) return { label: 'Sin histórico', detail: 'todavía' };
    const first = trend7[0]?.views || 0;
    const last = trend7[trend7.length - 1]?.views || 0;
    if (!first) return { label: 'Nueva señal', detail: 'arrancando' };
    const delta = ((last - first) / first) * 100;
    return {
      label: delta > 8 ? 'Sube' : delta < -8 ? 'Baja' : 'Estable',
      detail: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`,
    };
  }, [analytics]);

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Loader2 size={24} className="animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="app-page">
      <div className="app-panel overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.14),transparent_32%),linear-gradient(180deg,#0f141b_0%,#0c1117_100%)] p-6">
        <p className="app-eyebrow">Inicio</p>
        <h1 className="mt-2 text-[30px] font-black leading-tight text-white">Vista general de la máquina</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">
          Resumen ejecutivo de publicación, crecimiento y señal viral sin salir del dark mode.
        </p>

        <div className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="app-panel-soft p-5">
            <p className="app-kpi-label">Próximo vídeo automático</p>
            <p className="mt-3 text-5xl font-black tracking-tight text-white">{display}</p>
            <p className="mt-2 text-sm text-white/42">{label}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={() => onNavigate('generate')} className="app-button app-button-strong">
                <Play size={14} />
                Generar ahora
              </button>
              <button onClick={() => onNavigate('videos')} className="app-button">
                Ver vídeos
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card label="Vídeos" value={kpis.totalVideos ?? 0} detail="publicados" />
            <Card label="Views" value={(kpis.totalViews || 0).toLocaleString('es-ES')} detail="totales" tone="text-sky-300" />
            <Card label="Engagement" value={`${kpis.avgEngagement ?? 0}%`} detail="medio" tone="text-emerald-300" />
            <Card label="Tendencia" value={trend.label} detail={trend.detail} tone={trend.label === 'Sube' ? 'text-emerald-300' : trend.label === 'Baja' ? 'text-red-300' : 'text-white'} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="app-panel">
          <div className="app-section-header">
            <p className="app-eyebrow">Producción</p>
            <h2 className="app-title">Cola actual</h2>
          </div>
          <div className="grid gap-4 px-6 py-6 md:grid-cols-4">
            {[
              { label: 'Esperando', value: queue?.waiting || 0, tone: 'text-white' },
              { label: 'En curso', value: queue?.active || 0, tone: 'text-amber-300' },
              { label: 'Listos', value: queue?.completed || 0, tone: 'text-emerald-300' },
              { label: 'Fallos', value: queue?.failed || 0, tone: 'text-red-300' },
            ].map((item) => (
              <Card key={item.label} label={item.label} value={item.value} detail="cola" tone={item.tone} />
            ))}
          </div>
        </div>

        <div className="app-panel">
          <div className="app-section-header">
            <p className="app-eyebrow">Viral</p>
            <h2 className="app-title">Temas calientes</h2>
          </div>
          <div className="space-y-3 px-6 py-6">
            {(researchTopics.length ? researchTopics : topTopics).map((item, index) => (
              <div key={`${item.topic}-${index}`} className="app-panel-soft flex items-center justify-between p-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{TOPIC_ES[item.topic] || item.topic}</p>
                  <p className="mt-1 text-xs text-white/38">{item.count ? `${item.count} vídeos` : 'señal reciente'}</p>
                </div>
                <span className="app-badge app-badge-good">{Math.round(item.avgViralityScore || item.avgViews || 0)}</span>
              </div>
            ))}
            {topTopics.length === 0 && researchTopics.length === 0 ? (
              <div className="app-panel-soft p-5 text-sm text-white/38">
                Sin datos suficientes todavía.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="app-panel">
          <div className="app-section-header">
            <p className="app-eyebrow">Top vídeos</p>
            <h2 className="app-title">Lo que más está tirando</h2>
          </div>
          <div className="space-y-3 px-6 py-6">
            {topVideos.slice(0, 4).map((video, index) => (
              <div key={video.id || index} className="app-panel-soft p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{video.hook || 'Sin título'}</p>
                    <p className="mt-2 text-xs text-white/38">
                      {(video.max_views || 0).toLocaleString('es-ES')} views · {video.topic || 'sin topic'}
                    </p>
                  </div>
                  <span className="app-badge app-badge-good">{video.virality_score || 0}</span>
                </div>
              </div>
            ))}
            {!hasData ? <div className="app-panel-soft p-5 text-sm text-white/38">Publica vídeos para ver señal real.</div> : null}
          </div>
        </div>

        <div className="app-panel">
          <div className="app-section-header">
            <p className="app-eyebrow">Siguiente paso</p>
            <h2 className="app-title">Dónde entrar ahora</h2>
          </div>
          <div className="grid gap-3 px-6 py-6">
            {[
              { id: 'money', title: 'Monetización', detail: 'ver qué formatos escalar y cuánto falta para monetizar' },
              { id: 'ops', title: 'Operaciones', detail: 'revisar cola, calidad y próximas publicaciones' },
              { id: 'viral', title: 'Viral', detail: 'extraer patrones de hooks y temas con mejor señal' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="app-panel-soft flex items-center justify-between p-4 text-left transition hover:border-white/12 hover:bg-white/6"
              >
                <div>
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-1 text-xs text-white/38">{item.detail}</p>
                </div>
                <ChevronRight size={16} className="text-white/28" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
