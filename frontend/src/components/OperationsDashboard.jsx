/**
 * OperationsDashboard.jsx
 * Panel operativo en tiempo real — muestra el estado exacto de la máquina.
 * Auto-refresh cada 15s. Sin gráficas. Solo datos.
 */

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { RefreshCw, Radio, Loader, Zap, Upload } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const REFRESH_INTERVAL = 15;

// ─── helpers ───────────────────────────────────────────────────────────────

function truncate(str, n = 45) {
  if (!str || str === '—') return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function scoreColor(score, threshold) {
  if (!score && score !== 0) return 'text-gray-700';
  if (score >= threshold + 8) return 'text-emerald-400';
  if (score >= threshold)     return 'text-yellow-400';
  return 'text-red-400';
}

function ScoreBar({ value, threshold, max = 100 }) {
  const pct   = Math.min(100, ((value || 0) / max) * 100);
  const color = !value ? 'bg-gray-800'
    : value >= threshold + 8 ? 'bg-emerald-500'
    : value >= threshold     ? 'bg-yellow-500'
    : 'bg-red-500';
  return (
    <div className="h-0.5 bg-white/5 rounded-full overflow-hidden mt-1">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── main component ─────────────────────────────────────────────────────────

export default function OperationsDashboard() {
  const [data,       setData]       = useState(null);
  const [error,      setError]      = useState(null);
  const [countdown,  setCountdown]  = useState(REFRESH_INTERVAL);
  const [spinning,   setSpinning]   = useState(false);
  const [actionMsg,  setActionMsg]  = useState('');
  const timerRef = useRef(null);

  const load = async (manual = false) => {
    if (manual) setSpinning(true);
    try {
      const r = await axios.get(`${API}/api/dashboard/operations`);
      setData(r.data.data);
      setError(null);
      setCountdown(REFRESH_INTERVAL);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSpinning(false);
    }
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { load(); return REFRESH_INTERVAL; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  const action = async (url, label) => {
    setActionMsg(`${label}…`);
    try {
      await axios.post(`${API}${url}`);
      setActionMsg(`${label} ✓`);
      setTimeout(() => { setActionMsg(''); load(); }, 2500);
    } catch {
      setActionMsg('Error');
      setTimeout(() => setActionMsg(''), 2000);
    }
  };

  // ── loading / error ──────────────────────────────────────────────────────

  if (!data && !error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <Loader size={18} className="text-gray-600 animate-spin" />
      <p className="text-xs font-mono text-gray-600">Conectando con la máquina…</p>
    </div>
  );

  if (error) return (
    <div className="py-16 text-center space-y-3">
      <p className="text-xs font-mono text-red-500">{error}</p>
      <button onClick={() => load(true)} className="text-[11px] font-mono text-gray-600 underline">
        reintentar
      </button>
    </div>
  );

  const { overview, pipeline, upcoming, quality, recentRejections, nextDecision } = data;
  const thr = quality.thresholds;

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* ─ HEADER ─ */}
      <div className="flex items-center justify-between py-0.5">
        <div className="flex items-center gap-2">
          <Radio size={11} className="text-emerald-400" />
          <span className="text-[10px] font-mono font-semibold text-gray-400 tracking-widest uppercase">
            Operaciones
          </span>
          {actionMsg && (
            <span className="text-[10px] font-mono text-violet-400 animate-pulse">{actionMsg}</span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-mono text-gray-700">{countdown}s</span>
          <button onClick={() => load(true)} className="text-gray-700 hover:text-gray-400 transition-colors" disabled={spinning}>
            <RefreshCw size={11} className={spinning ? 'animate-spin text-gray-500' : ''} />
          </button>
        </div>
      </div>

      {/* ─ OVERVIEW: 2+2+2 grid ─ */}
      <div className="grid grid-cols-2 gap-2">

        {/* PRÓXIMA PUBLICACIÓN — célula grande */}
        <div className={`col-span-2 rounded-xl p-3.5 border flex items-center justify-between
          ${overview.readyToPublish > 0
            ? 'bg-blue-500/5 border-blue-500/15'
            : 'bg-white/[0.02] border-white/5'}`}>
          <div>
            <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">Próxima publicación</p>
            <p className="text-3xl font-bold font-mono text-white leading-none mt-1">
              {overview.nextPublishTime?.split(' ')[0] || '—'}
            </p>
            {overview.nextPublishIn && (
              <p className="text-xs font-mono text-yellow-400 mt-1">en {overview.nextPublishIn}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">Hoy</p>
            <p className="text-2xl font-bold font-mono leading-none mt-1">
              <span className={overview.publishedToday >= overview.maxPerDay ? 'text-emerald-400' : 'text-white'}>
                {overview.publishedToday}
              </span>
              <span className="text-gray-700 text-base"> /{overview.maxPerDay}</span>
            </p>
            <p className="text-[10px] font-mono text-gray-600 mt-1">publicados</p>
          </div>
        </div>

        {/* LISTOS */}
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
          <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">Listos</p>
          <p className={`text-2xl font-bold font-mono leading-none mt-1 ${overview.readyToPublish > 0 ? 'text-blue-400' : 'text-gray-700'}`}>
            {overview.readyToPublish}
          </p>
          <p className="text-[9px] font-mono text-gray-700 mt-0.5">para publicar</p>
        </div>

        {/* COLA */}
        <div className={`bg-white/[0.02] border rounded-xl p-3
          ${pipeline.rendering ? 'border-yellow-500/20' : 'border-white/5'}`}>
          <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">Cola / Render</p>
          <div className="flex items-end gap-2 mt-1">
            <p className="text-2xl font-bold font-mono leading-none text-white">{overview.queuePending}</p>
            {pipeline.rendering && (
              <div className="flex items-center gap-1 mb-0.5">
                <Loader size={9} className="text-yellow-400 animate-spin" />
                <span className="text-[10px] font-mono text-yellow-400">{pipeline.rendering.progress}%</span>
              </div>
            )}
          </div>
          <p className="text-[9px] font-mono text-gray-700 mt-0.5">
            {pipeline.rendering ? `renderizando · ${pipeline.rendering.topic}` : 'en cola'}
          </p>
        </div>

        {/* CALIDAD V/F */}
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
          <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">Calidad media</p>
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-gray-600">Viral</span>
              <span className={`text-sm font-bold font-mono ${scoreColor(quality.avgVirality, thr.viralityToQueue)}`}>
                {quality.avgVirality || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-gray-600">Format</span>
              <span className={`text-sm font-bold font-mono ${scoreColor(quality.avgFormatMatch, thr.formatMatchToQueue)}`}>
                {quality.avgFormatMatch || '—'}
              </span>
            </div>
          </div>
        </div>

        {/* RECHAZO */}
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
          <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">Rechazo</p>
          <p className={`text-2xl font-bold font-mono leading-none mt-1
            ${quality.rejectionRate > 60 ? 'text-orange-400'
            : quality.rejectionRate > 40 ? 'text-yellow-400'
            : 'text-gray-400'}`}>
            {quality.rejectionRate}<span className="text-base text-gray-600">%</span>
          </p>
          <p className="text-[9px] font-mono text-gray-700 mt-0.5">{quality.totalCycles} ciclos</p>
        </div>

      </div>

      {/* ─ PIPELINE ─ */}
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
        <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest mb-3">Pipeline</p>

        {/* estados en fila */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {[
            { key: 'PENDING',   count: pipeline.pending.length,     color: 'text-gray-400',    ring: 'border-gray-700' },
            { key: 'RENDER',    count: pipeline.rendering ? 1 : 0,  color: 'text-yellow-400',  ring: 'border-yellow-700', pulse: !!pipeline.rendering },
            { key: 'LISTO',     count: pipeline.rendered.length,     color: 'text-blue-400',    ring: 'border-blue-800' },
            { key: 'PUB HOY',   count: pipeline.publishedToday.length, color: 'text-emerald-400', ring: 'border-emerald-800' },
            { key: 'FALLIDO',   count: pipeline.failed.length,      color: pipeline.failed.length > 0 ? 'text-red-400' : 'text-gray-700', ring: pipeline.failed.length > 0 ? 'border-red-800' : 'border-gray-800' },
          ].map((s, i, arr) => (
            <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
              <div className={`text-center border rounded-lg px-2.5 py-1.5 ${s.ring} bg-white/[0.02]`}>
                <div className={`text-lg font-bold font-mono leading-none ${s.color} ${s.pulse ? 'animate-pulse' : ''}`}>
                  {s.count}
                </div>
                <div className="text-[8px] font-mono text-gray-600 mt-0.5 whitespace-nowrap">{s.key}</div>
              </div>
              {i < arr.length - 1 && <span className="text-gray-800 text-xs font-mono">→</span>}
            </div>
          ))}
        </div>

        {/* detalle render activo */}
        {pipeline.rendering && (
          <div className="mt-2.5 pt-2.5 border-t border-white/5">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-mono text-gray-500">
                <span className="text-yellow-400 mr-1">⬤</span>
                {pipeline.rendering.topic}
                {pipeline.rendering.hook && (
                  <span className="text-gray-700 ml-1">· {truncate(pipeline.rendering.hook, 35)}</span>
                )}
              </p>
              <p className="text-[10px] font-mono text-yellow-400 font-bold">{pipeline.rendering.progress}%</p>
            </div>
            <div className="h-0.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-yellow-500/50 rounded-full transition-all duration-700"
                style={{ width: `${pipeline.rendering.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ─ PRÓXIMOS A PUBLICAR ─ */}
      {upcoming.length > 0 ? (
        <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-white/5">
            <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">
              Próximos a publicar <span className="text-gray-700 normal-case">· ordenados por prioridad</span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono min-w-[420px]">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-3 py-2 text-[9px] text-gray-700 font-normal w-16">SLOT</th>
                  <th className="text-left px-2 py-2 text-[9px] text-gray-700 font-normal w-24">TOPIC</th>
                  <th className="text-left px-2 py-2 text-[9px] text-gray-700 font-normal">HOOK</th>
                  <th className="text-right px-2 py-2 text-[9px] text-gray-700 font-normal w-8">P</th>
                  <th className="text-right px-2 py-2 text-[9px] text-gray-700 font-normal w-8">V</th>
                  <th className="text-right px-3 py-2 text-[9px] text-gray-700 font-normal w-8">F</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((v, i) => (
                  <tr key={v.videoId} className={`border-b border-white/[0.03] ${i === 0 ? 'bg-blue-500/[0.04]' : 'hover:bg-white/[0.01]'}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`font-bold ${i === 0 ? 'text-blue-400' : 'text-gray-600'}`}>
                        {v.scheduledSlot}
                      </span>
                      {v.scheduledTomorrow && <span className="text-gray-700 text-[8px] ml-1">mañana</span>}
                    </td>
                    <td className="px-2 py-2 text-gray-500">{v.topic || '—'}</td>
                    <td className="px-2 py-2 text-gray-600">{truncate(v.hook, 38)}</td>
                    <td className={`px-2 py-2 text-right font-bold ${v.priorityScore >= 75 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                      {v.priorityScore ?? '—'}
                    </td>
                    <td className={`px-2 py-2 text-right ${scoreColor(v.viralityScore, thr.viralityToPublish)}`}>
                      {v.viralityScore ?? '—'}
                    </td>
                    <td className={`px-3 py-2 text-right ${scoreColor(v.formatMatchScore, thr.formatMatchToQueue)}`}>
                      {v.formatMatchScore ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white/[0.02] border border-white/5 rounded-xl px-3 py-4 text-center">
          <p className="text-[11px] font-mono text-gray-700">Sin vídeos renderizados en cola de publicación</p>
          <p className="text-[10px] font-mono text-gray-800 mt-0.5">
            La máquina generará el siguiente en el próximo ciclo
          </p>
        </div>
      )}

      {/* ─ CALIDAD detallada ─ */}
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">Calidad</p>
          <p className="text-[9px] font-mono text-gray-700">últimos {quality.totalCycles} ciclos</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'VIRALIDAD',  val: quality.avgVirality,     threshold: thr.viralityToQueue },
            { label: 'FORMAT',     val: quality.avgFormatMatch,   threshold: thr.formatMatchToQueue },
            { label: 'EMOCIÓN',    val: quality.avgEmotional,     threshold: 60 },
          ].map(({ label, val, threshold }) => (
            <div key={label}>
              <p className="text-[8px] font-mono text-gray-700">{label}</p>
              <p className={`text-2xl font-bold font-mono leading-none mt-0.5 ${scoreColor(val, threshold)}`}>
                {val || '—'}
              </p>
              <ScoreBar value={val} threshold={threshold} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-white/5 text-center">
          <div>
            <p className="text-[8px] font-mono text-gray-700">APROBACIÓN</p>
            <p className={`text-sm font-bold font-mono ${quality.approvalRate >= 40 ? 'text-emerald-400' : 'text-red-400'}`}>
              {quality.approvalRate}%
            </p>
          </div>
          <div>
            <p className="text-[8px] font-mono text-gray-700">PUB ≥ VIRAL</p>
            <p className="text-sm font-bold font-mono text-gray-500">{thr.viralityToPublish}</p>
          </div>
          <div>
            <p className="text-[8px] font-mono text-gray-700">QUEUE ≥ FORMAT</p>
            <p className="text-sm font-bold font-mono text-gray-500">{thr.formatMatchToQueue}</p>
          </div>
        </div>
      </div>

      {/* ─ PRÓXIMA DECISIÓN ─ */}
      {nextDecision && (
        <div className="bg-white/[0.02] border border-violet-500/10 rounded-xl p-3">
          <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest mb-2">Próxima generación</p>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-mono text-violet-300 font-bold">{nextDecision.nextTopic}</span>
                <span className="text-[9px] font-mono text-gray-600 bg-white/5 px-1.5 py-0.5 rounded">
                  {nextDecision.hookType}
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded
                  ${nextDecision.strategy === 'exploit_p80'
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : nextDecision.strategy === 'streak'
                    ? 'text-violet-400 bg-violet-500/10'
                    : 'text-gray-600 bg-white/5'}`}>
                  {nextDecision.strategy}
                </span>
              </div>
              {nextDecision.angle && (
                <p className="text-[10px] font-mono text-gray-600">{nextDecision.angle}</p>
              )}
              {nextDecision.reasoning && (
                <p className="text-[10px] font-mono text-gray-700 leading-relaxed">
                  {truncate(nextDecision.reasoning, 90)}
                </p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[8px] font-mono text-gray-700">CONF</p>
              <p className={`text-base font-bold font-mono
                ${(nextDecision.confidence || 0) >= 0.8 ? 'text-emerald-400'
                : (nextDecision.confidence || 0) >= 0.5 ? 'text-yellow-400'
                : 'text-gray-600'}`}>
                {Math.round((nextDecision.confidence || 0) * 100)}%
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─ RECHAZADOS ─ */}
      {recentRejections.length > 0 && (
        <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-white/5">
            <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">Rechazados recientes</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono min-w-[360px]">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  <th className="text-left px-3 py-1.5 text-[8px] text-gray-700 font-normal w-10">HORA</th>
                  <th className="text-left px-2 py-1.5 text-[8px] text-gray-700 font-normal w-20">TOPIC</th>
                  <th className="text-left px-2 py-1.5 text-[8px] text-gray-700 font-normal">HOOK</th>
                  <th className="text-right px-2 py-1.5 text-[8px] text-gray-700 font-normal w-8">V</th>
                  <th className="text-right px-2 py-1.5 text-[8px] text-gray-700 font-normal w-8">F</th>
                  <th className="text-left px-3 py-1.5 text-[8px] text-gray-700 font-normal">MOTIVO</th>
                </tr>
              </thead>
              <tbody>
                {recentRejections.map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.01]">
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtTime(r.rejectedAt)}</td>
                    <td className="px-2 py-2 text-gray-700">{r.topic || '—'}</td>
                    <td className="px-2 py-2 text-gray-600">{truncate(r.hook, 28)}</td>
                    <td className={`px-2 py-2 text-right ${scoreColor(r.viralityScore, 75)}`}>
                      {r.viralityScore ?? '—'}
                    </td>
                    <td className={`px-2 py-2 text-right ${scoreColor(r.formatMatchScore, 70)}`}>
                      {r.formatMatchScore ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-red-500/60">{truncate(r.reason, 32)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─ ACCIONES MANUALES ─ */}
      <div className="flex gap-2">
        <button
          onClick={() => action('/api/scheduler/run-generation', 'Generando')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-mono font-bold
            text-gray-500 bg-white/[0.02] border border-white/5 rounded-xl
            hover:bg-white/[0.04] hover:text-gray-300 hover:border-white/10 transition-all"
        >
          <Zap size={11} />
          GENERAR AHORA
        </button>
        <button
          onClick={() => action('/api/publish/run', 'Publicando')}
          disabled={overview.readyToPublish === 0}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-mono font-bold
            text-gray-500 bg-white/[0.02] border border-white/5 rounded-xl
            hover:bg-white/[0.04] hover:text-gray-300 hover:border-white/10 transition-all
            disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Upload size={11} />
          PUBLICAR AHORA
        </button>
        <button
          onClick={() => {
            if (window.confirm('¿Limpiar jobs fallidos y renders incompletos?')) {
              action('/api/admin/cleanup', 'Limpiando');
            }
          }}
          title="Eliminar jobs fallidos y renders sin output.mp4"
          className="px-3 py-2.5 text-[11px] font-mono font-bold
            text-gray-700 bg-white/[0.02] border border-white/5 rounded-xl
            hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all"
        >
          🗑
        </button>
      </div>

      {/* ─ STATUS BAR ─ */}
      <div className="flex items-center justify-between pt-0.5">
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <span>
            gen{' '}
            {overview.generationEnabled
              ? <span className="text-emerald-600">ON</span>
              : <span className="text-gray-700">OFF</span>}
          </span>
          <span>
            pub{' '}
            {overview.publishEnabled
              ? <span className="text-emerald-600">ON</span>
              : <span className="text-gray-700">OFF</span>}
          </span>
          {overview.isPublishing && (
            <span className="text-yellow-600 animate-pulse">publicando…</span>
          )}
          {pipeline.failed.length > 0 && (
            <span className="text-red-600">{pipeline.failed.length} fallidos</span>
          )}
        </div>
        <p className="text-[9px] font-mono text-gray-800">
          {new Date(data.timestamp).toLocaleTimeString('es-ES')}
        </p>
      </div>

    </div>
  );
}
