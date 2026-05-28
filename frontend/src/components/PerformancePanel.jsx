import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell,
} from 'recharts';
import {
  Loader, TrendingUp, Eye, Youtube, Film,
  ChevronDown, ChevronUp, Clock, Zap, ExternalLink,
  ArrowUpRight, Hash, RefreshCw,
} from 'lucide-react';
import axios from 'axios';

const TOPIC_ES = {
  ai_tools: 'Herramientas IA',
  automation: 'Automatización',
  ai_agents: 'Agentes IA',
  auto_channels: 'Canales automáticos',
  productivity: 'Productividad',
  ai_video_editing: 'Edición de vídeo IA',
  content_creation: 'Creación de contenido',
  nocode_lowcode: 'No-code / Low-code',
  tech_experiments: 'Experimentos',
  digital_opportunities: 'Oportunidades digitales',
};

/* ── Sección genérica ────────────────────────── */
function Card({ children, className = '' }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-5 ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ title, sub }) {
  return (
    <div className="mb-4">
      <p className="text-white font-bold">{title}</p>
      {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── Score ring ──────────────────────────────── */
function ScoreRing({ score }) {
  const color = !score ? '#374151'
    : score >= 80 ? '#10b981'
    : score >= 65 ? '#f59e0b'
    : '#ef4444';
  return (
    <div className="relative w-10 h-10 shrink-0">
      <svg className="w-10 h-10 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="none" stroke="#1f2937" strokeWidth="5" />
        <circle cx="24" cy="24" r="20" fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${((score || 0) / 100) * 125.6} 125.6`}
          strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black" style={{ color }}>
        {score || '?'}
      </span>
    </div>
  );
}

/* ── Chart tooltip ───────────────────────────── */
function CT({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-xs space-y-0.5">
      <p className="text-gray-400">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="font-semibold">
          {p.name}: {typeof p.value === 'number' && p.value > 100 ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
}

/* ── Video row expandible ────────────────────── */
function VideoRow({ v, rank }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-gray-800/60 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-gray-800/40 transition-colors"
      >
        <span className="text-lg font-black text-gray-700 w-5 shrink-0 text-center">{rank}</span>
        <ScoreRing score={v.virality_score} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium leading-tight line-clamp-1">{v.hook}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {v.topic && (
              <span className="text-[10px] text-violet-400 font-medium">
                {TOPIC_ES[v.topic] || v.topic}
              </span>
            )}
            {v.durationSeconds && (
              <span className="text-[10px] text-gray-600 flex items-center gap-0.5">
                <Clock size={9} />{v.durationSeconds}s
              </span>
            )}
            {v.max_views > 0 && (
              <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                <Eye size={9} />{v.max_views.toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {v.youtube_id && (
            <a
              href={`https://youtube.com/shorts/${v.youtube_id}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-gray-600 hover:text-red-400 transition-colors"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <span className="text-gray-600">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-800/60 p-3.5 bg-gray-800/20 space-y-2">
          {/* Breakdown bars */}
          {v.viralityBreakdown && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">Score breakdown</p>
              {[
                { key: 'hookStrength',    label: 'Hook',      max: 30, color: 'bg-amber-500'   },
                { key: 'emotionalTrigger',label: 'Emocional', max: 25, color: 'bg-red-500'     },
                { key: 'relatability',    label: 'Relación',  max: 20, color: 'bg-blue-500'    },
                { key: 'loopPotential',   label: 'Loop',      max: 15, color: 'bg-violet-500'  },
                { key: 'durationBonus',   label: 'Duración',  max: 10, color: 'bg-emerald-500' },
              ].map(({ key, label, max, color }) => {
                const val = v.viralityBreakdown[key] || 0;
                const pct = Math.round((val / max) * 100);
                return (
                  <div key={key} className="flex items-center gap-2">
                    <p className="text-[10px] text-gray-500 w-14 shrink-0 font-mono">{label}</p>
                    <div className="flex-1 h-1.5 bg-gray-700/60 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-400 w-10 text-right font-mono tabular-nums">{val}/{max}</p>
                  </div>
                );
              })}
            </div>
          )}

          {v.emotionalTrigger && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <Zap size={10} className="text-amber-500" />
              Trigger: <span className="text-amber-300">{v.emotionalTrigger}</span>
            </p>
          )}
          {v.psychologicalFact && (
            <p className="text-xs text-gray-400 italic border-l-2 border-violet-700 pl-2">
              "{v.psychologicalFact}"
            </p>
          )}
          {v.published_at && (
            <p className="text-[10px] text-gray-600">
              Publicado: {new Date(v.published_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── MAIN ────────────────────────────────────── */
export default function PerformancePanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort,    setSort]    = useState('views'); // views | score | engagement

  const load = () => {
    setLoading(true);
    axios.get('/api/analytics')
      .then((r) => setData(r.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader size={28} className="animate-spin text-violet-500" />
    </div>
  );

  const topicPerf    = data?.topicPerformance  || [];
  const durationAnal = data?.durationAnalysis  || [];
  const trend30      = data?.trend30           || [];
  const allVideos    = data?.allVideos         || [];
  const breakdown    = data?.avgBreakdown;
  const platTotals   = data?.platformTotals    || [];

  // Sort videos
  const sorted = [...allVideos].sort((a, b) => {
    if (sort === 'score')      return (b.virality_score || 0) - (a.virality_score || 0);
    if (sort === 'engagement') return (b.max_engagement || 0) - (a.max_engagement || 0);
    return (b.max_views || 0) - (a.max_views || 0);
  });

  const maxTopic = topicPerf[0]?.avgViews || 1;

  // Trend chart - últimos 30 días (solo últimos 14 para no saturar)
  const trendChart = trend30.slice(-14).map((d) => ({
    date: d.date.slice(5),
    views: d.views,
    engagement: d.avgEngagement,
  }));

  // Duration chart colors
  const durationColor = { '0-30s': '#6b7280', '30-45s': '#f59e0b', '45-60s': '#10b981', '60+s': '#ef4444' };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Análisis de rendimiento</h2>
          <p className="text-gray-500 text-sm mt-0.5">YouTube Shorts · datos reales</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs font-medium px-3 py-2 rounded-xl active:scale-95 transition-all"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* ── Platform status ─────────────────────────── */}
      <Card>
        <SectionHeader title="Plataformas" sub="YouTube es la plataforma principal" />
        <div className="grid grid-cols-3 gap-3">
          {/* YouTube — live */}
          {(() => {
            const yt = platTotals.find((p) => p.platform === 'youtube');
            return (
              <div className="bg-red-950/40 border border-red-800/40 rounded-xl p-3 text-center">
                <Youtube size={18} className="text-red-400 mx-auto mb-2" />
                <p className="text-white font-black text-lg leading-none">{(yt?.views || 0).toLocaleString()}</p>
                <p className="text-[10px] text-red-400/80 mt-1">YouTube</p>
                <p className="text-[10px] text-gray-600">views</p>
              </div>
            );
          })()}
          {/* TikTok — próximamente */}
          <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3 text-center opacity-50">
            <div className="w-4.5 h-4.5 mx-auto mb-2 text-gray-500">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px] mx-auto">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.16 8.16 0 004.77 1.53V6.84a4.85 4.85 0 01-1-.15z"/>
              </svg>
            </div>
            <p className="text-gray-500 font-black text-lg leading-none">—</p>
            <p className="text-[10px] text-gray-500 mt-1">TikTok</p>
            <p className="text-[10px] text-gray-600">Próx.</p>
          </div>
          {/* Instagram — próximamente */}
          <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3 text-center opacity-50">
            <div className="w-4.5 h-4.5 mx-auto mb-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] mx-auto text-gray-500">
                <rect x="2" y="2" width="20" height="20" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <p className="text-gray-500 font-black text-lg leading-none">—</p>
            <p className="text-[10px] text-gray-500 mt-1">Instagram</p>
            <p className="text-[10px] text-gray-600">Próx.</p>
          </div>
        </div>
      </Card>

      {/* ── Trend 30 días ───────────────────────────── */}
      {trendChart.length > 0 && (
        <Card>
          <SectionHeader title="Tendencia — 14 días" sub="Views diarios en YouTube" />
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={trendChart} margin={{ left: -20, right: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#7c3aed" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0}    />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#4b5563', fontSize: 10 }} />
              <YAxis hide />
              <Tooltip content={<CT />} />
              <Area type="monotone" dataKey="views" name="Views" stroke="#7c3aed" strokeWidth={2}
                fill="url(#areaGrad)" dot={false}
                activeDot={{ r: 4, fill: '#7c3aed', stroke: '#1f2937', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Topic performance ───────────────────────── */}
      <Card>
        <SectionHeader title="Rendimiento por tema" sub="Avg. views por vídeo publicado en ese tema" />
        {topicPerf.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-4">Sin datos todavía</p>
        ) : (
          <div className="space-y-3">
            {topicPerf.slice(0, 8).map((t) => {
              const pct = Math.max(4, Math.round((t.avgViews / maxTopic) * 100));
              const scoreColor = t.avgScore >= 75 ? 'text-emerald-400'
                : t.avgScore >= 60 ? 'text-amber-400' : 'text-gray-500';
              return (
                <div key={t.topic} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <p className="text-xs text-gray-400 truncate">{TOPIC_ES[t.topic] || t.topic}</p>
                    <p className="text-[10px] text-gray-600">{t.count} vídeo{t.count !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex-1">
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right w-24">
                    <p className="text-xs font-bold text-white tabular-nums">{t.avgViews.toLocaleString()} <span className="text-gray-600 font-normal">avg</span></p>
                    <p className={`text-[10px] font-semibold ${scoreColor}`}>score {t.avgScore}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Duration analysis ───────────────────────── */}
      <Card>
        <SectionHeader title="Duración vs rendimiento" sub="Qué longitud funciona mejor en YouTube Shorts" />
        {durationAnal.every((d) => d.count === 0) ? (
          <p className="text-gray-600 text-sm text-center py-4">Sin datos todavía</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {durationAnal.map((d) => {
              const isSweet = d.range === '45-60s';
              const color   = durationColor[d.range] || '#6b7280';
              return (
                <div
                  key={d.range}
                  className={`rounded-xl p-3 text-center border ${
                    isSweet ? 'bg-emerald-950/40 border-emerald-700/40' : 'bg-gray-800/60 border-gray-700/40'
                  }`}
                >
                  <p className={`text-xs font-bold mb-2 ${isSweet ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {d.range}{isSweet ? ' ✓' : ''}
                  </p>
                  <p className="text-xl font-black text-white leading-none">{d.count}</p>
                  <p className="text-[10px] text-gray-600 mb-2">vídeos</p>
                  <p className="text-xs font-bold text-white">{d.avgViews.toLocaleString()}</p>
                  <p className="text-[10px] text-gray-600">avg views</p>
                  {d.avgEngagement > 0 && (
                    <p className="text-[10px] text-emerald-400/70 mt-1">{d.avgEngagement}% eng</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Score breakdown average ─────────────────── */}
      {breakdown && (
        <Card>
          <SectionHeader title="Breakdown de score (promedio)" sub="Dónde está el potencial viral de tus vídeos" />
          <div className="space-y-3">
            {[
              { key: 'hookStrength',     label: 'Hook strength',    max: breakdown.maxHookStrength,     color: 'bg-amber-500'   },
              { key: 'emotionalTrigger', label: 'Trigger emocional',max: breakdown.maxEmotionalTrigger, color: 'bg-red-500'     },
              { key: 'relatability',     label: 'Relación audiencia',max: breakdown.maxRelatability,    color: 'bg-blue-500'    },
              { key: 'loopPotential',    label: 'Loop potential',   max: breakdown.maxLoopPotential,    color: 'bg-violet-500'  },
              { key: 'durationBonus',    label: 'Bonus duración',   max: breakdown.maxDurationBonus,    color: 'bg-emerald-500' },
            ].map(({ key, label, max, color }) => {
              const val = breakdown[key] || 0;
              const pct = Math.round((val / max) * 100);
              const numColor = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
              return (
                <div key={key} className="flex items-center gap-3">
                  <p className="text-xs text-gray-400 w-36 shrink-0">{label}</p>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`text-xs font-bold tabular-nums w-12 text-right ${numColor}`}>
                    {val}<span className="text-gray-600 font-normal">/{max}</span>
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-600 mt-4 border-t border-gray-800 pt-3">
            Un hook fuerte y alto trigger emocional son los factores más determinantes para la viralidad.
          </p>
        </Card>
      )}

      {/* ── Lista de vídeos ─────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-white font-bold">Todos los vídeos</p>
            <p className="text-gray-500 text-xs mt-0.5">{allVideos.length} vídeo{allVideos.length !== 1 ? 's' : ''}</p>
          </div>
          {/* Sort */}
          <div className="flex gap-1">
            {[
              { key: 'views',      label: 'Views'  },
              { key: 'score',      label: 'Score'  },
              { key: 'engagement', label: 'Eng.'   },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                  sort === key
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="bg-gray-900 border border-dashed border-gray-700 rounded-2xl p-12 text-center">
            <Film size={40} className="mx-auto mb-3 text-gray-700" />
            <p className="text-gray-500 text-sm">Sin vídeos todavía</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((v, i) => <VideoRow key={v.id || i} v={v} rank={i + 1} />)}
          </div>
        )}
      </div>

    </div>
  );
}
