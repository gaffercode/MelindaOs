import { STRUCTURAL_ROLES } from "../work-schedule/baseline-schedule";

/**
 * What Melinda knows about MelindaOS itself, returned by `baca_peta_melindaos`. Kept in code next to the tools it
 * describes, so a new tool or status shows up here in the same change. People's names come from the roles file.
 */
export function melindaSystemMap() {
  return {
    halaman: [
      { path: "/", isi: "Management Morning Brief hari ini: jadwal Direktur, temuan, keputusan, tindak lanjut." },
      { path: "/arahan", isi: "Buku besar Arahan Direktur (ID IOC-...): tugas yang dikirim ke PIC, status dan balasan staf." },
      { path: "/ruang-kerja", isi: "Ruang kerja eksekutif: jadwal 8 jabatan dengan bahan Task Vault di setiap rapat." },
      { path: "/berita", isi: "Warta harian (The Gaffer Times)." },
      { path: "/melinda", isi: "Percakapan ini." },
    ],
    jenis_tugas: {
      task_vault: "Masalah manajemen dari Action Register dan Master Log (ID seperti ACT-2810-01 atau MLOG-18). Statusnya: berjalan, pending_pihak_ketiga, butuh_keputusan_direktur, menunggu_verifikasi_novia, selesai.",
      arahan: "Arahan Direktur di buku besar (ID IOC-...). Status pengiriman: dibuat, diteruskan, diterima_pic, dikerjakan, terkendala, selesai. Direktur bisa menutupnya sebagai selesai, ditunda, atau dibatalkan.",
    },
    aturan: [
      "Rule #39: tugas operasional yang dilaporkan selesai oleh staf menjadi menunggu_verifikasi_novia sampai diverifikasi dr. Novia, Ibu Widya, atau Direktur. Keputusan Direktur lewat Melinda langsung selesai.",
      "Setiap perubahan (PIC, status, tindak lanjut, tugas baru, jadwal, sinkronisasi) hanya disiapkan oleh Melinda sebagai usulan. Perubahan baru tersimpan setelah Direktur menekan tombol Konfirmasi di bawah jawaban. Usulan kedaluwarsa setelah 15 menit.",
      "Mengganti PIC tidak mengubah status tugas. Mengganti PIC sebuah arahan IOC membuat arahan baru dan menutup yang lama sebagai dibatalkan (dialihkan).",
      "Jadwal 8 jabatan berasal dari jadwal baseline. Tambah, pindah, atau batal rapat disimpan sebagai perubahan per tanggal dan tetap berlaku setelah Sync.",
      "Data pasien (NIK, nomor rekam medis, nama pasien, tanggal lahir) tidak boleh masuk ke tugas atau jadwal.",
    ],
    jabatan: STRUCTURAL_ROLES.map((role) => ({ id: role.id, jabatan: role.title, pejabat: role.officialName, jam_kerja: role.workHoursWib, lapor_ke: role.lineReportTo })),
    alur_kerja: [
      "Pahami permintaan, lalu baca data dengan alat baca (baca_task_vault, baca_tugas, baca_tindak_lanjut, baca_jadwal_struktural, cari_pejabat).",
      "Cocokkan nama orang dengan cari_pejabat. Bila ada lebih dari satu kemungkinan atau tidak ada, tanyakan dulu kepada Direktur.",
      "Cocokkan tugas atau rapat dengan ID-nya. Bila ragu tugas mana yang dimaksud, sebutkan pilihannya dan tanyakan.",
      "Panggil alat usulkan_* sekali per perubahan, lalu katakan bahwa usulan menunggu konfirmasi Direktur.",
    ],
  };
}
