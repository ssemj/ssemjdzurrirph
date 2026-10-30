// ============================================================
// PdPC TIDAK DAPAT DIJALANKAN (kursus, cuti bencana, PdPR, CRK, MC, peperiksaan ...)
// Firestore: pdpc_exceptions/{id}
// Ayat refleksi dijana AI sekali semasa simpan, kemudian digunakan secara automatik
// pada semua RPH dalam julat tarikh (sedia ada & yang dijana kemudian).
// ============================================================
import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { PdpcException } from '../types';
import { generateWithFallback, getGeminiKey } from './geminiService';

export const PDPC_REASONS: { id: string; label: string; phrase: string }[] = [
  { id: 'KURSUS', label: 'Berkursus / Bengkel', phrase: 'guru terlibat dengan kursus' },
  { id: 'BENCANA', label: 'Cuti Bencana (banjir, jerebu dll)', phrase: 'sekolah ditutup kerana cuti bencana' },
  { id: 'PDPR', label: 'PdPR (dari rumah)', phrase: 'PdPC dilaksanakan secara PdPR' },
  { id: 'CRK', label: 'CRK (Cuti Rehat Khas)', phrase: 'guru mengambil Cuti Rehat Khas (CRK)' },
  { id: 'MC', label: 'MC / Cuti Sakit', phrase: 'guru bercuti sakit (MC)' },
  { id: 'PEPERIKSAAN', label: 'Peperiksaan / Pentaksiran', phrase: 'murid menduduki peperiksaan' },
  { id: 'PROGRAM', label: 'Program / Aktiviti Sekolah', phrase: 'murid/guru terlibat dengan program sekolah' },
  { id: 'TUGAS_RASMI', label: 'Tugas Rasmi Luar', phrase: 'guru menjalankan tugas rasmi di luar sekolah' },
  { id: 'LAIN', label: 'Lain-lain', phrase: '' },
];

const withTimeout = <T,>(p: Promise<T>, ms = 20000): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Firestore tidak memberi respons (semak internet / Firestore Rules)')), ms))]);

export const reasonLabel = (id: string) => PDPC_REASONS.find(r => r.id === id)?.label || id;

/** Ayat sandaran jika Gemini tiada / gagal. */
export function fallbackReflection(reason: string, detail = ''): string {
  const r = PDPC_REASONS.find(x => x.id === reason);
  const d = detail.trim() ? ` (${detail.trim()})` : '';
  if (reason === 'PDPR') return `PdPC dilaksanakan secara PdPR${d}. Murid diberikan tugasan dan bimbingan secara dalam talian.`;
  if (reason === 'PEPERIKSAAN') return `PdPC ditunda kerana murid menduduki peperiksaan${d}. Topik akan disambung pada sesi PdPC seterusnya.`;
  const what = r?.phrase || `guru terlibat dengan ${detail.trim() || 'urusan rasmi'}`;
  return `PdPC ditunda kerana ${what}${r?.phrase ? d : ''}. PdPC akan diganti pada waktu yang sesuai dan murid diberikan tugasan kendiri.`;
}

/** Jana ayat refleksi yang sesuai secara bijak menggunakan Gemini. */
export async function generateExceptionReflection(reason: string, detail: string, startDate: string, endDate: string): Promise<string> {
  if (!getGeminiKey()) return fallbackReflection(reason, detail);
  try {
    const res = await generateWithFallback({
      contents: `Anda guru sekolah menengah Malaysia. Tulis SATU atau DUA ayat ringkas (maksimum 35 patah perkataan, Bahasa Melayu baku) untuk ruangan REFLEKSI RPH apabila PdPC tidak dapat dijalankan.
Sebab: ${reasonLabel(reason)}
Butiran: ${detail || '-'}
Tarikh: ${startDate}${endDate && endDate !== startDate ? ` hingga ${endDate}` : ''}
Peraturan:
- Mulakan dengan "PdPC ditunda kerana ..." (KECUALI PdPR: mulakan "PdPC dilaksanakan secara PdPR ...").
- Nyatakan sebab dengan tepat (cth "guru terlibat dengan Kursus DSKP Seni Muzik", "guru bercuti sakit (MC)", "sekolah ditutup kerana cuti bencana banjir", "murid menduduki Peperiksaan Akhir Tahun").
- Ayat kedua (pilihan): tindakan susulan yang munasabah (cth PdPC diganti, murid diberi tugasan, topik disambung pada sesi berikutnya).
- Jangan guna tanda petikan, markdown atau senarai. Pulangkan ayat sahaja.`,
      config: { temperature: 0.4 },
    });
    const t = String(res.text || '').replace(/[*`"]/g, '').replace(/\s+/g, ' ').trim();
    return t.length > 15 ? t : fallbackReflection(reason, detail);
  } catch { return fallbackReflection(reason, detail); }
}

export async function loadExceptions(teacherId: string): Promise<PdpcException[]> {
  const snap = await withTimeout(getDocs(query(collection(db, 'pdpc_exceptions'), where('teacherId', '==', teacherId))));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as PdpcException))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export async function saveException(e: Omit<PdpcException, 'id'> & { id?: string }): Promise<PdpcException> {
  const id = e.id || `PDPC_${e.teacherId}_${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, '-');
  const data: PdpcException = {
    id, teacherId: e.teacherId, teacherName: e.teacherName || '', startDate: e.startDate,
    endDate: e.endDate && e.endDate >= e.startDate ? e.endDate : e.startDate,
    reason: e.reason, detail: e.detail || '', slotIds: e.slotIds || [], reflectionText: e.reflectionText,
    createdAt: e.createdAt || new Date().toISOString(),
  };
  await withTimeout(setDoc(doc(db, 'pdpc_exceptions', id), data));
  return data;
}

export const deleteException = (id: string) => withTimeout(deleteDoc(doc(db, 'pdpc_exceptions', id)));

export { exceptionFor } from './autoRphCore';
