/** CRM rujukan dan mitra RSIA Melinda DHAI. Hanya bentuk datanya; belum ada sumber data, jadi daftar mitra kosong
 * sampai Direktur menentukan sumbernya (jangan mengisi dengan data contoh). */
export const CRM_STAGES = [
  { id: "baru", label: "Baru", hint: "Belum pernah dihubungi" },
  { id: "dihubungi", label: "Dihubungi", hint: "Menunggu tanggapan" },
  { id: "aktif", label: "Kerja sama aktif", hint: "Merujuk dalam 90 hari" },
  { id: "tidur", label: "Perlu dihubungi lagi", hint: "Tidak merujuk lebih dari 90 hari" },
] as const;

export type CrmStage = (typeof CRM_STAGES)[number]["id"];

export type CrmPartner = {
  id: string;
  name: string;
  kind: "bidan" | "dokter" | "klinik" | "penjamin";
  stage: CrmStage;
  owner: string;
  lastContact: string | null; // ISO date
  referralsThisMonth: number;
  referralsLastMonth: number;
  nextAction: string | null;
};

export const PARTNER_KIND_LABEL: Record<CrmPartner["kind"], string> = {
  bidan: "Bidan praktik",
  dokter: "Dokter pengirim",
  klinik: "Klinik",
  penjamin: "Penjamin",
};

export function countByStage(partners: CrmPartner[]): Record<CrmStage, number> {
  const counts: Record<CrmStage, number> = { baru: 0, dihubungi: 0, aktif: 0, tidur: 0 };
  for (const p of partners) counts[p.stage] += 1;
  return counts;
}

/** Days since the last contact; null when never contacted. */
export function daysSince(iso: string | null, today: Date): number | null {
  if (!iso) return null;
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor((today.getTime() - then) / 86_400_000));
}

/** Daftar mitra RSIA Melinda DHAI dari dokumen "Daftar Bidan dan Pihak-Pihak yang Bekerja Sama" (hanya nama, urutan sesuai dokumen).
 * Tahap kerja sama, penanggung jawab, dan rujukan belum dicatat. */
export const PARTNER_NETWORK = [
  {
    id: "bidan",
    label: "Bidan",
    note: "Bidan praktik mitra",
    names: ["Ema Kristianingsih", "Dwi Kurnia", "Muriyati", "Sulistyorini", "Ida Farida", "Rita Dahliana", "Estu Farida", "Maylia Hestianan", "Sudarti", "Silka Indria", "Nusia Tulanda Nofa", "Tiara", "Anita Setya", "Wartinah", "Retnopurnamaningtyas", "Cholifa Rachmawati", "Atik Nur Alawyah", "Ennita", "Elly Trisdian", "Yetty Sherot Setianingsih", "Anis Yuda", "Ana Novita Sari", "Siti Asiyah", "Nabila Dewanti Nugroho", "Tri Dewi"],
  },
  {
    id: "puskesmas",
    label: "Puskesmas",
    note: "Fasilitas kesehatan pertama",
    names: ["Puskesmas Pace", "Puskesmas Tanjunganom", "Puskesmas Balowerti", "Puskesmas Ngronggot", "Puskesmas Baron", "Puskesmas Tarokan"],
  },
  {
    id: "perusahaan",
    label: "Perusahaan dan instansi",
    note: "Penjamin, asuransi, dan instansi",
    names: ["BRI Life", "InHealth", "AdMedika", "CAR Life", "Owlexa", "Garda Medika", "DocDoc", "MedLink", "HealthMetrix", "Tirta Medical Centre", "BCA Life", "BNI Life", "FWD", "Jamkrindo", "Prudential", "Reliance", "Fullerton", "BPJS Kesehatan", "Sam Husada", "Sima", "Ultra Medika", "PMI", "BRI", "BCA", "Bank Jatim"],
  },
] as const;

export const NETWORK_TOTAL = PARTNER_NETWORK.reduce((sum, group) => sum + group.names.length, 0);

/** Dua huruf awal untuk avatar bidan: "Ema Kristianingsih" -> "EK". */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
}
