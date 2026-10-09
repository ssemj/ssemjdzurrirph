// ============================================================
// SEMAKAN PENTADBIR — Firebase (menggantikan GAS / Google Sheet)
//  weekly_bundles/{id_minggu} : hantaran mingguan + status semakan (dokumen kecil, tiada PDF)
//  signatures/{id}            : tandatangan penyemak (disimpan SEKALI, dirujuk melalui signatureId)
//  erph_records/{id}          : status DISEMAK + ulasan dikemas kini secara pukal (writeBatch)
// PDF rasmi TIDAK lagi dijana/dimuat naik semasa semakan — ia dijana semula bila dibuka
// (ERPHPreview / rphPdf) daripada data RPH + ulasan + tandatangan.
// ============================================================
import { collection, doc, getDoc, getDocs, query, where, writeBatch, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { ERPHData, ERPHStatus, WeeklyBundle } from '../types';

export interface BundleReviewDoc {
  id_minggu: string;
  teacherId: string;
  teacherName: string;
  week: string;              // "Minggu 37"
  rphIds: string;            // JSON array
  status_proses: string;     // PENDING | DISEMAK
  timestamp?: string;        // masa hantar
  comment?: string;
  reviewedBy?: string;
  reviewerDesignation?: string;
  reviewedAt?: string;
  signatureId?: string;
  fsUpdatedAt: string;       // ISO — untuk tapisan masa
}

const withTimeout = <T,>(p: Promise<T>, ms = 20000): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Firestore tidak memberi respons (semak internet / Firestore Rules)')), ms))]);
const safeId = (s: string) => String(s || '').replace(/\//g, '_');

/** Cincangan ringkas (djb2) — ID tandatangan yang stabil supaya tidak disimpan berulang kali. */
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i += 7) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + s.length.toString(36); };

export const parseRphIds = (raw?: string): string[] => {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.map(String) : []; }
  catch { return String(raw || '').split(',').map(x => x.trim()).filter(Boolean); }
};

// ---------------- Hantar (guru) ----------------
export async function saveSubmissionFs(b: { id_minggu: string; teacherId: string; teacherName: string; week: string; rphIds: string[] }) {
  const now = new Date().toISOString();
  await withTimeout(setDoc(doc(db, 'weekly_bundles', safeId(b.id_minggu)), {
    id_minggu: b.id_minggu, teacherId: b.teacherId, teacherName: b.teacherName, week: b.week,
    rphIds: JSON.stringify(b.rphIds), status_proses: 'PENDING', timestamp: now, fsUpdatedAt: now,
  } as BundleReviewDoc, { merge: true }));
}

// ---------------- Semak (pentadbir) — SATU batch untuk banyak hantaran ----------------
export interface ReviewInput { status: string; comment: string; signature: string; reviewedBy: string; reviewerDesignation?: string }

export async function reviewBundlesFs(
  items: { bundle: WeeklyBundle; rphIds: string[] }[],
  r: ReviewInput,
  onProgress?: (done: number, total: number) => void,
): Promise<{ signatureId: string; reviewedAt: string }> {
  const reviewedAt = new Date().toISOString();
  const signatureId = r.signature ? `sig_${hash(r.signature)}` : '';
  if (signatureId) {
    const ref = doc(db, 'signatures', signatureId);
    const snap = await withTimeout(getDoc(ref)).catch(() => null);
    if (!snap || !snap.exists()) await withTimeout(setDoc(ref, { dataUrl: r.signature, owner: r.reviewedBy, createdAt: reviewedAt }));
  }
  // Firestore: maks 500 operasi setiap batch
  let batch = writeBatch(db), ops = 0, done = 0;
  const flush = async () => { if (ops) { await withTimeout(batch.commit(), 30000); batch = writeBatch(db); ops = 0; } };
  for (const { bundle, rphIds } of items) {
    batch.set(doc(db, 'weekly_bundles', safeId(bundle.id_minggu)), {
      id_minggu: bundle.id_minggu, teacherId: bundle.teacherId || '', teacherName: bundle.teacherName || '',
      week: bundle.week || '', rphIds: JSON.stringify(rphIds), timestamp: bundle.timestamp || '',
      status_proses: r.status, comment: r.comment, reviewedBy: r.reviewedBy, reviewerDesignation: r.reviewerDesignation || '',
      reviewedAt, signatureId, fsUpdatedAt: reviewedAt,
    } as BundleReviewDoc, { merge: true });
    ops++;
    for (const id of rphIds) {
      if (ops >= 450) await flush();
      batch.set(doc(db, 'erph_records', safeId(id)), {
        status: r.status === 'DISEMAK' ? ERPHStatus.REVIEWED : r.status,
        reviewComment: r.comment, reviewedBy: r.reviewedBy, reviewerDesignation: r.reviewerDesignation || '',
        reviewedAt, reviewSignatureId: signatureId, reviewBundleId: bundle.id_minggu,
      }, { merge: true });
      ops++;
    }
    done++;
    if (ops >= 400) { await flush(); onProgress?.(done, items.length); }
  }
  await flush();
  onProgress?.(items.length, items.length);
  return { signatureId, reviewedAt };
}

