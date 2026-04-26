import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, RefreshCw, TrendingUp } from 'lucide-react';

function Panel({ children, className = '' }) {
  return <section className={`app-panel overflow-hidden ${className}`}>{children}</section>;
}

function SectionHeader({ eyebrow, title, detail, action = null }) {
  return (
    <div className="app-section-header flex items-start justify-between gap-4">
      <div>
        <p className="app-eyebrow">{eyebrow}</p>
        <h2 className="app-title mt-2">{title}</h2>
        {detail ? <p className="mt-2 max-w-3xl text-sm leading-6 text-white/42">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

function KpiCard({ label, value, detail, tone = 'neutral', trend = null }) {
  const valueClass = tone === 'good'
    ? 'text-emerald-300'
    : tone === 'warn'
      ? 'text-amber-300'
      : tone === 'bad'
        ? 'text-red-300'
        : 'text-white';

  const trendClass = trend?.direction === 'up'
    ? 'bg-emerald-500/12 text-emerald-300'
    : trend?.direction === 'down'
      ? 'bg-red-500/12 text-red-300'
      : 'bg-white/6 text-white/55';

  return (
    <div className="rounded-[24px] border border-white/6 bg-[#131821] p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/28">{label}</p>
        {trend ? (
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${trendClass}`}>
            {trend.direction === 'up' ? <ArrowUpRight size={12} /> : trend.direction === 'down' ? <ArrowDownRight size={12} /> : null}
            {trend.label}
          </span>
        ) : null}
      </div>
      <p className={`mt-3 text-3xl font-black ${valueClass}`}>{value}</p>
      <p className="mt-2 text-xs leading-5 text-white/42">{detail}</p>
    </div>
  );
}

function PatternCard({ title, value, detail, tone = 'good' }) {
  return (
    <div className="rounded-[24px] border border-white/6 bg-[#131821] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className={`mt-3 text-2xl font-black ${tone === 'good' ? 'text-emerald-300' : 'text-red-300'}`}>{value}</p>
          <p className="mt-2 text-sm leading-6 text-white/44">{detail}</p>
        </div>
        {tone === 'good' ? <TrendingUp size={16} className="mt-1 text-emerald-300" /> : <AlertTriangle size={16} className="mt-1 text-red-300" />}
      </div>
    </div>
  );
}

function ImprovementItem({ title, detail }) {
  return (
    <div className="rounded-[22px] border border-white/6 bg-[#131821] p-4">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-white/46">{detail}</p>
    </div>
  );
}

function DecisionRail({ title, detail, tone = 'neutral' }) {
  const badge = tone === 'good'
    ? 'bg-emerald-500/12 text-emerald-300'
    : tone === 'warn'
      ? 'bg-amber-500/12 text-amber-300'
      : tone === 'bad'
        ? 'bg-red-500/12 text-red-300'
        : 'bg-white/6 text-white/55';

  return (
    <div className="rounded-[22px] border border-white/6 bg-[#131821] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-2 text-sm leading-6 text-white/44">{detail}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${badge}`}>{tone}</span>
      </div>
    </div>
  );
}

function ProgressBar({ label, current, required, source }) {
  const percent = required > 0 ? Math.min((current / required) * 100, 100) : 0;
  const sourceLabel = source === 'youtube' ? 'YouTube' : source === 'youtube_estimated_from_recent_uploads' ? 'YouTube estimado' : 'Estimación interna';

  return (
    <div className="rounded-[22px] border border-white/6 bg-[#131821] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs text-white/38">{sourceLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-black text-white">{formatLarge(current)}</p>
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/24">{formatOne(percent)}%</p>
        </div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-white/6">
        <div className="h-2 rounded-full bg-sky-400" style={{ width: `${Math.max(4, percent)}%` }} />
      </div>
      <p className="mt-2 text-xs text-white/34">Objetivo: {formatLarge(required)}</p>
    </div>
  );
}

function VideoRow({ video }) {
  const decision = video.monetizationScore >= 72 ? 'Escalar' : video.monetizationScore >= 56 ? 'Vigilar' : 'Cortar';
  const tone = video.monetizationScore >= 72 ? 'text-emerald-300' : video.monetizationScore >= 56 ? 'text-amber-300' : 'text-red-300';

  return (
    <div className="grid gap-3 rounded-[22px] border border-white/6 bg-[#131821] px-4 py-4 md:grid-cols-[minmax(0,1.7fr)_0.7fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{video.title}</p>
        <p className="mt-1 truncate text-[11px] text-white/32">
          {humanize(video.classification?.topic)} · {humanize(video.classification?.hookType)} · {humanize(video.classification?.viralTrigger)}
        </p>
      </div>
      <Metric label="Views" value={formatLarge(video.views)} />
      <Metric label="Com/1k" value={formatOne(video.commentsPer1kViews)} />
      <Metric label="Score" value={formatOne(video.monetizationScore)} />
      <Metric label="Ret." value={`${formatOne(video.retention)}%`} />
      <Metric label="Reeng." value={formatOne(video.reengageMetrics?.reengageEffectivenessScore)} />
      <div className="text-left md:text-right">
        <p className={`text-sm font-semibold ${tone}`}>{decision}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.16em] text-white/24">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

export default function MonetizationDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [query, setQuery] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [snapshotRes, analyticsRes] = await Promise.all([
        axios.get('/api/analytics/observation-snapshot'),
        axios.get('/api/analytics'),
      ]);

      setPayload({
        snapshot: snapshotRes.data?.data || null,
        analytics: analyticsRes.data?.data || null,
      });
    } catch (err) {
      setError('No se pudo cargar el dashboard.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const snapshot = payload?.snapshot;
  const analytics = payload?.analytics;
  const videos = snapshot?.videos || [];
  const summary = snapshot?.summary;
  const top = snapshot?.topPerformers || [];
  const worst = snapshot?.worstPerformers || [];
  const decisions = snapshot?.decisions || [];
  const insights = snapshot?.insights || [];
  const cohorts = snapshot?.cohorts || {};
  const trend7 = analytics?.trend7 || [];
  const youtubeChannel = analytics?.youtubeIntegration?.channel || null;
  const monetization = snapshot?.channelMonetization || null;

  const trend = useMemo(() => {
    if (trend7.length < 2) return { direction: 'flat', label: 'Sin histórico', delta: 0 };
    const first = trend7[0]?.views || 0;
    const last = trend7[trend7.length - 1]?.views || 0;
    if (!first) return { direction: last > 0 ? 'up' : 'flat', label: last > 0 ? 'Arranca' : 'Plano', delta: 0 };
    const delta = ((last - first) / first) * 100;
    return {
      direction: delta > 8 ? 'up' : delta < -8 ? 'down' : 'flat',
      label: delta > 8 ? 'Sube' : delta < -8 ? 'Baja' : 'Estable',
      delta,
    };
  }, [trend7]);

  const reengage = useMemo(() => {
    const withReengage = videos.filter((video) => video.hasReengage);
    return {
      avgEffectiveness: average(videos.map((video) => video.reengageMetrics?.reengageEffectivenessScore || 0)),
      avgDrop: average(videos.map((video) => video.reengageMetrics?.retentionDropBeforeReengage || 0)),
      avgRecovery: average(videos.map((video) => video.reengageMetrics?.retentionRecoveryAfterReengage || 0)),
      winners: withReengage.filter((video) => (video.reengageMetrics?.reengageEffectivenessScore || 0) >= 55).length,
    };
  }, [videos]);

  const whatWorks = useMemo(() => {
    const bestTopic = first(cohorts.byTopic);
    const bestHook = first(cohorts.byHookType);
    const bestTrigger = first(cohorts.byViralTrigger);
    const bestEmotional = first(cohorts.byEmotionalTrigger);

    return [
      top[0] && {
        title: 'Vídeo ganador',
        value: top[0].title,
        detail: `${formatLarge(top[0].views)} views · score ${formatOne(top[0].monetizationScore)} · retención ${formatOne(top[0].retention)}%.`,
      },
      bestTopic && {
        title: 'Tema que mejor convierte',
        value: humanize(bestTopic.key),
        detail: `Score medio ${formatOne(bestTopic.avgMonetizationScore || bestTopic.monetizationScore || 0)} con ${formatLarge(bestTopic.videos || bestTopic.count || 0)} vídeos.`,
      },
      bestHook && {
        title: 'Hook que más responde',
        value: humanize(bestHook.key),
        detail: `Retención media ${formatOne(bestHook.avgRetention || 0)}% y comments/1k ${formatOne(bestHook.avgCommentsPer1kViews || 0)}.`,
      },
      bestTrigger && {
        title: 'Trigger ganador',
        value: humanize(bestTrigger.key),
        detail: `Está sosteniendo mejor score y alcance que el resto de patrones actuales.`,
      },
      bestEmotional && {
        title: 'Emoción útil',
        value: humanize(bestEmotional.key),
        detail: `Es la señal emocional que mejor está empujando monetización y respuesta.`,
      },
    ].filter(Boolean).slice(0, 4);
  }, [top, cohorts]);

  const whatFails = useMemo(() => {
    const weakTopic = last(cohorts.byTopic);
    const weakHook = last(cohorts.byHookType);
    const weakTrigger = last(cohorts.byViralTrigger);

    return [
      worst[0] && {
        title: 'Vídeo flojo',
        value: worst[0].title,
        detail: `${formatLarge(worst[0].views)} views · score ${formatOne(worst[0].monetizationScore)} · retención ${formatOne(worst[0].retention)}%.`,
      },
      weakTopic && {
        title: 'Tema que mete ruido',
        value: humanize(weakTopic.key),
        detail: `Está por detrás en score, retención o comments/1k frente al resto.`,
      },
      weakHook && {
        title: 'Hook débil',
        value: humanize(weakHook.key),
        detail: `No está generando suficiente respuesta para justificar más volumen.`,
      },
      weakTrigger && {
        title: 'Trigger saturado',
        value: humanize(weakTrigger.key),
        detail: `Ahora mismo no está sosteniendo monetización ni diferenciación.`,
      },
    ].filter(Boolean).slice(0, 4);
  }, [worst, cohorts]);

  const improvements = useMemo(() => {
    const items = [];

    if ((summary?.avgCommentsPer1kViews || 0) < 12) {
      items.push({
        title: 'Subir conversación útil',
        detail: 'El canal necesita más comments/1k para convertir alcance en señal de negocio y acelerar monetización.',
      });
    }
    if ((summary?.avgRetention || 0) < 52) {
      items.push({
        title: 'Corregir retención media',
        detail: 'Aún se escapa demasiada audiencia antes de consolidar watch time suficiente.',
      });
    }
    if (reengage.avgRecovery < 6) {
      items.push({
        title: 'Hacer que el reengage rescate de verdad',
        detail: 'La recuperación tras el tramo crítico sigue corta y está limitando el valor de los vídeos medios.',
      });
    }
    if (top.filter((video) => video.monetizationScore >= 72).length < 3) {
      items.push({
        title: 'Repetir winners con más disciplina',
        detail: 'Todavía hay pocos patrones claramente escalables; hace falta más concentración en los formatos ganadores.',
      });
    }

    return items.slice(0, 4);
  }, [summary, reengage, top]);

  const decisionRows = useMemo(() => {
    const base = decisions.slice(0, 4).map((item, index) => ({
      title: item.title || `Decisión ${index + 1}`,
      detail: item.detail || item.recommendation || '',
      tone: item.tone || (index === 0 ? 'good' : 'warn'),
    }));

    if (base.length) return base;

    return [
      { title: 'Haz más de lo que gana', detail: 'Escala tema, hook y trigger que ya lideran monetization score y respuesta.', tone: 'good' },
      { title: 'Reduce lo que drena señal', detail: 'Recorta temas o hooks que aportan views sin monetización ni conversación.', tone: 'bad' },
      { title: 'Prueba una iteración más agresiva', detail: 'Prioriza variantes que mejoren retención crítica y comments/1k.', tone: 'warn' },
      { title: 'Vigila la consistencia', detail: 'Necesitas más vídeos ganadores repetibles, no más piezas simplemente correctas.', tone: 'neutral' },
    ];
  }, [decisions]);

  const filteredVideos = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return videos;
    return videos.filter((video) => {
      const haystack = [
        video.title,
        video.classification?.topic,
        video.classification?.hookType,
        video.classification?.viralTrigger,
      ].join(' ').toLowerCase();
      return haystack.includes(text);
    });
  }, [query, videos]);

  if (loading) {
    return (
      <div className="app-page">
        <Panel className="p-6 text-sm text-white/42">Cargando dashboard de monetización...</Panel>
      </div>
    );
  }

  if (error || !snapshot || !analytics) {
    return (
      <div className="app-page">
        <Panel className="p-6 text-sm text-red-300">{error || 'No se pudo cargar el dashboard.'}</Panel>
      </div>
    );
  }

  return (
    <div className="app-page">
      <Panel>
        <SectionHeader
          eyebrow="Dashboard principal"
          title="Control de canal y monetización"
          detail="Lectura del rendimiento real del canal, sin pipeline ni señales técnicas."
          action={(
            <button onClick={load} className="app-button">
              <RefreshCw size={14} />
              Actualizar
            </button>
          )}
        />
        <div className="grid gap-4 px-6 py-6 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Canal views"
            value={formatLarge(youtubeChannel?.viewCount || analytics?.kpis?.totalViews || 0)}
            detail={youtubeChannel ? 'Dato real del canal en YouTube.' : 'Estimación interna agregada.'}
            tone="neutral"
            trend={trend}
          />
          <KpiCard
            label="Suscriptores"
            value={youtubeChannel?.subscriberCount != null ? formatLarge(youtubeChannel.subscriberCount) : '—'}
            detail={youtubeChannel?.subscriberCount != null ? 'Dato real del canal.' : 'Dato no disponible.'}
            tone={youtubeChannel?.subscriberCount >= 1000 ? 'good' : 'warn'}
          />
          <KpiCard
            label="Monetization score"
            value={formatOne(summary?.avgMonetizationScore)}
            detail="Media de valor comercial potencial por vídeo."
            tone={summary?.avgMonetizationScore >= 68 ? 'good' : summary?.avgMonetizationScore >= 55 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="Retención media"
            value={`${formatOne(summary?.avgRetention)}%`}
            detail="Capacidad del canal para sostener visualización."
            tone={summary?.avgRetention >= 50 ? 'good' : summary?.avgRetention >= 42 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="Comments / 1k"
            value={formatOne(summary?.avgCommentsPer1kViews)}
            detail="Señal directa de conversación y respuesta."
            tone={summary?.avgCommentsPer1kViews >= 12 ? 'good' : summary?.avgCommentsPer1kViews >= 7 ? 'warn' : 'bad'}
          />
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Qué funciona"
          title="Los patrones que sí conviene repetir"
          detail="Lectura directa de winners en vídeos, temas, hooks y triggers."
        />
        <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
          {whatWorks.map((item) => (
            <PatternCard key={`${item.title}-${item.value}`} title={item.title} value={item.value} detail={item.detail} tone="good" />
          ))}
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Qué falla"
          title="Lo que hoy resta claridad o valor"
          detail="Todo lo que conviene recortar, corregir o dejar de repetir."
        />
        <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
          {whatFails.map((item) => (
            <PatternCard key={`${item.title}-${item.value}`} title={item.title} value={item.value} detail={item.detail} tone="bad" />
          ))}
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Qué mejorar"
          title="Las mejoras que más mueven negocio"
          detail="Palancas concretas para elevar calidad del canal y acelerar monetización."
        />
        <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
          {improvements.map((item) => (
            <ImprovementItem key={item.title} title={item.title} detail={item.detail} />
          ))}
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Monetización"
          title={monetization?.status || 'Estado de monetización'}
          detail={`Cuello de botella actual: ${monetization?.bottleneck || 'sin señal suficiente'}.`}
        />
        <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <ProgressBar
                label="Suscriptores"
                current={monetization?.current?.subscribers || 0}
                required={monetization?.required?.subscribers || 1000}
                source={monetization?.sources?.subscribers}
              />
              <ProgressBar
                label="Shorts views 90d"
                current={monetization?.current?.shortsViews90d || 0}
                required={monetization?.required?.shortsViews90d || 10000000}
                source={monetization?.sources?.shortsViews90d}
              />
              <ProgressBar
                label="Watch hours"
                current={Math.round(monetization?.current?.watchHours || 0)}
                required={monetization?.required?.watchHours || 4000}
                source={monetization?.sources?.watchHours}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <ImprovementItem
                title="Te faltan"
                detail={monetization?.missing?.subscribers != null ? `${formatLarge(monetization.missing.subscribers)} suscriptores.` : 'Dato real de suscriptores no disponible.'}
              />
              <ImprovementItem
                title="Views restantes"
                detail={`${formatLarge(monetization?.missing?.shortsViews90d || 0)} visualizaciones válidas de Shorts.`}
              />
              <ImprovementItem
                title="Estimación"
                detail={monetization?.projection?.daysToShorts ? `${formatEta(monetization.projection.daysToShorts)} al ritmo actual · confianza ${monetization.projection.confidence}.` : 'No hay proyección suficiente todavía.'}
              />
            </div>
          </div>
          <div className="space-y-4">
            <DecisionRail
              title="Qué más acerca al objetivo"
              detail={insights[0]?.recommendation || 'Escalar winners con mejor monetization score y mejor conversación por view.'}
              tone="good"
            />
            <DecisionRail
              title="Qué frena ahora"
              detail={monetization?.bottleneck || 'Aún falta señal suficiente para aislar el cuello de botella.'}
              tone="bad"
            />
            <DecisionRail
              title="Relación rendimiento → monetización"
              detail={insights[0]?.explanation || 'La mejora de retención y comments/1k es la vía más directa para acelerar monetización.'}
              tone="warn"
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Lista de vídeos"
          title="Vista limpia para decidir rápido"
          detail="Solo señales útiles para escalar, vigilar o cortar."
        />
        <div className="space-y-4 px-6 py-6">
          <div className="rounded-[22px] border border-white/6 bg-[#131821] px-4 py-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filtrar por título, tema, hook o trigger"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/26"
            />
          </div>
          <div className="space-y-3">
            {filteredVideos.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-[#131821] px-4 py-10 text-center text-sm text-white/35">
                No hay vídeos para ese filtro.
              </div>
            ) : filteredVideos.slice(0, 18).map((video) => <VideoRow key={video.id} video={video} />)}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function first(list = []) {
  return Array.isArray(list) && list.length ? list[0] : null;
}

function last(list = []) {
  return Array.isArray(list) && list.length ? list[list.length - 1] : null;
}

function average(values = []) {
  const valid = values.filter((value) => typeof value === 'number' && !Number.isNaN(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function formatLarge(value) {
  return Number(value || 0).toLocaleString('es-ES');
}

function formatOne(value) {
  return Number(value || 0).toFixed(1);
}

function humanize(value) {
  if (!value) return 'Sin señal';
  return String(value).replaceAll('_', ' ');
}

function formatEta(days) {
  if (!days || !Number.isFinite(days)) return 'Sin señal';
  if (days <= 14) return `${Math.round(days)} días`;
  if (days <= 120) return `${Math.round(days / 7)} semanas`;
  return `${Math.round(days / 30)} meses`;
}
