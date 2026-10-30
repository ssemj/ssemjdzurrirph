// ============================================================
// ADMIN: Tulis Pesanan untuk Home semua guru (Firestore announcements)
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Send, Loader2, Trash2 } from 'lucide-react';
import { Announcement, autoReminder, deleteAnnouncement, loadAnnouncements, saveAnnouncement } from '../services/announcementService';
import { mytDateStr } from '../services/autoRphCore';
import { OFFICIAL_REVIEWERS } from '../constants';
import { AnnouncementItem, PRINCIPAL } from './AnnouncementBoard';

const input = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 bg-white';
const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';

const AnnouncementAdmin: React.FC<{ teachers: any[]; userName: string }> = ({ teachers, userName }) => {
  // Penulis: senarai pentadbir rasmi, kemudian semua guru
  const authors = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; designation: string }[] = [];
    [...OFFICIAL_REVIEWERS, ...teachers.map(t => ({ name: t.name, designation: t.designation || 'Guru' }))].forEach(a => {
      const k = String(a.name || '').trim().toUpperCase();
      if (k && !seen.has(k)) { seen.add(k); out.push({ name: k, designation: a.designation }); }
    });
    return out;
  }, [teachers]);
  const [author, setAuthor] = useState(PRINCIPAL.name);
  const [date, setDate] = useState(mytDateStr(Date.now()));
  const [time, setTime] = useState('');
  const [message, setMessage] = useState('');
  const [important, setImportant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [list, setList] = useState<Announcement[]>([]);
  const load = async () => { try { setList(await loadAnnouncements(50)); } catch (e: any) { setMsg('Gagal memuatkan: ' + e.message); } };
  useEffect(() => { load(); }, []);

  const post = async () => {
    if (!message.trim()) { setMsg('Sila tulis mesej.'); return; }
    const a = authors.find(x => x.name === author);
    setBusy(true); setMsg('');
    try {
      await saveAnnouncement({ message, authorName: author, authorDesignation: a?.designation || '', date, time, important, createdBy: userName });
      setMessage(''); setImportant(false); setTime('');
      setMsg('✅ Pesanan dihantar ke Home semua guru.');
      await load();
    } catch (e: any) { setMsg('Gagal: ' + e.message); }
    finally { setBusy(false); }
  };
  const auto = autoReminder(PRINCIPAL);

  return (
    <div className="bg-white rounded-[2rem] border border-slate-100 premium-shadow p-5 md:p-8 space-y-6 text-left">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-rose-600 text-white"><Megaphone size={22} /></div>
        <div>
          <h2 className="text-lg font-black text-slate-900">Papan Pesanan Pentadbir</h2>
          <p className="text-xs text-slate-500">Pesanan dipaparkan di <b>Home semua guru</b> serta-merta. Hanya Pentadbir boleh menulis.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <div className="md:col-span-2"><span className={label}>Daripada</span>
          <select className={input} value={author} onChange={e => setAuthor(e.target.value)}>
            {authors.map(a => <option key={a.name} value={a.name}>{a.name} — {a.designation}</option>)}
          </select></div>
        <div><span className={label}>Tarikh</span><input type="date" className={input} value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><span className={label}>Masa (pilihan)</span><input type="time" className={input} value={time} onChange={e => setTime(e.target.value)} /></div>
        <div className="md:col-span-4"><span className={label}>Mesej</span>
          <textarea rows={4} className={input} value={message} onChange={e => setMessage(e.target.value)} placeholder="cth: Mesyuarat guru akan diadakan pada hari Isnin, 2.30 petang di Bilik Mesyuarat." /></div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-rose-600" checked={important} onChange={e => setImportant(e.target.checked)} />Penting (dipaparkan di atas)</label>
        <button onClick={post} disabled={busy} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Hantar Pesanan
        </button>
        {msg && <span className="text-sm font-semibold text-slate-700">{msg}</span>}
      </div>

      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900">
        <b>Peringatan automatik</b> (tidak perlu ditulis): setiap <b>Khamis</b> dan <b>Jumaat</b> sistem memaparkan peringatan penghantaran RPH daripada <b>{PRINCIPAL.name}</b>.
        {auto && <div className="mt-3"><AnnouncementItem a={auto} /></div>}
      </div>

      <div className="pt-2 border-t border-slate-100">
        <h3 className="font-black text-slate-900 mb-3">Pesanan dihantar ({list.length})</h3>
        {list.length === 0 ? <p className="text-sm text-slate-400">Belum ada pesanan.</p> : (
          <div className="space-y-2">
            {list.map(a => (
              <AnnouncementItem key={a.id} a={a} action={
                <button onClick={async () => { if (confirm('Padam pesanan ini daripada Home semua guru?')) { await deleteAnnouncement(a.id); load(); } }}
                  className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50" title="Padam"><Trash2 size={12} /></button>
              } />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnouncementAdmin;
