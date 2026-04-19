import { useState } from 'react';
import { format, addDays, isSameDay, isBefore, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Clock, TrendingUp, Settings } from 'lucide-react';

const TIMES    = ['15:00', '18:00', '21:00'];
const PRIO     = new Set([3, 4, 5]); // mié, jue, vie
const DAY_ABBR = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function isPastSlot(date, time) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d < new Date();
}

export default function ContentCalendar() {
  const [offset, setOffset] = useState(0);
  const today  = new Date();
  const monday = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
    return startOfDay(d);
  })();
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const upcoming = [];
  outer: for (let d = 0; d < 14; d++) {
    const day = addDays(today, d);
    for (const t of TIMES) {
      if (!isPastSlot(day, t)) {
        upcoming.push({ day, time: t });
        if (upcoming.length >= 5) break outer;
      }
    }
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div>
        <h2 className="text-xl font-black text-white">Calendario</h2>
        <p className="text-white/30 text-xs mt-0.5">Publicación automática · 3 vídeos/día</p>
      </div>

      {/* Próximas publicaciones */}
      <div className="space-y-2">
        {upcoming.map(({ day, time }, i) => {
          const isToday = isSameDay(day, today);
          const isPrio  = PRIO.has(day.getDay());
          return (
            <div
              key={i}
              className={`flex items-center gap-4 rounded-2xl border px-4 py-3.5 ${
                isToday
                  ? 'bg-violet-500/10 border-violet-500/30'
                  : isPrio
                  ? 'bg-amber-500/5 border-amber-500/15'
                  : 'bg-white/5 border-white/5'
              }`}
            >
              <div className="text-center w-10 shrink-0">
                <p className="text-[10px] font-bold text-white/30 uppercase">
                  {isToday ? 'HOY' : format(day, 'EEE', { locale: es }).toUpperCase()}
                </p>
                <p className={`text-2xl font-black leading-tight ${isToday ? 'text-violet-400' : 'text-white'}`}>
                  {format(day, 'd')}
                </p>
              </div>

              <div className={`w-px self-stretch ${isToday ? 'bg-violet-500/30' : 'bg-white/10'}`} />

              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Clock size={13} className={isToday ? 'text-violet-400' : 'text-white/30'} />
                  <p className={`text-base font-bold ${isToday ? 'text-white' : 'text-white/80'}`}>{time}</p>
                  <span className="text-[10px] text-white/25">CET</span>
                  {isPrio && (
                    <span className="flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-semibold">
                      <TrendingUp size={8} />Prioritario
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-white/25 mt-0.5 capitalize">
                  {format(day, "EEEE d 'de' MMMM", { locale: es })}
                </p>
              </div>

              <div className={`w-2 h-2 rounded-full shrink-0 ${
                isToday ? 'bg-violet-400 animate-pulse' : 'bg-white/10'
              }`} />
            </div>
          );
        })}
      </div>

      {/* Vista semanal */}
      <div className="bg-white/5 rounded-2xl border border-white/5 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-bold text-white">Vista semanal</p>
            <p className="text-white/30 text-xs mt-0.5">
              {format(monday, "d MMM", { locale: es })} – {format(addDays(monday, 6), "d MMM yyyy", { locale: es })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setOffset(o => o - 1)}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-white/10 text-white/40 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => setOffset(0)}
              className="px-3 h-8 rounded-xl hover:bg-white/10 text-white/40 text-xs transition-colors">
              Hoy
            </button>
            <button onClick={() => setOffset(o => o + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-white/10 text-white/40 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {days.map((day, i) => {
            const isToday = isSameDay(day, today);
            const isPast  = isBefore(startOfDay(day), startOfDay(today));
            const isPrio  = PRIO.has(day.getDay());
            return (
              <div
                key={i}
                className={`rounded-xl p-2 text-center border ${
                  isToday ? 'bg-violet-500/15 border-violet-500/30' :
                  isPrio  ? 'bg-amber-500/5 border-amber-500/15' :
                            'bg-white/3 border-white/5'
                } ${isPast && !isToday ? 'opacity-30' : ''}`}
              >
                <p className="text-[9px] font-bold text-white/30">{DAY_ABBR[i]}</p>
                <p className={`text-sm font-black mt-0.5 ${isToday ? 'text-violet-300' : 'text-white'}`}>
                  {format(day, 'd')}
                </p>
                <div className="mt-1.5 space-y-1">
                  {TIMES.map(t => (
                    <div key={t} className={`rounded text-[8px] font-mono py-0.5 leading-none ${
                      isPastSlot(day, t)
                        ? 'text-white/15 bg-white/3'
                        : isToday
                        ? 'text-violet-300 bg-violet-500/20'
                        : 'text-white/40 bg-white/5'
                    }`}>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Config */}
      <div className="bg-white/5 rounded-2xl border border-white/5 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Settings size={14} className="text-white/40" />
          <p className="text-sm font-bold text-white">Configuración del sistema</p>
        </div>
        <div className="space-y-3">
          {[
            { label: 'Publicaciones por día',   value: '3 vídeos',                    color: 'text-white'       },
            { label: 'Horarios (hora Madrid)',   value: '15:00 · 18:00 · 21:00',       color: 'text-white'       },
            { label: 'Días prioritarios',        value: 'Miércoles · Jueves · Viernes',color: 'text-amber-400'   },
            { label: 'Investigación viral',      value: 'Domingos · 3:00 AM',          color: 'text-violet-400'  },
            { label: 'Análisis de métricas',     value: 'Cada hora',                   color: 'text-emerald-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <p className="text-white/40 text-sm">{label}</p>
              <p className={`text-sm font-semibold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
