// ============================================================
// ADMIN: Pendaftaran Guru Baharu (Firestore: teachers/{loginId})
// Guru baharu terus muncul di senarai log masuk "Portal Guru".
// ============================================================
import React, { useState } from 'react';
import { UserPlus, Loader2, Trash2, Save, Search } from 'lucide-react';
import { NewTeacher } from '../services/teacherService';

interface Props {
  fsTeachers: NewTeacher[];
  existingTeachers: any[];   // senarai penuh (Google Sheet + Firebase) — semak pendua
  onSave: (t: NewTeacher) => Promise<NewTeacher>;
  onDelete: (login: string) => Promise<void>;
}

const input = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 bg-white';
const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';
const blank: NewTeacher = { login: '', name: '', designation: 'Guru Akademik', department: '', grade: 'DG41', email: '', phone: '', photo: '' };

const TeacherRegistration: React.FC<Props> = ({ fsTeachers, existingTeachers, onSave, onDelete }) => {
  const [f, setF] = useState<NewTeacher>(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState('');
  const set = (k: keyof NewTeacher, v: string) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    setMsg(null);
    if (!f.name.trim() || !f.login.trim()) { setMsg({ ok: false, text: 'Nama penuh dan Login ID wajib diisi.' }); return; }
    const dup = existingTeachers.find(t => String(t.login || t.id).trim().toLowerCase() === f.login.trim().toLowerCase());
    const isEditingOwn = fsTeachers.some(t => t.login.trim().toLowerCase() === f.login.trim().toLowerCase());
    if (dup && !isEditingOwn) { setMsg({ ok: false, text: `Login ID ini sudah digunakan oleh ${dup.name}.` }); return; }
    setBusy(true);
    try {
      const saved = await onSave(f);
      setMsg({ ok: true, text: `✅ ${saved.name} didaftarkan. Guru boleh log masuk di Portal Guru menggunakan Login ID: ${saved.login}` });
      setF(blank);
    } catch (e: any) { setMsg({ ok: false, text: 'Gagal simpan: ' + e.message }); }
    finally { setBusy(false); }
  };

  const list = fsTeachers.filter(t => (t.name + ' ' + t.login + ' ' + (t.department || '')).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="bg-white rounded-[2rem] border border-slate-100 premium-shadow p-5 md:p-8 space-y-6 text-left">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-teal-600 text-white"><UserPlus size={22} /></div>
        <div>
          <h2 className="text-lg font-black text-slate-900">Pendaftaran Guru Baharu</h2>
          <p className="text-xs text-slate-500">Disimpan di Firebase. Guru baharu terus muncul di senarai <b>Portal Guru</b> dan log masuk menggunakan <b>Login ID</b>.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="md:col-span-2"><span className={label}>Nama penuh *</span><input className={input} value={f.name} onChange={e => set('name', e.target.value)} placeholder="cth: AHMAD BIN ALI" /></div>
        <div><span className={label}>Login ID * (cth No. IC / ID guru)</span><input className={input} value={f.login} onChange={e => set('login', e.target.value)} placeholder="cth: 900101015555" /></div>
        <div><span className={label}>Jawatan</span><input className={input} value={f.designation} onChange={e => set('designation', e.target.value)} /></div>
        <div><span className={label}>Bidang / Unit</span><input className={input} value={f.department} onChange={e => set('department', e.target.value)} placeholder="cth: BIDANG KESENIAN" /></div>
        <div><span className={label}>Gred</span><input className={input} value={f.grade} onChange={e => set('grade', e.target.value)} /></div>
        <div><span className={label}>Emel</span><input type="email" className={input} value={f.email} onChange={e => set('email', e.target.value)} /></div>
        <div><span className={label}>No. Telefon</span><input className={input} value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
        <div><span className={label}>URL Gambar (pilihan)</span><input className={input} value={f.photo} onChange={e => set('photo', e.target.value)} placeholder="Pautan Google Drive / imej" /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-bold hover:bg-teal-700 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Daftar Guru
        </button>
        {f.login && fsTeachers.some(t => t.login === f.login) && <span className="text-xs text-amber-700">Login ID ini sudah didaftarkan — simpan akan mengemas kini maklumat.</span>}
      </div>
      {msg && <p className={`text-sm font-semibold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}

      <div className="pt-4 border-t border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="font-black text-slate-900">Guru didaftarkan melalui sistem ({fsTeachers.length})</h3>
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari..." className="pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs outline-none" /></div>
        </div>
        {list.length === 0 ? <p className="text-sm text-slate-400">Belum ada guru didaftarkan melalui sistem.</p> : (
          <div className="divide-y divide-slate-100">
            {list.map(t => (
              <div key={t.login} className="py-2.5 flex items-center justify-between gap-3">
                <button className="min-w-0 text-left" onClick={() => setF({ ...blank, ...t })} title="Klik untuk sunting">
                  <p className="text-sm font-bold text-slate-900 truncate">{t.name}</p>
                  <p className="text-[11px] text-slate-500">Login: {t.login} • {t.designation || '-'} • {t.department || '-'}</p>
                </button>
                <button onClick={async () => { if (confirm(`Padam pendaftaran ${t.name}? Rekod RPH guru ini tidak dipadam.`)) await onDelete(t.login); }}
                  className="shrink-0 p-2 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherRegistration;
