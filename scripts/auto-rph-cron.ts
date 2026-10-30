// ============================================================
// AUTO-JANA RPH BERJADUAL (PERCUMA) — dijalankan oleh GitHub Actions setiap 30 minit
// Tidak perlu aplikasi dibuka. Guna Firebase (SDK klien, Firestore Rules terbuka) + Gemini.
// Logik sama dengan aplikasi: src/services/autoRphCore.ts & autoRphGenerate.ts
//   Rahsia GitHub: GEMINI_API_KEY (wajib), GAS_WEB_APP_URL (pilihan)
// Uji di komputer:  GEMINI_API_KEY=xxx npx tsx scripts/auto-rph-cron.ts
// ============================================================
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../src/firebaseConfig';
import { autoErphId, findExisting, mytDateStr, mytToMs, needsNextMonday, nextMondayStr, occurrencesBetween } from '../src/services/autoRphCore';
import { generateForOccurrence } from '../src/services/autoRphGenerate';
import { setGeminiKey } from '../src/services/geminiService';
import type { AcademicCalendar, DskpDocument, ERPHData, PdpcException, RptDocument, TeacherTimetable } from '../src/types';

const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 40);
const GAS = process.env.GAS_WEB_APP_URL || '';

async function main() {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) throw new Error('GEMINI_API_KEY tiada (tetapkan di GitHub → Settings → Secrets → Actions).');
  setGeminiKey(key);

  const [calSnap, rptSnap, dskpSnap, ttSnap, excSnap] = await Promise.all([
    getDoc(doc(db, 'settings', 'academicCalendar')),
    getDocs(collection(db, 'rpt')),
    getDocs(collection(db, 'dskp')),
    getDocs(query(collection(db, 'timetables'), where('autoPilot.enabled', '==', true))),
    getDocs(collection(db, 'pdpc_exceptions')),
  ]);
  const calendar = calSnap.exists() ? (calSnap.data() as AcademicCalendar) : null;
  if (!calendar?.week1Monday) { console.log('Kalendar akademik belum ditetapkan — berhenti.'); return; }
  const rptDocs = rptSnap.docs.map(d => ({ id: d.id, ...d.data() } as RptDocument));
  const dskpDocs = dskpSnap.docs.map(d => ({ id: d.id, ...d.data() } as DskpDocument));
  const allExc = excSnap.docs.map(d => ({ id: d.id, ...d.data() } as PdpcException));
  const now = Date.now();
  let created = 0, skipped = 0, errors = 0;

  for (const t of ttSnap.docs) {
    const tt = t.data() as TeacherTimetable;
    if (!tt.slots?.length) continue;
    const lead = tt.autoPilot?.leadHours || 12;
    let to = now + lead * 3600 * 1000;
    if (needsNextMonday(now)) to = Math.max(to, mytToMs(nextMondayStr(mytDateStr(now)), '23:59'));
    const occs = occurrencesBetween(tt.slots, calendar, mytToMs(mytDateStr(now), '00:00'), to);
    if (!occs.length) continue;
    const dates = Array.from(new Set(occs.map(o => o.date))).slice(0, 10);
    const known = (await getDocs(query(collection(db, 'erph_records'), where('teacherId', '==', tt.teacherId), where('date', 'in', dates))))
      .docs.map(d => d.data() as ERPHData);   // termasuk DELETED: guru padam → jangan jana semula
    const exceptions = allExc.filter(x => x.teacherId === tt.teacherId);

    for (const occ of occs) {
      if (created >= MAX_PER_RUN) break;
      if (findExisting(known, tt.teacherId, occ)) continue;
      const id = autoErphId(tt.teacherId, occ.date, occ.slot.startTime, occ.slot.classTitle || '', occ.slot.subject);
      const lockRef = doc(db, 'auto_rph_locks', id);
      const lock = await getDoc(lockRef);
      if (lock.exists() && Date.now() - Number(lock.data().at || 0) < 20 * 60 * 1000) continue;   // sedang dijana di tempat lain
      if ((await getDoc(doc(db, 'erph_records', id))).exists()) continue;
      await setDoc(lockRef, { at: Date.now() });
      try {
        const res = await generateForOccurrence(occ, {
          teacherId: tt.teacherId, teacherName: tt.teacherName || '', slots: tt.slots,
          settings: { enabled: true, leadHours: lead, language: tt.autoPilot?.language || 'BM', skipManagement: !!tt.autoPilot?.skipManagement },
          rptDocs, dskpDocs, erphs: known, generatedBy: 'CLOUD', exceptions,
        });
        if (res.status !== 'CREATED' || !res.erph) { skipped++; console.log(`• Langkau ${id}: ${res.message}`); continue; }
        await setDoc(doc(db, 'erph_records', id), { ...res.erph, createdAt: serverTimestamp(), source: 'GitHub_Auto_RPH' });
        known.push(res.erph);
        created++;
        console.log(`✓ ${tt.teacherName}: ${occ.date} ${occ.slot.startTime} ${occ.slot.subject} ${occ.slot.classTitle}`);
        if (GAS) {
          const { reviewSignature, ...payload } = res.erph as any;
          await fetch(GAS, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, logType: 'RPH_RECORD' }) }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 1000));   // had kadar Gemini
      } catch (e: any) {
        errors++;
        console.error(`✗ ${id}: ${e?.message || e}`);
      }
    }
  }
  console.log(`Selesai: ${created} dijana, ${skipped} dilangkau, ${errors} ralat.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
