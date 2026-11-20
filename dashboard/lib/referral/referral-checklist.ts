import { DIAGNOSIS_GROUPS, DIAGNOSIS_GROUP_LABELS, VITAL_KEYS, type DiagnosisGroup, type VitalKey } from "./referral-types";

/**
 * Data-completeness prompts and the vital signs shown for each referral diagnosis.
 *
 * The diagnosis list, the referral criteria and the emergency exceptions come from the
 * APPROVED `SOP-KLI-FKTP-REFERRAL-PATHWAYS-AND-EMERGENCY`; the hypertension, pre-eclampsia
 * and diabetes entries also cite their clinical pathways. The checklist is not a diagnosis,
 * a score, or treatment advice: it only asks for the data the receiving doctor needs.
 *
 * `vitals` is the small set that supports the selected diagnosis; the form shows only those.
 * `requiredVitals` is at most the one measurement that makes the referral meaningful; the
 * sheet can still be sent when it is missing, but the form says so before sending.
 */

export type ChecklistGroup = "anamnesis" | "pemeriksaan" | "penunjang";
export type ChecklistItem = { id: string; label: string; group: ChecklistGroup };
export type DiagnosisProfile = {
  id: string;
  label: string;
  icd: string | null;
  group: DiagnosisGroup;
  vitals: readonly VitalKey[];
  requiredVitals: readonly VitalKey[];
  items: readonly ChecklistItem[];
  note: string | null;
  source: { title: string; docId: string } | null;
};

const item = (group: ChecklistGroup, id: string, label: string): ChecklistItem => ({ group, id, label });
const FKTP_SOURCE = {
  title: "Alur Rujukan FKTP ke RSIA Melinda DHAI",
  docId: "SOP-KLI-FKTP-REFERRAL-PATHWAYS-AND-EMERGENCY",
} as const;
const HT_SOURCE = { title: "Clinical Pathway Hipertensi Esensial", docId: "SOP-KLI-CP-PD-HIPERTENSI-ESENSIAL" } as const;
const HT_PREG_SOURCE = { title: "Clinical Pathway Hipertensi Gestasional", docId: "SOP-KLI-CP-OBG-HIPERTENSI-GESTASIONAL" } as const;
const PEB_SOURCE = { title: "Clinical Pathway Preeklamsia Berat dan Eklamsia", docId: "SOP-KLI-CP-OBG-PREEKLAMSIA-BERAT-DAN-EKLAMSIA" } as const;
const DM_SOURCE = { title: "PPK dan Clinical Pathway Poli Penyakit Dalam", docId: "SOP-KLI-PPK-CLINICAL-PATHWAY-POLI-PENYAKIT-DALAM" } as const;

