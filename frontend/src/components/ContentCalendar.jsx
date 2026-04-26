import { useMemo, useState } from 'react';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';

const TIMES = ['15:00', '18:00', '21:00'];

function nextSlots(limit = 8) {
  const now = new Date();
  const upcoming = [];

  outer: for (let dayIndex = 0; dayIndex < 21; dayIndex += 1) {
    const day = addDays(now, dayIndex);
    for (const time of TIMES) {
      const [hours, minutes] = time.split(':').map(Number);
      const slot = new Date(day);
      slot.setHours(hours, minutes, 0, 0);
      if (slot <= now) continue;
      upcoming.push(slot);
      if (upcoming.length >= limit) break outer;
    }
  }

  return upcoming;
}

function slotLabel(date) {
  const today = new Date();
  if (isSameDay(date, today)) return 'Hoy';
  if (isSameDay(date, addDays(today, 1))) return 'Mañana';
  return format(date, 'EEE', { locale: es });
}

export default function ContentCalendar() {
  const [offset, setOffset] = useState(0);
  const today = new Date();

  const monday = useMemo(() => {
    const day = new Date(today);
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7) + offset * 7);
    return startOfDay(day);
  }, [today, offset]);

  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const upcoming = useMemo(() => nextSlots(8), []);

  return (
    <div className="app-page">
      <section className="app-panel overflow-hidden">
        <div className="app-section-header">
          <p className="app-eyebrow">Calendario</p>
          <h1 className="app-title mt-2 text-2xl">Plan de publicaciones</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/42">Vista limpia de cuándo sale cada vídeo, con foco en frecuencia, slots y visión temporal.</p>
        </div>
        <div className="grid gap-4 px-6 py-6 xl:grid-cols-4">
          <Stat label="Slots por día" value="3" detail="Cadencia actual de publicación." />
          <Stat label="Horarios" value="15 · 18 · 21" detail="Ventanas activas del sistema." />
          <Stat label="Siguiente slot" value={upcoming[0] ? format(upcoming[0], 'HH:mm') : '—'} detail={upcoming[0] ? `${slotLabel(upcoming[0])} · ${format(upcoming[0], "d MMM", { locale: es })}` : 'Sin slots próximos.'} />
          <Stat label="Frecuencia" value="Diaria" detail="Cobertura continua durante la semana." />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="app-panel overflow-hidden">
          <div className="app-section-header">
            <p className="app-eyebrow">Próximos</p>
            <h2 className="app-title mt-2">Siguientes publicaciones</h2>
          </div>
          <div className="space-y-3 px-6 py-6">
            {upcoming.map((slot, index) => (
              <div key={`${slot.toISOString()}-${index}`} className="app-panel-soft flex items-center gap-4 p-4">
                <div className="w-14 shrink-0 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">{slotLabel(slot)}</p>
                  <p className="mt-1 text-2xl font-black text-white">{format(slot, 'd')}</p>
                </div>
                <div className="h-10 w-px bg-white/8" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Clock size={13} className="text-white/30" />
                    <p className="text-base font-semibold text-white">{format(slot, 'HH:mm')}</p>
                    <span className="text-[10px] uppercase tracking-[0.16em] text-white/24">CET</span>
                  </div>
                  <p className="mt-1 text-xs capitalize text-white/38">{format(slot, "EEEE d 'de' MMMM", { locale: es })}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="app-panel overflow-hidden">
          <div className="app-section-header flex items-center justify-between gap-3">
            <div>
              <p className="app-eyebrow">Semana</p>
              <h2 className="app-title mt-2">Vista temporal</h2>
              <p className="mt-2 text-sm text-white/42">
                {format(monday, "d MMM", { locale: es })} – {format(addDays(monday, 6), "d MMM yyyy", { locale: es })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setOffset((value) => value - 1)} className="app-button"><ChevronLeft size={14} /></button>
              <button onClick={() => setOffset(0)} className="app-button">Hoy</button>
              <button onClick={() => setOffset((value) => value + 1)} className="app-button"><ChevronRight size={14} /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-3 px-6 py-6">
            {days.map((day, index) => {
              const todayCard = isSameDay(day, today);
              return (
                <div
                  key={index}
                  className={`rounded-[22px] border p-3 text-center ${todayCard ? 'border-sky-500/20 bg-sky-500/10' : 'border-white/8 bg-[#131821]'}`}
                >
                  <p className="text-[10px] font-semibold text-white/30">{format(day, 'EEE', { locale: es }).slice(0, 1).toUpperCase()}</p>
                  <p className={`mt-1 text-lg font-black ${todayCard ? 'text-sky-300' : 'text-white'}`}>{format(day, 'd')}</p>
                  <div className="mt-3 space-y-1">
                    {TIMES.map((time) => (
                      <div key={time} className={`rounded-lg px-1.5 py-1 text-[10px] ${todayCard ? 'bg-sky-500/15 text-sky-200' : 'bg-white/6 text-white/52'}`}>
                        {time}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, detail }) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-[#131821] p-5">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/30">{label}</p>
      <p className="mt-3 text-3xl font-black text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-white/40">{detail}</p>
    </div>
  );
}
