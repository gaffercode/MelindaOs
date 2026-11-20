import { wibTime } from "@/lib/director/director-data";
import type { MedifySatusehat } from "@/lib/medify/medify-snapshot-contract";
import type { MedifySnapshotResult } from "@/lib/medify/medify-snapshot-store";
import type { SatusehatLogSummary, SatusehatSnapshot } from "./satusehat-snapshot-contract";

export type SatuSehatResourceCategory = "kunjungan" | "klinis" | "farmasi" | "penunjang";
export type SatuSehatSeverity = "ok" | "perhatian" | "kritis";

export interface SatuSehatFhirResource {
  id: string;
  name: string;
  plainTitle: string;
  category: SatuSehatResourceCategory;
  categoryLabel: string;
  count: number;
  status?: "ok" | "unavailable";
  periodMode?: "rolling_30d" | "all_time";
  clinicalRole: string;
  evaluation: string;
  severity: SatuSehatSeverity;
}

export interface SatuSehatClinicalFunnel {
  id: string;
  title: string;
  summary: string;
  conversionPercent: number;
  statusLabel: string;
  severity: SatuSehatSeverity;
  steps: Array<{ label: string; resource: string; count: number; note: string }>;
}

export interface SatuSehatFailureDiagnostic {
  id: string;
  resourceOrEndpoint: string;
  httpOrPattern: string;
  ruleNumber: string;
  impact: string;
  rootCause: string;
  remediation: string;
  severity: SatuSehatSeverity;
}

export interface SatuSehatModuleReadiness {
  id: string;
  moduleName: string;
  portalPath: string;
  statusLabel: string;
  detail: string;
  severity: SatuSehatSeverity;
}

export interface SatuSehatDirectorAction {
  priority: number;
  area: string;
  action: string;
  pic: string;
  target: string;
}

export interface SatuSehatPortalSnapshot {
  facilityName: string;
  facilityCode: string;
  verificationStatus: string;
  productionOrgId: string;
  sandboxOrgId: string;
  apiKeyLastUpdated: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  lastUpdated: string;
  targetSuccessPercent: number;
  logSummary: (SatusehatLogSummary & { sandboxTransactions?: number }) | null;
}

/**
 * Ringkasan data resmi dari Portal SATUSEHAT Kemenkes
 * (https://satusehat.kemkes.go.id/platform/dashboard) untuk RS Ibu dan Anak Melinda.
 * Hanya memuat angka agregat rumah sakit, tanpa nama atau identitas pasien.
 */
export const SATUSEHAT_PORTAL_SNAPSHOT: SatuSehatPortalSnapshot & {
  logSummary: NonNullable<SatuSehatPortalSnapshot["logSummary"]>;
} = {
  facilityName: "RS Ibu dan Anak Melinda",
  facilityCode: "3571148",
  verificationStatus: "Terverifikasi",
  productionOrgId: "100027810",
  sandboxOrgId: "b166e4ba-7529-456c-a7f3-a8876cfcf456",
  apiKeyLastUpdated: "24 Juli 2024, 09:07 WIB",
  periodStart: "2026-10-20",
  periodEnd: "2026-11-19",
  periodLabel: "20 Oktober – 19 November 2026 (30 hari)",
  lastUpdated: "19 November 2026, 20:15 WIB",
  targetSuccessPercent: 95,
  logSummary: {
    totalTransactions: 170604,
    successfulTransactions: 131548,
    failedTransactions: 39104,
    successRatePercent: 77.1,
    failureRatePercent: 22.9,
    sandboxTransactions: 0,
  },
};

