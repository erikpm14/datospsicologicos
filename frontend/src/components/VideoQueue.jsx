import { useEffect, useState } from 'react';
import {
  Plus, RefreshCw, CheckCircle, XCircle, Loader, Layers,
  ChevronDown, Sparkles, Clock, Zap, Youtube,
  ChevronUp, Film, BookOpen, Cherry, Play, X, Heart,
} from 'lucide-react';
import axios from 'axios';

const TOPICS = [
  { value:'',                  label:'Auto-selección',       emoji:'🎲' },
  { value:'dark_psychology',   label:'Psicología oscura',    emoji:'🌑' },
  { value:'relationships',     label:'Relaciones tóxicas',   emoji:'💔' },
  { value:'emotions',          label:'Emociones',            emoji:'🧠' },
  { value:'cognitive_biases',  label:'Sesgos cognitivos',    emoji:'🔀' },
  { value:'body_language',     label:'Lenguaje corporal',    emoji:'👁' },
  { value:'self_esteem',       label:'Autoestima',           emoji:'💪' },
  { value:'motivation',        label:'Motivación',           emoji:'⚡' },
  { value:'memory',            label:'Memoria',              emoji:'💾' },
  { value:'social_skills',     label:'Hab. sociales',        emoji:'🤝' },
  { value:'workplace',         label:'Trabajo',              emoji:'💼' },
  { value:'first_impressions', label:'Primera impresión',    emoji:'👋' },
  { value:'habits',            label:'Hábitos',              emoji:'📅' },
  { value:'communication',     label:'Comunicación',         emoji:'💬' },
];

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

function Card({ children, className='' }) {
  return <div className={`bg-white/5 rounded-2xl p-4 border border-white/5 ${className}`}>{children}</div>;
}

