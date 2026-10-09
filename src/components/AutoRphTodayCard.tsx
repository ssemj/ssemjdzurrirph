// ============================================================
// Kad Dashboard: RPH Automatik Hari Ini
// Papar kelas hari ini & esok (ikut jadual), status RPH, dan butang
// "Jana RPH Hari Ini" (trigger manual Gemini AI).
// ============================================================
import React, { useMemo, useState } from 'react';
import { Sparkles, Loader2, CalendarClock, CheckCircle2, CircleDashed, ChevronRight, Bot, AlertTriangle, Settings2, Square, CalendarRange } from 'lucide-react';
import { AcademicCalendar, AutoPilotSettings, ERPHData, ScheduleSlot } from '../types';
import { addDaysStr, findExisting, mytDateStr, occurrencesOnDate, weekOfDate } from '../services/autoRphCore';
import { formatTime } from '../constants';

export interface AutoRunState { running: boolean; message: string; done: number; total: number }

interface Props {
  teacherId: string;
  slots: ScheduleSlot[];
  erphs: ERPHData[];
  calendar: AcademicCalendar | null;
  autoPilot: AutoPilotSettings;
  hasGeminiKey: boolean;
  run: AutoRunState;
  onTrigger: (date: string) => void;
  onGenerateWeek: (date: string) => void;
  onStop: () => void;
  onOpenCenter: (tab: 'JADUAL' | 'RPT' | 'AUTO') => void;
  onOpenErph: (erph: ERPHData) => void;
}

const AutoRphTodayCard: React.FC<Props> = ({ teacherId, slots, erphs, calendar, autoPilot, hasGeminiKey, run, onTrigger, onGenerateWeek, onStop, onOpenCenter, onOpenErph }) => {
  const today = mytDateStr(Date.now());
  const [date, setDate] = useState(today);
  const occs = useMemo(() => occurrencesOnDate(slots, calendar, date), [slots, calendar, date]);
  const rows = occs.map(o => ({ o, erph: findExisting(erphs, teacherId, o) }));
  const ready = rows.filter(r => r.erph).length;
  const week = weekOfDate(calendar, date);
  const issues = [
    !slots.length && 'Jadual waktu belum direkod',
    !calendar && 'Kalendar akademik belum ditetapkan (Admin)',
    !hasGeminiKey && 'Kunci API Gemini belum ditetapkan (Tetapan)',
  ].filter(Boolean) as string[];

  return (
    <section className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4 md:p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0"><Bot size={22} /></div>
          <div>
            <h2 className="text-base md:text-lg font-extrabold text-slate-900">RPH Automatik AI</h2>
            <p className="text-xs text-slate-500">
              Jadual + RPT + DSKP → Gemini AI.{' '}
              {autoPilot.enabled
                ? <span className="text-emerald-700 font-semibold">Auto-jana AKTIF ({autoPilot.leadHours} jam sebelum kelas)</span>
                : <span className="text-amber-700 font-semibold">Auto-jana DIMATIKAN</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 bg-white overflow-hidden text-xs font-semibold">
            {[['Hari ini', today], ['Esok', addDaysStr(today, 1)]].map(([l, d]) => (
              <button key={d} onClick={() => setDate(d)} className={`px-3 py-2 ${date === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
            <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className="px-2 py-1 text-xs border-l border-slate-200 outline-none" />
          </div>
          <button onClick={() => onTrigger(date)} disabled={run.running || !occs.length || !hasGeminiKey}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
            {run.running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {date === today ? 'Jana RPH Hari Ini' : 'Jana RPH Tarikh Ini'}
          </button>
          <button onClick={() => onGenerateWeek(date)} disabled={run.running || !hasGeminiKey} title="Jana semua RPH minggu ini hingga Isnin minggu hadapan (untuk hantaran mingguan)"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-indigo-200 bg-white text-indigo-700 text-xs font-bold hover:border-indigo-400 disabled:opacity-50">
            <CalendarRange size={15} /> Jana Seminggu (Isnin→Isnin)
          </button>
          <button onClick={() => onOpenCenter('AUTO')} title="Pusat RPH Automatik" className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-slate-400"><Settings2 size={15} /></button>
        </div>
      </div>

      {run.running && (
        <div className="mt-4 rounded-2xl bg-white border border-indigo-100 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-indigo-700 flex items-center gap-2 min-w-0"><Loader2 size={13} className="animate-spin shrink-0" /><span className="truncate">{run.message}</span>{run.total > 0 && <span className="shrink-0">({run.done}/{run.total})</span>}</p>
            <button onClick={onStop} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500 text-white text-[11px] font-bold hover:bg-rose-600"><Square size={11} fill="currentColor" />Henti Jana</button>
          </div>
          <div className="h-1.5 bg-indigo-100 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${run.total ? (run.done / run.total) * 100 : 5}%` }} />
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {issues.map(i => (
            <button key={i} onClick={() => onOpenCenter(i.startsWith('Jadual') ? 'JADUAL' : 'AUTO')}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
              <AlertTriangle size={12} /> {i}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <CalendarClock size={13} /> {occs[0]?.day || ''} {date.split('-').reverse().join('/')} {week ? `• Minggu ${week}` : ''}
          </p>
          {occs.length > 0 && <p className="text-[11px] font-semibold text-slate-500">{ready}/{occs.length} RPH sedia</p>}
        </div>
        {occs.length === 0 ? (
          <p className="text-sm text-slate-500 bg-white rounded-2xl border border-dashed border-slate-200 p-4 text-center">
            Tiada kelas dalam jadual pada tarikh ini.{' '}
            <button onClick={() => onOpenCenter('JADUAL')} className="text-indigo-600 font-semibold hover:underline">Urus jadual waktu</button>
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ o, erph }) => (
              <button key={o.slot.id + o.date} onClick={() => erph && onOpenErph(erph)} disabled={!erph}
                className={`text-left rounded-2xl border p-3 bg-white transition-colors ${erph ? 'border-emerald-200 hover:border-emerald-400' : 'border-slate-200'} ${o.holiday ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-500">{formatTime(o.slot.startTime)} – {formatTime(o.slot.endTime)}</span>
                  {o.holiday ? <span className="text-[10px] font-bold text-rose-600">CUTI</span>
                    : erph ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700"><CheckCircle2 size={12} />{erph.autoGenerated ? 'AI' : 'Manual'}</span>
                    : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400"><CircleDashed size={12} />Belum</span>}
                </div>
                <p className="text-sm font-bold text-slate-900 mt-1 truncate">{o.slot.subject}</p>
                <p className="text-xs text-slate-500 truncate">{o.slot.classTitle || o.slot.className}</p>
                {erph?.sp && <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{erph.sp}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={() => onOpenCenter('JADUAL')} className="text-xs font-bold text-indigo-600 hover:underline inline-flex items-center gap-1">Jadual • RPT • Tetapan <ChevronRight size={14} /></button>
      </div>
    </section>
  );
};

export default AutoRphTodayCard;
