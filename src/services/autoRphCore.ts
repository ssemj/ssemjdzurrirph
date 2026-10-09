// ============================================================
// ENJIN RPH AUTOMATIK — logik tulen (tiada Firebase / pelayar)
// Digunakan oleh aplikasi web (autoRphRunner.ts) DAN Cloud Function
// berjadual (functions/src/index.ts) supaya kedua-duanya konsisten.
//
// Kunci utama penjanaan: JADUAL WAKTU → (tarikh, minggu, slot)
//                         RPT         → Tajuk / SK / SP minggu tersebut
//                         DSKP        → Standard Prestasi & Catatan (konteks AI)
// Semua masa dikira dalam waktu Malaysia (UTC+8, tiada DST).
// ============================================================
import type { AcademicCalendar, DskpDocument, DskpRow, ERPHData, RptDocument, RptRow, ScheduleSlot } from '../types';

export const MYT_OFFSET_MS = 8 * 3600 * 1000;
export const DAY_NAMES = ['AHAD', 'ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT', 'SABTU'];
export const DAY_LABEL: Record<string, string> = { ISNIN: 'Isnin', SELASA: 'Selasa', RABU: 'Rabu', KHAMIS: 'Khamis', JUMAAT: 'Jumaat', SABTU: 'Sabtu', AHAD: 'Ahad' };
const SCHOOL_DAYS = ['ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT', 'SABTU', 'AHAD'];

// ---------------- Utiliti tarikh (waktu Malaysia) ----------------
const pad = (n: number) => String(n).padStart(2, '0');
/** "yyyy-mm-dd" bagi detik ms dalam waktu Malaysia. */
export const mytDateStr = (ms: number) => { const d = new Date(ms + MYT_OFFSET_MS); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
/** Detik ms bagi tarikh + masa "HH:mm" waktu Malaysia. */
export const mytToMs = (date: string, time = '00:00') => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = String(time || '0:0').split(':').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0) - MYT_OFFSET_MS;
};
export const addDaysStr = (date: string, n: number) => mytDateStr(mytToMs(date, '12:00') + n * 86400000);
export const dayNameOf = (date: string) => DAY_NAMES[new Date(mytToMs(date, '12:00') + MYT_OFFSET_MS).getUTCDay()];
export const normDay = (d?: string) => String(d || '').trim().toUpperCase();
const toMin = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const mondayOfStr = (date: string) => { const wd = new Date(mytToMs(date, '12:00') + MYT_OFFSET_MS).getUTCDay() || 7; return addDaysStr(date, -(wd - 1)); };

export const weekOfDate = (cal: AcademicCalendar | null | undefined, date: string): number | null => {
  if (!cal?.week1Monday) return null;
  const diff = Math.round((mytToMs(mondayOfStr(date), '12:00') - mytToMs(mondayOfStr(cal.week1Monday), '12:00')) / 86400000);
  return Math.floor(diff / 7) + 1;
};
export const holidayOnDate = (cal: AcademicCalendar | null | undefined, date: string) =>
  cal?.holidays?.find(h => h.start && h.end && date >= h.start && date <= h.end) || null;

