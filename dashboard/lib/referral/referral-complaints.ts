import { profileFor } from "./referral-checklist";
import type { VitalKey } from "./referral-types";

/**
 * Chief complaints that drive the vital-sign block. In an emergency the referrer often
 * has a complaint before a diagnosis, so the complaint selects the measurements first;
 * the chosen diagnosis can still add the vital sign it needs (for example blood pressure
 * for pre-eclampsia).
 *
 * These are data prompts, not triage advice. Values are always measured by the referrer.
 */

export type Complaint = {
  id: string;
  label: string;
  vitals: readonly VitalKey[];
  requiredVitals: readonly VitalKey[];
};

export const COMPLAINTS: readonly Complaint[] = [
  { id: "sesak", label: "Sesak napas", vitals: ["rr", "spo2", "nadi", "suhu"], requiredVitals: ["spo2"] },
  { id: "demam", label: "Demam", vitals: ["suhu", "nadi", "rr", "spo2"], requiredVitals: ["suhu"] },
  { id: "perdarahan", label: "Perdarahan", vitals: ["td", "nadi", "rr", "spo2"], requiredVitals: ["nadi"] },
  { id: "nyeri_kepala", label: "Nyeri kepala", vitals: ["td", "nadi", "suhu"], requiredVitals: ["td"] },
  { id: "kejang", label: "Kejang", vitals: ["td", "nadi", "rr", "suhu", "spo2"], requiredVitals: ["suhu"] },
  { id: "diare_muntah", label: "Diare / muntah", vitals: ["nadi", "rr", "suhu", "bb"], requiredVitals: ["nadi"] },
  { id: "nyeri_perut", label: "Nyeri perut", vitals: ["td", "nadi", "suhu"], requiredVitals: ["td"] },
  { id: "nyeri_dada", label: "Nyeri dada", vitals: ["td", "nadi", "rr", "spo2"], requiredVitals: ["spo2"] },
  { id: "penurunan_kesadaran", label: "Penurunan kesadaran", vitals: ["td", "nadi", "rr", "spo2", "suhu"], requiredVitals: ["spo2"] },
  { id: "lemah_pucat", label: "Lemah / pucat", vitals: ["td", "nadi", "rr"], requiredVitals: ["td"] },
  { id: "batuk", label: "Batuk", vitals: ["rr", "suhu", "spo2"], requiredVitals: ["spo2"] },
  { id: "luka_trauma", label: "Luka / trauma", vitals: ["td", "nadi", "rr"], requiredVitals: ["td"] },
  { id: "mual_muntah_hamil", label: "Mual / muntah kehamilan", vitals: ["td", "nadi", "suhu", "bb"], requiredVitals: ["td"] },
  { id: "lainnya", label: "Keluhan lain", vitals: ["td", "nadi", "rr", "suhu", "spo2"], requiredVitals: [] },
];

const BY_ID = new Map(COMPLAINTS.map((complaint) => [complaint.id, complaint]));

/** The selected complaint, or null while none is chosen. */
export function complaintFor(id: string): Complaint | null {
  return BY_ID.get(id) ?? null;
}

/** What the form shows: the complaint's set, plus the vital the diagnosis cannot do without. */
export function vitalsFor(complaintId: string, profileId: string): { vitals: VitalKey[]; requiredVitals: VitalKey[] } {
  const complaint = complaintFor(complaintId);
  if (!complaint) {
    const profile = profileFor(profileId);
    return { vitals: [...profile.vitals], requiredVitals: [...profile.requiredVitals] };
  }
  const vitals = [...complaint.vitals];
  const requiredVitals = [...complaint.requiredVitals];
  for (const key of profileFor(profileId).requiredVitals) {
    if (!vitals.includes(key)) vitals.push(key);
    if (!requiredVitals.includes(key)) requiredVitals.push(key);
  }
  return { vitals, requiredVitals };
}
