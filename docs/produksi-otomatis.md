# Produksi otomatis harian

Fitur ini memproduksi video tanpa pengguna hadir. Pengguna menaruh ide cerita di
antrean, memilih jam mulai dan jumlah video per hari, lalu aplikasi menjalankan
jalur produksi biasa secara otomatis selama aplikasi terbuka.

## Cara kerja

- **Antrean ide** disimpan di tabel `auto_ideas` (lihat [data-model.md](data-model.md)):
  sinopsis, target durasi, bahasa, format, gaya visual, status
  (`pending`, `processing`, `done`, `failed`), proyek yang dihasilkan, dan pesan
  kegagalan. Ide diatur dari **Pengaturan › Produksi otomatis harian**.
- **Penjadwal** ada di `src/main/autoProducer.ts`, dimulai sekali dari
  `startAutoProducer()` di `src/main/index.ts` (di samping `resumeJobs()`).
  Setiap 30 detik ia memeriksa: fitur menyala, belum ada gelombang berjalan,
  tanggal hari ini belum tercatat di `autoLastRunDate`, dan jam komputer sudah
  melewati `autoTime`. Bila semua terpenuhi, satu gelombang jalan.
- **Satu gelombang** mengambil ide `pending` teratas sebanyak `autoPerDay`
  (bawaan 2, dijepit 1 sampai 5) dan memproduksinya satu per satu.
  Untuk gelombang terjadwal, `autoLastRunDate` ditulis **sebelum** produksi
  dimulai, jadi aplikasi yang ditutup dan dibuka lagi di hari yang sama tidak
  memproduksi gelombang kedua. Tombol **Jalankan sekarang** menjalankan
  gelombang manual yang tidak menyentuh tanggal jadwal.

## Jalur produksi per ide

Persis urutan manual, memakai fungsi dan antrean job yang sama:

1. `createProject` dari data ide.
2. `generateScript` lalu `generateVisuals(projectId, 'all')`.
3. `generateCharacterSheet` untuk setiap pemeran yang belum punya lembar
   karakter, ditunggu sampai selesai.
4. `generateMissingImages`, lalu `generateMissingVideos`; semua job ditunggu.
5. `generateNarration(projectId, 'all')` (sinkron Whisper mengikuti
   `whisperAuto` seperti biasa).
6. Bila `autoExport` menyala, `startExport` dengan bawaan 1080p, 30 fps,
   caption dibakar, file `.srt` ditulis, audio dinormalkan, dan musik di-duck,
   ke folder ekspor dari pengaturan (atau folder Video bawaan sistem).

Menunggu job dilakukan dengan polling `getJob` setiap 1,5 detik, batas 30 menit
per job. Job yang `failed` atau `canceled` menghentikan ide itu saja: ide
ditandai `failed` beserta pesannya, dan gelombang lanjut ke ide berikutnya.

## Batasan yang disengaja

- **Aplikasi harus terbuka.** Tidak ada layanan latar belakang sistem operasi;
  bila jamnya terlewat karena aplikasi tertutup, produksi terjadi saat aplikasi
  dibuka lagi di hari yang sama (karena pemeriksaan membandingkan jam, bukan
  menyamakan persis).
- **Hari yang terlewat tidak dikejar.** Gelombang hanya jalan untuk tanggal
  hari ini; kemarin yang kosong tidak dibuatkan susulan.
- **Biaya tetap nyata.** Setiap tahap memakai kunci API dan kredit pengguna
  seperti produksi manual. Karena itu fitur ini mati secara bawaan
  (`autoEnabled: false`) dan halaman pengaturannya mengingatkan soal biaya.
- **Pilihan per ide sengaja sempit**: durasi dan format saja. Bahasa mengikuti
  `defaultLanguage`, gaya visual dan model mengikuti bawaan aplikasi, sama
  seperti proyek baru yang dibuat tanpa membuka langkah Ide.
- Musik latar tidak ditambahkan otomatis; prompt musik tetap langkah manual di
  editor, karena file musiknya dipilih pengguna sendiri.

## Pengaturan

| Kunci | Bawaan | Arti |
|---|---|---|
| `autoEnabled` | `false` | Saklar utama penjadwal |
| `autoTime` | `07:00` | Jam mulai gelombang harian (waktu lokal) |
| `autoPerDay` | `2` | Jumlah video per gelombang (1 sampai 5) |
| `autoExport` | `true` | Ekspor MP4 di akhir produksi |
| `autoLastRunDate` | `null` | Tanggal gelombang terjadwal terakhir (YYYY-MM-DD) |

Kanal IPC: `auto:listIdeas`, `auto:addIdea`, `auto:removeIdea`, `auto:runNow`,
`auto:status` (tiga tempat seperti aturan proyek: `main/ipc.ts`,
`shared/api.ts`, `preload/index.ts`).
