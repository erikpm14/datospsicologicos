import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  Flame, Zap, TrendingUp, Clock, AlertTriangle, Loader,
  RefreshCw, BookOpen, CheckCircle, Target, Sparkles,
} from 'lucide-react';

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

function Section({ title, icon: Icon, iconColor='text-violet-400', children }) {
  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={16} className={iconColor}/>
        <p className="text-sm font-bold text-white">{title}</p>
      </div>
      {children}
    </div>
  );
}

export default function ViralInsights() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [ok,      setOk]      = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/research/insights')
      .then(r=>r.json())
      .then(j=>{ setData(j.data); setLoading(false); })
      .catch(()=>setLoading(false));
  };

  useEffect(()=>{ load(); },[]);

  const trigger = () => {
    setRunning(true); setOk(false);
    fetch('/api/research/run',{method:'POST'})
      .then(()=>{ setOk(true); setRunning(false); setTimeout(load,120000); })
      .catch(()=>setRunning(false));
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader size={28} className="animate-spin text-violet-500"/>
    </div>
  );

  if (!data) return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-black text-white">Viral esta semana</h2>
        <p className="text-white/30 text-xs mt-0.5">Análisis de tendencias en YouTube Shorts</p>
      </div>
      <div className="bg-white/5 rounded-2xl p-8 text-center border border-dashed border-white/10">
        <BookOpen size={40} className="mx-auto mb-4 text-white/15"/>
        <p className="text-white font-bold mb-2">Sin datos de investigación</p>
        <p className="text-white/30 text-sm mb-6 max-w-xs mx-auto leading-relaxed">
          Lanza la investigación para analizar los vídeos más virales de IA y automatización en YouTube
        </p>
        <button onClick={trigger} disabled={running}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm px-6 py-3 rounded-xl disabled:opacity-50 active:scale-95 transition-all">
          {running ? <Loader size={14} className="animate-spin"/> : <TrendingUp size={14}/>}
          {running ? 'Analizando YouTube (~2 min)...' : 'Lanzar investigación'}
        </button>
        {ok && <p className="text-emerald-400 text-sm mt-3 flex items-center justify-center gap-1.5"><CheckCircle size={13}/>En proceso, recarga en 2 min</p>}
        <div className="mt-6 bg-black/30 rounded-xl p-4 text-left font-mono text-xs text-emerald-400/70 max-w-xs mx-auto space-y-1">
          <p className="text-white/20"># O manualmente:</p>
          <p>node scripts/viral-research.js</p>
          <p>node scripts/analyze-patterns.js</p>
        </div>
      </div>
    </div>
  );

  const { insights, titleAnalysis, generatedAt } = data;
  const ageHours = Math.round((Date.now()-new Date(generatedAt).getTime())/3600000);
  const ageTxt = ageHours<24 ? `Hace ${ageHours}h` : `Hace ${Math.round(ageHours/24)} días`;

  // Prepare topic ranking chart
  const topicChart = (insights.topicsRanking||[]).slice(0,6).map((t,i)=>({
    topic: TOPIC_ES[t.topic]||t.topic,
    score: t.avgViralityScore ? Math.round(t.avgViralityScore) : (6-i)*12+20,
  }));

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Flame size={20} className="text-orange-400"/> Viral esta semana
          </h2>
          <p className="text-white/30 text-xs mt-0.5">{ageTxt} · datos reales de YouTube</p>
        </div>
        <button onClick={trigger} disabled={running}
          className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/40 text-xs px-3 py-2 rounded-xl disabled:opacity-50 transition-colors">
          <RefreshCw size={12} className={running?'animate-spin':''}/>
          {running?'Analizando...':'Actualizar'}
        </button>
      </div>

      {ok && (
        <div className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3">
          <Loader size={13} className="animate-spin text-violet-400"/>
          <p className="text-violet-300 text-xs">Investigación en proceso, se actualizará automáticamente...</p>
        </div>
      )}

      {/* Hallazgos clave */}
      {(insights.keyFindings||[]).length>0 && (
        <Section title="Hallazgos clave" icon={TrendingUp} iconColor="text-violet-400">
          <ul className="space-y-2">
            {(insights.keyFindings||[]).map((f,i)=>(
              <li key={i} className="flex gap-2.5 text-sm">
                <span className="text-violet-500 shrink-0 mt-0.5 font-black">·</span>
                <span className="text-white/70 leading-relaxed">{f}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Topics ranking */}
      {topicChart.length>0 && (
        <Section title="Temas con más potencial viral" icon={Target} iconColor="text-orange-400">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={topicChart} layout="vertical" margin={{left:90,right:16,top:0,bottom:0}}>
              <XAxis type="number" hide/>
              <YAxis type="category" dataKey="topic" axisLine={false} tickLine={false}
                tick={{fill:'rgba(255,255,255,0.45)',fontSize:11}} width={90}/>
              <Tooltip
                contentStyle={{background:'#1a1a2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,fontSize:11}}
                formatter={v=>[`Score ${v}`,'']}
              />
              <Bar dataKey="score" radius={[0,6,6,0]}>
                {topicChart.map((_,i)=><Cell key={i} fill={
                  i===0?'#f97316':i===1?'#f59e0b':i===2?'#eab308':'#7c3aed'
                }/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Hook patterns */}
      {(insights.bestHookPatterns||[]).length>0 && (
        <Section title="Patrones de hook más efectivos" icon={Zap} iconColor="text-amber-400">
          <div className="space-y-3">
            {(insights.bestHookPatterns||[]).map((p,i)=>(
              <div key={i} className="bg-black/20 rounded-xl p-3 border border-white/5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] bg-amber-500/20 border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded font-mono font-bold">
                    {p.pattern}
                  </span>
                  <p className="text-[10px] text-white/30 flex-1 leading-tight">{p.explanation}</p>
                </div>
                <p className="text-sm text-white/80 font-mono bg-white/5 rounded-lg px-3 py-2">
                  "{p.template}"
                </p>
                {p.example && <p className="text-[10px] text-white/25 mt-1.5 italic">Ej: "{p.example}"</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Power words + avoid */}
      <div className="grid grid-cols-2 gap-3">
        {(insights.powerWords||[]).length>0 && (
          <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-3">Palabras clave</p>
            <div className="flex flex-wrap gap-1.5">
              {(insights.powerWords||[]).map(w=>(
                <span key={w} className="text-[10px] bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 px-2 py-1 rounded-lg font-medium">
                  {w}
                </span>
              ))}
            </div>
          </div>
        )}
        {(insights.wordsToAvoid||[]).length>0 && (
          <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
            <div className="flex items-center gap-1.5 mb-3">
              <AlertTriangle size={11} className="text-red-400"/>
              <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider">A evitar</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(insights.wordsToAvoid||[]).map(w=>(
                <span key={w} className="text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-1 rounded-lg line-through">
                  {w}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Duración óptima */}
      {insights.optimalDuration && (
        <Section title="Duración óptima" icon={Clock} iconColor="text-blue-400">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-2xl bg-blue-500/15 border border-blue-500/20 flex flex-col items-center justify-center shrink-0">
              <p className="text-3xl font-black text-blue-400">{insights.optimalDuration.seconds}</p>
              <p className="text-[10px] text-blue-400/60">segundos</p>
            </div>
            <p className="text-sm text-white/60 leading-relaxed">{insights.optimalDuration.reasoning}</p>
          </div>
        </Section>
      )}

      {/* Nuevas sugerencias de hook */}
      {(insights.newHookSuggestions||[]).length>0 && (
        <Section title="Nuevos hooks sugeridos por IA" icon={Sparkles} iconColor="text-violet-400">
          <div className="space-y-2">
            {(insights.newHookSuggestions||[]).slice(0,6).map((h,i)=>(
              <div key={i} className="flex gap-2.5">
                <span className="text-violet-600 font-black text-sm shrink-0 w-4">{i+1}.</span>
                <p className="text-sm text-white/70 leading-relaxed">"{h}"</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Title analysis */}
      {titleAnalysis && (
        <Section title="Anatomía del título viral" icon={Target} iconColor="text-violet-400">
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-black/20 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-white">{titleAnalysis.avgTitleLength?.words}</p>
              <p className="text-white/30 text-[10px] mt-0.5">palabras</p>
            </div>
            <div className="bg-black/20 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-amber-400">{titleAnalysis.numberUsage?.percentage}%</p>
              <p className="text-white/30 text-[10px] mt-0.5">usan número</p>
            </div>
            <div className="bg-black/20 rounded-xl p-3 text-center">
              <p className="text-sm font-black text-violet-400 leading-tight mt-1">
                {titleAnalysis.questionVsStatement?.bestPerforming==='questions'?'Preguntas':'Afirm.'}
              </p>
              <p className="text-white/30 text-[10px] mt-0.5">rinden más</p>
            </div>
          </div>
          {(titleAnalysis.mustHaveElements||[]).length>0 && (
            <div>
              <p className="text-[10px] text-white/30 mb-2">Elementos obligatorios</p>
              <div className="flex flex-wrap gap-1.5">
                {(titleAnalysis.mustHaveElements||[]).map(e=>(
                  <span key={e} className="text-[10px] bg-white/5 border border-white/10 text-white/60 px-2.5 py-1 rounded-lg">{e}</span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

    </div>
  );
}
