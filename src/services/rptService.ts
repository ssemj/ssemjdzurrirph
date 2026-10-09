// ============================================================
// Rancangan Pengajaran Tahunan (RPT) — Firestore: rpt/{SUBJEK__TINGKATAN}
// Muat naik PDF / Word / Excel / CSV → baris Minggu | Tajuk | SK | SP | Catatan
// ============================================================
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { Type } from '@google/genai';
import { db } from '../firebaseConfig';
import { RptDocument, RptRow } from '../types';
import { fileToBase64, generateWithFallback, parseJson } from './geminiService';
import { docKey } from './autoRphCore';

const COLLECTION = 'rpt';
const withTimeout = <T,>(p: Promise<T>, ms = 20000): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Firestore tidak memberi respons (semak internet / Firestore Rules)')), ms))]);

export const rptDocId = (subject: string, form: string) => docKey(subject, form);

export const cleanRptRows = (rows: RptRow[]): RptRow[] => {
  const t = (v: any) => String(v ?? '').replace(/[ \t]+/g, ' ').trim();
  return rows
    .map(r => {
      const week = parseInt(String(r.week), 10);
      const weekEnd = parseInt(String(r.weekEnd ?? ''), 10);
      return {
        week, weekEnd: weekEnd > week ? weekEnd : week,
        title: t(r.title), field: t(r.field), sk: t(r.sk), sp: t(r.sp), notes: t(r.notes),
      };
    })
    .filter(r => r.week > 0 && r.week <= 60 && (r.sk || r.sp || r.title))
    .sort((a, b) => a.week - b.week);
};

export async function loadAllRpt(): Promise<RptDocument[]> {
  const snap = await withTimeout(getDocs(collection(db, COLLECTION)));
  return snap.docs.map(d => {
    const x = d.data() as any;
    return { id: d.id, subject: x.subject, form: x.form, year: x.year, rows: Array.isArray(x.rows) ? x.rows : [], sourceFile: x.sourceFile, updatedAt: x.updatedAt, updatedBy: x.updatedBy };
  });
}

export async function saveRpt(input: Omit<RptDocument, 'id' | 'updatedAt'>): Promise<RptDocument> {
  const id = rptDocId(input.subject, input.form);
  const payload = {
    subject: input.subject.trim(), form: input.form.trim(), year: input.year || '',
    rows: cleanRptRows(input.rows), sourceFile: input.sourceFile || '', updatedBy: input.updatedBy || '',
    updatedAt: new Date().toISOString(),
  };
  await withTimeout(setDoc(doc(db, COLLECTION, id), payload));
  return { id, ...payload };
}

export const deleteRpt = (id: string) => withTimeout(deleteDoc(doc(db, COLLECTION, id)));

// ---------------- Ekstrak ----------------
const RPT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    subject: { type: Type.STRING }, form: { type: Type.STRING }, year: { type: Type.STRING },
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          week: { type: Type.INTEGER, description: 'Nombor minggu mula' },
          weekEnd: { type: Type.INTEGER, description: 'Nombor minggu akhir jika julat (cth M3-M4 → 4), jika tidak sama dengan week' },
          title: { type: Type.STRING, description: 'Tajuk / Unit / Tema' },
          field: { type: Type.STRING, description: 'Bidang / Kemahiran (boleh kosong)' },
          sk: { type: Type.STRING, description: 'Standard Kandungan dengan nombor; beberapa dipisah "; "' },
          sp: { type: Type.STRING, description: 'Standard Pembelajaran dengan nombor; beberapa dipisah "; "' },
          notes: { type: Type.STRING, description: 'Catatan / cadangan aktiviti / PBD / EMK (boleh kosong)' },
        },
        required: ['week', 'title', 'sk', 'sp'],
      },
    },
  },
  required: ['rows'],
};

const rptPrompt = (h: { subject?: string; form?: string }) => `
Anda pakar kurikulum KPM Malaysia. Dokumen ini ialah Rancangan Pengajaran Tahunan (RPT).
Ekstrak SETIAP baris minggu persekolahan ke dalam JSON.
Peraturan:
- 'week' = nombor minggu (cth "Minggu 5" → 5). Julat "M3-M4" / "Minggu 3 & 4" → week 3, weekEnd 4.
- ABAIKAN baris cuti, peperiksaan, orientasi atau minggu tanpa SK/SP.
- Kekalkan nombor dan ayat asal SK/SP (cth "1.1 ...", "1.1.1 ..."). JANGAN ringkaskan. Beberapa SK/SP dipisahkan "; ".
- 'notes' = catatan / cadangan aktiviti / PAK-21 / PBD / EMK jika ada.
${h.subject ? `- Mata pelajaran: ${h.subject}.` : ''}
${h.form ? `- Ekstrak HANYA untuk ${h.form} jika dokumen mengandungi beberapa tingkatan.` : ''}
Pulangkan JSON sahaja.`;

