# Penerbitan paket Studio

1. Cocokkan sumber paket dengan SPO dan tata naskah yang berlaku. Perbarui sumber Studio dan bangun ulang snapshot. Jika sumber belum sah, biarkan Studio memblokir finalisasi.
2. Rekonsiliasi nomor untuk seri `sk`, `spo`, `form`, `materi`, dan `monitoring` dari register RSIA. Setelah migrasi Studio, isi `melinda_private.studio_number_series` melalui administrasi database. Gunakan `id`, `format` resmi yang memuat `{seq}`, `next_sequence` yang sudah diperiksa, `authority = 'director'`, dan `source_ids` yang menunjuk dokumen sumber. Tandai `reconciled` setelah register diperiksa. Pertahankan penghitung yang sudah berjalan dan periksa juga nomor yang terbit sebelum Studio.
3. Setelah review substansi, Direktur memilih tanggal penetapan, menyiapkan paket, dan mengunduh PDF final. PDF diterbitkan untuk ditandatangani di luar Studio.
4. Petugas arsip memeriksa seluruh dokumen yang ditandatangani dalam paket dan mencocokkannya dengan versi final. Ambil `id` dan `payload->>'finalizedHash'` dari `melinda_private.studio_packages`. Tambahkan catatan ke environment server `MELINDAOS_STUDIO_SIGNATURE_REGISTER`, dengan field `packageId`, `finalizedHash`, `evidenceRef` (kode arsip) dan `signedAt` (`YYYY-MM-DD`). Terapkan konfigurasi pada runtime server. Simpan kode arsip saja, tanpa nama pasien atau isi dokumen.
5. Direktur memilih paket yang sama, memasukkan kode arsip dan tanggal tanda tangan, lalu memilih **Catat pengesahan**. Studio mencatat identitas Direktur dan mempertahankan hash versi final.

Register pengesahan mencatat hasil pemeriksaan petugas arsip. Pemeriksaan kriptografis tanda tangan dilakukan di sistem arsip bila berlaku. Register EP STARKES saat ini masih pilot dan memerlukan perluasan untuk akreditasi RSIA 2027.