function ScoreRing({ score }) {
  const color = !score?'#6b7280':score>=80?'#10b981':score>=65?'#f59e0b':'#ef4444';
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

function LocalVideoCard({ v }) {
  const [open,     setOpen]     = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [res,      setRes]      = useState(null);
  const [playing,  setPlaying]  = useState(false);
  const s = v.script||{};

  async function upload() {
    setBusy(true); setRes(null);
    try {
      const r = await axios.post('/api/videos/upload-youtube',{videoId:v.id});
      setRes({ok:true, url:r.data.data?.url});
    } catch(e) { setRes({ok:false, msg:e.response?.data?.error||e.message}); }
    finally { setBusy(false); }
  }

  return (
    <>
    {playing && <VideoPlayer videoId={v.id} onClose={()=>setPlaying(false)}/>}
    <div className="bg-black/20 rounded-xl border border-white/5 overflow-hidden">
      <div className="flex items-center gap-3 p-3.5">
        {/* Play button */}
        <button onClick={()=>setPlaying(true)}
          className="relative shrink-0 w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center transition-colors active:scale-95">
          <Play size={18} fill="white" className="text-white ml-0.5"/>
          {s.viralityScore>0 && (
            <span className="absolute -bottom-1 -right-1 text-[9px] font-black px-1 py-0.5 rounded-md"
              style={{background: s.viralityScore>=80?'#10b981':s.viralityScore>=65?'#f59e0b':'#ef4444', color:'white'}}>
              {s.viralityScore}
            </span>
          )}
        </button>
        <button onClick={()=>setOpen(x=>!x)} className="flex-1 min-w-0 text-left">
          <p className="text-sm text-white font-medium line-clamp-2 leading-snug">{s.hook||'Sin guión'}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {s.isSeries && (
              <span className="text-[10px] bg-amber-500/15 border border-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">
                SERIE P{s.part}/{s.totalParts}
              </span>
            )}
            {s.topic     && <span className="text-[10px] text-violet-400">{s.topic}</span>}
            {s.durationSeconds && <span className="text-[10px] text-white/30 flex items-center gap-0.5"><Clock size={8}/>{s.durationSeconds}s</span>}
          </div>
        </button>
        <span className="text-white/20 cursor-pointer" onClick={()=>setOpen(x=>!x)}>{open?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</span>
      </div>

      {open && (
        <div className="border-t border-white/5 p-3.5 space-y-2.5">
          {[
            {key:'hook',        label:'HOOK',  c:'border-amber-500/50',   t:'text-amber-200/80'},
            {key:'claim',       label:'CLAIM', c:'border-blue-500/50',    t:'text-blue-200/80'},
            {key:'explanation', label:'EXPL.', c:'border-white/20',       t:'text-white/60'},
            {key:'cta',         label:'CTA',   c:'border-emerald-500/50', t:'text-emerald-200/80'},
          ].map(({key,label,c,t})=> s[key] && (
            <div key={key} className={`border-l-2 ${c} pl-3 py-1.5`}>
              <p className="text-[9px] font-bold text-white/25 font-mono">{label}</p>
              <p className={`text-xs leading-relaxed ${t}`}>{s[key]}</p>
            </div>
          ))}
          {s.psychologicalFact && (
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2">
              <p className="text-violet-400 text-[10px] font-bold mb-0.5">Dato psicológico</p>
              <p className="text-white/60 text-xs italic">"{s.psychologicalFact}"</p>
            </div>
          )}
          <button onClick={upload} disabled={busy}
            className="flex items-center gap-2 bg-red-600/20 border border-red-500/30 text-red-400 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 active:scale-95 transition-all">
            {busy?<Loader size={11} className="animate-spin"/>:<Youtube size={11}/>}
            {busy?'Subiendo...':'Subir a YouTube'}
          </button>
          {res && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${res.ok?'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300':'bg-red-500/10 border border-red-500/20 text-red-300'}`}>
              {res.ok?<CheckCircle size={11}/>:<XCircle size={11}/>}
              {res.ok?<>¡Subido! {res.url&&<a href={res.url} target="_blank" rel="noreferrer" className="underline ml-1">{res.url}</a>}</>:`Error: ${res.msg}`}
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}

export default function VideoQueue() {
  const [queue,      setQueue]      = useState({waiting:0,active:0,completed:0,failed:0});
  const [topic,      setTopic]      = useState('');
  const [busy,       setBusy]       = useState(false);
  const [msg,        setMsg]        = useState(null);
  const [preview,    setPreview]    = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [videos,     setVideos]     = useState([]);
  const [loadVid,    setLoadVid]    = useState(true);
  const [mode,       setMode]       = useState('single');   // 'single' | 'series' | 'fruit'
  const [seriesParts,setSeriesParts]= useState(3);
  const [satisfying, setSatisfying] = useState(false);
  const [fruitPairs, setFruitPairs] = useState([]);
  const [fruitThemes,setFruitThemes]= useState([]);
  const [fruitPair,  setFruitPair]  = useState('');
  const [fruitTheme, setFruitTheme] = useState('');

  const fetchQ = () => axios.get('/api/queue').then(r=>setQueue(r.data.data)).catch(()=>{});
  const fetchV = () => {
    setLoadVid(true);
    axios.get('/api/videos/local').then(r=>setVideos(r.data.data||[])).catch(()=>{}).finally(()=>setLoadVid(false));
  };

  useEffect(()=>{
    fetchQ(); fetchV();
    // Cargar opciones de fruit drama
    axios.get('/api/videos/fruit-drama/options').then(r=>{
      setFruitPairs(r.data.data.pairs||[]);
      setFruitThemes(r.data.data.themes||[]);
    }).catch(()=>{});
    const t=setInterval(fetchQ,6000);
    return ()=>clearInterval(t);
  },[]);

  const flash = (type,text) => { setMsg({type,text}); setTimeout(()=>setMsg(null),8000); };
  const bgStyle = satisfying ? 'satisfying' : undefined;

  const generate = async () => {
    setBusy(true);
    try {
      await axios.post('/api/videos/generate',{topic:topic||null, bgStyle});
      flash('ok','¡Añadido a la cola! Se generará en 2–3 min.');
      fetchQ();
    } catch(e) { flash('err',e.response?.data?.error||e.message); }
    finally { setBusy(false); }
  };

  const generateFruitDrama = async () => {
    setBusy(true);
    try {
      const body = {};
      if (fruitPair !== '')  body.pairIndex = parseInt(fruitPair);
      if (fruitTheme !== '') body.themeId   = fruitTheme;
      await axios.post('/api/videos/fruit-drama', body);
      flash('ok','🍓 Fruit Drama en cola! (~3 min)');
      fetchQ();
    } catch(e) { flash('err',e.response?.data?.error||e.message); }
    finally { setBusy(false); }
  };

  const generateSeries = async () => {
    setBusy(true);
    try {
      const r = await axios.post('/api/videos/series',{topic:topic||null, parts:seriesParts, bgStyle});
      flash('ok', `Serie "${r.data.data.seriesTitle}" — ${seriesParts} vídeos en cola 🔥`);
      fetchQ();
    } catch(e) { flash('err',e.response?.data?.error||e.message); }
    finally { setBusy(false); }
  };

  const batch = async () => {
    setBusy(true);
    try {
      const r=await axios.post('/api/videos/batch',{count:3});
      flash('ok',`${r.data.data.jobIds.length} vídeos en cola.`);
      fetchQ();
    } catch(e) { flash('err',e.response?.data?.error||e.message); }
    finally { setBusy(false); }
  };

  const getPreview = async () => {
    setPreviewing(true); setPreview(null);
    try { const r=await axios.post('/api/scripts/preview',{topic:topic||null}); setPreview(r.data.data); }
    catch(e) { flash('err',e.message); }
    finally { setPreviewing(false); }
  };

  const scoreColor = s => !s?'text-white/40':s>=80?'text-emerald-400':s>=65?'text-amber-400':'text-red-400';
  const sel = TOPICS.find(t=>t.value===topic);

  return (
    <div className="space-y-4">

      {/* Cola status */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-white">Cola de producción</p>
          <button onClick={fetchQ} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 transition-colors"><RefreshCw size={13}/></button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            {l:'Esperando',v:queue.waiting,   c:'text-white/60'},
            {l:'En curso', v:queue.active,    c:'text-blue-400'},
            {l:'Listos',   v:queue.completed, c:'text-emerald-400'},
            {l:'Fallidos', v:queue.failed,    c:'text-red-400'},
          ].map(({l,v,c})=>(
            <div key={l} className="text-center bg-black/20 rounded-xl py-2.5">
              <p className={`text-2xl font-black ${c}`}>{v}</p>
              <p className="text-white/25 text-[10px] mt-0.5">{l}</p>
            </div>
          ))}
        </div>
        {queue.active>0 && (
          <div className="mt-3 flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2.5">
            <Loader size={13} className="animate-spin text-blue-400"/>
            <p className="text-blue-300 text-xs font-semibold">Generando vídeo... (~2 min)</p>
          </div>
        )}
      </Card>

      {/* Modo de generación */}
      <Card>
        <p className="text-sm font-bold text-white mb-3">Generar contenido</p>

        {/* Selector de modo */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <button onClick={()=>setMode('single')}
            className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl text-xs font-semibold border transition-all ${mode==='single'?'bg-violet-600 border-violet-500 text-white':'bg-white/5 border-white/10 text-white/40 hover:text-white/60'}`}>
            <Film size={16}/>Vídeo solo
          </button>
          <button onClick={()=>setMode('series')}
            className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl text-xs font-semibold border transition-all ${mode==='series'?'bg-amber-600 border-amber-500 text-white':'bg-white/5 border-white/10 text-white/40 hover:text-white/60'}`}>
            <BookOpen size={16}/>Serie
          </button>
          <button onClick={()=>setMode('fruit')}
            className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl text-xs font-semibold border transition-all ${mode==='fruit'?'bg-pink-600 border-pink-500 text-white':'bg-white/5 border-white/10 text-white/40 hover:text-white/60'}`}>
            <Heart size={16}/>Fruta Drama
          </button>
        </div>

        {/* Tema */}
        <div className="mb-3">
          <label className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-2">Tema</label>
          <div className="relative">
            <select value={topic} onChange={e=>setTopic(e.target.value)}
              className="w-full appearance-none bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm pr-10 focus:outline-none focus:border-violet-500 transition-colors cursor-pointer">
              {TOPICS.map(t=><option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"/>
          </div>
        </div>

        {/* Número de partes (solo en modo serie) */}
        {mode==='series' && (
          <div className="mb-3">
            <label className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-2">Número de partes</label>
            <div className="flex gap-2">
              {[2,3,4,5].map(n=>(
                <button key={n} onClick={()=>setSeriesParts(n)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${seriesParts===n?'bg-amber-600 border-amber-500 text-white':'bg-white/5 border-white/10 text-white/40 hover:text-white/60'}`}>
                  {n}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/25 mt-2">Cada parte termina con "Parte {seriesParts > 1 ? 'X' : 2} en mi perfil →" — fuerza visitas al canal</p>
          </div>
        )}

        {/* Toggle fondo satisfying — solo en modos no-fruit */}
        {mode !== 'fruit' && <button onClick={()=>setSatisfying(x=>!x)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold transition-all mb-4 ${satisfying?'bg-pink-500/10 border-pink-500/30 text-pink-300':'bg-white/5 border-white/10 text-white/40 hover:text-white/60'}`}>
          <Cherry size={16} className={satisfying?'text-pink-400':'text-white/30'}/>
          <div className="text-left flex-1">
            <p className={satisfying?'text-pink-300':'text-white/50'}>Fondo satisfying {satisfying&&'✓'}</p>
            <p className="text-[10px] text-white/25 font-normal">Frutas, ASMR, cutting — retención x2</p>
          </div>
          <div className={`w-10 h-5 rounded-full transition-all relative ${satisfying?'bg-pink-500':'bg-white/10'}`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${satisfying?'left-5':'left-0.5'}`}/>
          </div>
        </button>}

        {/* Botones de acción */}
        {mode==='fruit' ? (
          <div className="space-y-3">
            {/* Stats virales */}
            <div className="bg-pink-500/8 border border-pink-500/20 rounded-xl p-3">
              <p className="text-pink-300 text-xs font-bold mb-1">🍓 Por qué funciona</p>
              <p className="text-white/40 text-[10px] leading-relaxed">300M vistas en 15 días en TikTok. Frutas con drama humano = retención máxima. Compresión emocional + absurdo = viral garantizado.</p>
            </div>
            {/* Selector pareja */}
            <div>
              <label className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-2">Pareja de frutas</label>
              <div className="relative">
                <select value={fruitPair} onChange={e=>setFruitPair(e.target.value)}
                  className="w-full appearance-none bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm pr-10 focus:outline-none focus:border-pink-500 transition-colors cursor-pointer">
                  <option value=''>🎲 Aleatoria</option>
                  {fruitPairs.map(p=>(
                    <option key={p.index} value={p.index}>🍓 {p.a} y {p.b}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"/>
              </div>
            </div>
            {/* Selector drama */}
            <div>
              <label className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-2">Tipo de drama</label>
              <div className="relative">
                <select value={fruitTheme} onChange={e=>setFruitTheme(e.target.value)}
                  className="w-full appearance-none bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm pr-10 focus:outline-none focus:border-pink-500 transition-colors cursor-pointer">
                  <option value=''>💔 Aleatorio</option>
                  {fruitThemes.map(t=>(
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"/>
              </div>
            </div>
            <button onClick={generateFruitDrama} disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-sm font-bold disabled:opacity-40 active:scale-95 transition-all">
              {busy?<Loader size={14} className="animate-spin"/>:<Heart size={14} fill="white"/>}
              {busy?'Generando drama...':'Generar Fruit Drama'}
            </button>
            <p className="text-[10px] text-white/20 text-center">~3 min · escenas individuales con Ken Burns</p>
          </div>
        ) : mode==='single' ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={getPreview} disabled={previewing||busy}
                className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-semibold disabled:opacity-40 active:scale-95 transition-all">
                {previewing?<Loader size={14} className="animate-spin"/>:<Sparkles size={14}/>}
                Ver guión
              </button>
              <button onClick={generate} disabled={busy}
                className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-40 active:scale-95 transition-all">
                {busy?<Loader size={14} className="animate-spin"/>:<Plus size={14}/>}
                Generar
              </button>
            </div>
            <button onClick={batch} disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-violet-500/20 text-violet-400 text-sm font-semibold disabled:opacity-40 active:scale-95 transition-all">
              <Layers size={14}/>Lote de 3 vídeos
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button onClick={generateSeries} disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold disabled:opacity-40 active:scale-95 transition-all">
              {busy?<Loader size={14} className="animate-spin"/>:<BookOpen size={14}/>}
              {busy?'Generando serie...`':`Generar serie de ${seriesParts} partes`}
            </button>
            <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3 space-y-1">
              {Array.from({length:seriesParts},(_,i)=>(
                <div key={i} className="flex items-center gap-2 text-xs text-white/50">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${i===seriesParts-1?'bg-violet-600 text-white':'bg-amber-500/20 text-amber-400'}`}>{i+1}</span>
                  <span>{i===0?'Introduce el concepto, hook fuerte':i===seriesParts-1?'Conclusión + CTA seguir perfil':`Continúa → "Parte ${i+2} en mi perfil →"`}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {msg && (
          <div className={`mt-3 flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm ${msg.type==='ok'?'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300':'bg-red-500/10 border border-red-500/20 text-red-300'}`}>
            {msg.type==='ok'?<CheckCircle size={14}/>:<XCircle size={14}/>}
            {msg.text}
          </div>
        )}
      </Card>

      {/* Preview guión */}
      {(previewing||preview) && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-bold text-white">Preview del guión</p>
              <p className="text-white/30 text-xs">{sel?`${sel.emoji} ${sel.label}`:'🎲 Auto'}</p>
            </div>
            {preview && (
              <div className="text-right">
                <p className={`text-4xl font-black ${scoreColor(preview.viralityScore)}`}>{preview.viralityScore}</p>
                <p className="text-white/20 text-[10px]">/ 100</p>
              </div>
            )}
          </div>
          {previewing ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader size={22} className="animate-spin text-violet-400"/>
              <p className="text-white/40 text-sm">Claude generando guión...</p>
            </div>
          ) : preview && (
            <>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {[
                  preview.estimatedWords && `${preview.estimatedWords} palabras`,
                  preview.durationSeconds && `~${preview.durationSeconds}s`,
                  preview.topic,
                  preview.viralTrigger,
                ].filter(Boolean).map(l=>(
                  <span key={l} className="bg-white/5 text-white/50 text-[10px] px-2.5 py-1 rounded-full">{l}</span>
                ))}
              </div>
              <div className="space-y-2">
                {[
                  {key:'hook',        label:'HOOK',  time:'0–3s',   cl:'border-amber-500/50',   bg:'bg-amber-500/5',   tc:'text-amber-200/90'},
                  {key:'claim',       label:'CLAIM', time:'3–15s',  cl:'border-blue-500/50',    bg:'bg-blue-500/5',    tc:'text-blue-200/90'},
                  {key:'explanation', label:'EXPL.', time:'15–45s', cl:'border-white/20',       bg:'bg-white/3',       tc:'text-white/70'},
                  {key:'cta',         label:'CTA',   time:'45–58s', cl:'border-emerald-500/50', bg:'bg-emerald-500/5', tc:'text-emerald-200/90'},
                ].map(({key,label,time,cl,bg,tc})=> preview[key] && (
                  <div key={key} className={`rounded-xl border-l-2 ${cl} ${bg} px-3 py-2.5`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-bold text-white/30 font-mono">{label}</span>
                      <span className="text-[9px] text-white/15">{time}</span>
                    </div>
                    <p className={`text-xs leading-relaxed ${tc}`}>{preview[key]}</p>
                  </div>
                ))}
              </div>
              {preview.psychologicalFact && (
                <div className="mt-3 bg-violet-500/10 border border-violet-500/20 rounded-xl px-3 py-2.5">
                  <p className="text-violet-400 text-[10px] font-bold mb-0.5">Dato psicológico</p>
                  <p className="text-white/60 text-xs italic">"{preview.psychologicalFact}"</p>
                </div>
              )}
              <button onClick={generate} disabled={busy}
                className="mt-4 w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-40 active:scale-95 transition-all">
                {busy?<Loader size={14} className="animate-spin"/>:<Plus size={14}/>}
                Generar este vídeo
              </button>
            </>
          )}
        </Card>
      )}

      {/* Vídeos locales */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-white">Vídeos generados <span className="text-white/30 font-normal">({videos.length})</span></p>
          <button onClick={()=>{fetchV();fetchQ();}} className="text-white/30 hover:text-white/60 transition-colors">
            <RefreshCw size={13} className={loadVid?'animate-spin':''}/>
          </button>
        </div>
        {loadVid ? (
          <div className="flex items-center justify-center h-24 text-white/20"><Film size={24} className="animate-pulse"/></div>
        ) : videos.length===0 ? (
          <div className="bg-white/3 rounded-2xl p-8 text-center border border-dashed border-white/8">
            <Film size={32} className="mx-auto mb-2 text-white/10"/>
            <p className="text-white/30 text-sm">Genera tu primer vídeo arriba</p>
          </div>
        ) : (
          <div className="space-y-2">
            {videos.map(v=><LocalVideoCard key={v.id} v={v}/>)}
          </div>
        )}
      </div>

    </div>
  );
}