// Pengepala lajur yang dikenali untuk import terus (tanpa AI)
const ALIASES: Record<keyof RptRow, string[]> = {
  week: ['MINGGU', 'WEEK', 'M', 'MINGGU MULA'],
  weekEnd: ['MINGGU AKHIR', 'WEEK END', 'HINGGA'],
  title: ['TAJUK', 'UNIT', 'TEMA', 'TITLE', 'TOPIK'],
  field: ['BIDANG', 'KEMAHIRAN', 'MODUL', 'FIELD', 'SKILL'],
  sk: ['SK', 'STANDARD KANDUNGAN', 'CONTENT STANDARD'],
  sp: ['SP', 'STANDARD PEMBELAJARAN', 'LEARNING STANDARD'],
  notes: ['CATATAN', 'NOTES', 'AKTIVITI', 'CADANGAN AKTIVITI', 'PBD'],
};
const pick = (row: Record<string, any>, key: keyof RptRow) => {
  for (const k of Object.keys(row)) if (ALIASES[key].includes(k.trim().toUpperCase())) return String(row[k] ?? '').trim();
  return '';
};

/** Excel/CSV dengan lajur MINGGU, TAJUK, SK, SP → terus tanpa AI. "3-4" dalam MINGGU diterima. */
export function parseRptTable(objects: Record<string, any>[]): RptRow[] {
  return cleanRptRows(objects.map(o => {
    const wk = pick(o, 'week');
    const m = wk.match(/(\d+)\s*(?:-|–|hingga|&|ke)?\s*M?(\d+)?/i);
    return {
      week: m ? Number(m[1]) : NaN, weekEnd: m?.[2] ? Number(m[2]) : Number(pick(o, 'weekEnd')) || undefined,
      title: pick(o, 'title'), field: pick(o, 'field'), sk: pick(o, 'sk'), sp: pick(o, 'sp'), notes: pick(o, 'notes'),
    } as RptRow;
  }));
}

export interface RptExtraction { subject?: string; form?: string; year?: string; rows: RptRow[]; method: 'TABLE' | 'AI' }

export async function extractRpt(file: File, hints: { subject?: string; form?: string } = {}, onProgress?: (m: string) => void): Promise<RptExtraction> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const parts: any[] = [];

  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    onProgress?.('Membaca hamparan...');
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    // Cuba import terus jika pengepala dikenali
    for (const name of wb.SheetNames) {
      const objs = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[name], { defval: '' });
      const rows = parseRptTable(objs);
      if (rows.length >= 3) return { rows, method: 'TABLE', ...hints };
    }
    const csv = wb.SheetNames.map(n => `### ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n').slice(0, 400000);
    parts.push({ text: `KANDUNGAN RPT (CSV):\n${csv}` });
  } else if (ext === 'pdf') {
    onProgress?.('Membaca PDF...');
    parts.push({ inlineData: { mimeType: 'application/pdf', data: await fileToBase64(file) } });
  } else if (ext === 'docx') {
    onProgress?.('Menukar dokumen Word...');
    const mammoth = await import('mammoth');
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    parts.push({ text: `KANDUNGAN RPT (HTML):\n${html}` });
  } else {
    throw new Error('Format tidak disokong. Guna PDF, DOCX, XLSX atau CSV.');
  }

  parts.push({ text: rptPrompt(hints) });
  onProgress?.('Gemini AI sedang membaca RPT minggu demi minggu... (1–3 minit)');
  const res = await generateWithFallback({
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', responseSchema: RPT_SCHEMA, temperature: 0, maxOutputTokens: 65536 },
  }, onProgress);
  const data = parseJson<{ subject?: string; form?: string; year?: string; rows: RptRow[] }>(res.text);
  return { subject: data.subject, form: data.form, year: data.year, rows: cleanRptRows(data.rows || []), method: 'AI' };
}
