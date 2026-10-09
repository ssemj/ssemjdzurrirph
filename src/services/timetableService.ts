// ============================================================
// Jadual Waktu Guru — Firestore: timetables/{teacherId}
// Juga menyimpan tetapan RPH Automatik (autoPilot) guru.
// ============================================================
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { AutoPilotSettings, ScheduleSlot, TeacherTimetable } from '../types';

export const DEFAULT_AUTOPILOT: AutoPilotSettings = { enabled: true, leadHours: 24, language: 'BM', skipManagement: false };

const withTimeout = <T,>(p: Promise<T>, ms = 15000): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Firestore tidak memberi respons')), ms))]);

const safeId = (id: string) => String(id || '').replace(/\//g, '_');

export async function loadTimetable(teacherId: string): Promise<TeacherTimetable | null> {
  const snap = await withTimeout(getDoc(doc(db, 'timetables', safeId(teacherId))));
  if (!snap.exists()) return null;
  const d = snap.data() as any;
  return {
    teacherId, teacherName: d.teacherName || '',
    slots: Array.isArray(d.slots) ? d.slots : [],
    autoPilot: { ...DEFAULT_AUTOPILOT, ...(d.autoPilot || {}) },
    updatedAt: d.updatedAt,
  };
}

export async function saveTimetable(tt: TeacherTimetable): Promise<void> {
  const clean = (s: ScheduleSlot): ScheduleSlot => ({
    id: s.id, teacherId: tt.teacherId, day: String(s.day || '').toUpperCase(), startTime: s.startTime, endTime: s.endTime,
    subject: (s.subject || '').trim(), className: (s.className || '').trim(), classTitle: (s.classTitle || '').trim(),
  });
  await withTimeout(setDoc(doc(db, 'timetables', safeId(tt.teacherId)), {
    teacherId: tt.teacherId, teacherName: tt.teacherName || '',
    slots: tt.slots.map(clean),
    autoPilot: { ...DEFAULT_AUTOPILOT, ...tt.autoPilot },
    updatedAt: new Date().toISOString(),
  }));
}
