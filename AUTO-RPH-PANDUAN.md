# SMART RPH — RPH Automatik AI (Jadual + RPT + DSKP → Gemini)

## Aliran
1. **Jadual Waktu** (Dashboard → *RPH Automatik AI* → tab *1. Jadual Waktu*): guru masukkan Hari, Masa Mula/Tamat, Subjek, Tingkatan, Kelas. Disimpan di Firestore `timetables/{idGuru}` (juga diselaraskan ke jadual lama & Google Sheet).
2. **RPT** (tab *2. RPT*): muat naik PDF/Word (dibaca Gemini) atau Excel/CSV (lajur `MINGGU, MINGGU AKHIR, TAJUK, BIDANG, SK, SP, CATATAN` — import terus tanpa AI). Semak & sunting jadual pratonton → Simpan. Firestore `rpt/{SUBJEK__TINGKATAN}` (dikongsi semua guru).
3. **DSKP**: guna pemuat naik DSKP sedia ada (Firestore `dskp`). Memberi Standard Prestasi & Catatan sebagai konteks AI.
4. **Auto-Jana** (tab *3*): hidup/matikan, tempoh (lalai **24 jam** sebelum kelas), bahasa, langkau slot Pengurusan.

## Cara RPH dijana
- Tarikh → **Minggu** ikut Kalendar Akademik (Admin). Minggu cuti/tarikh cuti dilangkau.
- Minggu → baris **RPT**. Jika kelas yang sama ada beberapa waktu seminggu, SP diagihkan (cth 3 SP / 3 kelas → 1 SP setiap kelas). Baris berjulat (M3–M4) dibahagi ikut minggu.
- Tiada RPT? → SP seterusnya dalam **DSKP** selepas SP terakhir yang diajar ke kelas itu.
- Gemini menjana **Objektif, Aktiviti, BBM, Refleksi** (format sedia ada: "Murid…", BI untuk English, Jawi untuk Pendidikan Islam).
- RPH disimpan sebagai **Draf** di Firebase `erph_records` + Google Sheet → guru semak, sunting, cetak, jana PDF, hantar mingguan, semakan pentadbir seperti biasa.
- ID RPH tetap (`AUTO_…`) → tiada pendua. RPH yang ditulis guru tidak akan diganti.

## Bila ia berjalan
- **Dalam aplikasi**: 10 saat selepas guru log masuk dan setiap 30 minit semasa aplikasi dibuka — menjana semua kelas dari awal hari ini hingga +24 jam.
- **Butang trigger**: kad *RPH Automatik AI* di Dashboard → *Jana RPH Hari Ini* (atau Esok / pilih tarikh).
- **24/7 walaupun aplikasi ditutup (pilihan)**: Cloud Function `functions/` (perlu pelan Blaze):
  ```bash
  npm i -g firebase-tools && firebase login
  cd functions && npm install && cd ..
  firebase functions:secrets:set GEMINI_API_KEY        # tampal kunci Gemini
  firebase deploy --only functions                     # tanya GAS_WEB_APP_URL → tampal URL Apps Script (atau kosong)
  ```
  Berjalan setiap 30 minit (Asia/Kuala_Lumpur, rantau asia-southeast1). Uji: `https://asia-southeast1-smart-rph-dzurri.cloudfunctions.net/autoRphRunNow?key=<6 aksara terakhir kunci Gemini>`.

## Firestore Rules
Koleksi baharu: `timetables`, `rpt`, `auto_rph_locks`. Jika Rules anda menyekat koleksi tertentu, benarkan baca/tulis bagi `timetables` dan `rpt` sama seperti `dskp`.

## Fail diubah / ditambah
- Baharu: `src/services/autoRphCore.ts`, `autoRphGenerate.ts`, `autoRphRunner.ts`, `rptService.ts`, `timetableService.ts`, `src/components/AutoRphCenter.tsx`, `AutoRphTodayCard.tsx`, `functions/`, `firebase.json`, `.firebaserc`
- Diubah: `src/App.tsx`, `src/types.ts`, `src/components/TeacherDashboard.tsx`, `src/services/geminiService.ts` (eksport fungsi + boleh jalan di Node)
- Salinan asal: `_backup_sebelum_autorph_2026-10-08/`

## Kemas kini 9 Okt 2026
- **Borang RPH**: slot kosong diisi automatik (Tajuk, Bidang, SK, SP + Objektif, Aktiviti, BBM, Refleksi). Butang **AUTO ISI (RPT + AI)** dan **HENTI JANA**; had masa Gemini 90 saat → guru boleh tekan **JANA AI** secara manual.
- **Hantaran Isnin → Isnin**: Pratonton & Hantar Minggu N = RPH Minggu N + RPH Isnin Minggu N+1 (Isnin depan ditanda `bundledInWeek` supaya tidak dihantar dua kali).
- AI menyiapkan RPH **Isnin minggu hadapan** (disimpan di minggu seterusnya) **tanpa refleksi**: auto mulai Khamis, atau butang **Jana Seminggu (Isnin→Isnin)** di Dashboard / editor mingguan / Pusat RPH Automatik.
- Butang **Henti Jana** untuk penjanaan pukal.

## Semakan Pentadbir → Firebase (9 Okt 2026)
- Semakan (satu atau pukal) kini disimpan ke Firestore dalam SATU `writeBatch`: `weekly_bundles/{id_minggu}` (status, ulasan, penyemak), `erph_records/{id}` (status DISEMAK), `signatures/{id}` (tandatangan disimpan sekali sahaja).
- Tiada lagi penjanaan PDF html2canvas, muat naik PDF base64 ke 2 GAS, atau tunggu 8 saat setiap hantaran.
- PDF rasmi (dengan ulasan & tandatangan) dijana semula bila guru/pentadbir buka "Lihat Template Rasmi".
- Hantaran baharu juga direkod di `weekly_bundles` (GAS hantaran guru dikekalkan). Data lama Google Sheet masih dibaca; status Firebase mengatasi.
- Notifikasi guru: Firebase + mesej ringkas ke GAS (tanpa PDF).
- Fail: `src/services/reviewService.ts`; diubah `App.tsx`, `AdminDashboard.tsx`, `TeacherDashboard.tsx`.
