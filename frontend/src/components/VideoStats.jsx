import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ArrowDownRight, ArrowUpRight, RefreshCw } from 'lucide-react';

const SORTS = [
  { key: 'views', label: 'Views' },
  { key: 'comments', label: 'Comentarios' },
  { key: 'commentsPer1kViews', label: 'Com/1k' },
  { key: 'retention', label: 'Retención' },
  { key: 'monetizationScore', label: 'Score' },
];

const SEGMENT_LABELS = [
  ['hook', 'Hook'],
  ['open_loop', 'Open loop'],
  ['micro_value', 'Micro value'],
  ['escalation', 'Escalation'],
  ['reengage', 'Reengage'],
  ['peak', 'Peak'],
  ['open_ending', 'Open ending'],
  ['soft_cta', 'Soft CTA'],
];

function Panel({ children, className = '' }) {
  return <section className={`app-panel overflow-hidden ${className}`}>{children}</section>;
}

function Kpi({ label, value, detail, tone = 'neutral' }) {
  const valueClass = tone === 'good'
    ? 'text-emerald-300'
    : tone === 'warn'
      ? 'text-amber-300'
      : tone === 'bad'
        ? 'text-red-300'
        : 'text-white';

  return (
    <div className="rounded-[24px] border border-white/8 bg-[#131821] p-5">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/30">{label}</p>
      <p className={`mt-3 text-3xl font-black ${valueClass}`}>{value}</p>
      <p className="mt-2 text-xs leading-5 text-white/40">{detail}</p>
    </div>
  );
}

function MetricBox({ label, value, detail, source = null }) {
  return (
    <div className="rounded-[20px] border border-white/8 bg-[#131821] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <p className="app-wrap text-[11px] uppercase tracking-[0.16em] text-white/28">{label}</p>
        {source ? <span className="rounded-full bg-white/6 px-2.5 py-1 text-[10px] font-semibold text-white/55">{source}</span> : null}
      </div>
      <p className="app-wrap mt-3 text-2xl font-black text-white">{value}</p>
      {detail ? <p className="app-wrap mt-2 text-xs leading-5 text-white/40">{detail}</p> : null}
    </div>
  );
}

function SectionTitle({ title, detail }) {
  return (
    <div>
      <p className="app-wrap text-sm font-semibold text-white">{title}</p>
      {detail ? <p className="app-wrap mt-1 text-xs leading-5 text-white/40">{detail}</p> : null}
    </div>
  );
}

function RetentionBar({ label, value, tone = 'neutral' }) {
  const color = tone === 'good'
    ? 'bg-emerald-400'
    : tone === 'warn'
      ? 'bg-amber-400'
      : tone === 'bad'
        ? 'bg-red-400'
        : 'bg-sky-400';

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-white/46">{label}</p>
        <p className="text-xs font-semibold text-white">{formatOne(value)}%</p>
      </div>
      <div className="h-2 rounded-full bg-white/6">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.max(4, Math.min(100, value || 0))}%` }} />
      </div>
    </div>
  );
}

function SegmentCard({ label, text }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-[#131821] p-4">
      <p className="app-wrap text-[11px] uppercase tracking-[0.16em] text-white/28">{label}</p>
      <p className="app-wrap mt-2 text-sm leading-6 text-white/74">{text || 'Sin contenido'}</p>
    </div>
  );
}

function InsightList({ title, items, tone = 'neutral' }) {
  const badge = tone === 'good'
    ? 'bg-emerald-500/12 text-emerald-300'
    : tone === 'bad'
      ? 'bg-red-500/12 text-red-300'
      : 'bg-amber-500/12 text-amber-300';

  return (
    <div className="rounded-[22px] border border-white/8 bg-[#131821] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="app-wrap text-sm font-semibold text-white">{title}</p>
        <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${badge}`}>{tone}</span>
      </div>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item} className="app-wrap rounded-[16px] bg-black/20 px-3 py-2.5 text-sm leading-6 text-white/74">{item}</div>
        ))}
      </div>
    </div>
  );
}

