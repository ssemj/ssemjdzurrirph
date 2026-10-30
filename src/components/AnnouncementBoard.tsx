// ============================================================
// HOME GURU: Papan Pesanan Pentadbir (+ peringatan automatik Khamis/Jumaat)
// ============================================================
import React, { useEffect, useState } from 'react';
import { Megaphone, Pin, Bell, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Announcement, autoReminder, loadAnnouncements } from '../services/announcementService';
import { OFFICIAL_REVIEWERS } from '../constants';

export const PRINCIPAL = OFFICIAL_REVIEWERS.find(r => /pengetua/i.test(r.designation)) || { name: 'PENGETUA', designation: 'PENGETUA' };
const dmy = (d: string) => (d || '').split('-').reverse().join('/');
const isNew = (a: Announcement) => Date.now() - new Date(a.createdAt).getTime() < 3 * 86400000;

export const AnnouncementItem: React.FC<{ a: Announcement; action?: React.ReactNode }> = ({ a, action }) => (
  <div className={`rounded-2xl border p-4 ${a.auto ? 'bg-amber-50 border-amber-200' : a.important ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        {a.auto ? <Bell size={14} className="text-amber-600" /> : a.important ? <Pin size={14} className="text-rose-600" /> : <Megaphone size={14} className="text-indigo-600" />}
        <span className="text-xs font-black text-slate-900 uppercase">{a.authorName}</span>
        {a.authorDesignation && <span className="text-[10px] font-bold text-slate-500 uppercase">• {a.authorDesignation}</span>}
        {a.auto && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">PERINGATAN</span>}
        {!a.auto && isNew(a) && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-600 text-white">BAHARU</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-bold text-slate-400">{dmy(a.date)}{a.time ? ` • ${a.time}` : ''}</span>
        {action}
      </div>
    </div>
    <p className="text-sm text-slate-800 mt-2 whitespace-pre-wrap leading-relaxed">{a.message}</p>
  </div>
);

const AnnouncementBoard: React.FC = () => {
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const load = async () => { setLoading(true); try { setList(await loadAnnouncements(30)); } catch (e) { console.warn('Pesanan:', e); } finally { setLoading(false); } };
  useEffect(() => { load(); const t = setInterval(load, 5 * 60 * 1000); return () => clearInterval(t); }, []);

  const auto = autoReminder(PRINCIPAL);
  const sorted = [...list].sort((a, b) => Number(!!b.important) - Number(!!a.important) || b.createdAt.localeCompare(a.createdAt));
  const items = [...(auto ? [auto] : []), ...sorted];
  const shown = showAll ? items : items.slice(0, 3);

  return (
    <section className="rounded-3xl border border-indigo-100 bg-white p-4 md:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center"><Megaphone size={20} /></div>
          <div>
            <h2 className="text-base md:text-lg font-extrabold text-slate-900">Papan Pesanan Pentadbir</h2>
            <p className="text-xs text-slate-500">Pesanan rasmi daripada pentadbiran sekolah</p>
          </div>
        </div>
        <button onClick={load} title="Muat semula" className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:text-indigo-600"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">{loading ? 'Memuatkan...' : 'Tiada pesanan buat masa ini.'}</p>
      ) : (
        <div className="space-y-2">{shown.map(a => <AnnouncementItem key={a.id} a={a} />)}</div>
      )}
      {items.length > 3 && (
        <button onClick={() => setShowAll(v => !v)} className="mt-3 text-xs font-bold text-indigo-600 inline-flex items-center gap-1">
          {showAll ? <>Tunjuk kurang <ChevronUp size={14} /></> : <>Lihat semua ({items.length}) <ChevronDown size={14} /></>}
        </button>
      )}
    </section>
  );
};

export default AnnouncementBoard;
