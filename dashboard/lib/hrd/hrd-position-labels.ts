/** Usulan label tampilan. Nilai jabatan sumber tetap ada di hrd-data dan staff-data. */
const POSITION_LABELS = new Map(Object.entries({
  "Wadir Operasional": "Wakil Direktur Operasional",
  "Wadir SDM & Keuangan": "Wakil Direktur SDM dan Keuangan",
  "Kabag Pelayanan": "Kepala Bagian Pelayanan Klinis",
  "Kabag Penunjang": "Kepala Bagian Pelayanan Penunjang",
  "Kabag Umum & SDM": "Kepala Bagian SDM dan Layanan Umum",
  "Kabag Umum sekaligus Kepala SDM": "Kepala Bagian SDM dan Layanan Umum",
  "Kepala Ruang VK": "Kepala Ruang Bersalin",
  "Kepala Ruang Anak": "Kepala Ruang Perawatan Anak",
  "Bidan VK": "Bidan Pelaksana Ruang Bersalin",
  "Bidan Neonatus": "Bidan Pelayanan Neonatal",
  "Bidan Ruang Bayi": "Bidan Pelaksana Ruang Bayi",
  "Perawat Poli Rawat Jalan": "Perawat Poliklinik",
  "Frontliner": "Petugas Admisi dan Informasi Pasien",
  "Kepala Resepsionis": "Kepala Layanan Resepsionis",
  "Perekam Medis": "Perekam Medis dan Informasi Kesehatan",
  "Staf Casemix": "Staf Pengelolaan Klaim dan Casemix",
  "Staf Asuransi & Casemix": "Staf Penjaminan dan Casemix",
  "Nutrisionis / Ahli Gizi": "Nutrisionis",
  "Staf Instalasi Gizi": "Petugas Pelayanan Gizi",
  "Petugas CSSD": "Petugas Sterilisasi Sentral (CSSD)",
  "Kepala IPSRS": "Kepala Instalasi Pemeliharaan Sarana Rumah Sakit (IPSRS)",
  "Driver": "Pengemudi Operasional",
  "Staf Keamanan": "Petugas Keamanan",
  "Koordinator Cleaning Service": "Koordinator Layanan Kebersihan",
  "Anggota Cleaning Service": "Petugas Layanan Kebersihan",
  "Kepala Ruang Laundry": "Kepala Layanan Laundry dan Linen",
  "Anggota Laundry": "Petugas Pengelolaan Linen",
  "Pengepul Sampah Rumah Tangga": "Pranata Pengelolaan Limbah Domestik",
  "Asisten Rumah Tangga": "Pranata Tata Graha",
  "Petugas Kantin": "Penyelia Layanan Boga & Kantin",
  "Staf Sarana Prasarana": "Staf Pemeliharaan Sarana dan Prasarana",
  "Staf Kasir": "Petugas Kasir"
}));

export function positionLabel(position: string): string {
  return POSITION_LABELS.get(position) ?? position;
}
