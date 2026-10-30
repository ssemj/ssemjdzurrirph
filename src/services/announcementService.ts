// ============================================================
// PAPAN PESANAN PENTADBIR — Firestore: announcements/{id}
// Ditulis oleh Admin, dipaparkan di Home semua guru (sync serta-merta).
// Peringatan automatik Khamis & Jumaat dijana tanpa pangkalan data.
// ============================================================
import { collection, deleteDoc, doc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { addDaysStr, dayNameOf, mytDateStr } from './autoRphCore';

export interface Announcement {
  id: string;
  message: string;
  authorName: string;
  authorDesignation?: string;
  date: string;          // yyyy-mm-dd
  time?: string;         // HH:mm (pilihan)
  important?: boolean;   // pesanan penting (dipaparkan di atas)
  createdAt: string;
  createdBy?: string;
  auto?: boolean;        // peringatan automatik (tidak disimpan)
}

const withTimeout = <T,>(p: Promise<T>, ms = 15000): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Firestore tidak memberi respons (semak internet / Firestore Rules)')), ms))]);

export async function loadAnnouncements(max = 30): Promise<Announcement[]> {
  const snap = await withTimeout(getDocs(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(max))));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Announcement));
}

export async function saveAnnouncement(a: Omit<Announcement, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<Announcement> {
  const id = a.id || `ANN_${Date.now()}`;
  const data: Announcement = {
    id, message: a.message.trim(), authorName: a.authorName.trim(), authorDesignation: (a.authorDesignation || '').trim(),
    date: a.date, time: a.time || '', important: !!a.important, createdAt: a.createdAt || new Date().toISOString(), createdBy: a.createdBy || '',
  };
  if (!data.message) throw new Error('Mesej tidak boleh kosong.');
  await withTimeout(setDoc(doc(db, 'announcements', id), data));
  return data;
}

export const deleteAnnouncement = (id: string) => withTimeout(deleteDoc(doc(db, 'announcements', id)));

const dmy = (d: string) => d.split('-').reverse().join('/');

/** Peringatan automatik Pengetua: Khamis (esok hantar) & Jumaat (hari ini hantar). */
export function autoReminder(principal: { name: string; designation: string }, todayMs = Date.now()): Announcement | null {
  const today = mytDateStr(todayMs);
  const dn = dayNameOf(today);
  const base = { id: `AUTO_${today}`, authorName: principal.name, authorDesignation: principal.designation, date: today, time: '07:00', important: true, createdAt: `${today}T07:00:00`, auto: true };
  if (dn === 'KHAMIS') {
    const fri = addDaysStr(today, 1);
    return { ...base, message: `Peringatan mesra: penghantaran RPH pada esok, Jumaat (${dmy(fri)}). Sila pastikan RPH ditulis bersama dengan Refleksi.` };
  }
  if (dn === 'JUMAAT') {
    return { ...base, message: `Sila hantar RPH anda pada hari ini, Jumaat (${dmy(today)}). Pastikan RPH mingguan ditulis lengkap dengan refleksi. Jangan lupa sertakan RPH hari pertama pada minggu seterusnya.` };
  }
  return null;
}
