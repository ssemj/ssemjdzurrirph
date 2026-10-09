// ============================================================
// PUSAT RPH AUTOMATIK
//  Tab 1 Jadual Waktu  — guru bina jadual sendiri (Hari, Masa, Subjek, Tingkatan, Kelas)
//  Tab 2 RPT           — muat naik Rancangan Pengajaran Tahunan (PDF/Word/Excel) → Firestore
//  Tab 3 Auto-Jana     — tetapan 24 jam, butang trigger, senarai akan datang & log
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, CalendarDays, FileSpreadsheet, Bot, Plus, Trash2, Save, Pencil, Upload, Loader2, Sparkles,
  CheckCircle2, XCircle, AlertTriangle, Download, X, Clock, Info, Copy,
} from 'lucide-react';
import {
  AcademicCalendar, AutoPilotSettings, DskpDocument, ERPHData, MasterData, RptDocument, RptRow, ScheduleSlot, TeacherTimetable, UserProfile,
} from '../types';
import SchoolTimetableGrid from './SchoolTimetableGrid';
import { formatTime } from '../constants';
import {
  DAY_LABEL, findDskpDoc, findExisting, findRptDoc, lastSpFor, lessonPosition, mytDateStr, normDay, planLesson, weekOfDate,
} from '../services/autoRphCore';
import { plannedOccurrences } from '../services/autoRphRunner';
import { extractRpt, saveRpt, deleteRpt, cleanRptRows } from '../services/rptService';
import { getGeminiKey } from '../services/geminiService';
import type { AutoResult } from '../services/autoRphGenerate';
import type { AutoRunState } from './AutoRphTodayCard';

export type CenterTab = 'JADUAL' | 'RPT' | 'AUTO';
const DAYS = ['ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT'];
const newId = () => 'slot_' + Math.random().toString(36).slice(2, 10);

interface Props {
  user: UserProfile;
  isAdmin?: boolean;
  initialTab?: CenterTab;
  masterData: MasterData;
  dskpDocs: DskpDocument[];
  rptDocs: RptDocument[];
  onRptUpdated: () => void;
  timetable: TeacherTimetable;
  onSaveTimetable: (tt: TeacherTimetable) => Promise<void>;
  erphs: ERPHData[];
  calendar: AcademicCalendar | null;
  run: AutoRunState;
  lastResults: AutoResult[];
  onTrigger: (date: string, regenerate: boolean) => void;
  onRunWindow: () => void;
  onGenerateWeek: (date: string) => void;
  onStop: () => void;
  onOpenErph: (erph: ERPHData) => void;
  onBack: () => void;
}

const card = 'bg-white rounded-3xl border border-slate-200 p-4 md:p-6';
const input = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 bg-white';
const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';

const AutoRphCenter: React.FC<Props> = (p) => {
  const [tab, setTab] = useState<CenterTab>(p.initialTab || 'JADUAL');
  useEffect(() => { if (p.initialTab) setTab(p.initialTab); }, [p.initialTab]);

  const tabs: { id: CenterTab; label: string; icon: any }[] = [
    { id: 'JADUAL', label: '1. Jadual Waktu', icon: CalendarDays },
    { id: 'RPT', label: '2. RPT', icon: FileSpreadsheet },
    { id: 'AUTO', label: '3. Auto-Jana RPH', icon: Bot },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24 animate-fadeIn text-left">
      <div className="flex items-center gap-3">
        <button onClick={p.onBack} className="p-2 rounded-xl border border-slate-200 bg-white hover:border-slate-400"><ChevronLeft size={18} /></button>
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold text-slate-900">Pusat RPH Automatik</h1>
          <p className="text-xs text-slate-500">Kunci utama penjanaan: <b>Jadual Waktu</b> + <b>RPT</b> + <b>DSKP</b> → Gemini AI</p>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap border ${tab === t.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'JADUAL' && <JadualTab {...p} />}
      {tab === 'RPT' && <RptTab {...p} />}
      {tab === 'AUTO' && <AutoTab {...p} />}
    </div>
  );
};

