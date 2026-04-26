import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Loader2, Radio, RefreshCw, Sparkles, Upload, Wand2 } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const REFRESH_INTERVAL = 15;

function scoreTone(score, threshold) {
  if (score == null) return 'text-white/30';
  if (score >= threshold + 8) return 'text-emerald-300';
  if (score >= threshold) return 'text-amber-300';
  return 'text-red-300';
}

function Bar({ value = 0, threshold = 0, max = 100 }) {
  const pct = Math.min(100, ((value || 0) / max) * 100);
  const color = !value
    ? 'bg-white/12'
    : value >= threshold + 8
      ? 'bg-emerald-400'
      : value >= threshold
        ? 'bg-amber-400'
        : 'bg-red-400';

  return (
    <div className="mt-3 h-2 rounded-full bg-white/6">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.max(4, pct)}%` }} />
    </div>
  );
}

function StatCard({ label, value, detail, tone = 'text-white' }) {
  return (
    <div className="app-kpi">
      <p className="app-kpi-label">{label}</p>
      <p className={`app-kpi-value ${tone}`}>{value}</p>
      <p className="app-kpi-meta">{detail}</p>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="app-panel-soft p-5 text-sm text-white/38">
      {text}
    </div>
  );
}

export default function OperationsDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [spinning, setSpinning] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const timerRef = useRef(null);

  const load = async (manual = false) => {
    if (manual) setSpinning(true);
    try {
      const response = await axios.get(`${API}/api/dashboard/operations`);
      setData(response.data.data);
      setError(null);
      setCountdown(REFRESH_INTERVAL);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSpinning(false);
    }
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          load();
          return REFRESH_INTERVAL;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  const runAction = async (url, label) => {
    setActionMsg(`${label}...`);
    try {
      await axios.post(`${API}${url}`);
      setActionMsg(`${label} ok`);
      setTimeout(() => {
        setActionMsg('');
        load();
      }, 2000);
    } catch {
      setActionMsg('Error');
      setTimeout(() => setActionMsg(''), 2000);
    }
  };

  if (!data && !error) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Loader2 size={24} className="animate-spin text-white/30" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-page">
        <div className="app-panel p-6 text-sm text-red-300">{error}</div>
      </div>
    );
  }

  const { overview, pipeline, upcoming, quality, recentRejections, nextDecision, timestamp } = data;
  const thresholds = quality.thresholds;

  return (
    <div className="app-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Radio size={12} className="text-emerald-300" />
            <span className="app-eyebrow">Operaciones</span>
          </div>
          <h1 className="mt-2 text-2xl font-black text-white">Control operativo de la máquina</h1>
          <p className="mt-1 text-sm text-white/42">Estado real de publicación, generación, calidad y próximos movimientos.</p>
        </div>
        <div className="flex items-center gap-2">
          {actionMsg ? <span className="app-badge app-badge-warn">{actionMsg}</span> : null}
          <span className="app-badge">{countdown}s</span>
          <button onClick={() => load(true)} className="app-button" disabled={spinning}>
            <RefreshCw size={14} className={spinning ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="app-panel p-6">
          <p className="app-eyebrow">Próxima publicación</p>
          <div className="mt-4 flex items-end justify-between gap-6">
            <div>
              <p className="text-5xl font-black tracking-tight text-white">{overview.nextPublishTime?.split(' ')[0] || '—'}</p>
              <p className="mt-2 text-sm text-amber-300">{overview.nextPublishIn ? `en ${overview.nextPublishIn}` : 'Sin ventana calculada'}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-white/34">Hoy</p>
              <p className="mt-1 text-4xl font-black text-white">{overview.publishedToday}<span className="text-xl text-white/28"> / {overview.maxPerDay}</span></p>
              <p className="mt-1 text-sm text-white/34">publicados</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
          <StatCard label="Listos" value={overview.readyToPublish} detail="vídeos preparados para publicar" tone={overview.readyToPublish > 0 ? 'text-sky-300' : 'text-white'} />
          <StatCard label="Cola" value={overview.queuePending} detail={pipeline.rendering ? `render ${pipeline.rendering.progress}%` : 'sin render activo'} tone={pipeline.rendering ? 'text-amber-300' : 'text-white'} />
          <StatCard label="Calidad media" value={quality.avgVirality || '—'} detail={`format ${quality.avgFormatMatch || '—'} · emoción ${quality.avgEmotional || '—'}`} tone="text-emerald-300" />
          <StatCard label="Rechazo" value={`${quality.rejectionRate}%`} detail={`${quality.totalCycles} ciclos`} tone={quality.rejectionRate > 60 ? 'text-red-300' : quality.rejectionRate > 40 ? 'text-amber-300' : 'text-white'} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="app-panel">
          <div className="app-section-header">
            <p className="app-eyebrow">Pipeline</p>
            <h2 className="app-title">Qué está pasando ahora</h2>
          </div>
          <div className="grid gap-4 px-6 py-6 md:grid-cols-5">
            {[
              { label: 'Pending', value: pipeline.pending.length, detail: 'esperando' },
              { label: 'Render', value: pipeline.rendering ? 1 : 0, detail: pipeline.rendering ? `${pipeline.rendering.progress}%` : 'sin tarea' },
              { label: 'Listo', value: pipeline.rendered.length, detail: 'para publicar' },
              { label: 'Publicado hoy', value: pipeline.publishedToday.length, detail: 'completados' },
              { label: 'Fallido', value: pipeline.failed.length, detail: 'requiere revisión' },
            ].map((item) => (
              <div key={item.label} className="app-panel-soft p-4 text-center">
                <p className="app-kpi-label">{item.label}</p>
                <p className="mt-3 text-3xl font-black text-white">{item.value}</p>
                <p className="mt-1 text-xs text-white/36">{item.detail}</p>
              </div>
            ))}
          </div>
          {pipeline.rendering ? (
            <div className="px-6 pb-6">
              <div className="app-panel-soft p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{pipeline.rendering.topic}</p>
                    <p className="mt-1 text-xs text-white/40">{pipeline.rendering.hook || 'Render en curso'}</p>
                  </div>
                  <span className="app-badge app-badge-warn">{pipeline.rendering.progress}%</span>
                </div>
                <Bar value={pipeline.rendering.progress} threshold={80} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="app-panel">
          <div className="app-section-header">
            <p className="app-eyebrow">Calidad</p>
            <h2 className="app-title">Señal de entrada</h2>
          </div>
          <div className="grid gap-4 px-6 py-6 md:grid-cols-3">
            {[
              { label: 'Viralidad', value: quality.avgVirality, threshold: thresholds.viralityToQueue },
              { label: 'Format match', value: quality.avgFormatMatch, threshold: thresholds.formatMatchToQueue },
              { label: 'Emoción', value: quality.avgEmotional, threshold: 60 },
            ].map((item) => (
              <div key={item.label} className="app-panel-soft p-4">
                <p className="app-kpi-label">{item.label}</p>
                <p className={`mt-3 text-3xl font-black ${scoreTone(item.value, item.threshold)}`}>{item.value || '—'}</p>
                <Bar value={item.value} threshold={item.threshold} />
              </div>
            ))}
          </div>
          <div className="grid gap-4 px-6 pb-6 md:grid-cols-3">
            <BigStat title="Aprobación" value={`${quality.approvalRate}%`} />
            <BigStat title="Publish >= viral" value={thresholds.viralityToPublish} />
            <BigStat title="Queue >= format" value={thresholds.formatMatchToQueue} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="app-panel">
          <div className="app-section-header">
            <p className="app-eyebrow">Próximos</p>
            <h2 className="app-title">Vídeos listos para salir</h2>
          </div>
          <div className="px-2 py-2">
            {upcoming.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState text="No hay vídeos renderizados en cola de publicación." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>Topic</th>
                      <th>Hook</th>
                      <th>P</th>
                      <th>V</th>
                      <th>F</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map((video) => (
                      <tr key={video.videoId}>
                        <td className="font-semibold text-white">{video.scheduledSlot}</td>
                        <td className="text-white/60">{video.topic || '—'}</td>
                        <td className="max-w-[320px] truncate text-white/46">{video.hook || '—'}</td>
                        <td className="text-right text-emerald-300">{video.priorityScore ?? '—'}</td>
                        <td className={`text-right ${scoreTone(video.viralityScore, thresholds.viralityToPublish)}`}>{video.viralityScore ?? '—'}</td>
                        <td className={`text-right ${scoreTone(video.formatMatchScore, thresholds.formatMatchToQueue)}`}>{video.formatMatchScore ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {nextDecision ? (
            <div className="app-panel p-6">
              <p className="app-eyebrow">Próxima generación</p>
              <h2 className="app-title">{nextDecision.nextTopic}</h2>
              <p className="mt-2 text-sm text-white/46">{nextDecision.angle || 'Sin ángulo detallado'}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="app-badge">{nextDecision.hookType}</span>
                <span className="app-badge">{nextDecision.strategy}</span>
                <span className={`app-badge ${(nextDecision.confidence || 0) >= 0.8 ? 'app-badge-good' : 'app-badge-warn'}`}>
                  {Math.round((nextDecision.confidence || 0) * 100)}% conf.
                </span>
              </div>
              {nextDecision.reasoning ? <p className="mt-4 text-sm leading-6 text-white/42">{nextDecision.reasoning}</p> : null}
            </div>
          ) : null}

          <div className="app-panel p-6">
            <p className="app-eyebrow">Acciones manuales</p>
            <div className="mt-4 grid gap-3">
              <button onClick={() => runAction('/api/scheduler/run-generation', 'Generando')} className="app-button app-button-strong">
                <Wand2 size={14} />
                Generar ahora
              </button>
              <button onClick={() => runAction('/api/publish/run', 'Publicando')} disabled={overview.readyToPublish === 0} className="app-button disabled:cursor-not-allowed disabled:opacity-30">
                <Upload size={14} />
                Publicar ahora
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-white/34">
              <span>gen {overview.generationEnabled ? 'ON' : 'OFF'} · pub {overview.publishEnabled ? 'ON' : 'OFF'}</span>
              <span>{new Date(timestamp).toLocaleTimeString('es-ES')}</span>
            </div>
          </div>
        </div>
      </div>

      {recentRejections.length > 0 ? (
        <div className="app-panel">
          <div className="app-section-header">
            <p className="app-eyebrow">Rechazados recientes</p>
            <h2 className="app-title">Lo que el sistema está descartando</h2>
          </div>
          <div className="overflow-x-auto px-2 py-2">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Topic</th>
                  <th>Hook</th>
                  <th>V</th>
                  <th>F</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {recentRejections.map((item, index) => (
                  <tr key={`${item.rejectedAt}-${index}`}>
                    <td>{item.rejectedAt ? new Date(item.rejectedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="text-white/58">{item.topic || '—'}</td>
                    <td className="max-w-[320px] truncate text-white/44">{item.hook || '—'}</td>
                    <td className={scoreTone(item.viralityScore, 75)}>{item.viralityScore ?? '—'}</td>
                    <td className={scoreTone(item.formatMatchScore, 70)}>{item.formatMatchScore ?? '—'}</td>
                    <td className="text-red-300/72">{item.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BigStat({ title, value }) {
  return (
    <div className="app-panel-soft p-4">
      <p className="app-kpi-label">{title}</p>
      <p className="mt-3 text-2xl font-black text-white">{value}</p>
    </div>
  );
}
