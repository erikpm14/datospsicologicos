import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Eye, TrendingUp, Film, Zap, Play, Loader, Clock, ChevronRight, AlertCircle, Flame } from 'lucide-react';
import axios from 'axios';

const TOPIC_ES = {
  body_language:'Lenguaje corporal', cognitive_biases:'Sesgos cognitivos',
  relationships:'Relaciones',        workplace:'Trabajo',
  first_impressions:'1ª impresión',  social_skills:'Hab. sociales',
  habits:'Hábitos',                  communication:'Comunicación',
  emotions:'Emociones',              memory:'Memoria',
  motivation:'Motivación',           dark_psychology:'Psic. oscura',
  self_esteem:'Autoestima',
};

function useCountdown() {
  const [secs, setSecs] = useState(0);
  const [label, setLabel] = useState('');
  useEffect(() => {
    function calc() {
      const T = ['15:00','18:00','21:00'];
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const next = T.find(t => t > hhmm);
      const tgt = new Date(now);
      if (next) { const [h,m]=next.split(':'); tgt.setHours(+h,+m,0,0); setLabel(`Hoy · ${next}`); }
      else { tgt.setDate(tgt.getDate()+1); tgt.setHours(15,0,0,0); setLabel('Mañana · 15:00'); }
      setSecs(Math.max(0, Math.floor((tgt-now)/1000)));
    }
    calc(); const t=setInterval(calc,1000); return ()=>clearInterval(t);
  }, []);
  const h=String(Math.floor(secs/3600)).padStart(2,'0');
  const m=String(Math.floor((secs%3600)/60)).padStart(2,'0');
  const s=String(secs%60).padStart(2,'0');
  return { display:`${h}:${m}:${s}`, label };
}

function Stat({ label, value, sub, color='text-white' }) {
  return (
    <div className="bg-white/5 rounded-2xl p-4 flex flex-col gap-1">
      <p className="text-white/40 text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-black leading-none ${color}`}>{value}</p>
      {sub && <p className="text-white/30 text-[10px]">{sub}</p>}
    </div>
  );
}

