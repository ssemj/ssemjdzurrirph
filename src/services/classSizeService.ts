// ============================================================
// BILANGAN MURID KELAS — DIKONGSI SELURUH SEKOLAH
// Firestore: class_sizes/{TINGKATAN__KELAS}
// Seorang guru daftar → semua guru yang mengajar kelas sama terus guna nilai yang sama.
// ============================================================
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { classSizeKey } from './autoRphCore';

export interface ClassSize { key: string; className: string; classTitle: string; count: number; updatedBy?: string; updatedAt?: string }

const withTimeout = <T,>(p: Promise<T>, ms = 15000): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Firestore tidak memberi respons')), ms))]);

export async function loadClassSizes(): Promise<Record<string, ClassSize>> {
  const snap = await withTimeout(getDocs(collection(db, 'class_sizes')));
  const out: Record<string, ClassSize> = {};
  snap.docs.forEach(d => { const x = d.data() as ClassSize; if (x.count > 0) out[d.id] = { ...x, key: d.id }; });
  return out;
}

export async function saveClassSize(className: string, classTitle: string, count: number, updatedBy = ''): Promise<ClassSize> {
  const key = classSizeKey(className, classTitle);
  const data: ClassSize = { key, className: className.trim(), classTitle: classTitle.trim(), count: Math.round(count), updatedBy, updatedAt: new Date().toISOString() };
  await withTimeout(setDoc(doc(db, 'class_sizes', key), data));
  return data;
}
