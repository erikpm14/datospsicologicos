import { useState } from 'react';
import { Brain, Radio, Home, Film, TrendingUp, PlusCircle, CalendarDays } from 'lucide-react';
import OperationsDashboard from './components/OperationsDashboard';
import OverviewDashboard from './components/OverviewDashboard';
import VideoStats from './components/VideoStats';
import ViralInsights from './components/ViralInsights';
import VideoQueue from './components/VideoQueue';
import ContentCalendar from './components/ContentCalendar';

const TABS = [
  { id: 'ops',      label: 'Ops',       icon: Radio       },
  { id: 'home',     label: 'Inicio',    icon: Home        },
  { id: 'videos',   label: 'Vídeos',    icon: Film        },
  { id: 'viral',    label: 'Viral',     icon: TrendingUp  },
  { id: 'generate', label: 'Generar',   icon: PlusCircle  },
  { id: 'calendar', label: 'Calendario',icon: CalendarDays},
];

export default function App() {
  const [tab, setTab] = useState('ops');

  return (
    <div className="min-h-screen bg-[#080810] text-white">

      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#080810]/95 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-lg shadow-violet-900/50">
              <Brain size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold leading-none">Datos Psicológicos</p>
              <p className="text-[10px] text-white/30 leading-none mt-0.5">YouTube Shorts · Auto</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-[11px] text-emerald-400 font-semibold">Activo</span>
          </div>
        </div>
      </header>

      {/* DESKTOP NAV */}
      <div className="hidden md:block border-b border-white/5 bg-[#080810]/95 backdrop-blur-xl sticky top-14 z-30">
        <div className="max-w-2xl mx-auto px-4 flex">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${
                tab === id
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-white/30 hover:text-white/60'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <main className="max-w-2xl mx-auto px-4 py-5 pb-28 md:pb-10">
        {tab === 'ops'      && <OperationsDashboard />}
        {tab === 'home'     && <OverviewDashboard onNavigate={setTab} />}
        {tab === 'videos'   && <VideoStats />}
        {tab === 'viral'    && <ViralInsights />}
        {tab === 'generate' && <VideoQueue />}
        {tab === 'calendar' && <ContentCalendar />}
      </main>

      {/* MOBILE NAV */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-white/5 bg-[#080810]/95 backdrop-blur-xl">
        <div className="flex">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all ${
                tab === id ? 'text-violet-400' : 'text-white/25 hover:text-white/50'
              }`}
            >
              <Icon size={20} strokeWidth={tab === id ? 2.5 : 1.8} />
              <span className="text-[9px] font-semibold uppercase tracking-wide">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