function SortButton({ active, direction, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? 'bg-white text-black' : 'bg-white/6 text-white/55 hover:text-white/80'}`}
    >
      {label}
      {active ? (direction === 'desc' ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />) : null}
    </button>
  );
}

function VideoTable({ videos, selectedId, onSelect, sortKey, sortDirection, onSort }) {
  return (
    <div className="overflow-x-auto">
      <table className="app-table min-w-[1280px]">
        <thead>
          <tr>
            <th>Vídeo</th>
            <th>Fecha</th>
            <th>Duración</th>
            <th>Views</th>
            <th>Likes</th>
            <th>Comentarios</th>
            <th>Com/1k</th>
            <th>Retención</th>
            <th>Score</th>
            <th>Reengage</th>
            <th>Decisión</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((video) => (
            <tr
              key={video.id}
              onClick={() => onSelect(video.id)}
              className={`cursor-pointer transition hover:bg-white/[0.03] ${selectedId === video.id ? 'bg-white/[0.04]' : ''}`}
            >
              <td>
                <div className="flex items-center gap-3">
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-xl border border-white/8 bg-[#0b0f14]">
                    {video.thumbnail ? (
                      <img src={video.thumbnail} alt={video.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.18em] text-white/24">sin thumb</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="app-wrap max-w-[320px] text-sm font-semibold text-white">{video.title}</p>
                    <p className="app-wrap mt-1 max-w-[320px] text-[11px] text-white/34">
                      {humanize(video.classification?.topic)} · {humanize(video.classification?.hookType)} · {sourceLabel(video.dataSources?.views)}
                    </p>
                  </div>
                </div>
              </td>
              <td>{video.publishedAt ? formatDate(video.publishedAt) : '—'}</td>
              <td>{formatDuration(video.estimatedDuration || video.durationSeconds || 0)}</td>
              <td>{formatLarge(video.views)}</td>
              <td>{formatLarge(video.likes)}</td>
              <td>{formatLarge(video.comments)}</td>
              <td>{formatOne(video.commentsPer1kViews)}</td>
              <td>{formatOne(video.retention)}%</td>
              <td>{formatOne(video.monetizationScore)}</td>
              <td>{formatOne(video.reengageMetrics?.reengageEffectivenessScore)}</td>
              <td>
                <span className={`font-black tracking-[0.08em] ${decisionTone(video.decision)}`}>{video.decision}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function VideoStats() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('views');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedId, setSelectedId] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [analyticsRes, snapshotRes] = await Promise.all([
        axios.get('/api/analytics'),
        axios.get('/api/analytics/observation-snapshot'),
      ]);

      setPayload({
        analytics: analyticsRes.data?.data || null,
        snapshot: snapshotRes.data?.data || null,
      });
    } catch {
      setError('No se pudo cargar la vista de vídeos.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const analytics = payload?.analytics;
  const snapshot = payload?.snapshot;
  const summary = snapshot?.summary;
  const channelVideos = analytics?.allVideos || [];
  const snapshotVideos = snapshot?.videos || [];

  const mergedVideos = useMemo(() => {
    const analyticsMap = new Map(channelVideos.map((video) => [String(video.id), video]));
    const merged = snapshotVideos.map((video) => {
      const analyticsVideo = analyticsMap.get(String(video.id)) || {};
      const title = video.title || analyticsVideo.title || analyticsVideo.hook || 'Sin título';
      const monetizationScore = video.monetizationScore || analyticsVideo.monetizationScore || 0;
      const decision = monetizationScore >= 72 ? 'ESCALAR' : monetizationScore >= 56 ? 'VIGILAR' : 'CORTAR';
      return {
        ...analyticsVideo,
        ...video,
        title,
        publishedAt: analyticsVideo.published_at || analyticsVideo.publishedAt || null,
        durationSeconds: analyticsVideo.durationSeconds || video.estimatedDuration || 0,
        thumbnail: analyticsVideo.youtube_id ? `https://i.ytimg.com/vi/${analyticsVideo.youtube_id}/hqdefault.jpg` : null,
        youtubeId: analyticsVideo.youtube_id || null,
        classification: {
          topic: analyticsVideo.topic || video.classification?.topic,
          hookType: analyticsVideo.hookType || video.classification?.hookType,
          viralTrigger: video.classification?.viralTrigger,
          emotionalTrigger: video.classification?.emotionalTrigger,
        },
        decision,
      };
    });

    return merged;
  }, [channelVideos, snapshotVideos]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = !text
      ? mergedVideos
      : mergedVideos.filter((video) => {
          const haystack = [
            video.title,
            video.classification?.topic,
            video.classification?.hookType,
            video.classification?.viralTrigger,
            video.classification?.emotionalTrigger,
          ].join(' ').toLowerCase();
          return haystack.includes(text);
        });

    return [...list].sort((a, b) => {
      const aValue = sortableValue(a, sortKey);
      const bValue = sortableValue(b, sortKey);
      if (sortDirection === 'asc') return aValue - bValue;
      return bValue - aValue;
    });
  }, [mergedVideos, query, sortKey, sortDirection]);

  useEffect(() => {
    if (!filtered.length) return;
    if (!selectedId || !filtered.some((video) => video.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((video) => video.id === selectedId) || filtered[0] || null;
  const channelAverage = useMemo(() => ({
    views: average(mergedVideos.map((video) => video.views || 0)),
    retention: average(mergedVideos.map((video) => video.retention || 0)),
    commentsPer1kViews: average(mergedVideos.map((video) => video.commentsPer1kViews || 0)),
    monetizationScore: average(mergedVideos.map((video) => video.monetizationScore || 0)),
    reengage: average(mergedVideos.map((video) => video.reengageMetrics?.reengageEffectivenessScore || 0)),
  }), [mergedVideos]);
  const topAverage = useMemo(() => {
    const top = [...mergedVideos].sort((a, b) => (b.monetizationScore || 0) - (a.monetizationScore || 0)).slice(0, Math.min(5, mergedVideos.length));
    return {
      views: average(top.map((video) => video.views || 0)),
      retention: average(top.map((video) => video.retention || 0)),
      commentsPer1kViews: average(top.map((video) => video.commentsPer1kViews || 0)),
      monetizationScore: average(top.map((video) => video.monetizationScore || 0)),
      reengage: average(top.map((video) => video.reengageMetrics?.reengageEffectivenessScore || 0)),
    };
  }, [mergedVideos]);

  const diagnosis = useMemo(() => selected ? buildDiagnosis(selected, channelAverage) : null, [selected, channelAverage]);
  const recommendations = useMemo(() => selected ? buildRecommendations(selected, channelAverage, topAverage) : [], [selected, channelAverage, topAverage]);
  const retentionStages = selected?.retentionSegments || {};

  function handleSort(key) {
    if (sortKey === key) {
      setSortDirection((current) => current === 'desc' ? 'asc' : 'desc');
      return;
    }
    setSortKey(key);
    setSortDirection('desc');
  }

  if (loading) {
    return <div className="app-page"><Panel className="p-6 text-sm text-white/42">Cargando análisis de vídeos...</Panel></div>;
  }

  if (error || !summary) {
    return <div className="app-page"><Panel className="p-6 text-sm text-red-300">{error || 'No se pudo cargar la vista de vídeos.'}</Panel></div>;
  }

  return (
    <div className="app-page">
      <Panel>
        <div className="app-section-header flex items-start justify-between gap-4">
          <div>
            <p className="app-eyebrow">Vídeos</p>
            <h1 className="app-title mt-2 text-2xl">Análisis por vídeo</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-white/42">Vista de revisión seria para comparar vídeos, detectar patrones y entrar al detalle como en una consola de análisis.</p>
          </div>
          <button onClick={load} className="app-button"><RefreshCw size={14} />Actualizar</button>
        </div>
        <div className="grid gap-4 px-6 py-6 xl:grid-cols-5">
          <Kpi label="Vídeos analizados" value={formatLarge(summary.totalVideos)} detail="Piezas con señal agregada en el sistema." />
          <Kpi label="Views medias" value={formatLarge(Math.round(summary.avgViews || 0))} detail="Rendimiento medio por vídeo." />
          <Kpi label="Retención media" value={`${formatOne(summary.avgRetention)}%`} detail="Capacidad del catálogo para sostener atención." tone={summary.avgRetention >= 50 ? 'good' : summary.avgRetention >= 42 ? 'warn' : 'bad'} />
          <Kpi label="Comments / 1k" value={formatOne(summary.avgCommentsPer1kViews)} detail="Respuesta útil por cada mil views." tone={summary.avgCommentsPer1kViews >= 12 ? 'good' : summary.avgCommentsPer1kViews >= 7 ? 'warn' : 'bad'} />
          <Kpi label="Score medio" value={formatOne(summary.avgMonetizationScore)} detail="Valor comercial potencial del catálogo." tone={summary.avgMonetizationScore >= 68 ? 'good' : summary.avgMonetizationScore >= 55 ? 'warn' : 'bad'} />
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <Panel>
          <div className="app-section-header flex items-start justify-between gap-4">
            <div>
              <p className="app-eyebrow">Listado principal</p>
              <h2 className="app-title mt-2">Vista estilo Studio</h2>
              <p className="mt-2 text-sm leading-6 text-white/42">Ordena, filtra y detecta rápido qué merece escalarse, vigilarse o cortarse.</p>
            </div>
          </div>
          <div className="space-y-4 px-6 py-6">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filtrar por título, tema, hook o trigger"
                className="app-input xl:max-w-md"
              />
              <div className="flex flex-wrap gap-2">
                {SORTS.map((item) => (
                  <SortButton
                    key={item.key}
                    active={sortKey === item.key}
                    direction={sortDirection}
                    label={item.label}
                    onClick={() => handleSort(item.key)}
                  />
                ))}
              </div>
            </div>
            {filtered.length ? (
              <VideoTable
                videos={filtered}
                selectedId={selected?.id}
                onSelect={setSelectedId}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-[#131821] px-4 py-12 text-center text-sm text-white/35">No hay vídeos para ese filtro.</div>
            )}
          </div>
        </Panel>

        {selected ? (
          <div className="space-y-6">
            <Panel className="xl:sticky xl:top-24">
              <div className="app-section-header">
                <p className="app-eyebrow">Detalle del vídeo</p>
                <h2 className="app-title app-wrap mt-2">{selected.title}</h2>
                <p className="app-wrap mt-2 text-sm leading-6 text-white/42">{selected.publishedAt ? `Publicado el ${formatDate(selected.publishedAt)}` : 'Fecha no disponible'} · {humanize(selected.classification?.topic)} · {selected.youtubeId ? 'YouTube' : 'Interno'}</p>
              </div>
              <div className="space-y-6 px-6 py-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <MetricBox label="Views" value={formatLarge(selected.views)} source={sourceLabel(selected.dataSources?.views)} />
                  <MetricBox label="Likes" value={formatLarge(selected.likes)} source={sourceLabel(selected.dataSources?.likes)} />
                  <MetricBox label="Comentarios" value={formatLarge(selected.comments)} source={sourceLabel(selected.dataSources?.comments)} />
                  <MetricBox label="Duración" value={formatDuration(selected.estimatedDuration || selected.durationSeconds || 0)} source={sourceLabel(selected.dataSources?.duration)} />
                  <MetricBox label="Retención media" value={`${formatOne(selected.retention)}%`} source={sourceLabel(selected.dataSources?.retention)} />
                  <MetricBox label="CTR" value="—" detail="No disponible en el dataset actual." />
                  <MetricBox label="Monetization score" value={formatOne(selected.monetizationScore)} />
                  <MetricBox label="Reengage effectiveness" value={formatOne(selected.reengageMetrics?.reengageEffectivenessScore)} />
                </div>

                <div className="space-y-4">
                  <SectionTitle title="Retención" detail="Curva proxy por tramos y lectura del impacto del reengage." />
                  <div className="space-y-3 rounded-[22px] border border-white/8 bg-[#131821] p-4">
                    <RetentionBar label="0–5s" value={retentionStages.stage0 || 0} tone="good" />
                    <RetentionBar label="5–15s" value={retentionStages.stage1 || 0} />
                    <RetentionBar label="15–25s" value={retentionStages.stage2 || 0} tone="bad" />
                    <RetentionBar label="25–40s" value={retentionStages.stage3 || 0} tone="warn" />
                    <RetentionBar label="40–60s" value={retentionStages.stage4 || 0} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <MetricBox label="Caída previa" value={`${formatOne(selected.reengageMetrics?.retentionDropBeforeReengage)}%`} detail="Pérdida antes del tramo de rescate." />
                    <MetricBox label="Recuperación" value={`${formatOne(selected.reengageMetrics?.retentionRecoveryAfterReengage)}%`} detail="Lo que recupera tras el reengage." />
                    <MetricBox label="Tramo crítico" value="15–25s" detail="Zona más sensible para este formato actual." />
                  </div>
                </div>

                <div className="space-y-4">
                  <SectionTitle title="Segmentos del guión" detail="Lectura completa de la estructura narrativa usada en el vídeo." />
                  <div className="grid gap-3 md:grid-cols-2">
                    {SEGMENT_LABELS.map(([key, label]) => (
                      <SegmentCard key={key} label={label} text={selected.segments?.[key]} />
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <InsightList title="Qué funcionó" items={diagnosis.works} tone="good" />
                  <InsightList title="Qué falló" items={diagnosis.fails} tone="bad" />
                  <InsightList title="Por qué rindió así" items={diagnosis.why} tone="warn" />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <InsightList title="Qué repetir" items={recommendations.repeat} tone="good" />
                  <InsightList title="Qué cambiar" items={recommendations.change} tone="warn" />
                </div>

                <div className="space-y-4">
                  <SectionTitle title="Comparativa" detail="Cómo queda este vídeo frente a la media del canal y frente a los mejores." />
                  <div className="grid gap-3 md:grid-cols-2">
                    <MetricBox label="Vs media canal" value={comparisonText(selected, channelAverage)} detail="Views · retención · comments/1k · score." />
                    <MetricBox label="Vs top vídeos" value={comparisonText(selected, topAverage)} detail="Diferencia frente al grupo ganador del canal." />
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function sortableValue(video, key) {
  if (key === 'commentsPer1kViews') return video.commentsPer1kViews || 0;
  if (key === 'monetizationScore') return video.monetizationScore || 0;
  return video[key] || 0;
}

function decisionTone(decision) {
  if (decision === 'ESCALAR') return 'text-emerald-300';
  if (decision === 'VIGILAR') return 'text-amber-300';
  return 'text-red-300';
}

function sourceLabel(source) {
  if (source === 'youtube') return 'YouTube';
  if (source === 'youtube_estimated_from_recent_uploads') return 'YouTube est.';
  if (source === 'estimated') return 'Estimado';
  if (source === 'internal') return 'Interno';
  return source || 'Estimado';
}

function buildDiagnosis(video, channelAverage) {
  const works = [];
  const fails = [];
  const why = [];

  if ((video.monetizationScore || 0) >= channelAverage.monetizationScore) works.push('El score está por encima de la media del canal.');
  if ((video.retention || 0) >= channelAverage.retention) works.push('La retención aguanta mejor que la media del catálogo.');
  if ((video.commentsPer1kViews || 0) >= channelAverage.commentsPer1kViews) works.push('Genera más conversación por view que el promedio.');
  if ((video.reengageMetrics?.reengageEffectivenessScore || 0) >= channelAverage.reengage) works.push('El reengage rescata mejor que la media.');

  if ((video.retention || 0) < channelAverage.retention) fails.push('La retención cae antes de lo deseable.');
  if ((video.commentsPer1kViews || 0) < channelAverage.commentsPer1kViews) fails.push('La conversación está por debajo del promedio.');
  if ((video.reengageMetrics?.reengageEffectivenessScore || 0) < channelAverage.reengage) fails.push('El reengage no está compensando la caída crítica.');
  if ((video.views || 0) > channelAverage.views && (video.monetizationScore || 0) < channelAverage.monetizationScore) fails.push('Tiene views, pero convierte peor en valor comercial.');

  why.push(video.decision === 'ESCALAR' ? 'Combina alcance, retención o señal comercial suficiente para repetirse.' : video.decision === 'VIGILAR' ? 'Tiene alguna señal útil, pero aún no es un patrón sólido.' : 'Hoy no justifica más volumen frente a alternativas mejores.');
  why.push((video.hasReengage ? 'Usa reengage en la estructura.' : 'No usa reengage o no aporta señal fuerte en esta pieza.'));

  return {
    works: works.length ? works : ['No destaca claramente frente a la media del canal.'],
    fails: fails.length ? fails : ['No tiene una debilidad dominante clara.'],
    why,
  };
}

function buildRecommendations(video, channelAverage, topAverage) {
  const repeat = [];
  const change = [];

  if ((video.retention || 0) >= channelAverage.retention) repeat.push('Mantener la apertura y el ritmo inicial porque sostienen mejor la atención.');
  if ((video.commentsPer1kViews || 0) >= channelAverage.commentsPer1kViews) repeat.push('Repetir el tipo de hook o enfoque que provoca más respuesta.');
  if ((video.reengageMetrics?.reengageEffectivenessScore || 0) >= topAverage.reengage) repeat.push('Conservar el patrón de reengage porque compite con los mejores vídeos.');

  if ((video.retention || 0) < topAverage.retention) change.push('Reforzar el tramo 15–25s para acercarlo a la retención de los top vídeos.');
  if ((video.commentsPer1kViews || 0) < topAverage.commentsPer1kViews) change.push('Hacer el cierre más comentable y menos genérico.');
  if ((video.reengageMetrics?.reengageEffectivenessScore || 0) < topAverage.reengage) change.push('Volver el reengage más directo o más temprano.');
  if ((video.monetizationScore || 0) < topAverage.monetizationScore) change.push('Concentrar el mensaje en el patrón emocional o temático que más monetiza dentro del canal.');

  return {
    repeat: repeat.length ? repeat : ['No hay un patrón ganador claro para replicar todavía.'],
    change: change.length ? change : ['No necesita un cambio grande frente a los líderes actuales.'],
  };
}

function comparisonText(video, benchmark) {
  const parts = [
    diffText(video.views || 0, benchmark.views, 'views'),
    diffText(video.retention || 0, benchmark.retention, 'retención'),
    diffText(video.commentsPer1kViews || 0, benchmark.commentsPer1kViews, 'com/1k'),
    diffText(video.monetizationScore || 0, benchmark.monetizationScore, 'score'),
  ];
  return parts.join(' · ');
}

function diffText(value, benchmark, label) {
  const diff = value - (benchmark || 0);
  const prefix = diff >= 0 ? '+' : '';
  return `${label} ${prefix}${formatOne(diff)}`;
}

function average(values = []) {
  const valid = values.filter((value) => typeof value === 'number' && !Number.isNaN(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function humanize(value) {
  if (!value) return 'Sin señal';
  return String(value).replaceAll('_', ' ');
}

function formatLarge(value) {
  return Number(value || 0).toLocaleString('es-ES');
}

function formatOne(value) {
  return Number(value || 0).toFixed(1);
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (!mins) return `${secs}s`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
