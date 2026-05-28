import { useEffect, useState } from 'react';
import { Film, RefreshCw, Youtube, ChevronDown, ChevronUp, Clock, Zap, ExternalLink } from 'lucide-react';
import axios from 'axios';

const TOPIC_LABELS = {
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

function ScoreRing({ score }) {
  const color = !score ? '#374151' : score >= 80 ? '#10b981' : score >= 65 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="none" stroke="#1f2937" strokeWidth="4" />
        <circle
          cx="24" cy="24" r="20" fill="none"
          stroke={color} strokeWidth="4"
          strokeDasharray={`${((score || 0) / 100) * 125.6} 125.6`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-black" style={{ color }}>
        {score || '?'}
      </span>
    </div>
  );
}

function VideoCard({ v }) {
  const [open, setOpen]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [result, setResult] = useState(null);

  const s = v.script || {};

  async function upload() {
    setBusy(true);
    setResult(null);
    try {
      const r = await axios.post('/api/videos/upload-youtube', { videoId: v.id });
      setResult({ ok: true, url: r.data.data?.url });
    } catch (e) {
      setResult({ ok: false, msg: e.response?.data?.error || e.message });
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      {/* Fila principal */}
      <button
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-800/50 active:bg-gray-800 transition-colors"
      >
        <ScoreRing score={s.viralityScore} />

        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold leading-snug line-clamp-2">
            {s.hook || 'Sin guión'}
          </p>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
            {s.topic && (
              <span className="text-xs text-violet-400 font-medium">
                {TOPIC_LABELS[s.topic] || s.topic}
              </span>
            )}
            {s.durationSeconds && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Clock size={10} />{s.durationSeconds}s
              </span>
            )}
            {s.viralTrigger && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Zap size={10} />{s.viralTrigger}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-gray-600">
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {/* Detalle expandible */}
      {open && (
        <div className="border-t border-gray-800 p-4 space-y-3">
          {[
            { key: 'hook',        label: 'HOOK',        border: 'border-amber-500',   text: 'text-amber-200'   },
            { key: 'claim',       label: 'CLAIM',       border: 'border-blue-500',    text: 'text-blue-200'    },
            { key: 'explanation', label: 'EXPLICACIÓN', border: 'border-gray-600',    text: 'text-gray-200'    },
            { key: 'cta',         label: 'CTA',         border: 'border-emerald-500', text: 'text-emerald-200' },
          ].map(({ key, label, border, text }) => s[key] && (
            <div key={key} className={`border-l-4 ${border} pl-3`}>
              <p className="text-[10px] font-bold text-gray-500 font-mono mb-0.5">{label}</p>
              <p className={`text-sm leading-relaxed ${text}`}>{s[key]}</p>
            </div>
          ))}

          {s.psychologicalFact && (
            <div className="bg-violet-950 border border-violet-800 rounded-xl px-3 py-2.5 mt-1">
              <p className="text-violet-300 text-xs font-semibold mb-0.5">Dato psicológico</p>
              <p className="text-gray-300 text-xs italic">"{s.psychologicalFact}"</p>
            </div>
          )}

          <button
            onClick={upload}
            disabled={busy}
            className="mt-1 flex items-center gap-2 bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50 active:scale-95 transition-all"
          >
            {busy
              ? <span className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
              : <Youtube size={15} />}
            {busy ? 'Subiendo a YouTube...' : 'Subir a YouTube'}
          </button>

          {result && (
            <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm ${
              result.ok
                ? 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                : 'bg-red-950 border border-red-800 text-red-300'
            }`}>
              {result.ok ? (
                <>
                  <ExternalLink size={14} className="shrink-0 mt-0.5" />
                  <span>¡Subido! {result.url && <a href={result.url} target="_blank" rel="noreferrer" className="underline">{result.url}</a>}</span>
                </>
              ) : (
                <span>Error: {result.msg}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VideoList() {
  const [videos,  setVideos]  = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    axios.get('/api/videos/local')
      .then((r) => setVideos(r.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Vídeos generados</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Cargando...' : `${videos.length} vídeo${videos.length !== 1 ? 's' : ''} en local`}
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium px-4 py-2 rounded-xl active:scale-95 transition-all"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-500">
          <Film size={32} className="animate-pulse" />
        </div>
      ) : videos.length === 0 ? (
        <div className="bg-gray-900 rounded-2xl border border-dashed border-gray-700 p-12 text-center">
          <Film size={48} className="mx-auto mb-4 text-gray-700" />
          <p className="text-white font-bold text-lg mb-1">Sin vídeos todavía</p>
          <p className="text-gray-500 text-sm">Ve a "Generar" para crear tu primer vídeo</p>
        </div>
      ) : (
        <div className="space-y-3">
          {videos.map((v) => <VideoCard key={v.id} v={v} />)}
        </div>
      )}
    </div>
  );
}
