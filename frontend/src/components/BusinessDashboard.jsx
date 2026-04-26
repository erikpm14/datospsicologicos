import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ArrowDownRight, ArrowUpRight, Copy, RefreshCw } from 'lucide-react';

function Panel({ children, className = '' }) {
  return <section className={`app-panel overflow-hidden ${className}`}>{children}</section>;
}

function SectionHeader({ eyebrow, title, detail, action = null }) {
  return (
    <div className="app-section-header flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="app-wrap min-w-0">
        <p className="app-eyebrow">{eyebrow}</p>
        <h2 className="app-title app-wrap mt-2 text-2xl">{title}</h2>
        {detail ? <p className="app-wrap mt-2 max-w-4xl text-sm leading-6 text-white/42">{detail}</p> : null}
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
    <div className="rounded-[24px] border border-white/8 bg-[#131821] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="app-wrap text-[11px] uppercase tracking-[0.18em] text-white/30">{label}</p>
        {trend ? (
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${trendClass}`}>
            {trend.direction === 'up' ? <ArrowUpRight size={12} /> : trend.direction === 'down' ? <ArrowDownRight size={12} /> : null}
            {trend.label}
          </span>
        ) : null}
      </div>
      <p className={`app-wrap mt-3 text-4xl font-black ${valueClass}`}>{value}</p>
      <p className="app-wrap mt-2 text-xs leading-5 text-white/42">{detail}</p>
    </div>
  );
}

function StoryCard({ title, value, detail, tone = 'good' }) {
  const valueClass = tone === 'good' ? 'text-emerald-300' : 'text-red-300';
  return (
    <div className="rounded-[24px] border border-white/8 bg-[#131821] p-5">
      <p className="app-wrap text-sm font-semibold text-white">{title}</p>
      <p className={`app-wrap mt-3 text-xl font-black ${valueClass}`}>{value}</p>
      <p className="app-wrap mt-2 text-sm leading-6 text-white/44">{detail}</p>
    </div>
  );
}

function ImprovementCard({ title, detail }) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-[#131821] p-5">
      <p className="app-wrap text-sm font-semibold text-white">{title}</p>
      <p className="app-wrap mt-2 text-sm leading-6 text-white/46">{detail}</p>
    </div>
  );
}

function ProgressCard({ label, current, required, source, detail }) {
  const percent = required > 0 ? Math.min((current / required) * 100, 100) : 0;
  const sourceLabel = source === 'youtube'
    ? 'YouTube'
    : source === 'youtube_estimated_from_recent_uploads'
      ? 'YouTube estimado'
      : 'Estimación interna';

  return (
    <div className="rounded-[24px] border border-white/8 bg-[#131821] p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="app-wrap min-w-0">
          <p className="app-wrap text-sm font-semibold text-white">{label}</p>
          <p className="app-wrap mt-1 text-xs text-white/36">{sourceLabel}</p>
        </div>
        <div className="text-left md:text-right">
          <p className="app-wrap text-2xl font-black text-white">{formatLarge(current)}</p>
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/24">{formatOne(percent)}%</p>
        </div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-white/6">
        <div className="h-2 rounded-full bg-sky-400" style={{ width: `${Math.max(4, percent)}%` }} />
      </div>
      <p className="app-wrap mt-3 text-xs leading-5 text-white/40">{detail || `Objetivo ${formatLarge(required)}`}</p>
    </div>
  );
}

function VideoRow({ video }) {
  const decision = video.monetizationScore >= 72 ? 'ESCALAR' : video.monetizationScore >= 56 ? 'VIGILAR' : 'CORTAR';
  const tone = decision === 'ESCALAR' ? 'text-emerald-300' : decision === 'VIGILAR' ? 'text-amber-300' : 'text-red-300';

  return (
    <div className="grid gap-3 rounded-[22px] border border-white/8 bg-[#131821] px-4 py-4 xl:grid-cols-[minmax(0,1.8fr)_0.75fr_0.75fr_0.75fr_0.95fr] xl:items-center">
      <div className="min-w-0">
        <p className="app-wrap text-sm font-semibold text-white">{video.title}</p>
        <p className="app-wrap mt-1 text-[11px] text-white/32">
          {humanize(video.classification?.topic)} · {humanize(video.classification?.hookType)}
        </p>
      </div>
      <Metric label="Score" value={formatOne(video.monetizationScore)} />
      <Metric label="Retención" value={`${formatOne(video.retention)}%`} />
      <Metric label="Com/1k" value={formatOne(video.commentsPer1kViews)} />
      <div className="text-left xl:text-right">
        <p className={`text-sm font-black tracking-[0.08em] ${tone}`}>{decision}</p>
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

export default function BusinessDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

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
    } catch {
      setError('No se pudo cargar el dashboard de negocio.');
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
  const summary = snapshot?.summary;
  const videos = snapshot?.videos || [];
  const top = snapshot?.topPerformers || [];
  const worst = snapshot?.worstPerformers || [];
  const decisions = snapshot?.decisions || [];
  const insights = snapshot?.insights || [];
  const monetization = snapshot?.channelMonetization || null;
  const cohorts = snapshot?.cohorts || {};
  const trend7 = analytics?.trend7 || [];

  const trend = useMemo(() => {
    if (trend7.length < 2) return { direction: 'flat', label: 'Sin histórico', delta: 0 };
    const firstValue = trend7[0]?.views || 0;
    const lastValue = trend7[trend7.length - 1]?.views || 0;
    if (!firstValue) return { direction: lastValue > 0 ? 'up' : 'flat', label: lastValue > 0 ? 'Arranca' : 'Plano', delta: 0 };
    const delta = ((lastValue - firstValue) / firstValue) * 100;
    return {
      direction: delta > 8 ? 'up' : delta < -8 ? 'down' : 'flat',
      label: delta > 8 ? 'Sube' : delta < -8 ? 'Baja' : 'Estable',
      delta,
    };
  }, [trend7]);

  const reengageEffectiveness = useMemo(
    () => average(videos.map((video) => video.reengageMetrics?.reengageEffectivenessScore || 0)),
    [videos]
  );

  const works = useMemo(() => {
    const bestTopic = first(cohorts.byTopic);
    const bestHook = first(cohorts.byHookType);
    const bestVideo = first(top);
    return [
      bestVideo && {
        title: 'Vídeo ganador',
        value: truncate(bestVideo.title, 72),
        detail: `${formatLarge(bestVideo.views)} views · score ${formatOne(bestVideo.monetizationScore)} · retención ${formatOne(bestVideo.retention)}%.`,
      },
      bestTopic && {
        title: 'Tema que tira',
        value: humanize(bestTopic.key),
        detail: `Score medio ${formatOne(bestTopic.avgMonetizationScore || bestTopic.monetizationScore || 0)} y ${formatLarge(bestTopic.videos || bestTopic.count || 0)} vídeos con señal.`,
      },
      bestHook && {
        title: 'Hook que responde',
        value: humanize(bestHook.key),
        detail: `Retención media ${formatOne(bestHook.avgRetention || 0)}% y comments/1k ${formatOne(bestHook.avgCommentsPer1kViews || 0)}.`,
      },
    ].filter(Boolean);
  }, [cohorts, top]);

  const fails = useMemo(() => {
    const weakTopic = last(cohorts.byTopic);
    const badVideo = first(worst);
    return [
      badVideo && {
        title: 'Vídeo flojo',
        value: truncate(badVideo.title, 72),
        detail: `${formatLarge(badVideo.views)} views · score ${formatOne(badVideo.monetizationScore)} · retención ${formatOne(badVideo.retention)}%.`,
      },
      (summary?.avgRetention || 0) < 45 && {
        title: 'Retención baja',
        value: `${formatOne(summary?.avgRetention)}%`,
        detail: 'La media del canal todavía pierde demasiada audiencia antes de consolidar watch time.',
      },
      reengageEffectiveness < 50 && {
        title: 'Reengage débil',
        value: formatOne(reengageEffectiveness),
        detail: 'El rescate del tramo crítico no está recuperando suficiente atención.',
      },
      weakTopic && {
        title: 'Tema que no compensa',
        value: humanize(weakTopic.key),
        detail: 'Ahora mismo está por debajo del resto en valor comercial o retención.',
      },
    ].filter(Boolean);
  }, [cohorts, worst, summary, reengageEffectiveness]);

  const improvements = useMemo(() => {
    const rows = [
      (summary?.avgCommentsPer1kViews || 0) < 10 && {
        title: 'Subir comments/1k',
        detail: 'Necesitas más conversación útil para convertir views en señal de canal y monetización.',
      },
      (summary?.avgRetention || 0) < 50 && {
        title: 'Corregir retención media',
        detail: 'Refuerza el tramo 15–25s para evitar caídas que frenan watch time y escalado.',
      },
      reengageEffectiveness < 55 && {
        title: 'Hacer el reengage más fuerte',
        detail: 'Los vídeos todavía no recuperan suficiente atención tras el punto crítico.',
      },
      decisions[0] && {
        title: decisions[0].action || 'Escalar patrón ganador',
        detail: decisions[0].reason || 'Hay un patrón que conviene repetir con más frecuencia.',
      },
    ].filter(Boolean);
    return rows.slice(0, 4);
  }, [summary, reengageEffectiveness, decisions]);

  const filteredVideos = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return videos;
    return videos.filter((video) => {
      const haystack = [
        video.title,
        video.classification?.topic,
        video.classification?.hookType,
      ].join(' ').toLowerCase();
      return haystack.includes(text);
    });
  }, [query, videos]);

  const chatgptSummary = useMemo(() => {
    if (!summary || !monetization) return '';
    const lines = [
      'Resumen para ChatGPT',
      '',
      `Estado actual: monetization score medio ${formatOne(summary.avgMonetizationScore)}, retención media ${formatOne(summary.avgRetention)}%, comments/1k ${formatOne(summary.avgCommentsPer1kViews)}, reengage effectiveness ${formatOne(reengageEffectiveness)} y tendencia ${trend.label.toLowerCase()}.`,
      `Qué funciona: ${works.map((item) => `${item.title}: ${item.value}`).join(' | ') || 'sin señal suficiente'}.`,
      `Qué falla: ${fails.map((item) => `${item.title}: ${item.value}`).join(' | ') || 'sin señal suficiente'}.`,
      `Qué mejorar: ${improvements.map((item) => item.title).join(' | ') || 'sin mejoras priorizadas'}.`,
      `Estado monetización: ${monetization.status}. Suscriptores ${formatLarge(monetization.current?.subscribers || 0)}/${formatLarge(monetization.required?.subscribers || 1000)}, Shorts 90d ${formatLarge(monetization.current?.shortsViews90d || 0)}/${formatLarge(monetization.required?.shortsViews90d || 10000000)}. Cuello de botella: ${monetization.bottleneck}. Estimación: ${monetization.projection?.daysToShorts ? formatEta(monetization.projection.daysToShorts) : 'sin proyección suficiente'}.`,
    ];
    return lines.join('\n');
  }, [summary, monetization, reengageEffectiveness, trend, works, fails, improvements]);

  async function copySummary() {
    if (!chatgptSummary) return;
    await navigator.clipboard.writeText(chatgptSummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  if (loading) {
    return <div className="app-page"><Panel className="p-6 text-sm text-white/42">Cargando dashboard de negocio...</Panel></div>;
  }

  if (error || !summary || !monetization) {
    return <div className="app-page"><Panel className="p-6 text-sm text-red-300">{error || 'No se pudo cargar el dashboard de negocio.'}</Panel></div>;
  }

  return (
    <div className="app-page">
      <Panel>
        <SectionHeader
          eyebrow="Resumen general"
          title="Dashboard del canal"
          detail="Lectura directa de monetización, patrones ganadores, fallos y distancia hasta monetizar."
          action={<button onClick={load} className="app-button"><RefreshCw size={14} />Actualizar</button>}
        />
        <div className="grid gap-4 px-6 py-6 xl:grid-cols-6">
          <KpiCard label="Monetization score" value={formatOne(summary.avgMonetizationScore)} detail="Media de valor comercial potencial por vídeo." tone={summary.avgMonetizationScore >= 68 ? 'good' : summary.avgMonetizationScore >= 55 ? 'warn' : 'bad'} />
          <KpiCard label="Retención" value={`${formatOne(summary.avgRetention)}%`} detail="Capacidad media del canal para sostener atención." tone={summary.avgRetention >= 50 ? 'good' : summary.avgRetention >= 42 ? 'warn' : 'bad'} />
          <KpiCard label="Comments / 1k" value={formatOne(summary.avgCommentsPer1kViews)} detail="Respuesta útil por cada mil views." tone={summary.avgCommentsPer1kViews >= 12 ? 'good' : summary.avgCommentsPer1kViews >= 7 ? 'warn' : 'bad'} />
          <KpiCard label="Reengage" value={formatOne(reengageEffectiveness)} detail="Efectividad media del rescate en el tramo crítico." tone={reengageEffectiveness >= 55 ? 'good' : reengageEffectiveness >= 42 ? 'warn' : 'bad'} />
          <KpiCard label="Vídeos analizados" value={formatLarge(summary.totalVideos)} detail="Base real usada para esta lectura de negocio." />
          <KpiCard label="Tendencia" value={trend.label} detail={`Cambio ${signed(trend.delta)}% en la señal reciente.`} trend={trend} />
        </div>
      </Panel>

      <Panel>
        <SectionHeader eyebrow="Qué funciona" title="Lo que sí merece repetirse" detail="Temas, hooks y vídeos que están empujando el canal." />
        <div className="grid gap-4 px-6 py-6 xl:grid-cols-3">
          {works.map((item) => <StoryCard key={`${item.title}-${item.value}`} title={item.title} value={item.value} detail={item.detail} tone="good" />)}
        </div>
      </Panel>

      <Panel>
        <SectionHeader eyebrow="Qué falla" title="Lo que conviene recortar o corregir" detail="Señales que ahora mismo están drenando valor o frenando crecimiento." />
        <div className="grid gap-4 px-6 py-6 xl:grid-cols-4">
          {fails.map((item) => <StoryCard key={`${item.title}-${item.value}`} title={item.title} value={item.value} detail={item.detail} tone="bad" />)}
        </div>
      </Panel>

      <Panel>
        <SectionHeader eyebrow="Qué mejorar" title="Palancas de mejora accionables" detail="Acciones concretas para mover negocio antes, no teoría." />
        <div className="grid gap-4 px-6 py-6 xl:grid-cols-4">
          {improvements.map((item) => <ImprovementCard key={item.title} title={item.title} detail={item.detail} />)}
        </div>
      </Panel>

      <Panel>
        <SectionHeader eyebrow="Monetización" title={monetization.status} detail={`Ahora mismo el cuello de botella principal es que ${monetization.bottleneck}.`} />
        <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-4 xl:grid-cols-3">
            <ProgressCard label="Suscriptores actuales" current={monetization.current?.subscribers || 0} required={monetization.required?.subscribers || 1000} source={monetization.sources?.subscribers} detail={`Faltan ${formatLarge(monetization.missing?.subscribers || 0)} para llegar a 1000.`} />
            <ProgressCard label="Views Shorts 90d" current={monetization.current?.shortsViews90d || 0} required={monetization.required?.shortsViews90d || 10000000} source={monetization.sources?.shortsViews90d} detail={`Faltan ${formatLarge(monetization.missing?.shortsViews90d || 0)} views válidas.`} />
            <ProgressCard label="Watch hours" current={Math.round(monetization.current?.watchHours || 0)} required={monetization.required?.watchHours || 4000} source={monetization.sources?.watchHours} detail={`Faltan ${formatLarge(Math.round(monetization.missing?.watchHours || 0))} horas.`} />
          </div>
          <div className="space-y-4">
            <ImprovementCard title="Estimación" detail={monetization.projection?.daysToShorts ? `${formatEta(monetization.projection.daysToShorts)} al ritmo actual · confianza ${monetization.projection.confidence}.` : 'No hay proyección suficiente todavía.'} />
            <ImprovementCard title="Cuello de botella" detail={monetization.bottleneck} />
            <ImprovementCard title="Qué acelera más" detail={insights[0]?.recommendation || 'Escalar patrones con mejor score y mejor capacidad de generar conversación.'} />
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Lista de vídeos"
          title="Decisión rápida por vídeo"
          detail="Score, retención, comments/1k y decisión de negocio."
        />
        <div className="space-y-4 px-6 py-6">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar por título, tema o hook"
            className="app-input"
          />
          <div className="space-y-3">
            {filteredVideos.slice(0, 24).map((video) => <VideoRow key={video.id} video={video} />)}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Resumen para ChatGPT"
          title="Bloque copiable"
          detail="Estado actual, qué funciona, qué falla, qué mejorar y monetización en un solo bloque."
          action={<button onClick={copySummary} className="app-button"><Copy size={14} />{copied ? 'Copiado' : 'Copiar'}</button>}
        />
        <div className="px-6 py-6">
          <pre className="app-wrap overflow-hidden rounded-[24px] border border-white/8 bg-[#131821] p-5 text-sm leading-7 text-white/74 whitespace-pre-wrap">{chatgptSummary}</pre>
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

function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatLarge(value) {
  return Number(value || 0).toLocaleString('es-ES');
}

function formatOne(value) {
  return Number(value || 0).toFixed(1);
}

function signed(value) {
  const amount = Number(value || 0).toFixed(1);
  return value > 0 ? `+${amount}` : amount;
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