/** 19 jenis data layanan resmi pada Portal SATUSEHAT Kemenkes (20 Okt – 19 Nov 2026) dalam bahasa manajemen rumah sakit. */
export const SATUSEHAT_FHIR_RESOURCES: readonly SatuSehatFhirResource[] = [
  {
    id: "medication",
    name: "Medication",
    plainTitle: "Daftar obat & alat kesehatan",
    category: "farmasi",
    categoryLabel: "Resep & obat farmasi",
    count: 8533,
    clinicalRole: "Nama obat dan sediaan farmasi rumah sakit",
    evaluation: "Paling banyak terkirim; daftar obat rumah sakit sudah tersambung dengan kamus obat Kemenkes.",
    severity: "ok",
  },
  {
    id: "medication-request",
    name: "MedicationRequest",
    plainTitle: "Resep obat dari dokter",
    category: "farmasi",
    categoryLabel: "Resep & obat farmasi",
    count: 5909,
    clinicalRole: "Peresepan obat elektronik oleh dokter penanggung jawab",
    evaluation: "Resep elektronik dari poliklinik dan rawat inap sudah rutin terkirim.",
    severity: "ok",
  },
  {
    id: "medication-statement",
    name: "MedicationStatement",
    plainTitle: "Catatan pemakaian obat pasien",
    category: "farmasi",
    categoryLabel: "Resep & obat farmasi",
    count: 4964,
    clinicalRole: "Riwayat dan pemakaian obat selama perawatan",
    evaluation: "Terkirim rutin mengikuti resep dokter.",
    severity: "ok",
  },
  {
    id: "medication-dispense",
    name: "MedicationDispense",
    plainTitle: "Serah terima obat di farmasi",
    category: "farmasi",
    categoryLabel: "Resep & obat farmasi",
    count: 4652,
    clinicalRole: "Pencatatan obat yang sudah diserahkan ke pasien",
    evaluation: "Baru 78,7% dari resep dokter yang tercatat sudah diserahkan ke pasien; 21,3% sisanya belum tercatat selesai di farmasi.",
    severity: "perhatian",
  },
  {
    id: "observation",
    name: "Observation",
    plainTitle: "Tanda vital & pemeriksaan fisik",
    category: "klinis",
    categoryLabel: "Pemeriksaan & diagnosis",
    count: 1583,
    clinicalRole: "Tekanan darah, nadi, suhu, berat badan, dan hasil periksa",
    evaluation: "Tensi, nadi, suhu, dan pemeriksaan fisik rata-rata terkirim 2 sampai 3 data setiap kunjungan.",
    severity: "ok",
  },
  {
    id: "condition",
    name: "Condition",
    plainTitle: "Diagnosis penyakit (ICD-10)",
    category: "klinis",
    categoryLabel: "Pemeriksaan & diagnosis",
    count: 1378,
    clinicalRole: "Diagnosis utama dan penyerta pasien",
    evaluation: "Diagnosis dokter rata-rata terkirim 2 catatan setiap kunjungan pasien.",
    severity: "ok",
  },
  {
    id: "procedure",
    name: "Procedure",
    plainTitle: "Tindakan medis & operasi",
    category: "klinis",
    categoryLabel: "Pemeriksaan & diagnosis",
    count: 935,
    clinicalRole: "Tindakan klinis dan operasi (ICD-9-CM)",
    evaluation: "Tindakan di poliklinik, IGD, dan kamar bersalin/operasi sudah rutin masuk.",
    severity: "ok",
  },
  {
    id: "encounter",
    name: "Encounter",
    plainTitle: "Data kunjungan pasien",
    category: "kunjungan",
    categoryLabel: "Kunjungan & perawatan",
    count: 652,
    clinicalRole: "Kunjungan rawat jalan, IGD, dan rawat inap",
    evaluation: "652 kunjungan berhasil masuk, tetapi ribuan pengiriman kunjungan lainnya masih ditolak Kemenkes karena isian belum lengkap (kode aturan 10118).",
    severity: "perhatian",
  },
  {
    id: "episode-of-care",
    name: "EpisodeOfCare",
    plainTitle: "Rangkaian perawatan berkelanjutan",
    category: "kunjungan",
    categoryLabel: "Kunjungan & perawatan",
    count: 609,
    clinicalRole: "Rangkaian perawatan terpadu seperti pemeriksaan kehamilan",
    evaluation: "93,4% kunjungan pasien sudah terhubung dalam rangkaian perawatan ibu dan anak.",
    severity: "ok",
  },
  {
    id: "clinical-impression",
    name: "ClinicalImpression",
    plainTitle: "Kesimpulan pemeriksaan dokter",
    category: "klinis",
    categoryLabel: "Pemeriksaan & diagnosis",
    count: 547,
    clinicalRole: "Penilaian klinis dokter saat memeriksa pasien",
    evaluation: "83,9% kunjungan pasien sudah dilengkapi catatan penilaian dokter.",
    severity: "ok",
  },
  {
    id: "care-plan",
    name: "CarePlan",
    plainTitle: "Rencana perawatan pasien",
    category: "klinis",
    categoryLabel: "Pemeriksaan & diagnosis",
    count: 527,
    clinicalRole: "Rencana asuhan dokter dan keperawatan",
    evaluation: "80,8% kunjungan pasien sudah memiliki rencana perawatan dari dokter atau perawat.",
    severity: "ok",
  },
  {
    id: "service-request",
    name: "ServiceRequest",
    plainTitle: "Permintaan periksa lab & radiologi",
    category: "penunjang",
    categoryLabel: "Lab, USG & imunisasi",
    count: 478,
    clinicalRole: "Surat permintaan pemeriksaan laboratorium atau USG",
    evaluation: "Permintaan periksa dari dokter sudah masuk (478 data), tetapi hasil pemeriksaannya belum ikut terkirim.",
    severity: "perhatian",
  },
  {
    id: "composition",
    name: "Composition",
    plainTitle: "Resume medis pasien pulang",
    category: "klinis",
    categoryLabel: "Pemeriksaan & diagnosis",
    count: 409,
    clinicalRole: "Ringkasan medis lengkap saat pasien selesai berobat",
    evaluation: "Baru 62,7% kunjungan pasien yang lengkap sampai resume medis pulang; perlu ditingkatkan ke target 95%.",
    severity: "perhatian",
  },
  {
    id: "questionnaire-response",
    name: "QuestionnaireResponse",
    plainTitle: "Formulir tanya jawab & skrining",
    category: "klinis",
    categoryLabel: "Pemeriksaan & diagnosis",
    count: 254,
    clinicalRole: "Pengkajian awal dan skrining pasien",
    evaluation: "Sebagian formulir pengkajian awal pasien sudah masuk ke Kemenkes.",
    severity: "ok",
  },
  {
    id: "specimen",
    name: "Specimen",
    plainTitle: "Pencatatan sampel laboratorium",
    category: "penunjang",
    categoryLabel: "Lab, USG & imunisasi",
    count: 129,
    clinicalRole: "Data pengambilan sampel darah, urin, atau jaringan lab",
    evaluation: "Baru 27,0% dari permintaan laboratorium yang mencatat data sampel pemeriksaan.",
    severity: "perhatian",
  },
  {
    id: "allergy-intolerance",
    name: "AllergyIntolerance",
    plainTitle: "Catatan riwayat alergi pasien",
    category: "klinis",
    categoryLabel: "Pemeriksaan & diagnosis",
    count: 103,
    clinicalRole: "Riwayat alergi obat dan makanan pasien",
    evaluation: "15,8% kunjungan mencatat riwayat alergi obat atau makanan pasien.",
    severity: "ok",
  },
  {
    id: "diagnostic-report",
    name: "DiagnosticReport",
    plainTitle: "Hasil akhir pemeriksaan laboratorium",
    category: "penunjang",
    categoryLabel: "Lab, USG & imunisasi",
    count: 20,
    clinicalRole: "Laporan hasil pemeriksaan laboratorium dan penunjang",
    evaluation: "Masih sangat sedikit: dari 478 permintaan periksa, baru 20 hasil laboratorium (4,2%) yang sampai ke Kemenkes.",
    severity: "kritis",
  },
  {
    id: "immunization",
    name: "Immunization",
    plainTitle: "Catatan imunisasi ibu & anak",
    category: "penunjang",
    categoryLabel: "Lab, USG & imunisasi",
    count: 2,
    clinicalRole: "Catatan pemberian vaksin bayi, anak, dan ibu",
    evaluation: "Masih sangat sedikit untuk RS Ibu dan Anak: baru 2 catatan vaksin yang masuk dalam 30 hari karena nama vaksin belum disamakan dengan daftar Kemenkes.",
    severity: "kritis",
  },
  {
    id: "imaging-study",
    name: "ImagingStudy",
    plainTitle: "Hasil pemeriksaan USG & radiologi",
    category: "penunjang",
    categoryLabel: "Lab, USG & imunisasi",
    count: 0,
    clinicalRole: "Catatan pemeriksaan USG kebidanan dan foto rontgen",
    evaluation: "Belum ada data yang masuk (0 laporan) karena alat USG dan radiologi belum dihubungkan ke Satu Sehat.",
    severity: "kritis",
  },
];