// ---------------- Normalisasi nama ----------------
export const normSubject = (s?: string) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
export const normForm = (f?: string) => String(f || '').trim().toUpperCase().replace(/^(TINGKATAN|TING\.?|TKT\.?|TAHUN|T)\s*/, '').replace(/\s+/g, ' ');
export const docKey = (subject: string, form: string) =>
  `${subject}__${form}`.toUpperCase().normalize('NFKD').replace(/[^A-Z0-9_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

export const isManagement = (subject?: string) => /^\s*pengurusan\s*$/i.test(String(subject || ''));
/** Slot yang tidak perlu RPH. */
export const isNonTeaching = (subject?: string) => /^\s*(cuti|cuti umum|rehat|perhimpunan|peperiksaan.*|serlahan seni)\s*$/i.test(String(subject || ''));

// ---------------- Jadual → kejadian kelas ----------------
export interface Occurrence {
  slot: ScheduleSlot;
  date: string;        // yyyy-mm-dd
  day: string;         // "Isnin"
  week: number | null; // ikut kalendar akademik
  startMs: number;
  holiday?: string;
}

/** Semua kelas dalam julat [fromMs, toMs] (termasuk), mengikut jadual mingguan guru. */
export function occurrencesBetween(slots: ScheduleSlot[], cal: AcademicCalendar | null | undefined, fromMs: number, toMs: number): Occurrence[] {
  const out: Occurrence[] = [];
  let date = mytDateStr(fromMs);
  const last = mytDateStr(toMs);
  for (let guard = 0; date <= last && guard < 400; guard++, date = addDaysStr(date, 1)) {
    const dn = dayNameOf(date);
    for (const slot of slots) {
      if (normDay(slot.day) !== dn || !slot.startTime || !slot.subject) continue;
      const startMs = mytToMs(date, slot.startTime);
      if (startMs < fromMs || startMs > toMs) continue;
      const hol = holidayOnDate(cal, date);
      out.push({ slot, date, day: DAY_LABEL[dn] || dn, week: weekOfDate(cal, date), startMs, holiday: hol?.name });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** Semua kelas pada satu tarikh. */
export const occurrencesOnDate = (slots: ScheduleSlot[], cal: AcademicCalendar | null | undefined, date: string) =>
  occurrencesBetween(slots, cal, mytToMs(date, '00:00'), mytToMs(date, '23:59'));

/** Kedudukan kelas ini dalam minggu bagi subjek + kelas yang sama (untuk agihan SP). */
export function lessonPosition(slots: ScheduleSlot[], slot: ScheduleSlot): { index: number; total: number } {
  const same = slots
    .filter(s => normSubject(s.subject) === normSubject(slot.subject) && normForm(s.className) === normForm(slot.className)
      && String(s.classTitle || '').trim().toUpperCase() === String(slot.classTitle || '').trim().toUpperCase())
    .sort((a, b) => (SCHOOL_DAYS.indexOf(normDay(a.day)) - SCHOOL_DAYS.indexOf(normDay(b.day))) || (toMin(a.startTime) - toMin(b.startTime)));
  const index = Math.max(0, same.findIndex(s => s.id === slot.id || (normDay(s.day) === normDay(slot.day) && s.startTime === slot.startTime)));
  return { index, total: Math.max(1, same.length) };
}

// ---------------- RPT → isi pelajaran ----------------
export const findRptDoc = (docs: RptDocument[], subject?: string, form?: string) =>
  docs.find(d => normSubject(d.subject) === normSubject(subject) && normForm(d.form) === normForm(form)) || null;

export const findDskpDoc = (docs: DskpDocument[], subject?: string, form?: string) =>
  docs.find(d => normSubject(d.subject) === normSubject(subject) && normForm(d.form) === normForm(form)) || null;

const splitList = (s?: string) => String(s || '').split(/\s*(?:;|\n)\s*/).map(x => x.trim()).filter(Boolean);
const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));
const code = (s: string) => s.match(/^\s*(\d+(?:\.\d+)*)/)?.[1] || '';

interface Unit { title: string; field: string; sk: string; sp: string; notes: string }

/** Pecah senarai kepada `total` bahagian; bahagian ke-`index`. Jika item < total, ulang (pengukuhan). */
export function chunkFor<T>(items: T[], index: number, total: number): T[] {
  if (!items.length) return [];
  if (items.length <= total) return [items[Math.min(items.length - 1, Math.floor(index * items.length / total))]];
  const start = Math.floor(index * items.length / total), end = Math.floor((index + 1) * items.length / total);
  return items.slice(start, Math.max(end, start + 1));
}

/** Baris RPT yang meliputi minggu `week` — baris berjulat (M3–M4) dibahagi SP-nya ikut minggu. */
export function rptUnitsForWeek(doc: RptDocument | null, week: number | null): Unit[] {
  if (!doc || week == null) return [];
  const units: Unit[] = [];
  for (const r of doc.rows as RptRow[]) {
    const w0 = Number(r.week), w1 = Number(r.weekEnd || r.week);
    if (!(week >= w0 && week <= w1)) continue;
    const sks = splitList(r.sk);
    let sps = splitList(r.sp);
    if (w1 > w0) sps = chunkFor(sps, week - w0, w1 - w0 + 1);
    if (!sps.length && sks.length) sps = [''];
    for (const sp of sps) {
      const c = code(sp);
      const sk = sks.filter(k => c && code(k) && c.startsWith(code(k) + '.'));
      units.push({ title: r.title || '', field: r.field || '', sk: (sk.length ? sk : sks).join('; '), sp, notes: r.notes || '' });
    }
  }
  return units;
}

export interface LessonPlan {
  title: string; field: string; sk: string; sp: string; notes: string;
  source: string;          // cth "RPT M12 (1/3)"
}

const mergeUnits = (units: Unit[], source: string): LessonPlan => ({
  title: uniq(units.map(u => u.title)).join(' / '),
  field: uniq(units.map(u => u.field)).join(' / '),
  sk: uniq(units.flatMap(u => splitList(u.sk))).join('; '),
  sp: uniq(units.map(u => u.sp)).join('; '),
  notes: uniq(units.map(u => u.notes)).join(' '),
  source,
});

/** Sandaran jika tiada RPT: SP seterusnya dalam DSKP selepas SP terakhir yang diajar ke kelas ini. */
export function nextFromDskp(dskp: DskpDocument | null, lastSp?: string): LessonPlan | null {
  if (!dskp?.rows?.length) return null;
  const rows = dskp.rows;
  const lastCodes = splitList(lastSp).map(code).filter(Boolean);
  let idx = 0;
  if (lastCodes.length) {
    const i = rows.findIndex(r => code(r.sp) === lastCodes[lastCodes.length - 1]);
    idx = i >= 0 ? (i + 1) % rows.length : 0;
  }
  const r = rows[idx];
  return { title: r.title, field: r.field || '', sk: r.sk, sp: r.sp, notes: r.notes || '', source: 'DSKP (turutan)' };
}

/** Tentukan Tajuk/SK/SP bagi satu kelas. */
export function planLesson(args: {
  rpt: RptDocument | null; dskp: DskpDocument | null; week: number | null;
  position: { index: number; total: number }; lastSp?: string;
}): LessonPlan | null {
  const units = rptUnitsForWeek(args.rpt, args.week);
  if (units.length) {
    const pick = chunkFor(units, args.position.index, args.position.total);
    return mergeUnits(pick, `RPT M${args.week}${args.position.total > 1 ? ` (${args.position.index + 1}/${args.position.total})` : ''}`);
  }
  return nextFromDskp(args.dskp, args.lastSp);
}

/** Baris DSKP penuh (TP + catatan) bagi SK/SP terpilih — konteks untuk Gemini. */
export function dskpContextRows(dskp: DskpDocument | null, sk: string, sp: string): DskpRow[] {
  if (!dskp) return [];
  const spCodes = splitList(sp).map(code).filter(Boolean);
  const skCodes = splitList(sk).map(code).filter(Boolean);
  let rows = dskp.rows.filter(r => spCodes.includes(code(r.sp)));
  if (!rows.length) rows = dskp.rows.filter(r => skCodes.includes(code(r.sk)));
  return rows.slice(0, 8);
}

// ---------------- Rekod RPH ----------------
/** ID tetap → elak RPH berganda bila dijana dari beberapa peranti / Cloud Function. */
export const autoErphId = (teacherId: string, date: string, startTime: string, classTitle: string, subject: string) =>
  ('AUTO_' + [teacherId, date, startTime.replace(':', ''), classTitle, subject].join('_'))
    .toUpperCase().normalize('NFKD').replace(/[^A-Z0-9_]+/g, '-').slice(0, 140);

/** Adakah RPH untuk kelas ini sudah wujud (dijana atau ditulis manual)? */
export function findExisting(erphs: ERPHData[], teacherId: string, occ: Occurrence): ERPHData | undefined {
  const s = occ.slot;
  const id = autoErphId(teacherId, occ.date, s.startTime, s.classTitle || '', s.subject);
  return erphs.find(e => (e.id === id || (
    String(e.teacherId || '').toLowerCase() === teacherId.toLowerCase() &&
    e.date === occ.date && e.startTime === s.startTime &&
    normSubject(e.subject) === normSubject(s.subject) &&
    String(e.classTitle || '').trim().toUpperCase() === String(s.classTitle || '').trim().toUpperCase())));
}

/** SP terakhir yang diajar kepada kelas ini sebelum tarikh tersebut (untuk sandaran DSKP). */
export function lastSpFor(erphs: ERPHData[], teacherId: string, slot: ScheduleSlot, beforeDate: string) {
  return erphs
    .filter(e => String(e.teacherId || '').toLowerCase() === teacherId.toLowerCase() && e.date < beforeDate && e.sp
      && normSubject(e.subject) === normSubject(slot.subject)
      && String(e.classTitle || '').trim().toUpperCase() === String(slot.classTitle || '').trim().toUpperCase())
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime))[0]?.sp;
}

/** Isnin minggu hadapan (relatif kepada tarikh). */
export const nextMondayStr = (date: string) => addDaysStr(mondayOfStr(date), 7);
/** RPH minggu hadapan (cth Isnin depan) belum diajar → refleksi dikosongkan. */
export const isFutureWeek = (date: string, todayMs = Date.now()) => !!date && date >= nextMondayStr(mytDateStr(todayMs));
/** Hari Khamis–Ahad → RPH Isnin minggu hadapan perlu disiapkan (hantaran Isnin ke Isnin). */
export const needsNextMonday = (todayMs = Date.now()) => [0, 4, 5, 6].includes(new Date(todayMs + MYT_OFFSET_MS).getUTCDay());

export const durationLabel = (start: string, end: string) => {
  const m = toMin(end) - toMin(start);
  return m > 0 ? `${m} minit` : '';
};
