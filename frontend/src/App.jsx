import { useState } from 'react';
import { BadgeEuro, Brain, CalendarDays, Film, Radio, TrendingUp } from 'lucide-react';
import OperationsDashboard from './components/OperationsDashboard';
import BusinessDashboard from './components/BusinessDashboard';
import VideoStats from './components/VideoStats';
import ContentCalendar from './components/ContentCalendar';
import PerformanceAnalyticsDashboard from './components/PerformanceAnalyticsDashboard';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: BadgeEuro },
  { id: 'videos', label: 'Vídeos', icon: Film },
  { id: 'calendar', label: 'Calendario', icon: CalendarDays },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp },
  { id: 'ops', label: 'Ops', icon: Radio },
];

export default function App() {
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-40 border-b border-white/6 bg-[#090d12]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-700 shadow-lg shadow-violet-950/40">
              <Brain size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold leading-none">Datos Psicológicos</p>
              <p className="mt-0.5 text-[10px] leading-none text-white/30">YouTube Shorts · Auto</p>
            </div>
          </div>
          <div className="app-badge app-badge-good">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-[11px] font-semibold text-emerald-400">Activo</span>
          </div>
        </div>
      </header>

      <div className="sticky top-16 z-30 hidden border-b border-white/6 bg-[#090d12]/92 backdrop-blur-xl md:block">
        <div className="mx-auto flex max-w-6xl gap-1 px-5 py-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
                tab === id ? 'bg-white text-black' : 'text-white/38 hover:bg-white/6 hover:text-white/70'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <main className={`mx-auto px-5 py-6 pb-28 md:pb-10 ${tab === 'dashboard' || tab === 'videos' || tab === 'calendar' || tab === 'analytics' ? 'w-full max-w-[1480px]' : 'max-w-6xl'}`}>
        {tab === 'dashboard' && <BusinessDashboard />}
        {tab === 'videos' && <VideoStats />}
        {tab === 'calendar' && <ContentCalendar />}
        {tab === 'analytics' && <PerformanceAnalyticsDashboard />}
        {tab === 'ops' && <OperationsDashboard />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/6 bg-[#090d12]/94 backdrop-blur-xl md:hidden">
        <div className="flex">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-1 flex-col items-center gap-1 py-3 transition-all ${
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