export const SATUSEHAT_CLINICAL_FUNNELS: readonly SatuSehatClinicalFunnel[] = [
  {
    id: "visit-to-resume",
    title: "Alur kunjungan sampai resume medis pulang",
    summary: "Dari 652 kunjungan yang masuk, baru 62,7% yang lengkap sampai resume medis pulang.",
    conversionPercent: 62.7,
    statusLabel: "Perlu ditingkatkan ke target 95%",
    severity: "perhatian",
    steps: [
      { label: "Kunjungan pasien", resource: "Encounter", count: 652, note: "100% kunjungan masuk" },
      { label: "Rangkaian perawatan", resource: "EpisodeOfCare", count: 609, note: "93,4% dari kunjungan" },
      { label: "Resume medis pulang", resource: "Composition", count: 409, note: "62,7% dari kunjungan" },
    ],
  },
  {
    id: "prescription-to-dispense",
    title: "Alur resep dokter sampai obat diserahkan",
    summary: "Dari 5.909 resep dokter, 78,7% tercatat sudah diserahkan oleh instalasi farmasi.",
    conversionPercent: 78.7,
    statusLabel: "21,3% resep belum tercatat selesai",
    severity: "perhatian",
    steps: [
      { label: "Resep dokter", resource: "MedicationRequest", count: 5909, note: "100% resep keluar" },
      { label: "Catatan pemakaian", resource: "MedicationStatement", count: 4964, note: "84,0% dari resep" },
      { label: "Obat diserahkan", resource: "MedicationDispense", count: 4652, note: "78,7% dari resep" },
    ],
  },
  {
    id: "order-to-lab-report",
    title: "Alur permintaan sampai hasil laboratorium",
    summary: "Terjadi penurunan tajam: dari 478 permintaan periksa, baru 20 hasil akhir lab (4,2%) yang masuk.",
    conversionPercent: 4.2,
    statusLabel: "Perlu perbaikan sambungan hasil lab",
    severity: "kritis",
    steps: [
      { label: "Permintaan periksa", resource: "ServiceRequest", count: 478, note: "100% permintaan dokter" },
      { label: "Sampel laboratorium", resource: "Specimen", count: 129, note: "27,0% dari permintaan" },
      { label: "Hasil akhir lab", resource: "DiagnosticReport", count: 20, note: "4,2% dari permintaan" },
    ],
  },
  {
    id: "rsia-signature-modules",
    title: "Layanan utama RS Ibu & Anak (imunisasi & USG)",
    summary: "Laporan vaksinasi anak/ibu dan pemeriksaan USG kebidanan masih sangat tertinggal.",
    conversionPercent: 0.3,
    statusLabel: "Sangat kurang untuk layanan ibu & anak",
    severity: "kritis",
    steps: [
      { label: "Kunjungan terdata", resource: "Encounter", count: 652, note: "Pembanding kunjungan" },
      { label: "Imunisasi anak & ibu", resource: "Immunization", count: 2, note: "Baru 2 vaksin dalam 30 hari" },
      { label: "USG & radiologi", resource: "ImagingStudy", count: 0, note: "Belum ada data masuk" },
    ],
  },
];

