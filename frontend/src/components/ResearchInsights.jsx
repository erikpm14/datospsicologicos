import { useEffect, useState } from 'react';
import {
  TrendingUp, Zap, AlertTriangle, Clock, Target,
  BookOpen, RefreshCw, CheckCircle, Loader,
} from 'lucide-react';

function Card({ children, className = '' }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-5 ${className}`}>
      {children}
    </div>
  );
}

export default function ResearchInsights() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runMsg,  setRunMsg]  = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/research/insights')
      .then((r) => r.json())
      .then((json) => { setData(json.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const trigger = () => {
    setRunning(true);
    setRunMsg(null);
    fetch('/api/research/run', { method: 'POST' })
      .then((r) => r.json())
      .then((json) => {
        setRunMsg(json.message);
        setRunning(false);
        setTimeout(load, 120000);
      })
      .catch(() => setRunning(false));
  };

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <Loader size={28} className="animate-spin text-violet-500" />
    </div>
  );

  if (!data) return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Research viral</h2>
          <p className="text-gray-500 text-sm mt-0.5">Análisis de vídeos virales de tu nicho</p>
        </div>
      </div>
      <Card className="text-center py-10">
        <BookOpen size={40} className="mx-auto mb-4 text-gray-700" />
        <p className="text-white font-bold mb-1">Sin datos todavía</p>
        <p className="text-gray-500 text-sm mb-6 max-w-xs mx-auto">
          Ejecuta la investigación para analizar los vídeos más virales de IA y automatización en YouTube
        </p>
        <button
          onClick={trigger}
          disabled={running}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm px-6 py-3 rounded-xl disabled:opacity-50 active:scale-95 transition-all"
        >
          {running ? <Loader size={15} className="animate-spin" /> : <TrendingUp size={15} />}
          {running ? 'Analizando YouTube...' : 'Lanzar investigación (~2 min)'}
        </button>
        {runMsg && (
          <p className="text-emerald-400 text-sm mt-3 flex items-center justify-center gap-2">
            <CheckCircle size={14} />
            {runMsg}
          </p>
        )}
        <div className="mt-6 bg-gray-800/60 rounded-xl p-4 text-left text-xs font-mono text-emerald-400 space-y-1 max-w-sm mx-auto">
          <p className="text-gray-500"># O manualmente:</p>
          <p>node scripts/viral-research.js</p>
          <p>node scripts/analyze-patterns.js</p>
        </div>
      </Card>
    </div>
  );

  const { insights, titleAnalysis, generatedAt } = data;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Research viral</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Actualizado {new Date(generatedAt).toLocaleDateString('es-ES', { dateStyle: 'medium' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] bg-emerald-950 text-emerald-400 border border-emerald-800/50 px-2.5 py-1 rounded-full font-semibold">
            Datos reales
          </span>
          <button
            onClick={trigger}
            disabled={running}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs font-medium px-3 py-1.5 rounded-xl disabled:opacity-50 transition-all"
          >
            <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
            {running ? 'Analizando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {runMsg && (
        <div className="flex items-center gap-3 bg-violet-950 border border-violet-800/50 rounded-xl px-4 py-3">
          <Loader size={14} className="animate-spin text-violet-400 shrink-0" />
          <p className="text-violet-300 text-sm">{runMsg} · El dashboard se actualizará automáticamente.</p>
        </div>
      )}

      {/* Hallazgos clave */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={15} className="text-violet-400" />
          <p className="text-white font-bold">Hallazgos clave</p>
        </div>
        <ul className="space-y-2">
          {(insights.keyFindings || []).map((f, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="text-violet-500 shrink-0 mt-0.5">•</span>
              <span className="text-gray-300 leading-relaxed">{f}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Patrones de hook */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Zap size={15} className="text-amber-400" />
          <p className="text-white font-bold">Patrones de hook efectivos</p>
        </div>
        <div className="space-y-3">
          {(insights.bestHookPatterns || []).map((p, i) => (
            <div key={i} className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/40">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] bg-amber-900/60 border border-amber-700/50 text-amber-400 px-2 py-0.5 rounded font-mono font-semibold">
                  {p.pattern}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-2 leading-relaxed">{p.explanation}</p>
              <p className="text-sm text-white font-mono bg-gray-900 rounded-lg px-3 py-2 border border-gray-700/40">
                "{p.template}"
              </p>
              {p.example && (
                <p className="text-xs text-gray-600 mt-2 italic">Ej: "{p.example}"</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Duración + Topics */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-blue-400" />
            <p className="text-white font-bold text-sm">Duración óptima</p>
          </div>
          <p className="text-4xl font-black text-blue-400 leading-none">{insights.optimalDuration?.seconds}s</p>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">{insights.optimalDuration?.reasoning}</p>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Target size={14} className="text-violet-400" />
            <p className="text-white font-bold text-sm">Temas top</p>
          </div>
          <ol className="space-y-1.5">
            {(insights.topicsRanking || []).slice(0, 5).map((t, i) => (
              <li key={i} className="text-xs flex items-center gap-2 text-gray-300">
                <span className="text-violet-500 font-bold w-3 shrink-0">{i + 1}.</span>
                <span className="font-mono truncate">{t.topic}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* Palabras */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-3">Palabras de impacto</p>
          <div className="flex flex-wrap gap-1.5">
            {(insights.powerWords || []).map((w) => (
              <span key={w} className="text-xs bg-emerald-950/60 border border-emerald-800/40 text-emerald-300 px-2 py-1 rounded-lg">
                {w}
              </span>
            ))}
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-1.5 mb-3">
            <AlertTriangle size={12} className="text-red-400" />
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">A evitar</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(insights.wordsToAvoid || []).map((w) => (
              <span key={w} className="text-xs bg-red-950/40 border border-red-800/30 text-red-400 px-2 py-1 rounded-lg line-through">
                {w}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* Análisis de títulos */}
      {titleAnalysis && (
        <Card>
          <p className="text-white font-bold mb-4">Estructura de títulos virales</p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-white">{titleAnalysis.avgTitleLength?.words}</p>
              <p className="text-[10px] text-gray-500 mt-1">palabras</p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-amber-400">{titleAnalysis.numberUsage?.percentage}%</p>
              <p className="text-[10px] text-gray-500 mt-1">usan número</p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-base font-black text-violet-400 leading-none mt-1">
                {titleAnalysis.questionVsStatement?.bestPerforming === 'questions' ? 'Preguntas' : 'Afirmaciones'}
              </p>
              <p className="text-[10px] text-gray-500 mt-1">rinden más</p>
            </div>
          </div>
          {(titleAnalysis.mustHaveElements || []).length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Elementos clave en títulos virales</p>
              <div className="flex flex-wrap gap-1.5">
                {(titleAnalysis.mustHaveElements || []).map((e) => (
                  <span key={e} className="text-xs bg-gray-800 border border-gray-700 text-gray-300 px-2.5 py-1 rounded-lg">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Nuevas sugerencias de hook */}
      {(insights.newHookSuggestions || []).length > 0 && (
        <Card>
          <p className="text-white font-bold mb-4">Nuevas plantillas de hook sugeridas</p>
          <div className="space-y-2">
            {insights.newHookSuggestions.slice(0, 6).map((h, i) => (
              <div key={i} className="flex gap-3 items-start">
                <span className="text-violet-600 font-black text-sm shrink-0 mt-0.5">{i + 1}.</span>
                <p className="text-gray-300 text-sm leading-relaxed">"{h}"</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Mejoras al generador */}
      {insights.promptImprovements && (
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Mejoras aplicadas al generador de guiones
          </p>
          <p className="text-gray-300 text-sm leading-relaxed">{insights.promptImprovements}</p>
        </Card>
      )}

    </div>
  );
}