export const REFERRAL_PROFILES: readonly DiagnosisProfile[] = [
  // ── Obgyn: kegawatan maternal ─────────────────────────────────────────────
  {
    id: "preeklamsia",
    label: "Preeklamsia berat / eklamsia",
    icd: "O14.1",
    group: "obgyn",
    vitals: ["td", "nadi", "rr", "spo2"],
    requiredVitals: ["td"],
    items: [
      item("anamnesis", "usia_kehamilan", "Usia kehamilan"),
      item("anamnesis", "nyeri_kepala", "Nyeri kepala hebat"),
      item("anamnesis", "pandangan_kabur", "Pandangan kabur"),
      item("anamnesis", "nyeri_ulu_hati", "Nyeri ulu hati"),
      item("pemeriksaan", "proteinuria", "Proteinuria (dipstick)"),
      item("pemeriksaan", "edema_paru", "Ronki atau tanda edema paru"),
      item("pemeriksaan", "djj", "Denyut jantung janin"),
    ],
    note: "Kegawatan maternal. Kirim ke IGD atau VK; jangan menunda untuk melengkapi administrasi.",
    source: PEB_SOURCE,
  },
  {
    id: "hipertensi_kehamilan",
    label: "Hipertensi dalam kehamilan",
    icd: "O13",
    group: "obgyn",
    vitals: ["td", "nadi", "rr", "spo2"],
    requiredVitals: ["td"],
    items: [
      item("anamnesis", "usia_kehamilan", "Usia kehamilan"),
      item("anamnesis", "nyeri_kepala", "Nyeri kepala"),
      item("anamnesis", "pandangan_kabur", "Pandangan kabur"),
      item("anamnesis", "riwayat_ht_kronik", "Riwayat hipertensi sebelum hamil"),
      item("pemeriksaan", "proteinuria", "Proteinuria (dipstick)"),
      item("pemeriksaan", "edema", "Edema"),
    ],
    note: "Bila proteinuria positif atau muncul gejala impending eklamsia, alihkan ke protokol preeklamsia berat.",
    source: HT_PREG_SOURCE,
  },
  {
    id: "perdarahan_kehamilan",
    label: "Perdarahan kehamilan / antepartum",
    icd: "O46.9",
    group: "obgyn",
    vitals: ["td", "nadi", "rr", "spo2"],
    requiredVitals: ["td"],
    items: [
      item("anamnesis", "usia_kehamilan", "Usia kehamilan"),
      item("anamnesis", "jumlah_perdarahan", "Perkiraan jumlah perdarahan"),
      item("anamnesis", "nyeri_perut", "Nyeri perut atau kontraksi"),
      item("pemeriksaan", "plasenta_previa", "Riwayat plasenta previa / SC"),
      item("pemeriksaan", "kondisi_janin", "Denyut jantung janin"),
    ],
    note: "Perdarahan aktif jalan lahir dapat langsung ke IGD tanpa surat rujukan.",
    source: FKTP_SOURCE,
  },
  {
    id: "kpd",
    label: "Ketuban pecah dini",
    icd: "O42.9",
    group: "obgyn",
    vitals: ["td", "nadi", "suhu", "rr"],
    requiredVitals: ["suhu"],
    items: [
      item("anamnesis", "waktu_pecah", "Jam ketuban pecah"),
      item("anamnesis", "warna_ketuban", "Warna dan bau air ketuban"),
      item("anamnesis", "his", "His atau kontraksi"),
      item("pemeriksaan", "usia_kehamilan", "Usia kehamilan"),
      item("pemeriksaan", "djj", "Denyut jantung janin"),
    ],
    note: "KPD dengan mekonium, bau busuk, atau his aktif adalah kegawatan; kirim segera.",
    source: FKTP_SOURCE,
  },
  {
    id: "gawat_janin",
    label: "Gawat janin",
    icd: "O68",
    group: "obgyn",
    vitals: ["td", "nadi", "spo2"],
    requiredVitals: ["spo2"],
    items: [
      item("anamnesis", "gerakan_janin", "Gerakan janin berkurang"),
      item("anamnesis", "usia_kehamilan", "Usia kehamilan"),
      item("pemeriksaan", "djj", "Denyut jantung janin / CTG"),
      item("pemeriksaan", "warna_ketuban", "Warna air ketuban"),
    ],
    note: "Gawat janin akut adalah kegawatan; kirim segera ke IGD atau VK.",
    source: FKTP_SOURCE,
  },
  {
    id: "inpartu",
    label: "Inpartu / persalinan aktif",
    icd: "O62.9",
    group: "obgyn",
    vitals: ["td", "nadi", "suhu", "rr"],
    requiredVitals: ["td"],
    items: [
      item("anamnesis", "usia_kehamilan", "Usia kehamilan"),
      item("anamnesis", "his", "Frekuensi dan lama his"),
      item("pemeriksaan", "pembukaan", "Pembukaan serviks"),
      item("pemeriksaan", "djj", "Denyut jantung janin"),
    ],
    note: "Inpartu kala I fase aktif atau kala II dapat langsung ke IGD/VK.",
    source: FKTP_SOURCE,
  },
  {
    id: "hpp",
    label: "Perdarahan pascapersalinan",
    icd: "O72.1",
    group: "obgyn",
    vitals: ["td", "nadi", "rr", "spo2"],
    requiredVitals: ["nadi"],
    items: [
      item("anamnesis", "jumlah_perdarahan", "Perkiraan jumlah perdarahan"),
      item("anamnesis", "waktu_persalinan", "Waktu persalinan"),
      item("pemeriksaan", "kontraksi_uterus", "Kontraksi uterus"),
      item("pemeriksaan", "plasenta", "Plasenta lahir lengkap atau tidak"),
    ],
    note: "HPP masif adalah kegawatan; kirim segera, jangan menunggu surat rujukan.",
    source: FKTP_SOURCE,
  },
  {
    id: "sepsis_puerperalis",
    label: "Sepsis pascapersalinan",
    icd: "O85",
    group: "obgyn",
    vitals: ["td", "nadi", "suhu", "rr", "spo2"],
    requiredVitals: ["suhu"],
    items: [
      item("anamnesis", "demam", "Demam dan waktu muncul"),
      item("anamnesis", "nyeri_perut", "Nyeri perut bawah"),
      item("pemeriksaan", "lokia", "Lokia berbau atau perdarahan"),
      item("pemeriksaan", "waktu_persalinan", "Waktu persalinan"),
    ],
    note: "Sepsis puerperalis adalah kegawatan; kirim segera ke IGD.",
    source: FKTP_SOURCE,
  },
  // ── Obgyn: rujukan terencana ───────────────────────────────────────────────
  {
    id: "krt",
    label: "Kehamilan risiko tinggi",
    icd: "O09.9",
    group: "obgyn",
    vitals: ["td", "nadi", "rr"],
    requiredVitals: ["td"],
    items: [
      item("anamnesis", "usia_kehamilan", "Usia kehamilan"),
      item("anamnesis", "kriteria_krt", "Kriteria KRT (usia, paritas, ROB, bekas SC, letak)"),
      item("anamnesis", "komorbid", "Komorbid maternal (DM, jantung, asma, tiroid, Hep B, HIV)"),
      item("pemeriksaan", "tfu", "Tinggi fundus uteri"),
      item("pemeriksaan", "djj", "Denyut jantung janin"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "mioma",
    label: "Mioma uteri / perdarahan uterus abnormal",
    icd: "D25.9",
    group: "obgyn",
    vitals: ["td", "nadi"],
    requiredVitals: ["td"],
    items: [
      item("anamnesis", "pola_haid", "Pola haid dan jumlah perdarahan"),
      item("anamnesis", "nyeri_panggul", "Nyeri panggul"),
      item("pemeriksaan", "anemia", "Tanda anemia"),
      item("penunjang", "usg", "Hasil USG bila ada"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "aub",
    label: "Perdarahan uterus abnormal",
    icd: "N93.8",
    group: "obgyn",
    vitals: ["td", "nadi"],
    requiredVitals: ["td"],
    items: [
      item("anamnesis", "pola_haid", "Pola haid dan lama perdarahan"),
      item("anamnesis", "nyeri_panggul", "Nyeri panggul"),
      item("pemeriksaan", "anemia", "Tanda anemia"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "kista_ovarium",
    label: "Kista ovarium / massa adneksa",
    icd: "N83.2",
    group: "obgyn",
    vitals: ["td", "nadi", "suhu"],
    requiredVitals: ["td"],
    items: [
      item("anamnesis", "nyeri_panggul", "Nyeri panggul"),
      item("anamnesis", "kembung", "Kembung atau benjolan perut"),
      item("penunjang", "usg", "Hasil USG bila ada"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "prolaps",
    label: "Prolaps organ panggul",
    icd: "N81.9",
    group: "obgyn",
    vitals: ["td", "nadi"],
    requiredVitals: [],
    items: [
      item("anamnesis", "keluhan", "Keluhan berat atau menonjol"),
      item("anamnesis", "riwayat_persalinan", "Riwayat persalinan"),
      item("pemeriksaan", "derajat", "Derajat prolaps bila dinilai"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "infertilitas",
    label: "Infertilitas",
    icd: "N97.9",
    group: "obgyn",
    vitals: ["td", "nadi"],
    requiredVitals: [],
    items: [
      item("anamnesis", "lama", "Lama mencoba dan evaluasi sebelumnya"),
      item("anamnesis", "siklus", "Siklus haid"),
      item("penunjang", "usg", "Hasil USG atau hormonal bila ada"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "servisitis",
    label: "Servisitis / lesi pra-kanker",
    icd: "N72",
    group: "obgyn",
    vitals: ["td", "nadi"],
    requiredVitals: [],
    items: [
      item("anamnesis", "keluhan", "Keluhan keputihan atau perdarahan kontak"),
      item("penunjang", "iva_pap", "Hasil IVA / Pap Smear"),
      item("pemeriksaan", "inspekulo", "Temuan inspekulo"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },

  // ── Anak: kegawatan ────────────────────────────────────────────────────────
  {
    id: "asma_anak",
    label: "Asma anak",
    icd: "J45.9",
    group: "anak",
    vitals: ["rr", "spo2", "nadi", "suhu"],
    requiredVitals: ["spo2"],
    items: [
      item("anamnesis", "sesak", "Sesak dan pemicu"),
      item("anamnesis", "obat", "Obat asma yang sudah dipakai"),
      item("pemeriksaan", "retraksi", "Retraksi atau wheezing"),
      item("pemeriksaan", "kesadaran", "Kesadaran"),
    ],
    note: "Distres napas akut dengan sianosis adalah kegawatan; kirim segera.",
    source: FKTP_SOURCE,
  },
  {
    id: "bronkopneumonia",
    label: "Bronkopneumonia",
    icd: "J18.0",
    group: "anak",
    vitals: ["rr", "spo2", "suhu", "nadi"],
    requiredVitals: ["spo2"],
    items: [
      item("anamnesis", "demam", "Demam dan lama"),
      item("anamnesis", "batuk", "Batuk dan sesak"),
      item("pemeriksaan", "retraksi", "Retraksi dinding dada"),
      item("pemeriksaan", "ronki", "Ronki"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "diare_dehidrasi",
    label: "Diare dengan dehidrasi",
    icd: "A09",
    group: "anak",
    vitals: ["nadi", "rr", "suhu", "bb"],
    requiredVitals: ["nadi"],
    items: [
      item("anamnesis", "frekuensi", "Frekuensi diare dan muntah"),
      item("anamnesis", "urin", "Produksi urin terakhir"),
      item("pemeriksaan", "turgor", "Turgor kulit dan mata cekung"),
      item("pemeriksaan", "kesadaran", "Kesadaran"),
    ],
    note: "Diare tanpa dehidrasi tuntas di FKTP; dehidrasi berat langsung ke IGD.",
    source: FKTP_SOURCE,
  },
  {
    id: "kejang",
    label: "Kejang demam berulang / epilepsi",
    icd: "G40.9",
    group: "anak",
    vitals: ["td", "nadi", "rr", "suhu", "spo2"],
    requiredVitals: ["suhu"],
    items: [
      item("anamnesis", "lama_kejang", "Lama dan jumlah kejang"),
      item("anamnesis", "kesadaran", "Kesadaran setelah kejang"),
      item("pemeriksaan", "fokal", "Tanda neurologis fokal"),
    ],
    note: "Kejang aktif atau berulang tanpa pemulihan kesadaran adalah kegawatan.",
    source: FKTP_SOURCE,
  },
  {
    id: "tb_anak",
    label: "TB anak dengan komplikasi / gizi buruk",
    icd: "A15.0",
    group: "anak",
    vitals: ["suhu", "bb", "rr", "spo2"],
    requiredVitals: ["bb"],
    items: [
      item("anamnesis", "batuk", "Batuk lama dan kontak TB"),
      item("anamnesis", "skor_tb", "Skor TB anak"),
      item("pemeriksaan", "bb", "Berat badan dan status gizi"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "alergi_makanan",
    label: "Alergi makanan berat / CMPA",
    icd: "T78.1",
    group: "anak",
    vitals: ["rr", "spo2", "td", "nadi", "suhu"],
    requiredVitals: ["spo2"],
    items: [
      item("anamnesis", "pemicu", "Makanan pemicu dan waktu muncul"),
      item("anamnesis", "gejala", "Urtikaria, muntah, atau sesak"),
      item("pemeriksaan", "jalan_napas", "Tanda obstruksi jalan napas"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  // ── Anak: rujukan terencana ────────────────────────────────────────────────
  {
    id: "ftt",
    label: "Gagal tumbuh (failure to thrive)",
    icd: "R62.5",
    group: "anak",
    vitals: ["bb", "tb", "rr", "suhu"],
    requiredVitals: ["bb"],
    items: [
      item("anamnesis", "asupan", "Asupan makan dan riwayat penyakit"),
      item("pemeriksaan", "bb", "Berat badan dan panjang badan"),
      item("penunjang", "grafik", "Grafik pertumbuhan"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "stunting",
    label: "Stunting / gizi buruk",
    icd: "E44.0",
    group: "anak",
    vitals: ["bb", "tb", "rr", "suhu"],
    requiredVitals: ["bb"],
    items: [
      item("anamnesis", "asupan", "Asupan makan dan penyakit penyerta"),
      item("pemeriksaan", "bb_tb", "Berat dan tinggi badan"),
      item("pemeriksaan", "edema", "Edema pada kedua kaki"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "keterlambatan_perkembangan",
    label: "Keterlambatan perkembangan",
    icd: "F88",
    group: "anak",
    vitals: ["bb", "tb", "rr"],
    requiredVitals: ["bb"],
    items: [
      item("anamnesis", "milestone", "Milestone motorik dan bicara"),
      item("anamnesis", "riwayat", "Riwayat kejang atau infeksi"),
      item("pemeriksaan", "neurologis", "Pemeriksaan neurologis singkat"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "bayi_risiko_tinggi",
    label: "Bayi risiko tinggi pasca NICU",
    icd: "P07.3",
    group: "anak",
    vitals: ["bb", "rr", "suhu", "spo2"],
    requiredVitals: ["bb"],
    items: [
      item("anamnesis", "riwayat_nicu", "Riwayat NICU dan diagnosis saat lahir"),
      item("pemeriksaan", "bb", "Berat badan terkini"),
      item("pemeriksaan", "kembang", "Kembang-tumbuh dan minum"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },
  {
    id: "ikterus_neonatorum",
    label: "Ikterus neonatorum",
    icd: "P59.9",
    group: "anak",
    vitals: ["suhu", "bb", "rr", "spo2"],
    requiredVitals: ["suhu"],
    items: [
      item("anamnesis", "usia_hari", "Usia bayi dalam hari"),
      item("anamnesis", "awal_ikterus", "Ikterus muncul dalam 24 jam atau tidak"),
      item("pemeriksaan", "kramer", "Derajat ikterus (Kramer)"),
      item("penunjang", "bilirubin", "Bilirubin total/direk/indirek bila ada"),
    ],
    note: "Ikterus dalam 24 jam pertama atau sampai telapak tangan/kaki adalah kegawatan.",
    source: FKTP_SOURCE,
  },
  {
    id: "asfiksia",
    label: "Asfiksia neonatorum",
    icd: "P21.9",
    group: "anak",
    vitals: ["rr", "spo2", "nadi", "suhu"],
    requiredVitals: ["spo2"],
    items: [
      item("anamnesis", "apgar", "APGAR menit 1 dan 5"),
      item("pemeriksaan", "napas", "Napas, retraksi, dan merintih"),
      item("pemeriksaan", "resusitasi", "Resusitasi yang sudah diberikan"),
    ],
    note: "Asfiksia lahir adalah kegawatan; kirim segera ke IGD/perinatologi.",
    source: FKTP_SOURCE,
  },
  {
    id: "rds",
    label: "RDS neonatus",
    icd: "P22.0",
    group: "anak",
    vitals: ["rr", "spo2", "nadi", "suhu"],
    requiredVitals: ["spo2"],
    items: [
      item("anamnesis", "usia", "Usia bayi dalam jam"),
      item("pemeriksaan", "retraksi", "Retraksi dan grunting"),
      item("penunjang", "rontgen", "Rontgen toraks bila ada"),
    ],
    note: "Distres napas neonatus adalah kegawatan.",
    source: FKTP_SOURCE,
  },
  {
    id: "bbler",
    label: "Berat badan lahir rendah (BBLR)",
    icd: "P07.1",
    group: "anak",
    vitals: ["bb", "rr", "suhu", "spo2"],
    requiredVitals: ["bb"],
    items: [
      item("anamnesis", "usia_gestasi", "Usia gestasi dan berat lahir"),
      item("pemeriksaan", "suhu", "Suhu dan kemampuan minum"),
      item("pemeriksaan", "napas", "Pola napas"),
    ],
    note: null,
    source: FKTP_SOURCE,
  },

  // ── Umum ───────────────────────────────────────────────────────────────────
  {
    id: "umum",
    label: "Rujukan umum",
    icd: null,
    group: "umum",
    vitals: VITAL_KEYS,
    requiredVitals: [],
    items: [
      item("anamnesis", "keluhan_utama", "Keluhan utama dan sejak kapan"),
      item("anamnesis", "riwayat_penyakit", "Riwayat penyakit dan obat yang diminum"),
      item("pemeriksaan", "kesadaran", "Kesadaran umum"),
      item("penunjang", "penunjang_lalu", "Pemeriksaan penunjang yang sudah dilakukan"),
    ],
    note: null,
    source: null,
  },
  {
    id: "hipertensi_dewasa",
    label: "Hipertensi dewasa",
    icd: "I10",
    group: "umum",
    vitals: ["td", "nadi", "rr", "spo2", "bb"],
    requiredVitals: ["td"],
    items: [
      item("anamnesis", "nyeri_kepala", "Nyeri kepala"),
      item("anamnesis", "pandangan_kabur", "Pandangan kabur"),
      item("anamnesis", "nyeri_dada", "Nyeri dada atau berdebar"),
      item("anamnesis", "sesak", "Sesak napas"),
      item("anamnesis", "obat_ht", "Obat antihipertensi dan kepatuhannya"),
      item("pemeriksaan", "edema_tungkai", "Edema tungkai"),
      item("pemeriksaan", "ronki", "Ronki basal paru"),
      item("penunjang", "ekg", "EKG 12 sadapan"),
    ],
    note: "Kriteria keluar jalur: tekanan darah ≥180/110 mmHg disertai tanda kerusakan organ target dialihkan segera ke UGD.",
    source: HT_SOURCE,
  },
  {
    id: "diabetes",
    label: "Diabetes melitus tipe 2",
    icd: "E11.9",
    group: "umum",
    vitals: ["td", "nadi", "gds", "bb"],
    requiredVitals: ["gds"],
    items: [
      item("anamnesis", "poliuri", "Sering berkemih"),
      item("anamnesis", "polidipsi", "Sering haus"),
      item("anamnesis", "turun_bb", "Penurunan berat badan"),
      item("anamnesis", "obat_dm", "Obat diabetes dan kepatuhannya"),
      item("pemeriksaan", "luka_kaki", "Pemeriksaan kaki dan luka"),
    ],
    note: "Bila glukosa sangat tinggi disertai muntah, napas cepat, atau penurunan kesadaran, kirim segera ke IGD.",
    source: DM_SOURCE,
  },
];

const BY_ID = new Map(REFERRAL_PROFILES.map((profile) => [profile.id, profile]));
const GENERIC_PROFILE = BY_ID.get("umum") as DiagnosisProfile;

/** Unknown, missing, or not-yet-chosen ids fall back to the generic profile, never to null. */
export function profileFor(id: string): DiagnosisProfile {
  return BY_ID.get(id) ?? GENERIC_PROFILE;
}

/** Profiles in the order the select renders them, grouped by specialty. */
export function profilesByGroup(): { group: DiagnosisGroup; label: string; profiles: DiagnosisProfile[] }[] {
  return DIAGNOSIS_GROUPS.map((group) => ({
    group,
    label: DIAGNOSIS_GROUP_LABELS[group],
    profiles: REFERRAL_PROFILES.filter((profile) => profile.group === group),
  }));
}

export const CHECKLIST_GROUP_LABELS: Readonly<Record<ChecklistGroup, string>> = {
  anamnesis: "Anamnesis",
  pemeriksaan: "Pemeriksaan fisik",
  penunjang: "Penunjang yang sudah dilakukan",
};