// ======================= TAB 1: JADUAL =======================
const JadualTab: React.FC<Props> = ({ user, masterData, dskpDocs, rptDocs, timetable, onSaveTimetable, erphs }) => {
  const [slots, setSlots] = useState<ScheduleSlot[]>(timetable.slots);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const blank: ScheduleSlot = { id: '', teacherId: user.id, day: 'ISNIN', startTime: '07:30', endTime: '08:30', subject: '', className: '', classTitle: '' };
  const [draft, setDraft] = useState<ScheduleSlot>(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => { if (!dirty) setSlots(timetable.slots); }, [timetable.slots]);

  const subjects = useMemo(() => Array.from(new Set([...(masterData.subjects || []), ...dskpDocs.map(d => d.subject), ...rptDocs.map(d => d.subject), 'PENGURUSAN'])).filter(Boolean).sort(), [masterData.subjects, dskpDocs, rptDocs]);
  const forms = useMemo(() => Array.from(new Set([...Object.keys(masterData.classes || {}), ...dskpDocs.map(d => d.form), ...rptDocs.map(d => d.form), 'Tingkatan 1', 'Tingkatan 2', 'Tingkatan 3', 'Tingkatan 4', 'Tingkatan 5'])).filter(Boolean).sort(), [masterData.classes, dskpDocs, rptDocs]);
  const classOptions = (masterData.classes || {})[draft.className] || [];

  const set = (k: keyof ScheduleSlot, v: string) => setDraft(d => ({ ...d, [k]: v }));
  const valid = draft.subject.trim() && draft.className.trim() && draft.startTime < draft.endTime;
  const commit = () => {
    if (!valid) return;
    setSlots(prev => editingId ? prev.map(s => s.id === editingId ? { ...draft, id: editingId } : s) : [...prev, { ...draft, id: newId() }]);
    setDraft(d => ({ ...d, startTime: d.endTime, endTime: addMinutes(d.endTime, 60), id: '' }));
    setEditingId(null); setDirty(true);
  };
  const remove = (id: string) => { setSlots(prev => prev.filter(s => s.id !== id)); setDirty(true); };
  const copyDay = (from: string, to: string) => {
    if (!confirm(`Salin semua slot ${DAY_LABEL[from]} ke ${DAY_LABEL[to]}?`)) return;
    setSlots(prev => [...prev, ...prev.filter(s => normDay(s.day) === from).map(s => ({ ...s, id: newId(), day: to }))]); setDirty(true);
  };
  const importFromRph = () => {
    const map = new Map<string, ScheduleSlot>();
    erphs.filter(e => e.teacherId === user.id && e.day && e.startTime && e.endTime && e.subject).forEach(e => {
      const day = String(e.day).toUpperCase();
      const k = `${day}|${e.startTime}|${e.subject}|${e.classTitle}`;
      if (!map.has(k) && !slots.some(s => `${normDay(s.day)}|${s.startTime}|${s.subject}|${s.classTitle}` === k))
        map.set(k, { id: newId(), teacherId: user.id, day, startTime: e.startTime, endTime: e.endTime, subject: e.subject, className: e.className, classTitle: e.classTitle });
    });
    if (!map.size) return alert('Tiada slot baharu ditemui daripada rekod RPH lama.');
    setSlots(prev => [...prev, ...map.values()]); setDirty(true);
    alert(`${map.size} slot diimport daripada rekod RPH. Semak dan tekan Simpan.`);
  };
  const save = async () => {
    setSaving(true);
    try { await onSaveTimetable({ ...timetable, slots }); setDirty(false); }
    catch (e: any) { alert('Gagal simpan jadual: ' + e.message); }
    finally { setSaving(false); }
  };

  const byDay = DAYS.map(d => ({ d, list: slots.filter(s => normDay(s.day) === d).sort((a, b) => a.startTime.localeCompare(b.startTime)) }));

  return (
    <div className="space-y-6">
      <div className={card}>
        <h2 className="font-extrabold text-slate-900 mb-1">{editingId ? 'Kemaskini slot' : 'Tambah slot mengajar'}</h2>
        <p className="text-xs text-slate-500 mb-4">Tingkatan mesti sama dengan Tingkatan pada DSKP/RPT (cth "Tingkatan 1") supaya AI boleh padankan.</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div><span className={label}>Hari</span>
            <select className={input} value={normDay(draft.day)} onChange={e => set('day', e.target.value)}>{DAYS.map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select></div>
          <div><span className={label}>Mula</span><input type="time" className={input} value={draft.startTime} onChange={e => set('startTime', e.target.value)} /></div>
          <div><span className={label}>Tamat</span><input type="time" className={input} value={draft.endTime} onChange={e => set('endTime', e.target.value)} /></div>
          <div className="col-span-2 md:col-span-1"><span className={label}>Subjek</span>
            <input list="autorph-subjects" className={input} value={draft.subject} onChange={e => set('subject', e.target.value)} placeholder="Subjek" />
            <datalist id="autorph-subjects">{subjects.map(s => <option key={s} value={s} />)}</datalist></div>
          <div><span className={label}>Tingkatan</span>
            <input list="autorph-forms" className={input} value={draft.className} onChange={e => set('className', e.target.value)} placeholder="Tingkatan 1" />
            <datalist id="autorph-forms">{forms.map(s => <option key={s} value={s} />)}</datalist></div>
          <div><span className={label}>Kelas</span>
            <input list="autorph-classes" className={input} value={draft.classTitle} onChange={e => set('classTitle', e.target.value)} placeholder="1 Bestari" />
            <datalist id="autorph-classes">{classOptions.map(s => <option key={s} value={s} />)}</datalist></div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={commit} disabled={!valid} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">
            {editingId ? <Pencil size={15} /> : <Plus size={15} />}{editingId ? 'Kemaskini' : 'Tambah'}
          </button>
          {editingId && <button onClick={() => { setEditingId(null); setDraft(blank); }} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold">Batal</button>}
          <button onClick={importFromRph} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600"><Download size={15} />Import dari rekod RPH lama</button>
        </div>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-extrabold text-slate-900">Jadual mingguan ({slots.length} slot)</h2>
            <p className="text-xs text-slate-500">Lencana menunjukkan sama ada RPT dan DSKP tersedia untuk Subjek + Tingkatan tersebut.</p>
          </div>
          <button onClick={save} disabled={!dirty || saving} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{dirty ? 'Simpan Jadual' : 'Tersimpan'}
          </button>
        </div>
        <div className="grid md:grid-cols-5 gap-3">
          {byDay.map(({ d, list }, di) => (
            <div key={d} className="rounded-2xl bg-slate-50 p-2.5">
              <div className="flex items-center justify-between px-1 mb-2">
                <p className="text-xs font-extrabold text-slate-700 uppercase">{DAY_LABEL[d]}</p>
                {list.length > 0 && di < 4 && <button title={`Salin ke ${DAY_LABEL[DAYS[di + 1]]}`} onClick={() => copyDay(d, DAYS[di + 1])} className="text-slate-400 hover:text-slate-700"><Copy size={13} /></button>}
              </div>
              <div className="space-y-2">
                {list.length === 0 && <p className="text-[11px] text-slate-400 px-1">Tiada slot</p>}
                {list.map(s => {
                  const hasRpt = !!findRptDoc(rptDocs, s.subject, s.className);
                  const hasDskp = !!findDskpDoc(dskpDocs, s.subject, s.className);
                  return (
                    <div key={s.id} className={`bg-white rounded-xl border p-2 ${editingId === s.id ? 'border-indigo-400' : 'border-slate-200'}`}>
                      <p className="text-[10px] font-bold text-slate-500">{formatTime(s.startTime)}–{formatTime(s.endTime)}</p>
                      <p className="text-xs font-bold text-slate-900 leading-tight">{s.subject}</p>
                      <p className="text-[11px] text-slate-500">{s.className}{s.classTitle ? ` • ${s.classTitle}` : ''}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <div className="flex gap-1">
                          <Badge ok={hasRpt} t="RPT" /><Badge ok={hasDskp} t="DSKP" />
                        </div>
                        <div className="flex gap-1.5 text-slate-400">
                          <button onClick={() => { setDraft(s); setEditingId(s.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-indigo-600"><Pencil size={12} /></button>
                          <button onClick={() => remove(s.id)} className="hover:text-rose-600"><Trash2 size={12} /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {slots.length > 0 && <div className={card}><h2 className="font-extrabold text-slate-900 mb-3">Paparan jadual</h2><SchoolTimetableGrid slots={slots} /></div>}
    </div>
  );
};

const Badge = ({ ok, t }: { ok: boolean; t: string }) => (
  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{ok ? '✓' : '✗'} {t}</span>
);
const addMinutes = (t: string, m: number) => { const [h, mm] = t.split(':').map(Number); const x = Math.min(h * 60 + mm + m, 23 * 60 + 59); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

// ======================= TAB 2: RPT =======================
const RptTab: React.FC<Props> = ({ user, masterData, dskpDocs, rptDocs, onRptUpdated, timetable, isAdmin }) => {
  const [subject, setSubject] = useState('');
  const [form, setForm] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ subject: string; form: string; year?: string; rows: RptRow[]; sourceFile: string } | null>(null);
  const [viewing, setViewing] = useState<RptDocument | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const needed = useMemo(() => {
    const m = new Map<string, { subject: string; form: string }>();
    timetable.slots.filter(s => !/^\s*pengurusan\s*$/i.test(s.subject)).forEach(s => m.set(`${s.subject}|${s.className}`, { subject: s.subject, form: s.className }));
    return Array.from(m.values()).map(x => ({ ...x, has: !!findRptDoc(rptDocs, x.subject, x.form) }));
  }, [timetable.slots, rptDocs]);
  const subjects = useMemo(() => Array.from(new Set([...(masterData.subjects || []), ...dskpDocs.map(d => d.subject), ...timetable.slots.map(s => s.subject)])).filter(Boolean).sort(), [masterData.subjects, dskpDocs, timetable.slots]);
  const forms = useMemo(() => Array.from(new Set([...Object.keys(masterData.classes || {}), ...dskpDocs.map(d => d.form), ...timetable.slots.map(s => s.className)])).filter(Boolean).sort(), [masterData.classes, dskpDocs, timetable.slots]);

  const onFile = async (f?: File) => {
    if (!f) return;
    setError('');
    if (!subject || !form) { setError('Pilih Subjek dan Tingkatan dahulu.'); return; }
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls' && !getGeminiKey()) { setError('Kunci API Gemini diperlukan untuk membaca PDF/Word. Tetapkan di menu Tetapan.'); return; }
    try {
      setBusy('Memproses...');
      const out = await extractRpt(f, { subject, form }, m => setBusy(m));
      if (!out.rows.length) throw new Error('Tiada baris minggu ditemui. Semak fail atau guna templat Excel.');
      setDraft({ subject, form, year: out.year, rows: out.rows, sourceFile: f.name });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };
  const save = async () => {
    if (!draft) return;
    try { setBusy('Menyimpan ke Firebase...'); await saveRpt({ ...draft, updatedBy: user.name }); setDraft(null); onRptUpdated(); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const editRow = (i: number, k: keyof RptRow, v: string) => setDraft(d => d && ({ ...d, rows: d.rows.map((r, j) => j === i ? { ...r, [k]: k === 'week' || k === 'weekEnd' ? Number(v) : v } : r) }));
  const template = () => {
    const csv = 'MINGGU,MINGGU AKHIR,TAJUK,BIDANG,SK,SP,CATATAN\n1,1,"Unit 1: Contoh Tajuk","Umum","1.1 Contoh SK","1.1.1 Contoh SP; 1.1.2 Contoh SP","PAK-21: Gallery Walk"\n2,3,"Unit 1: Contoh Tajuk","Umum","1.2 Contoh SK","1.2.1 SP; 1.2.2 SP; 1.2.3 SP",""\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'Templat_RPT.csv'; a.click();
  };

  return (
    <div className="space-y-6">
      {needed.length > 0 && (
        <div className={card}>
          <h2 className="font-extrabold text-slate-900 mb-3">RPT diperlukan oleh jadual anda</h2>
          <div className="flex flex-wrap gap-2">
            {needed.map(n => (
              <button key={n.subject + n.form} onClick={() => { setSubject(n.subject); setForm(n.form); }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${n.has ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                {n.has ? '✓' : '✗'} {n.subject} • {n.form}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={card}>
        <h2 className="font-extrabold text-slate-900 mb-1">Muat naik RPT</h2>
        <p className="text-xs text-slate-500 mb-4">PDF / Word dibaca oleh Gemini AI. Excel / CSV dengan lajur <b>MINGGU, TAJUK, SK, SP</b> diimport terus tanpa AI. Satu RPT dikongsi oleh semua guru bagi Subjek + Tingkatan yang sama.</p>
        <div className="grid md:grid-cols-3 gap-3">
          <div><span className={label}>Subjek</span><input list="rpt-subjects" className={input} value={subject} onChange={e => setSubject(e.target.value)} />
            <datalist id="rpt-subjects">{subjects.map(s => <option key={s} value={s} />)}</datalist></div>
          <div><span className={label}>Tingkatan</span><input list="rpt-forms" className={input} value={form} onChange={e => setForm(e.target.value)} placeholder="Tingkatan 1" />
            <datalist id="rpt-forms">{forms.map(s => <option key={s} value={s} />)}</datalist></div>
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}Pilih fail RPT
            </button>
            <button onClick={template} title="Muat turun templat CSV" className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600"><Download size={15} /></button>
          </div>
        </div>
        {busy && <p className="mt-3 text-xs font-semibold text-indigo-700">{busy}</p>}
        {error && <p className="mt-3 text-xs font-semibold text-rose-600 flex items-center gap-1.5"><AlertTriangle size={13} />{error}</p>}
      </div>

      {draft && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="font-extrabold text-slate-900">Semak RPT: {draft.subject} • {draft.form}</h2>
              <p className="text-xs text-slate-500">{draft.rows.length} baris daripada {draft.sourceFile}. Betulkan jika perlu sebelum simpan.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold">Batal</button>
              <button onClick={save} disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold"><Save size={15} />Simpan RPT</button>
            </div>
          </div>
          <RptTable rows={draft.rows} onEdit={editRow} onDelete={i => setDraft(d => d && ({ ...d, rows: d.rows.filter((_, j) => j !== i) }))}
            onAdd={() => setDraft(d => d && ({ ...d, rows: [...d.rows, { week: (d.rows[d.rows.length - 1]?.weekEnd || 0) + 1, title: '', sk: '', sp: '', field: '', notes: '' }] }))} />
        </div>
      )}

      <div className={card}>
        <h2 className="font-extrabold text-slate-900 mb-3">RPT tersimpan ({rptDocs.length})</h2>
        {rptDocs.length === 0 ? <p className="text-sm text-slate-500">Belum ada RPT.</p> : (
          <div className="divide-y divide-slate-100">
            {[...rptDocs].sort((a, b) => (a.subject + a.form).localeCompare(b.subject + b.form)).map(d => (
              <div key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{d.subject} • {d.form}</p>
                  <p className="text-[11px] text-slate-500">{d.rows.length} baris • M{Math.min(...d.rows.map(r => r.week))}–M{Math.max(...d.rows.map(r => r.weekEnd || r.week))} • {d.updatedBy || ''} {d.updatedAt ? new Date(d.updatedAt).toLocaleDateString('ms-MY') : ''}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setViewing(d)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold">Lihat</button>
                  <button onClick={() => { setSubject(d.subject); setForm(d.form); setDraft({ subject: d.subject, form: d.form, year: d.year, rows: d.rows, sourceFile: d.sourceFile || 'Firebase' }); }} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold">Sunting</button>
                  {(isAdmin || d.updatedBy === user.name) && (
                    <button onClick={async () => { if (confirm(`Padam RPT ${d.subject} ${d.form}?`)) { await deleteRpt(d.id); onRptUpdated(); } }} className="px-2 py-1.5 rounded-lg border border-rose-200 text-rose-600"><Trash2 size={13} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {viewing && (
        <div className="fixed inset-0 z-[500] bg-slate-900/60 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[85vh] overflow-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-extrabold">{viewing.subject} • {viewing.form}</h3>
              <button onClick={() => setViewing(null)}><X size={18} /></button>
            </div>
            <RptTable rows={viewing.rows} />
          </div>
        </div>
      )}
    </div>
  );
};

const RptTable: React.FC<{ rows: RptRow[]; onEdit?: (i: number, k: keyof RptRow, v: string) => void; onDelete?: (i: number) => void; onAdd?: () => void }> = ({ rows, onEdit, onDelete, onAdd }) => {
  const cols: { k: keyof RptRow; l: string; w: string }[] = [
    { k: 'week', l: 'M', w: 'w-14' }, { k: 'weekEnd', l: 'Hingga', w: 'w-14' }, { k: 'title', l: 'Tajuk', w: 'min-w-[160px]' },
    { k: 'field', l: 'Bidang', w: 'min-w-[100px]' }, { k: 'sk', l: 'SK', w: 'min-w-[180px]' }, { k: 'sp', l: 'SP', w: 'min-w-[240px]' }, { k: 'notes', l: 'Catatan', w: 'min-w-[160px]' },
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500"><tr>{cols.map(c => <th key={c.k} className={`text-left px-2 py-2 font-bold ${c.w}`}>{c.l}</th>)}{onDelete && <th />}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              {cols.map(c => (
                <td key={c.k} className="px-1.5 py-1">
                  {onEdit
                    ? (c.k === 'week' || c.k === 'weekEnd'
                      ? <input type="number" className="w-12 px-1 py-1 border border-slate-200 rounded" value={(r[c.k] as any) ?? ''} onChange={e => onEdit(i, c.k, e.target.value)} />
                      : <textarea rows={2} className="w-full px-1.5 py-1 border border-slate-200 rounded resize-y" value={(r[c.k] as any) ?? ''} onChange={e => onEdit(i, c.k, e.target.value)} />)
                    : <span className="whitespace-pre-wrap">{String(r[c.k] ?? '')}</span>}
                </td>
              ))}
              {onDelete && <td className="px-1"><button onClick={() => onDelete(i)} className="text-rose-500 p-1"><Trash2 size={13} /></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {onAdd && <button onClick={onAdd} className="m-2 inline-flex items-center gap-1 text-xs font-bold text-indigo-600"><Plus size={13} />Tambah baris</button>}
    </div>
  );
};

// ======================= TAB 3: AUTO =======================
const AutoTab: React.FC<Props> = ({ user, timetable, onSaveTimetable, calendar, erphs, rptDocs, dskpDocs, run, lastResults, onTrigger, onRunWindow, onGenerateWeek, onStop, onOpenErph }) => {
  const [settings, setSettings] = useState<AutoPilotSettings>(timetable.autoPilot);
  useEffect(() => setSettings(timetable.autoPilot), [timetable.autoPilot]);
  const [date, setDate] = useState(mytDateStr(Date.now()));
  const [regen, setRegen] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const hasKey = !!getGeminiKey();
  const nowWeek = weekOfDate(calendar, mytDateStr(Date.now()));

  const update = async (patch: Partial<AutoPilotSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { await onSaveTimetable({ ...timetable, autoPilot: next }); setSavedMsg('Tetapan disimpan'); setTimeout(() => setSavedMsg(''), 2000); }
    catch (e: any) { setSavedMsg('Gagal simpan: ' + e.message); }
  };

  const upcoming = useMemo(() => plannedOccurrences({ slots: timetable.slots, calendar, settings, mode: 'AUTO_24J' }).map(o => {
    const erph = findExisting(erphs, user.id, o);
    const plan = erph ? null : planLesson({
      rpt: findRptDoc(rptDocs, o.slot.subject, o.slot.className), dskp: findDskpDoc(dskpDocs, o.slot.subject, o.slot.className),
      week: o.week, position: lessonPosition(timetable.slots, o.slot), lastSp: lastSpFor(erphs, user.id, o.slot, o.date),
    });
    return { o, erph, plan };
  }), [timetable.slots, calendar, settings, erphs, rptDocs, dskpDocs, user.id]);

  const checks = [
    { ok: timetable.slots.length > 0, t: `Jadual waktu (${timetable.slots.length} slot)` },
    { ok: !!calendar, t: calendar ? `Kalendar akademik — sekarang Minggu ${nowWeek}` : 'Kalendar akademik belum ditetapkan (Admin → Kalendar)' },
    { ok: rptDocs.length > 0, t: `RPT dimuat naik (${rptDocs.length})` },
    { ok: dskpDocs.length > 0, t: `DSKP dalam pangkalan data (${dskpDocs.length})` },
    { ok: hasKey, t: hasKey ? 'Kunci API Gemini ditetapkan' : 'Kunci API Gemini belum ditetapkan (Tetapan)' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <div className={card}>
          <h2 className="font-extrabold text-slate-900 mb-3">Semakan kesediaan</h2>
          <ul className="space-y-2">{checks.map(c => <li key={c.t} className="flex items-center gap-2 text-sm">{c.ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <XCircle size={16} className="text-rose-500" />}<span className={c.ok ? 'text-slate-700' : 'text-rose-700 font-semibold'}>{c.t}</span></li>)}</ul>
        </div>
        <div className={card}>
          <div className="flex items-center justify-between mb-3"><h2 className="font-extrabold text-slate-900">Tetapan Auto-Jana</h2>{savedMsg && <span className="text-[11px] font-semibold text-emerald-600">{savedMsg}</span>}</div>
          <label className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-slate-700"><b>Jana RPH automatik</b> setiap hari mengikut jadual</span>
            <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={settings.enabled} onChange={e => update({ enabled: e.target.checked })} />
          </label>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div><span className={label}>Jana sebelum kelas</span>
              <select className={input} value={settings.leadHours} onChange={e => update({ leadHours: Number(e.target.value) })}>
                {[12, 24, 48, 72].map(h => <option key={h} value={h}>{h} jam</option>)}
              </select></div>
            <div><span className={label}>Bahasa lalai</span>
              <select className={input} value={settings.language} onChange={e => update({ language: e.target.value as any })}>
                <option value="BM">Bahasa Melayu</option><option value="BI">English</option><option value="JAWI">Jawi</option>
              </select></div>
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm text-slate-700">
            <input type="checkbox" className="accent-indigo-600" checked={!!settings.skipManagement} onChange={e => update({ skipManagement: e.target.checked })} /> Langkau slot PENGURUSAN
          </label>
          <p className="text-[11px] text-slate-500 mt-3 flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" />Subjek English → BI dan Pendidikan Islam → Jawi secara automatik.</p>
        </div>
      </div>

      <div className={card}>
        <h2 className="font-extrabold text-slate-900 mb-1">Trigger manual</h2>
        <p className="text-xs text-slate-500 mb-4">Jana RPH bagi semua kelas pada tarikh dipilih sekarang juga. RPH yang ditulis guru tidak akan diganti.</p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="date" className={input + ' max-w-[180px]'} value={date} onChange={e => setDate(e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" className="accent-indigo-600" checked={regen} onChange={e => setRegen(e.target.checked)} />Jana semula RPH AI yang masih Draf</label>
          <button onClick={() => onTrigger(date, regen)} disabled={run.running || !hasKey} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">
            {run.running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}Jana RPH tarikh ini
          </button>
          <button onClick={onRunWindow} disabled={run.running || !hasKey} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-700 text-sm font-bold disabled:opacity-50">
            <Clock size={15} />Jana {settings.leadHours} jam akan datang
          </button>
          <button onClick={() => onGenerateWeek(date)} disabled={run.running || !hasKey} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-700 text-sm font-bold disabled:opacity-50">
            <CalendarDays size={15} />Jana seminggu (Isnin → Isnin depan)
          </button>
          {run.running && (
            <button onClick={onStop} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-bold"><X size={15} />Henti Jana</button>
          )}
        </div>
        {run.running && <p className="mt-3 text-xs font-semibold text-indigo-700">{run.message} ({run.done}/{run.total})</p>}
      </div>

      <div className={card}>
        <h2 className="font-extrabold text-slate-900 mb-3">Kelas dalam tempoh {settings.leadHours} jam akan datang</h2>
        {upcoming.length === 0 ? <p className="text-sm text-slate-500">Tiada kelas.</p> : (
          <div className="divide-y divide-slate-100">
            {upcoming.map(({ o, erph, plan }) => (
              <div key={o.slot.id + o.date} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">{o.day} {o.date.split('-').reverse().join('/')} • {formatTime(o.slot.startTime)} • {o.slot.subject} <span className="font-normal text-slate-500">{o.slot.classTitle || o.slot.className}</span></p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {o.holiday ? `Cuti: ${o.holiday}` : erph ? `RPH sedia (${erph.autoGenerated ? 'AI' : 'manual'}): ${erph.sp || erph.sk || erph.title}` : plan ? `Akan dijana dari ${plan.source}: ${plan.sp || plan.sk}` : '⚠ Tiada RPT/DSKP sepadan — akan dilangkau'}
                  </p>
                </div>
                {erph ? <button onClick={() => onOpenErph(erph)} className="shrink-0 text-xs font-bold text-emerald-700 px-2.5 py-1 rounded-lg bg-emerald-50">Buka</button>
                  : <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg ${plan && !o.holiday ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{o.holiday ? 'CUTI' : plan ? 'MENUNGGU' : 'TIADA DATA'}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {lastResults.length > 0 && (
        <div className={card}>
          <h2 className="font-extrabold text-slate-900 mb-3">Log penjanaan terakhir</h2>
          <div className="divide-y divide-slate-100">
            {lastResults.map((r, i) => (
              <div key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{r.occ.day} {formatTime(r.occ.slot.startTime)} • {r.occ.slot.subject} {r.occ.slot.classTitle}</span>
                <span className={`shrink-0 text-[11px] font-bold ${r.status === 'CREATED' ? 'text-emerald-700' : r.status === 'ERROR' ? 'text-rose-600' : 'text-slate-500'}`}>
                  {r.status === 'CREATED' ? '✓ ' : r.status === 'ERROR' ? '✗ ' : '• '}{r.message}
                  {r.erph && <button onClick={() => onOpenErph(r.erph!)} className="ml-2 underline">Buka</button>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 space-y-1">
        <p className="font-bold text-slate-800">Bagaimana auto-jana 24 jam berfungsi?</p>
        <p>• Setiap kali aplikasi dibuka (dan setiap 30 minit semasa dibuka), sistem menjana RPH bagi semua kelas dari awal hari ini hingga {settings.leadHours} jam akan datang yang belum ada RPH.</p>
        <p>• Untuk penjanaan 24/7 walaupun aplikasi ditutup, Admin boleh aktifkan Cloud Function berjadual (lihat AUTO-RPH-PANDUAN.md).</p>
        <p>• Hantaran mingguan ialah <b>Isnin → Isnin minggu hadapan</b>. Mulai Khamis, AI turut menyiapkan RPH Isnin minggu hadapan (disimpan di minggu seterusnya, <b>tanpa refleksi</b>).</p>
        <p>• RPH dijana berstatus <b>Draf</b> — guru boleh semak, sunting dan hantar seperti biasa.</p>
      </div>
    </div>
  );
};

export default AutoRphCenter;
