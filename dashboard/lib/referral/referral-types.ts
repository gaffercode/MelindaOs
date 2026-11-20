/**
 * Shared shapes for the public referral sheet (`/rujukan`) and the dashboard inbox
 * (`/rujukan-masuk`). Pure data only: no React and no server imports, so both sides
 * can validate the same draft.
 */

export const REFERRAL_STATUSES = ["baru", "dihubungi", "diterima", "ditolak", "selesai"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export const REFERRAL_STATUS_LABELS: Readonly<Record<ReferralStatus, string>> = {
  baru: "Baru",
  dihubungi: "Sudah dihubungi",
  diterima: "Diterima",
  ditolak: "Tidak dapat diterima",
  selesai: "Selesai",
};

export const FACILITY_TYPES = [
  "FKTP / Puskesmas",
  "Klinik",
  "Praktik dokter perorangan",
  "Praktik bidan mandiri",
  "Rumah sakit lain",
] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const DESTINATIONS = [
  "IGD 24 jam",
  "Poli Anak",
  "Poli Obgyn",
  "Poli Penyakit Dalam",
  "Kamar Bersalin (VK)",
  "Rawat inap",
] as const;
export type Destination = (typeof DESTINATIONS)[number];

export const INSURERS = ["Umum / pribadi", "BPJS Kesehatan", "Asuransi swasta", "Perusahaan / korporat"] as const;
export type Insurer = (typeof INSURERS)[number];

export const SEXES = ["L", "P"] as const;
export type Sex = (typeof SEXES)[number] | "";

export const VITAL_KEYS = ["td", "nadi", "rr", "suhu", "spo2", "gds", "bb", "tb"] as const;
export type VitalKey = (typeof VITAL_KEYS)[number];
export type Vitals = Record<VitalKey, string>;

export const VITAL_LABELS: Readonly<Record<VitalKey, { label: string; unit: string; placeholder: string }>> = {
  td: { label: "Tekanan darah", unit: "mmHg", placeholder: "mis. 150/95" },
  nadi: { label: "Nadi", unit: "x/menit", placeholder: "mis. 92" },
  rr: { label: "Laju napas", unit: "x/menit", placeholder: "mis. 20" },
  suhu: { label: "Suhu", unit: "°C", placeholder: "mis. 37,2" },
  spo2: { label: "SpO2", unit: "%", placeholder: "mis. 98" },
  gds: { label: "Glukosa darah sewaktu", unit: "mg/dL", placeholder: "mis. 210" },
  bb: { label: "Berat badan", unit: "kg", placeholder: "mis. 62" },
  tb: { label: "Tinggi badan", unit: "cm", placeholder: "mis. 158" },
};

export type ReferralPatient = {
  name: string;
  birthDate: string;
  age: string;
  /** Older referrals omit the unit and are interpreted as years. */
  ageUnit?: "hari" | "bulan" | "tahun";
  sex: Sex;
  rm: string;
  nik: string;
};

export const CITIES = ["Kediri Kota", "Kediri Kabupaten", "Nganjuk"] as const;
export type City = (typeof CITIES)[number];

export const DIAGNOSIS_GROUPS = ["obgyn", "anak", "umum"] as const;
export type DiagnosisGroup = (typeof DIAGNOSIS_GROUPS)[number];
export const DIAGNOSIS_GROUP_LABELS: Readonly<Record<DiagnosisGroup, string>> = {
  obgyn: "Kebidanan & kandungan (Obgyn)",
  anak: "Anak (Pediatri)",
  umum: "Umum / penyakit dalam",
};

export type ReferralReferrer = {
  facilityType: FacilityType;
  facility: string;
  city: City;
  doctor: string;
  phone: string;
};

export type ReferralClinical = {
  profileId: string;
  chiefComplaint: string;
  diagnosis: string;
  reason: string;
  onset: string;
  vitals: Vitals;
  checks: Record<string, boolean>;
  therapy: string;
  allergy: string;
  pregnancy: string;
  insurer: Insurer;
  destination: Destination;
  date: string;
  time: string;
  notes: string;
};

export type ReferralDraft = {
  patient: ReferralPatient;
  referrer: ReferralReferrer;
  clinical: ReferralClinical;
  consent: boolean;
};

export const EMPTY_VITALS: Vitals = { td: "", nadi: "", rr: "", suhu: "", spo2: "", gds: "", bb: "", tb: "" };

/** A blank draft for one calendar day; the date and clock come from the caller so tests are deterministic. */
export function emptyReferralDraft(date: string, time: string): ReferralDraft {
  return {
    patient: { name: "", birthDate: "", age: "", sex: "", rm: "", nik: "" },
    referrer: { facilityType: "FKTP / Puskesmas", facility: "", city: "Kediri Kota", doctor: "", phone: "" },
    clinical: {
      profileId: "",
      chiefComplaint: "",
      diagnosis: "",
      reason: "",
      onset: "",
      vitals: { ...EMPTY_VITALS },
      checks: {},
      therapy: "",
      allergy: "",
      pregnancy: "",
      insurer: "BPJS Kesehatan",
      destination: "IGD 24 jam",
      date,
      time,
      notes: "",
    },
    consent: false,
  };
}

export type StoredReferral = {
  id: string;
  reference: string;
  receivedAt: string;
  status: ReferralStatus;
  payload: ReferralDraft;
  note: string | null;
  handledBy: string | null;
  handledAt: string | null;
};

export type ReferralReceipt = { reference: string; receivedAt: string; replayed: boolean };