export const SATUSEHAT_FAILURE_DIAGNOSTICS: readonly SatuSehatFailureDiagnostic[] = [
  {
    id: "encounter-rule-10118",
    resourceOrEndpoint: "Data kunjungan pasien (Encounter)",
    httpOrPattern: "Ditolak sistem Kemenkes",
    ruleNumber: "Rule 10118",
    impact: "Penyebab terbesar dari 39.104 pengiriman gagal karena Medify terus mencoba mengirim ulang otomatis setiap menit.",
    rootCause: "Data kunjungan dikirim saat jam layanan, ruangan, atau nomor Satu Sehat dokter/pasien belum lengkap.",
    remediation: "Minta staf IT dan vendor Medify melengkapi isian wajib kunjungan sesuai Rule 10118 dan menghentikan pengiriman ulang otomatis jika data memang belum lengkap.",
    severity: "kritis",
  },
  {
    id: "patient-post-400",
    resourceOrEndpoint: "Data identitas pasien (Patient)",
    httpOrPattern: "Nomor identitas belum cocok (kode 400)",
    ruleNumber: "Tanpa nomor pasien/kunjungan",
    impact: "Jika identitas pasien ditolak di awal, seluruh catatan pemeriksaan dan obat pasien tersebut ikut tertahan.",
    rootCause: "Sering terjadi pada bayi baru lahir yang belum punya NIK sendiri atau NIK pasien tidak cocok dengan data Dukcapil.",
    remediation: "Pastikan pendaftaran bayi baru lahir memakai NIK ibu di Medify serta cek kesesuaian NIK di loket pendaftaran.",
    severity: "kritis",
  },
  {
    id: "diagnostic-report-dropoff",
    resourceOrEndpoint: "Hasil laboratorium (DiagnosticReport)",
    httpOrPattern: "95,8% hasil belum terkirim otomatis",
    ruleNumber: "Putus setelah permintaan periksa",
    impact: "Dari 478 permintaan periksa lab, baru 20 hasil akhir (4,2%) yang sampai ke catatan Kemenkes.",
    rootCause: "Tombol selesai atau validasi hasil di unit laboratorium Medify belum otomatis mengirim laporan hasil ke Satu Sehat.",
    remediation: "Cocokkan daftar jenis pemeriksaan lab dengan kode standar Kemenkes dan aktifkan pengiriman otomatis saat hasil lab disahkan.",
    severity: "kritis",
  },
  {
    id: "ssrme-log-500",
    resourceOrEndpoint: "Riwayat medis nasional untuk dokter (SSRME)",
    httpOrPattern: "Fitur belum aktif (kode 500)",
    ruleNumber: "Catatan akses masih 0",
    impact: "Dokter RSIA Melinda belum bisa membuka riwayat rekam medis pasien dari rumah sakit atau puskesmas lain.",
    rootCause: "Profil sistem rekam medis rumah sakit belum didaftarkan di halaman pengaturan portal Kemenkes.",
    remediation: "Daftarkan profil sistem rekam medis Medify di portal Kemenkes lalu aktifkan tombol akses riwayat medis bagi dokter.",
    severity: "perhatian",
  },
];

export const SATUSEHAT_MODULE_READINESS: readonly SatuSehatModuleReadiness[] = [
  {
    id: "production-access",
    moduleName: "Izin resmi pengiriman data rumah sakit (Production)",
    portalPath: "/platform/dashboard/production-access",
    statusLabel: "Aktif dan disetujui",
    detail: "Rumah sakit sudah resmi diverifikasi Kemenkes (Kode Fasyankes 3571148) dan diizinkan mengirim data pasien yang sebenarnya.",
    severity: "ok",
  },
  {
    id: "api-credentials",
    moduleName: "Kunci sambungan otomatis Medify ke Kemenkes",
    portalPath: "/platform/dashboard/api-code-access",
    statusLabel: "Aktif (diperbarui 24 Juli 2024)",
    detail: "Identitas RSIA Melinda (100027810) sudah tersambung, tetapi kunci akses sudah berumur lebih dari 2 tahun sehingga baiknya diperbarui berkala.",
    severity: "ok",
  },
  {
    id: "system-profile",
    moduleName: "Pendaftaran profil sistem rekam medis (Medify)",
    portalPath: "/platform/dashboard/profile/edit-system-rme-using-vendor",
    statusLabel: "Belum didaftarkan",
    detail: "Nama aplikasi rekam medis yang dipakai rumah sakit belum diisikan pada menu profil sistem di portal Kemenkes.",
    severity: "perhatian",
  },
  {
    id: "ssrme-module",
    moduleName: "Fitur dokter melihat riwayat medis nasional (SSRME)",
    portalPath: "/platform/dashboard/modul-instalation",
    statusLabel: "Belum berjalan (0 klik)",
    detail: "Dokter belum memakai tombol riwayat medis lintas fasyankes dan persetujuan pasien di loket pendaftaran.",
    severity: "perhatian",
  },
  {
    id: "webhook-hpke",
    moduleName: "Pemberitahuan balik otomatis dari Kemenkes (Webhook)",
    portalPath: "/platform/dashboard/webhook-configuration",
    statusLabel: "Belum diaktifkan",
    detail: "Alamat penerima pemberitahuan otomatis dari Kemenkes masih kosong sehingga info perubahan data tidak langsung masuk ke SIMRS.",
    severity: "perhatian",
  },
  {
    id: "dicom-router",
    moduleName: "Sambungan alat USG kebidanan & radiologi (DICOM)",
    portalPath: "/platform/dashboard/instalation-guide",
    statusLabel: "Belum tersambung (0 data)",
    detail: "Hasil pemeriksaan USG kandungan maupun foto radiologi belum terkirim karena penghubung alat medis belum dipasang.",
    severity: "kritis",
  },
  {
    id: "kyc-mobile",
    moduleName: "Pencocokan identitas pasien di loket (Satu Sehat Mobile)",
    portalPath: "/platform/dashboard/instalation-guide",
    statusLabel: "Siap digunakan",
    detail: "Panduan verifikasi identitas pasien di meja pendaftaran tersedia untuk mencegah pengiriman identitas yang ditolak.",
    severity: "ok",
  },
];