// ---------------- Muat ----------------
/** Guru: hantaran sendiri. Pentadbir: semua hantaran dalam tempoh `days` hari. */
export async function loadBundleReviews(opts: { teacherId?: string; days?: number }): Promise<BundleReviewDoc[]> {
  const col = collection(db, 'weekly_bundles');
  const q = opts.teacherId
    ? query(col, where('teacherId', '==', opts.teacherId))
    : query(col, where('fsUpdatedAt', '>=', new Date(Date.now() - (opts.days || 200) * 86400000).toISOString()));
  const snap = await withTimeout(getDocs(q));
  return snap.docs.map(d => d.data() as BundleReviewDoc);
}

const sigCache: Record<string, string> = {};
export async function loadSignatures(ids: string[]): Promise<Record<string, string>> {
  const need = Array.from(new Set(ids.filter(id => id && !(id in sigCache))));
  await Promise.all(need.map(async id => {
    try { const s = await withTimeout(getDoc(doc(db, 'signatures', id))); sigCache[id] = s.exists() ? String((s.data() as any).dataUrl || '') : ''; }
    catch { /* abaikan */ }
  }));
  return { ...sigCache };
}

// ---------------- Gabung ke data aplikasi ----------------
/** Status semakan Firebase mengatasi data Google Sheet; hantaran Firebase sahaja ditambah. */
export function overlayBundles(bundles: WeeklyBundle[], reviews: BundleReviewDoc[]): WeeklyBundle[] {
  if (!reviews.length) return bundles;
  const map = new Map(reviews.map(r => [r.id_minggu, r]));
  const seen = new Set<string>();
  const out = bundles.map(b => {
    const r = map.get(b.id_minggu);
    if (!r) return b;
    seen.add(b.id_minggu);
    if (r.status_proses !== 'DISEMAK') return b;
    return { ...b, status_proses: 'DISEMAK', status: 'DISEMAK', comment: r.comment || b.comment, reviewedBy: r.reviewedBy || b.reviewedBy, reviewerDesignation: r.reviewerDesignation || b.reviewerDesignation, rphIds: b.rphIds || r.rphIds } as WeeklyBundle;
  });
  reviews.filter(r => !seen.has(r.id_minggu)).forEach(r => out.push({
    timestamp: r.timestamp || r.fsUpdatedAt, teacherName: r.teacherName, week: r.week, id_minggu: r.id_minggu,
    status_proses: r.status_proses, status: r.status_proses, jana_url: '', teacherId: r.teacherId, rphIds: r.rphIds,
    comment: r.comment, reviewedBy: r.reviewedBy, reviewerDesignation: r.reviewerDesignation,
  } as WeeklyBundle));
  return out;
}

export function overlayErphs(erphs: ERPHData[], reviews: BundleReviewDoc[], sigs: Record<string, string>): ERPHData[] {
  const done = reviews.filter(r => r.status_proses === 'DISEMAK');
  if (!done.length) return erphs;
  const byId = new Map<string, BundleReviewDoc>();
  done.forEach(r => parseRphIds(r.rphIds).forEach(id => byId.set(id, r)));
  let changed = false;
  const out = erphs.map(e => {
    const r = byId.get(e.id);
    if (!r) return e;
    const sig = (r.signatureId && sigs[r.signatureId]) || e.reviewSignature;
    if (e.status === ERPHStatus.REVIEWED && e.reviewComment === r.comment && e.reviewSignature === sig) return e;
    changed = true;
    return { ...e, status: ERPHStatus.REVIEWED, reviewComment: r.comment, reviewedBy: r.reviewedBy, reviewerDesignation: r.reviewerDesignation, reviewSignature: sig, reviewedAt: r.reviewedAt };
  });
  return changed ? out : erphs;
}
