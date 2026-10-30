// ============================================================
// PENDAFTARAN GURU BAHARU (oleh Admin) — Firestore: teachers/{loginId}
// Digabung dengan senarai guru dari Google Sheet semasa log masuk.
// ============================================================
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';

export interface NewTeacher {
  login: string;          // Login ID (cth No. IC / ID guru) — digunakan untuk log masuk
  name: string;
  designation?: string;   // Jawatan
  department?: string;    // Bidang / Unit
  grade?: string;         // Gred
  email?: string;
  phone?: string;
  photo?: string;         // URL gambar (pilihan)
  createdAt?: string;
  createdBy?: string;
}

const withTimeout = <T,>(p: Promise<T>, ms = 15000): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Firestore tidak memberi respons (semak internet / Firestore Rules)')), ms))]);
const safeId = (s: string) => String(s || '').trim().replace(/\//g, '_');

export async function loadFirebaseTeachers(): Promise<NewTeacher[]> {
  const snap = await withTimeout(getDocs(collection(db, 'teachers')));
  return snap.docs.map(d => d.data() as NewTeacher).filter(t => t.login && t.name);
}

export async function saveFirebaseTeacher(t: NewTeacher): Promise<NewTeacher> {
  const clean: NewTeacher = {
    login: t.login.trim(), name: t.name.trim().toUpperCase(),
    designation: (t.designation || 'Guru').trim(), department: (t.department || '').trim().toUpperCase(),
    grade: (t.grade || '').trim().toUpperCase(), email: (t.email || '').trim(), phone: (t.phone || '').trim(),
    photo: (t.photo || '').trim(), createdAt: t.createdAt || new Date().toISOString(), createdBy: t.createdBy || '',
  };
  if (!clean.login || !clean.name) throw new Error('Nama dan Login ID wajib diisi.');
  await withTimeout(setDoc(doc(db, 'teachers', safeId(clean.login)), clean));
  return clean;
}

export const deleteFirebaseTeacher = (login: string) => withTimeout(deleteDoc(doc(db, 'teachers', safeId(login))));

/** Bentuk rekod seperti baris registry Google Sheet supaya App memprosesnya sama. */
export const toRegistryRow = (t: NewTeacher) => ({
  login: t.login, id: t.login, namaguru: t.name, name: t.name, jawatan: t.designation, designation: t.designation,
  bidang: t.department, department: t.department, gred: t.grade, grade: t.grade, email: t.email, phone: t.phone,
  gambar: t.photo, source: 'FIREBASE',
});