export const SATUSEHAT_DIRECTOR_ACTIONS: readonly SatuSehatDirectorAction[] = [
  {
    priority: 1,
    area: "Turunkan penolakan kunjungan & identitas pasien",
    action: "Periksa penyebab data kunjungan ditolak (Rule 10118) serta pastikan pendaftaran bayi memakai NIK ibu agar 39.104 pengiriman gagal segera turun.",
    pic: "Staf IT (Qoyyum) & Vendor Medify",
    target: "Keberhasilan kirim >= 95%",
  },
  {
    priority: 2,
    area: "Sambungkan hasil laboratorium & alat USG",
    action: "Aktifkan pengiriman otomatis hasil akhir laboratorium (baru 20 dari 478 permintaan) dan pasang penghubung alat USG/radiologi ke Satu Sehat.",
    pic: "Unit Laboratorium, Radiologi & Staf IT",
    target: "Hasil lab >= 90% terkirim; data USG mulai masuk",
  },
  {
    priority: 3,
    area: "Lengkapi catatan imunisasi & resume pulang",
    action: "Samakan nama vaksin Poli Anak dengan daftar obat Kemenkes (baru 2 catatan imunisasi) dan tingkatkan kelengkapan resume medis pulang dari 62,7%.",
    pic: "Poli Anak, Kebidanan, Farmasi & Rekam Medis",
    target: "Semua imunisasi dan resume pulang tercatat",
  },
  {
    priority: 4,
    area: "Daftarkan profil rekam medis & fitur riwayat dokter",
    action: "Isi profil sistem Medify di portal Kemenkes agar fitur dokter melihat riwayat medis nasional (SSRME) aktif serta lengkapi kontak institusi.",
    pic: "Manajemen, Komite RME & Staf IT",
    target: "Fitur riwayat medis dokter aktif digunakan",
  },
];

export const SATUSEHAT_CATEGORY_OPTIONS: ReadonlyArray<{ id: "semua" | "perhatian" | SatuSehatResourceCategory; label: string }> = [
  { id: "semua", label: "Semua jenis data (19)" },
  { id: "perhatian", label: "Perlu perbaikan (8)" },
  { id: "kunjungan", label: "Kunjungan & perawatan (2)" },
  { id: "klinis", label: "Pemeriksaan & diagnosis (8)" },
  { id: "farmasi", label: "Resep & obat farmasi (4)" },
  { id: "penunjang", label: "Lab, USG & imunisasi (5)" },
];

const numFmt = new Intl.NumberFormat("id-ID");
const pctFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export function filterSatuSehatResources(
  filter: "semua" | "perhatian" | SatuSehatResourceCategory,
  resources: readonly SatuSehatFhirResource[] = SATUSEHAT_FHIR_RESOURCES,
): SatuSehatFhirResource[] {
  if (filter === "semua") return [...resources];
  if (filter === "perhatian") return resources.filter((item) => item.severity !== "ok");
  return resources.filter((item) => item.category === filter);
}

export function extractMedifySatusehat(result: MedifySnapshotResult | null | undefined): MedifySatusehat | null {
  return result?.snapshot?.satusehat ?? null;
}

function buildLiveResources(liveSnapshot: SatusehatSnapshot): SatuSehatFhirResource[] {
  const map = new Map(liveSnapshot.resources.map((item) => [item.name, item]));
  const countOf = (name: string) => map.get(name)?.count ?? 0;

  const encounter = countOf("Encounter");
  const req = countOf("MedicationRequest");
  const disp = countOf("MedicationDispense");
  const srv = countOf("ServiceRequest");
  const spec = countOf("Specimen");
  const diag = countOf("DiagnosticReport");
  const comp = countOf("Composition");
  const imm = countOf("Immunization");
  const img = countOf("ImagingStudy");

  return SATUSEHAT_FHIR_RESOURCES.map((base) => {
    const live = map.get(base.name);
    const count = live?.count ?? base.count;
    const status = live?.status ?? "ok";
    const periodMode = live?.periodMode ?? "rolling_30d";

    if (status === "unavailable") {
      return {
        ...base,
        count: 0,
        status,
        periodMode,
        severity: "perhatian",
        evaluation: "Belum berhasil ditarik dari sistem Kemenkes pada penarikan terakhir; periksa hak akses jenis data ini.",
      };
    }

    let severity: SatuSehatSeverity = base.severity;
    let evaluation = base.evaluation;
    const periodNote = periodMode === "all_time" ? " (hitungan total kumulatif Kemenkes)." : ".";

    if (base.name === "MedicationDispense") {
      const ratio = pct(disp, req);
      severity = req > 0 && ratio < 95 ? "perhatian" : "ok";
      evaluation = req > 0
        ? `${pctFmt.format(ratio)}% dari resep dokter (${numFmt.format(disp)} dari ${numFmt.format(req)}) sudah tercatat diserahkan di farmasi${periodNote}`
        : `${numFmt.format(count)} serah terima obat tercatat${periodNote}`;
    } else if (base.name === "Composition") {
      const ratio = pct(comp, encounter);
      severity = encounter > 0 && ratio < 95 ? "perhatian" : "ok";
      evaluation = encounter > 0
        ? `${pctFmt.format(ratio)}% kunjungan (${numFmt.format(comp)} dari ${numFmt.format(encounter)}) memiliki resume medis pulang${periodNote}`
        : `${numFmt.format(count)} resume medis tercatat${periodNote}`;
    } else if (base.name === "ServiceRequest") {
      severity = srv > 0 && diag < srv * 0.5 ? "perhatian" : "ok";
      evaluation = `${numFmt.format(srv)} permintaan pemeriksaan lab/radiologi masuk dari dokter${periodNote}`;
    } else if (base.name === "Specimen") {
      const ratio = pct(spec, srv);
      severity = srv > 0 && ratio < 50 ? "perhatian" : "ok";
      evaluation = srv > 0
        ? `${pctFmt.format(ratio)}% dari permintaan pemeriksaan (${numFmt.format(spec)} dari ${numFmt.format(srv)}) mencatat sampel lab${periodNote}`
        : `${numFmt.format(spec)} sampel laboratorium tercatat${periodNote}`;
    } else if (base.name === "DiagnosticReport") {
      const ratio = pct(diag, srv);
      severity = srv > 0 && ratio < 50 ? "kritis" : ratio < 90 ? "perhatian" : "ok";
      evaluation = srv > 0
        ? `Baru ${numFmt.format(diag)} hasil akhir (${pctFmt.format(ratio)}% dari ${numFmt.format(srv)} permintaan pemeriksaan) sampai ke Kemenkes${periodNote}`
        : `${numFmt.format(diag)} hasil akhir laboratorium tercatat${periodNote}`;
    } else if (base.name === "Immunization") {
      severity = imm < 10 ? "kritis" : "ok";
      evaluation = imm < 10
        ? `Baru ${numFmt.format(imm)} catatan imunisasi masuk; perlu penyelarasan kamus vaksin ibu & anak dengan Kemenkes${periodNote}`
        : `${numFmt.format(imm)} catatan imunisasi ibu & anak sudah tercatat di Kemenkes${periodNote}`;
    } else if (base.name === "ImagingStudy") {
      severity = img === 0 ? "kritis" : "ok";
      evaluation = img === 0
        ? `Belum ada data USG atau radiologi masuk (0 laporan); alat belum terhubung ke Satu Sehat${periodNote}`
        : `${numFmt.format(img)} pemeriksaan USG/radiologi sudah tercatat di Kemenkes${periodNote}`;
    } else if (base.name === "Encounter") {
      severity = count === 0 ? "kritis" : "ok";
      evaluation = `${numFmt.format(count)} kunjungan pasien berhasil tersimpan di sistem Kemenkes${periodNote}`;
    } else {
      severity = count === 0 ? "perhatian" : "ok";
      evaluation = `${numFmt.format(count)} catatan ${base.plainTitle.toLowerCase()} tersimpan di sistem Kemenkes${periodNote}`;
    }

    return { ...base, count, status, periodMode, severity, evaluation };
  });
}