export default function OverviewDashboard({ onNavigate }) {
  const { display, label } = useCountdown();
  const [analytics, setAnalytics] = useState(null);
  const [queue,     setQueue]     = useState(null);
  const [research,  setResearch]  = useState(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get('/api/analytics'),
      axios.get('/api/queue'),
      axios.get('/api/research/insights').catch(()=>({ data:{ data:null }})),
    ]).then(([a,q,r]) => {
      setAnalytics(a.data.data);
      setQueue(q.data.data);
      setResearch(r.data.data);
    }).finally(() => setLoading(false));

    const t = setInterval(() =>
      axios.get('/api/queue').then(r=>setQueue(r.data.data)).catch(()=>{}), 7000);
    return () => clearInterval(t);
  }, []);

  const kpis    = analytics?.kpis || {};
  const trend7  = analytics?.trend7 || [];
  const topVids = analytics?.topVideos || [];
  const topTopics = analytics?.topicPerformance?.slice(0,3) || [];

  // Chart data – últimos 7 días rellenos
  const chart = (() => {
    const map = {};
    trend7.forEach(d => { map[d.date]=d.views; });
    return Array.from({length:7},(_,i)=>{
      const d = new Date(Date.now()-(6-i)*86400000);
      const k = d.toISOString().split('T')[0];
      return { date:`${d.getMonth()+1}/${d.getDate()}`, views: map[k]||0 };
    });
  })();

  const hasData = (kpis.totalViews||0) > 0;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader size={28} className="animate-spin text-violet-500" />
    </div>
  );

  return (
    <div className="space-y-4">

      {/* HERO COUNTDOWN */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-violet-700 to-indigo-900 p-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.4),transparent_60%)]" />
        <div className="relative">
          <p className="text-violet-300 text-xs font-bold uppercase tracking-widest mb-1">Próximo vídeo automático</p>
          <p className="text-6xl font-black text-white font-mono tracking-tight leading-none">{display}</p>
          <p className="text-violet-300/80 text-sm mt-2 flex items-center gap-1.5 mb-5">
            <Clock size={12} />{label} · 3 vídeos/día
          </p>
          <div className="flex gap-2">
            <button onClick={()=>onNavigate('generate')}
              className="flex items-center gap-2 bg-white text-violet-900 font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-violet-50 active:scale-95 transition-all shadow-lg shadow-violet-900/40">
              <Play size={14} fill="currentColor"/>Generar ahora
            </button>
            <button onClick={()=>onNavigate('videos')}
              className="flex items-center gap-2 bg-white/10 border border-white/20 text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-white/20 active:scale-95 transition-all">
              <Film size={14}/>Mis vídeos
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Vídeos"       value={kpis.totalVideos??0}                            sub="publicados"          />
        <Stat label="Views totales" value={(kpis.totalViews||0).toLocaleString('es-ES')}  sub="acumulados" color="text-blue-400" />
        <Stat label="Engagement"   value={`${kpis.avgEngagement??0}%`}                    sub="likes + comentarios" color="text-emerald-400"/>
        <Stat label="Score medio"  value={kpis.avgScore??0}                               sub="potencial viral" color="text-amber-400"/>
      </div>

      {/* COLA */}
      {queue && (
        <div className="bg-white/5 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-white">Cola de producción</p>
            <button onClick={()=>onNavigate('generate')} className="text-violet-400 text-xs flex items-center gap-0.5 hover:text-violet-300">
              Gestionar <ChevronRight size={12}/>
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              {l:'Esperando', v:queue.waiting,   c:'text-white/60'},
              {l:'En curso',  v:queue.active,    c:'text-blue-400'},
              {l:'Listos',    v:queue.completed, c:'text-emerald-400'},
              {l:'Fallos',    v:queue.failed,    c:'text-red-400'},
            ].map(({l,v,c})=>(
              <div key={l} className="text-center">
                <p className={`text-2xl font-black ${c}`}>{v}</p>
                <p className="text-white/30 text-[10px] mt-0.5">{l}</p>
              </div>
            ))}
          </div>
          {queue.active>0 && (
            <div className="mt-3 flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2">
              <Loader size={13} className="animate-spin text-blue-400"/>
              <p className="text-blue-300 text-xs font-semibold">Generando vídeo (~2 min)</p>
            </div>
          )}
          {queue.failed>0 && (
            <div className="mt-2 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle size={13} className="text-red-400"/>
              <p className="text-red-300 text-xs font-semibold">{queue.failed} vídeo{queue.failed>1?'s':''} fallido{queue.failed>1?'s':''}</p>
            </div>
          )}
        </div>
      )}

      {/* TRENDING ESTA SEMANA */}
      {research?.insights && (
        <div className="bg-white/5 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Flame size={16} className="text-orange-400"/>
              <p className="text-sm font-bold text-white">Viral esta semana</p>
            </div>
            <button onClick={()=>onNavigate('viral')} className="text-violet-400 text-xs flex items-center gap-0.5 hover:text-violet-300">
              Ver todo <ChevronRight size={12}/>
            </button>
          </div>
          <div className="space-y-2">
            {(research.insights.topicsRanking||[]).slice(0,3).map((t,i)=>(
              <div key={i} className="flex items-center gap-3">
                <span className={`text-sm font-black w-5 text-center ${i===0?'text-orange-400':i===1?'text-amber-400':'text-white/40'}`}>{i+1}</span>
                <p className="text-sm text-white/80 flex-1">{TOPIC_ES[t.topic]||t.topic}</p>
                {t.avgViralityScore && <span className="text-xs font-bold text-emerald-400">{Math.round(t.avgViralityScore)}</span>}
              </div>
            ))}
          </div>
          {(research.insights.bestHookPatterns||[]).slice(0,1).map((p,i)=>(
            <div key={i} className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wide mb-1">Hook más efectivo</p>
              <p className="text-xs text-white/80 font-mono">"{p.template}"</p>
            </div>
          ))}
        </div>
      )}

      {/* TREND CHART */}
      <div className="bg-white/5 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-bold text-white">Views · últimos 7 días</p>
          {!hasData && <span className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full">Sin datos aún</span>}
        </div>
        <p className="text-white/30 text-xs mb-4">
          {hasData ? 'Visualizaciones diarias en YouTube' : 'Publica vídeos para ver estadísticas reales'}
        </p>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={chart} margin={{left:-30,right:0,top:4}}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#7c3aed" stopOpacity={0.4}/>
                <stop offset="100%" stopColor="#7c3aed" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill:'#ffffff30',fontSize:10}}/>
            <Tooltip
              contentStyle={{background:'#1a1a2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,fontSize:12}}
              labelStyle={{color:'#ffffff60'}}
              formatter={v=>[v.toLocaleString()+' views','']}
            />
            <Area type="monotone" dataKey="views" stroke="#7c3aed" strokeWidth={2}
              fill="url(#g1)" dot={false}
              activeDot={{r:4,fill:'#7c3aed',stroke:'#080810',strokeWidth:2}}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* TOP VÍDEOS */}
      {topVids.length>0 && (
        <div className="bg-white/5 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-white">Top vídeos</p>
            <button onClick={()=>onNavigate('videos')} className="text-violet-400 text-xs flex items-center gap-0.5 hover:text-violet-300">
              Ver todos <ChevronRight size={12}/>
            </button>
          </div>
          <div className="space-y-3">
            {topVids.slice(0,3).map((v,i)=>{
              const maxV = topVids[0]?.max_views||1;
              const pct  = Math.max(4, Math.round((v.max_views/maxV)*100));
              const scoreColor = (v.virality_score||0)>=80?'text-emerald-400':(v.virality_score||0)>=65?'text-amber-400':'text-red-400';
              return (
                <div key={v.id||i} className="flex items-center gap-3">
                  <span className="text-white/20 font-black text-lg w-5 text-center shrink-0">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate leading-tight">{v.hook||'Sin título'}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full" style={{width:`${pct}%`}}/>
                      </div>
                      <span className="text-white/40 text-[10px] tabular-nums">{(v.max_views||0).toLocaleString()}</span>
                    </div>
                  </div>
                  <span className={`text-xs font-black tabular-nums ${scoreColor}`}>{v.virality_score||0}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
