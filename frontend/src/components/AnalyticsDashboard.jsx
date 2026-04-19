import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Eye, TrendingUp, Film, Zap, Play, AlertCircle, Loader, Clock } from 'lucide-react';
import axios from 'axios';

/* ── Countdown hasta el próximo vídeo ──────────────────────── */
function useCountdown() {
  const [secs, setSecs] = useState(0);
  const [nextTime, setNextTime] = useState('');

  useEffect(() => {
    function calc() {
      const times = ['15:00', '18:00', '21:00'];
      const now = new Date();
      const todayStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const next = times.find((t) => t > todayStr);
      const target = new Date(now);
      if (next) {
        const [h, m] = next.split(':');
        target.setHours(+h, +m, 0, 0);
        setNextTime(`Hoy ${next}`);
      } else {
        target.setDate(target.getDate() + 1);
        target.setHours(15, 0, 0, 0);
        setNextTime('Mañana 15:00');
      }
      setSecs(Math.max(0, Math.floor((target - now) / 1000)));
    }
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, []);

  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return { display: `${h}:${m}:${s}`, nextTime };
}

/* ── Tarjeta KPI ───────────────────────────────────────────── */
function KPI({ label, value, icon: Icon, color, sub }) {
  const cfg = {
    violet: { card: 'bg-violet-600',  icon: 'text-violet-200' },
    blue:   { card: 'bg-blue-600',    icon: 'text-blue-200'   },
    emerald:{ card: 'bg-emerald-600', icon: 'text-emerald-200'},
    amber:  { card: 'bg-amber-500',   icon: 'text-amber-200'  },
  }[color] || { card: 'bg-violet-600', icon: 'text-violet-200' };

  return (
    <div className={`${cfg.card} rounded-2xl p-5 flex flex-col justify-between min-h-[110px]`}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-white/80">{label}</p>
        <Icon size={20} className={cfg.icon} />
      </div>
      <div>
        <p className="text-4xl font-black text-white tracking-tight leading-none">{value}</p>
        {sub && <p className="text-xs text-white/60 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export default function AnalyticsDashboard({ onNavigate }) {
  const { display, nextTime } = useCountdown();
  const [stats,   setStats]   = useState(null);
  const [queue,   setQueue]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([axios.get('/api/stats'), axios.get('/api/queue')])
      .then(([s, q]) => { setStats(s.data.data); setQueue(q.data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));

    const t = setInterval(() =>
      axios.get('/api/queue').then((r) => setQueue(r.data.data)).catch(() => {}), 7000);
    return () => clearInterval(t);
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader size={28} className="animate-spin text-violet-400" />
    </div>
  );

  const totals    = stats?.totals    || {};
  const topVideos = stats?.topVideos || [];
  const metrics   = stats?.recentMetrics || [];

  const totalVideos = parseInt(totals.total_videos  || 0);
  const totalViews  = parseInt(totals.total_views   || 0);
  const avgEng      = parseFloat(totals.avg_engagement || 0).toFixed(1);
  const bestViews   = topVideos[0] ? parseInt(topVideos[0].max_views) : null;

  const chartData = (() => {
    const m = {};
    metrics.forEach((x) => { m[x.date] = (m[x.date] || 0) + parseInt(x.views || 0); });
    return Object.entries(m).sort((a,b) => a[0] > b[0] ? 1 : -1).slice(-7)
      .map(([date, views]) => ({ date: date.slice(5), views }));
  })();

  return (
    <div className="space-y-6">

      {/* ── HERO: próximo vídeo + generar ──────────────────── */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-700 to-violet-900 p-6">
        <p className="text-violet-300 text-sm font-semibold uppercase tracking-wider mb-2">
          Próximo vídeo automático
        </p>
        <p className="text-6xl font-black text-white tracking-tight font-mono leading-none mb-1">
          {display}
        </p>
        <p className="text-violet-300 text-sm mb-5 flex items-center gap-1.5">
          <Clock size={13} />
          {nextTime} · 3 publicaciones/día
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => onNavigate('queue')}
            className="flex items-center gap-2 bg-white text-violet-900 font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-violet-50 active:scale-95 transition-all"
          >
            <Play size={15} fill="currentColor" />
            Generar ahora
          </button>
          <button
            onClick={() => onNavigate('videos')}
            className="flex items-center gap-2 bg-violet-600/60 text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-violet-600 active:scale-95 transition-all border border-violet-500"
          >
            Ver vídeos
          </button>
        </div>
      </div>

      {/* ── COLA ───────────────────────────────────────────── */}
      {queue && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">Cola de vídeos</p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Esperando', val: queue.waiting,   bg: 'bg-gray-800',    text: 'text-white'        },
              { label: 'En curso',  val: queue.active,    bg: 'bg-blue-900',    text: 'text-blue-300'     },
              { label: 'Listos',    val: queue.completed, bg: 'bg-emerald-900', text: 'text-emerald-300'  },
              { label: 'Fallidos',  val: queue.failed,    bg: 'bg-red-900',     text: 'text-red-300'      },
            ].map(({ label, val, bg, text }) => (
              <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                <p className={`text-3xl font-black ${text}`}>{val}</p>
                <p className="text-xs text-gray-400 mt-1">{label}</p>
              </div>
            ))}
          </div>
          {queue.active > 0 && (
            <div className="mt-4 flex items-center gap-3 bg-blue-950 border border-blue-800 rounded-xl px-4 py-3">
              <Loader size={16} className="animate-spin text-blue-400 shrink-0" />
              <div>
                <p className="text-blue-300 text-sm font-semibold">Generando vídeo...</p>
                <p className="text-blue-500 text-xs">Esto puede tardar 2–3 minutos</p>
              </div>
            </div>
          )}
          {queue.failed > 0 && (
            <div className="mt-4 flex items-center gap-3 bg-red-950 border border-red-800 rounded-xl px-4 py-3">
              <AlertCircle size={16} className="text-red-400 shrink-0" />
              <p className="text-red-300 text-sm font-semibold">
                {queue.failed} vídeo{queue.failed > 1 ? 's' : ''} fallido{queue.failed > 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── KPIs ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <KPI label="Vídeos publicados" value={totalVideos}                                  icon={Film}      color="violet"  sub="desde el inicio"       />
        <KPI label="Views totales"     value={totalViews ? totalViews.toLocaleString() : '—'} icon={Eye}     color="blue"    sub="todas las plataformas" />
        <KPI label="Engagement medio"  value={`${avgEng}%`}                                icon={TrendingUp} color="emerald" sub="likes + comentarios"   />
        <KPI label="Mejor vídeo"       value={bestViews ? bestViews.toLocaleString() : '—'} icon={Zap}      color="amber"   sub="views en un solo vídeo"/>
      </div>

      {/* ── GRÁFICO ────────────────────────────────────────── */}
      {chartData.length > 0 ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
          <p className="text-white font-bold mb-1">Views últimos 7 días</p>
          <p className="text-gray-500 text-xs mb-5">Total de visualizaciones por día en todas las plataformas</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barSize={32} barCategoryGap="30%">
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6b7280', fontSize: 12 }}
              />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: 'rgba(139,92,246,0.08)' }}
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 12, fontSize: 13 }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v) => [v.toLocaleString() + ' views', '']}
              />
              <Bar dataKey="views" radius={[8, 8, 4, 4]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={i === chartData.length - 1 ? '#7c3aed' : '#1f2937'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
          <p className="text-white font-bold mb-1">Views últimos 7 días</p>
          <p className="text-gray-500 text-xs mb-4">Aparecerá aquí cuando tengas vídeos publicados con métricas</p>
          <div className="flex items-end gap-2 h-20">
            {[30, 45, 25, 60, 40, 70, 50].map((h, i) => (
              <div key={i} className="flex-1 bg-gray-800 rounded-t-lg opacity-40" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      )}

      {/* ── TOP VÍDEOS ─────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
        <p className="text-white font-bold mb-1">Mejores vídeos</p>
        <p className="text-gray-500 text-xs mb-4">
          {topVideos.length > 0 ? 'Ordenados por máximo de views' : 'Aparecerán aquí cuando publiques vídeos'}
        </p>

        {topVideos.length === 0 ? (
          <div className="text-center py-8">
            <Film size={40} className="mx-auto mb-3 text-gray-700" />
            <p className="text-gray-500 text-sm">Todavía sin vídeos publicados</p>
            <button
              onClick={() => onNavigate('queue')}
              className="mt-4 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
            >
              Generar primer vídeo
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {topVideos.slice(0, 5).map((v, i) => {
              const views   = parseInt(v.max_views || 0);
              const eng     = parseFloat(v.max_engagement || 0);
              const maxV    = parseInt(topVideos[0].max_views || 1);
              const pct     = Math.max(6, Math.round(views / maxV * 100));
              return (
                <div key={i} className="flex items-center gap-4">
                  <span className="text-2xl font-black text-gray-700 w-7 shrink-0 text-center">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{v.hook}</p>
                    <div className="mt-1.5 h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-white">{views.toLocaleString()}</p>
                    <p className={`text-xs ${eng > 5 ? 'text-emerald-400' : 'text-gray-500'}`}>
                      {eng.toFixed(1)}%
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
