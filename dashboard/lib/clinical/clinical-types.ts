/**
 * Shapes for the clinical page (`/klinis`): handover, duty roster and incident reports typed in by the
 * Director or a doctor. Pure data, no React and no server imports, so the form and the server share them.
 */

export const CLINICAL_KINDS = ["handover", "roster", "insiden"] as const;
export type ClinicalKind = (typeof CLINICAL_KINDS)[number];
export const CLINICAL_KIND_LABELS: Readonly<Record<ClinicalKind, string>> = {
  handover: "Serah terima",
  roster: "Roster jaga",
  insiden: "Insiden",
};

export const SHIFTS = ["pagi", "siang", "malam"] as const;
export type Shift = (typeof SHIFTS)[number];
export const SHIFT_LABELS: Readonly<Record<Shift, string>> = { pagi: "Pagi", siang: "Siang", malam: "Malam" };

export const CLINICAL_STATUSES = ["aktif", "dibatalkan"] as const;
export type ClinicalStatus = (typeof CLINICAL_STATUSES)[number];

export const INCIDENT_TYPES = ["KTD", "KNC", "KPC", "Sentinel"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export const INCIDENT_GRADES = ["biru", "hijau", "kuning", "merah"] as const;
export type IncidentGrade = (typeof INCIDENT_GRADES)[number];
export const INCIDENT_PROGRESS = ["baru", "ditindaklanjuti", "selesai"] as const;
export type IncidentProgress = (typeof INCIDENT_PROGRESS)[number];

export type HandoverPayload = {
  patient: string;
  rm: string;
  room: string;
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  pending: string;
  from: string;
  to: string;
};

export type RosterPerson = { name: string; role: string };
export type RosterPayload = { people: RosterPerson[]; notes: string };

export type IncidentPayload = {
  time: string;
  place: string;
  type: IncidentType;
  grade: IncidentGrade;
  chronology: string;
  followUp: string;
  progress: IncidentProgress;
  reporter: string;
};

export type PayloadFor = { handover: HandoverPayload; roster: RosterPayload; insiden: IncidentPayload };

/** What the form submits: the kind-specific payload plus the fields every entry has. */
export type ClinicalDraft<K extends ClinicalKind = ClinicalKind> = {
  [Key in K]: { kind: Key; date: string; shift: Shift | null; unit: string; payload: PayloadFor[Key] };
}[K];

export type StoredClinicalEntry<K extends ClinicalKind = ClinicalKind> = ClinicalDraft<K> & {
  id: string;
  status: ClinicalStatus;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};