function buildLiveFunnels(resources: readonly SatuSehatFhirResource[]): SatuSehatClinicalFunnel[] {
  const countOf = (name: string) => resources.find((item) => item.name === name)?.count ?? 0;
  const encounter = countOf("Encounter");
  const episode = countOf("EpisodeOfCare");
  const composition = countOf("Composition");
  const medReq = countOf("MedicationRequest");
  const medStmt = countOf("MedicationStatement");
  const medDisp = countOf("MedicationDispense");
  const srvReq = countOf("ServiceRequest");
  const specimen = countOf("Specimen");
  const diagRep = countOf("DiagnosticReport");
  const immunization = countOf("Immunization");
  const imaging = countOf("ImagingStudy");

  const resumePct = pct(composition, encounter);
  const dispensePct = pct(medDisp, medReq);
  const labPct = pct(diagRep, srvReq);
  const rsiaPct = pct(immunization + imaging, encounter);

  return [
    {
      id: "visit-to-resume",
      title: "Alur kunjungan sampai resume medis pulang",
      summary: `Dari ${numFmt.format(encounter)} kunjungan yang masuk, ${pctFmt.format(resumePct)}% lengkap sampai resume medis pulang.`,
      conversionPercent: resumePct,
      statusLabel: resumePct >= 95 ? "Memenuhi target 95%" : "Perlu ditingkatkan ke target 95%",
      severity: resumePct >= 95 ? "ok" : "perhatian",
      steps: [
        { label: "Kunjungan pasien", resource: "Encounter", count: encounter, note: "100% kunjungan masuk" },
        { label: "Rangkaian perawatan", resource: "EpisodeOfCare", count: episode, note: `${pctFmt.format(pct(episode, encounter))}% dari kunjungan` },
        { label: "Resume medis pulang", resource: "Composition", count: composition, note: `${pctFmt.format(resumePct)}% dari kunjungan` },
      ],
    },
    {
      id: "prescription-to-dispense",
      title: "Alur resep dokter sampai obat diserahkan",
      summary: `Dari ${numFmt.format(medReq)} resep dokter, ${pctFmt.format(dispensePct)}% tercatat sudah diserahkan oleh instalasi farmasi.`,
      conversionPercent: dispensePct,
      statusLabel: dispensePct >= 95 ? "Selaras dengan peresepan" : `${pctFmt.format(Math.max(0, 100 - dispensePct))}% resep belum tercatat selesai`,
      severity: dispensePct >= 95 ? "ok" : "perhatian",
      steps: [
        { label: "Resep dokter", resource: "MedicationRequest", count: medReq, note: "100% resep keluar" },
        { label: "Catatan pemakaian", resource: "MedicationStatement", count: medStmt, note: `${pctFmt.format(pct(medStmt, medReq))}% dari resep` },
        { label: "Obat diserahkan", resource: "MedicationDispense", count: medDisp, note: `${pctFmt.format(dispensePct)}% dari resep` },
      ],
    },
    {
      id: "order-to-lab-report",
      title: "Alur permintaan sampai hasil laboratorium",
      summary: `Dari ${numFmt.format(srvReq)} permintaan periksa, baru ${numFmt.format(diagRep)} hasil akhir lab (${pctFmt.format(labPct)}%) yang masuk.`,
      conversionPercent: labPct,
      statusLabel: labPct >= 90 ? "Sambungan hasil lab baik" : "Perlu perbaikan sambungan hasil lab",
      severity: labPct >= 90 ? "ok" : labPct >= 50 ? "perhatian" : "kritis",
      steps: [
        { label: "Permintaan periksa", resource: "ServiceRequest", count: srvReq, note: "100% permintaan dokter" },
        { label: "Sampel laboratorium", resource: "Specimen", count: specimen, note: `${pctFmt.format(pct(specimen, srvReq))}% dari permintaan` },
        { label: "Hasil akhir lab", resource: "DiagnosticReport", count: diagRep, note: `${pctFmt.format(labPct)}% dari permintaan` },
      ],
    },
    {
      id: "rsia-signature-modules",
      title: "Layanan utama RS Ibu & Anak (imunisasi & USG)",
      summary: "Laporan vaksinasi anak/ibu dan pemeriksaan USG kebidanan perlu dipantau khusus.",
      conversionPercent: rsiaPct,
      statusLabel: imaging === 0 || immunization < 10 ? "Sangat kurang untuk layanan ibu & anak" : "Layanan ibu & anak mulai tercatat",
      severity: imaging === 0 || immunization < 10 ? "kritis" : "ok",
      steps: [
        { label: "Kunjungan terdata", resource: "Encounter", count: encounter, note: "Pembanding kunjungan" },
        { label: "Imunisasi anak & ibu", resource: "Immunization", count: immunization, note: `${numFmt.format(immunization)} catatan vaksin` },
        { label: "USG & radiologi", resource: "ImagingStudy", count: imaging, note: imaging === 0 ? "Belum ada data masuk" : `${numFmt.format(imaging)} pemeriksaan` },
      ],
    },
  ];
}

