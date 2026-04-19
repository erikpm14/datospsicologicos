import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Loader, Eye, TrendingUp, Zap, Clock, ChevronDown, ChevronUp,
  ExternalLink, RefreshCw, Film, Youtube, CheckCircle, XCircle, Download, Play, X,
} from 'lucide-react';
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

const SCORE_COLOR = s =>
  !s ? '#6b7280' : s>=80 ? '#10b981' : s>=65 ? '#f59e0b' : '#ef4444';

function VideoPlayer({ videoId, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}>
      <div className="relative" onClick={e=>e.stopPropagation()}>
        <video
          src={`/api/videos/${videoId}/stream`}
          controls autoPlay playsInline
          className="rounded-2xl shadow-2xl"
          style={{ maxHeight:'90vh', maxWidth:'calc(90vh * 9/16)', width:'100%' }}
        />
        <button onClick={onClose}
          className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
          <X size={16}/>
        </button>
      </div>
    </div>
  );
}

function ScoreRing({ score }) {
  const color = SCORE_COLOR(score);
  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="19" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5"/>
        <circle cx="24" cy="24" r="19" fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${((score||0)/100)*119.4} 119.4`} strokeLinecap="round"/>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-black" style={{color}}>
        {score||'?'}
      </span>
    </div>
  );
}

function BreakdownBar({ label, val, max, color }) {
  const pct = Math.round((val/max)*100);
  const cls = pct>=80?'text-emerald-400':pct>=50?'text-amber-400':'text-red-400';
  return (
    <div className="flex items-center gap-2">
      <p className="text-[10px] text-white/40 w-20 shrink-0">{label}</p>
      <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{width:`${pct}%`}}/>
      </div>
      <p className={`text-[10px] font-bold tabular-nums w-8 text-right ${cls}`}>{val}<span className="text-white/20">/{max}</span></p>
    </div>
  );
}

function VideoCard({ v, rank, maxViews }) {
  const [open,    setOpen]    = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);
  const [playing, setPlaying] = useState(false);
  const viewPct = maxViews>0 ? Math.max(2, Math.round((v.max_views/maxViews)*100)) : 0;

  async function upload() {
    setBusy(true); setResult(null);
    try {
      const r = await axios.post('/api/videos/upload-youtube',{videoId:v.id});
      setResult({ok:true, url:r.data.data?.url});
    } catch(e) { setResult({ok:false,msg:e.response?.data?.error||e.message}); }
    finally { setBusy(false); }
  }

  const bd = v.viralityBreakdown;

  return (
    <>
    {playing && <VideoPlayer videoId={v.id} onClose={()=>setPlaying(false)}/>}
    <div className="bg-white/5 rounded-2xl overflow-hidden border border-white/5">
      {/* MAIN ROW */}
      <div className="flex items-center gap-3 p-4">
        <button onClick={()=>setPlaying(true)}
          className="relative shrink-0 w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center transition-colors active:scale-95 group">
          <Play size={18} fill="white" className="text-white ml-0.5"/>
          {/* score badge */}
          {v.virality_score>0 && (
            <span className="absolute -bottom-1 -right-1 text-[9px] font-black px-1 py-0.5 rounded-md"
              style={{background: v.virality_score>=80?'#10b981':v.virality_score>=65?'#f59e0b':'#ef4444', color:'white'}}>
              {v.virality_score}
            </span>
          )}
        </button>
        <button onClick={()=>setOpen(x=>!x)} className="flex-1 min-w-0 text-left">
          <p className="text-white text-sm font-semibold leading-snug line-clamp-2 mb-1.5">
            {v.hook||'Sin guión'}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {v.max_views>0 && (
              <span className="flex items-center gap-1 text-[11px] text-white/50">
                <Eye size={10}/>{v.max_views.toLocaleString('es-ES')}
              </span>
            )}
            {v.max_engagement>0 && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-400/70">
                <TrendingUp size={10}/>{v.max_engagement.toFixed(1)}%
              </span>
            )}
            {v.durationSeconds && (
              <span className="flex items-center gap-1 text-[11px] text-white/30">
                <Clock size={10}/>{v.durationSeconds}s
              </span>
            )}
            {v.topic && (
              <span className="text-[10px] bg-violet-500/15 text-violet-400 px-2 py-0.5 rounded-full font-medium">
                {TOPIC_ES[v.topic]||v.topic}
              </span>
            )}
          </div>
          {viewPct>0 && (
            <div className="mt-2 h-1 bg-white/8 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all" style={{width:`${viewPct}%`}}/>
            </div>
          )}
        </button>
        <span onClick={()=>setOpen(x=>!x)} className="text-white/20 shrink-0 cursor-pointer">
          {open?<ChevronUp size={16}/>:<ChevronDown size={16}/>}
        </span>
      </div>

      {/* EXPANDED */}
      {open && (
        <div className="border-t border-white/5 p-4 space-y-4">

          {/* Script sections */}
          {v.hook_text||v.claim||v.cta ? (
            <div className="space-y-2">
              {[
                {key:'hook_text', label:'HOOK',    color:'border-amber-500/60',   bg:'bg-amber-500/5',   text:'text-amber-200/90'},
                {key:'claim',     label:'CLAIM',   color:'border-blue-500/60',    bg:'bg-blue-500/5',    text:'text-blue-200/90'},
                {key:'cta',       label:'CTA',     color:'border-emerald-500/60', bg:'bg-emerald-500/5', text:'text-emerald-200/90'},
              ].map(({key,label,color,bg,text})=> v[key] && (
                <div key={key} className={`border-l-2 ${color} ${bg} pl-3 py-2 rounded-r-lg`}>
                  <p className="text-[9px] font-bold text-white/30 font-mono mb-0.5">{label}</p>
                  <p className={`text-xs leading-relaxed ${text}`}>{v[key]}</p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Score breakdown */}
          {bd && (
            <div>
              <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-2">Score breakdown</p>
              <div className="space-y-2">
                <BreakdownBar label="Hook"       val={bd.hookStrength||0}     max={30} color="bg-amber-500"/>
                <BreakdownBar label="Emocional"  val={bd.emotionalTrigger||0} max={25} color="bg-red-500"/>
                <BreakdownBar label="Relación"   val={bd.relatability||0}     max={20} color="bg-blue-500"/>
                <BreakdownBar label="Loop"       val={bd.loopPotential||0}    max={15} color="bg-violet-500"/>
                <BreakdownBar label="Duración"   val={bd.durationBonus||0}    max={10} color="bg-emerald-500"/>
              </div>
            </div>
          )}

          {v.psychologicalFact && (
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-3 py-2.5">
              <p className="text-violet-400 text-[10px] font-bold mb-1">Dato psicológico</p>
              <p className="text-white/70 text-xs italic">"{v.psychologicalFact}"</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            {v.youtube_id ? (
              <a href={`https://youtube.com/shorts/${v.youtube_id}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 bg-red-600/20 border border-red-500/30 text-red-400 text-xs font-semibold px-3 py-2 rounded-xl hover:bg-red-600/30 transition-colors">
                <ExternalLink size={12}/>Ver en YouTube
              </a>
            ) : (
              <button onClick={upload} disabled={busy}
                className="flex items-center gap-1.5 bg-red-600/20 border border-red-500/30 text-red-400 text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-50 hover:bg-red-600/30 active:scale-95 transition-all">
                {busy ? <Loader size={12} className="animate-spin"/> : <Youtube size={12}/>}
                {busy?'Subiendo...':'Subir a YouTube'}
              </button>
            )}
          </div>

          {result && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl ${result.ok?'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300':'bg-red-500/10 border border-red-500/20 text-red-300'}`}>
              {result.ok ? <CheckCircle size={12}/> : <XCircle size={12}/>}
              {result.ok ? <>¡Subido! {result.url&&<a href={result.url} target="_blank" rel="noreferrer" className="underline ml-1">{result.url}</a>}</> : `Error: ${result.msg}`}
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}

// ── Stats summary cards ──────────────────────────────────────────────────────

function MiniStat({ label, value, color='text-white' }) {
  return (
    <div className="bg-white/5 rounded-xl p-3 text-center">
      <p className={`text-xl font-black ${color}`}>{value}</p>
      <p className="text-white/30 text-[10px] mt-0.5">{label}</p>
    </div>
  );
}

// ── Topic performance bar chart ──────────────────────────────────────────────

function TopicChart({ data }) {
  if (!data?.length) return null;
  const top = data.slice(0,6).map(d=>({
    topic: TOPIC_ES[d.topic]||d.topic,
    views: d.avgViews,
    score: d.avgScore,
  }));
  return (
    <div className="bg-white/5 rounded-2xl p-4">
      <p className="text-sm font-bold text-white mb-1">Avg views por tema</p>
      <p className="text-white/30 text-xs mb-4">Rendimiento promedio de cada categoría</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={top} layout="vertical" margin={{left:80,right:20,top:0,bottom:0}}>
          <XAxis type="number" hide/>
          <YAxis type="category" dataKey="topic" axisLine={false} tickLine={false}
            tick={{fill:'rgba(255,255,255,0.5)',fontSize:11}} width={80}/>
          <Tooltip
            contentStyle={{background:'#1a1a2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,fontSize:11}}
            formatter={v=>[v.toLocaleString()+' avg views','']}
          />
          <Bar dataKey="views" radius={[0,6,6,0]}>
            {top.map((_,i)=><Cell key={i} fill={i===0?'#7c3aed':i===1?'#6d28d9':'#4c1d95'}/>)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

export default function VideoStats() {
  const [analytics, setAnalytics] = useState(null);
  const [localVids, setLocalVids] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [sort,      setSort]      = useState('score'); // score | views | engagement
  const [view,      setView]      = useState('all');   // all | published | local
  const [syncing,   setSyncing]   = useState(false);
  const [syncMsg,   setSyncMsg]   = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [a, lv] = await Promise.all([
        axios.get('/api/analytics'),
        axios.get('/api/videos/local'),
      ]);
      setAnalytics(a.data.data);
      setLocalVids(lv.data.data||[]);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  const syncYouTube = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await axios.post('/api/youtube/sync');
      setSyncMsg({ ok: true, text: r.data.data?.message || 'Sincronizado' });
      await load();
    } catch(e) {
      setSyncMsg({ ok: false, text: e.response?.data?.error || e.message });
    } finally { setSyncing(false); }
  };

  useEffect(()=>{ load(); },[]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader size={28} className="animate-spin text-violet-500"/>
    </div>
  );

  const kpis     = analytics?.kpis||{};
  const allVids  = analytics?.allVideos||[];
  const topicPerf= analytics?.topicPerformance||[];

  // Merge DB videos con local videos para mostrar script
  const localMap = {};
  localVids.forEach(lv=>{ localMap[lv.id]=lv.script; });

  const enriched = allVids.map(v=>({
    ...v,
    hook_text: v.hook_text || localMap[v.id]?.hook || v.hook,
    claim:     v.claim     || localMap[v.id]?.claim,
    cta:       v.cta       || localMap[v.id]?.cta,
    psychologicalFact: v.psychologicalFact || localMap[v.id]?.psychologicalFact,
    viralityBreakdown: v.viralityBreakdown || localMap[v.id]?.viralityBreakdown,
    durationSeconds:   v.durationSeconds   || localMap[v.id]?.durationSeconds,
  }));

  // Also include local-only videos (not yet in DB)
  const dbIds = new Set(allVids.map(v=>v.id));
  const localOnly = localVids.filter(lv=>!dbIds.has(lv.id)).map(lv=>({
    id: lv.id,
    hook: lv.script?.hook||'Sin guión',
    hook_text: lv.script?.hook,
    claim: lv.script?.claim,
    cta: lv.script?.cta,
    topic: lv.script?.topic,
    virality_score: lv.script?.viralityScore,
    durationSeconds: lv.script?.durationSeconds,
    viralityBreakdown: lv.script?.viralityBreakdown,
    psychologicalFact: lv.script?.psychologicalFact,
    max_views: 0, max_engagement: 0, max_likes: 0, max_comments: 0,
  }));

  const combined = [...enriched, ...localOnly];

  const sorted = [...combined].sort((a,b)=>{
    if (sort==='views')      return (b.max_views||0)-(a.max_views||0);
    if (sort==='engagement') return (b.max_engagement||0)-(a.max_engagement||0);
    return (b.virality_score||0)-(a.virality_score||0);
  });

  const maxViews = Math.max(...combined.map(v=>v.max_views||0), 1);
  const totalEng = combined.length ? (combined.reduce((s,v)=>s+(v.max_engagement||0),0)/combined.length).toFixed(1) : 0;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-white">Mis vídeos</h2>
          <p className="text-white/30 text-xs mt-0.5">{combined.length} vídeos en total</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncYouTube} disabled={syncing}
            className="flex items-center gap-1.5 bg-red-600/15 hover:bg-red-600/25 border border-red-500/20 text-red-400 text-xs px-3 py-2 rounded-xl disabled:opacity-50 transition-colors">
            {syncing ? <Loader size={12} className="animate-spin"/> : <Download size={12}/>}
            {syncing ? 'Sincronizando...' : 'Sync YouTube'}
          </button>
          <button onClick={load} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/50 text-xs px-3 py-2 rounded-xl transition-colors">
            <RefreshCw size={12} className={loading?'animate-spin':''}/> Actualizar
          </button>
        </div>
      </div>
      {syncMsg && (
        <div className={`flex items-center gap-2 text-xs px-4 py-3 rounded-xl border ${syncMsg.ok?'bg-emerald-500/10 border-emerald-500/20 text-emerald-300':'bg-red-500/10 border-red-500/20 text-red-300'}`}>
          {syncMsg.ok ? <CheckCircle size={13}/> : <XCircle size={13}/>}
          {syncMsg.text}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Total views"   value={(kpis.totalViews||0).toLocaleString('es-ES')} color="text-blue-400"/>
        <MiniStat label="Eng. medio"    value={`${totalEng}%`} color="text-emerald-400"/>
        <MiniStat label="Score medio"   value={kpis.avgScore||0} color="text-amber-400"/>
      </div>

      {/* Topic performance chart */}
      {topicPerf.length>0 && <TopicChart data={topicPerf}/>}

      {/* Sort controls */}
      <div className="flex items-center gap-2">
        <p className="text-white/30 text-xs mr-1">Ordenar:</p>
        {[{k:'score',l:'Score'},{k:'views',l:'Views'},{k:'engagement',l:'Engagement'}].map(({k,l})=>(
          <button key={k} onClick={()=>setSort(k)}
            className={`text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors ${sort===k?'bg-violet-600 text-white':'bg-white/5 text-white/40 hover:text-white/60'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Video list */}
      {sorted.length===0 ? (
        <div className="bg-white/5 rounded-2xl p-12 text-center border border-dashed border-white/10">
          <Film size={40} className="mx-auto mb-3 text-white/10"/>
          <p className="text-white/40 text-sm">Sin vídeos todavía</p>
          <p className="text-white/20 text-xs mt-1">Genera tu primer vídeo en la pestaña Generar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((v,i)=><VideoCard key={v.id||i} v={v} rank={i+1} maxViews={maxViews}/>)}
        </div>
      )}

    </div>
  );
}