export function buildSatuSehatExecutiveAnalysis(
  medifySatusehat: MedifySatusehat | null,
  liveSnapshot: SatusehatSnapshot | null = null,
): string[] {
  const resources = liveSnapshot ? buildLiveResources(liveSnapshot) : SATUSEHAT_FHIR_RESOURCES;
  const logSummary = liveSnapshot ? liveSnapshot.logSummary : SATUSEHAT_PORTAL_SNAPSHOT.logSummary;
  const totalResourcesCount = resources.reduce((sum, item) => sum + item.count, 0);
  const formattedTotalObjects = numFmt.format(totalResourcesCount);
  const pharmaCount = resources.filter((item) => item.category === "farmasi").reduce((sum, item) => sum + item.count, 0);
  const countOf = (name: string) => resources.find((item) => item.name === name)?.count ?? 0;
  const srv = countOf("ServiceRequest");
  const diag = countOf("DiagnosticReport");
  const imm = countOf("Immunization");
  const img = countOf("ImagingStudy");
  const lines: string[] = [];

  if (logSummary) {
    lines.push(
      `Dari seluruh kiriman data rumah sakit ke portal Kemenkes dalam 30 hari terakhir, tingkat keberhasilannya masih ${pctFmt.format(logSummary.successRatePercent)}% (${numFmt.format(logSummary.successfulTransactions)} berhasil dari ${numFmt.format(logSummary.totalTransactions)} pengiriman), masih di bawah target ideal ${SATUSEHAT_PORTAL_SNAPSHOT.targetSuccessPercent}%. Sebanyak ${numFmt.format(logSummary.failedTransactions)} pengiriman ditolak karena isian kunjungan belum lengkap (Rule 10118) dan pencocokan identitas pasien gagal.`,
    );
  } else if (liveSnapshot) {
    const okCount = liveSnapshot.resources.filter((item) => item.status === "ok").length;
    lines.push(
      `Penarikan otomatis terbaru langsung dari sistem Kemenkes (${liveSnapshot.periodLabel}) berhasil membaca ${okCount} dari ${liveSnapshot.resources.length} jenis laporan. Catatan penolakan harian (seperti Rule 10118) tidak tersedia melalui sambungan hitung-jumlah otomatis dan tetap merujuk audit portal Kemenkes.`,
    );
  }

  lines.push(
    `Sudah ada ${formattedTotalObjects} catatan layanan yang berhasil masuk ke catatan nasional (paling banyak berasal dari resep dan obat farmasi sebanyak ${numFmt.format(pharmaCount)} catatan), namun layanan penting RS Ibu dan Anak masih perlu perhatian: hasil USG/radiologi ${numFmt.format(img)}, catatan imunisasi ${numFmt.format(imm)}, dan hasil akhir laboratorium baru ${numFmt.format(diag)} dari ${numFmt.format(srv)} permintaan (${pctFmt.format(pct(diag, srv))}%).`,
  );

  lines.push(
    "Beberapa fitur portal Kemenkes juga belum diaktifkan: nama sistem rekam medis rumah sakit belum didaftarkan, fitur dokter melihat riwayat medis nasional masih belum berjalan (0 klik), dan pemberitahuan balik otomatis belum disambungkan.",
  );

  if (medifySatusehat) {
    lines.push(
      `Perbandingan dengan catatan internal Medify (${medifySatusehat.periodStart} s.d. ${medifySatusehat.periodEnd}): Medify mencatat ${pctFmt.format(medifySatusehat.globalPercent)}% data pasien pulang sudah terkirim (${numFmt.format(medifySatusehat.sent)} dari ${numFmt.format(medifySatusehat.expected)} data, ${numFmt.format(medifySatusehat.failed)} gagal, ${numFmt.format(medifySatusehat.notSent)} belum dikirim)${logSummary ? `, sedangkan catatan di portal Kemenkes menunjukkan masih ada ${numFmt.format(logSummary.failedTransactions)} pengiriman berulang yang ditolak sistem pusat` : ""}.`,
    );
  } else {
    lines.push(
      "Perbandingan dengan Medify: laporan harian Medify untuk tanggal ini belum tersedia, sehingga seluruh angka di halaman ini diambil langsung dari Satu Sehat Kemenkes.",
    );
  }

  return lines;
}

export function formatSatuSehatInstructionText(
  medifySatusehat: MedifySatusehat | null,
  liveSnapshot: SatusehatSnapshot | null = null,
): string {
  const facilityName = liveSnapshot?.facilityName ?? SATUSEHAT_PORTAL_SNAPSHOT.facilityName;
  const facilityCode = liveSnapshot?.facilityCode ?? SATUSEHAT_PORTAL_SNAPSHOT.facilityCode;
  const orgId = liveSnapshot?.organizationId ?? SATUSEHAT_PORTAL_SNAPSHOT.productionOrgId;
  const periodLabel = liveSnapshot?.periodLabel ?? SATUSEHAT_PORTAL_SNAPSHOT.periodLabel;
  const resources = liveSnapshot ? buildLiveResources(liveSnapshot) : SATUSEHAT_FHIR_RESOURCES;
  const countOf = (name: string) => resources.find((item) => item.name === name)?.count ?? 0;
  const logSummary = liveSnapshot ? liveSnapshot.logSummary : SATUSEHAT_PORTAL_SNAPSHOT.logSummary;

  const lines = [
    `Arahan Direktur — Perbaikan Pengiriman Data Satu Sehat (${facilityName} · Kode RS ${facilityCode} · ID Organisasi ${orgId})`,
    `Periode catatan Kemenkes: ${periodLabel}`,
    `1. Kurangi pengiriman yang ditolak (${logSummary ? `${numFmt.format(logSummary.failedTransactions)} gagal / ${logSummary.failureRatePercent}% dari ${numFmt.format(logSummary.totalTransactions)} pengiriman` : "audit penolakan berkala"}): perbaiki kelengkapan isian kunjungan pasien (Rule 10118) dan gunakan NIK ibu untuk bayi baru lahir bersama tim IT dan vendor Medify.`,
    `2. Lengkapi layanan unggulan ibu dan anak serta penunjang: aktifkan pengiriman otomatis hasil akhir laboratorium (baru ${countOf("DiagnosticReport")} dari ${countOf("ServiceRequest")} permintaan), sambungkan alat USG/radiologi (tercatat ${countOf("ImagingStudy")}), dan cocokkan daftar vaksin anak ke kamus Kemenkes (tercatat ${countOf("Immunization")}).`,
    "3. Daftarkan profil sistem Medify di portal Kemenkes agar dokter bisa memakai fitur riwayat medis nasional serta aktifkan pemberitahuan balik otomatis.",
  ];
  if (logSummary) {
    lines.push(`Tingkat keberhasilan di portal saat ini: ${logSummary.successRatePercent}% (${logSummary.successfulTransactions} berhasil).`);
  }
  if (medifySatusehat) {
    lines.push(
      `Pembanding laporan internal Medify (${medifySatusehat.lastUpdate}): ${medifySatusehat.globalPercent}% (${medifySatusehat.sent}/${medifySatusehat.expected} data pasien pulang terkirim, ${medifySatusehat.failed} gagal, ${medifySatusehat.notSent} belum dikirim).`,
    );
  }
  return lines.join("\n");
}

export function resolveSatuSehatDashboardData(liveSnapshot: SatusehatSnapshot | null) {
  if (!liveSnapshot) {
    return {
      isLive: false,
      sourceBanner: `Catatan resmi Portal Satu Sehat Kemenkes periode ${SATUSEHAT_PORTAL_SNAPSHOT.periodLabel} untuk ID organisasi ${SATUSEHAT_PORTAL_SNAPSHOT.productionOrgId} · hanya angka total rumah sakit, tanpa identitas pasien.`,
      portal: SATUSEHAT_PORTAL_SNAPSHOT as SatuSehatPortalSnapshot,
      resources: SATUSEHAT_FHIR_RESOURCES,
      funnels: SATUSEHAT_CLINICAL_FUNNELS,
    };
  }

  const resources = buildLiveResources(liveSnapshot);
  const funnels = buildLiveFunnels(resources);
  const observedWib = wibTime(liveSnapshot.observedAt);
  const portal: SatuSehatPortalSnapshot = {
    ...SATUSEHAT_PORTAL_SNAPSHOT,
    facilityName: liveSnapshot.facilityName,
    facilityCode: liveSnapshot.facilityCode,
    productionOrgId: liveSnapshot.organizationId,
    periodStart: liveSnapshot.periodStart,
    periodEnd: liveSnapshot.periodEnd,
    periodLabel: liveSnapshot.periodLabel,
    lastUpdated: `${liveSnapshot.date} · ${observedWib}`,
    logSummary: liveSnapshot.logSummary,
  };

  return {
    isLive: true,
    sourceBanner: `Tarikan otomatis langsung dari sistem Kemenkes (${liveSnapshot.environment}) pada ${observedWib} untuk ID organisasi ${liveSnapshot.organizationId} · hanya angka total rumah sakit, tanpa identitas pasien.`,
    portal,
    resources,
    funnels,
  };
}
