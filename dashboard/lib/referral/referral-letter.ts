import { complaintFor } from "./referral-complaints";
import { profileFor } from "./referral-checklist";
import { VITAL_KEYS, VITAL_LABELS, type ReferralDraft, type VitalKey } from "./referral-types";

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** `YYYY-MM-DD` to `16 November 2026`; an invalid value is returned unchanged. */
export function referralDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = MONTHS_ID[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : value;
}

/** Age from a birth date against `today` (both `YYYY-MM-DD`); empty when the date is missing or invalid. */
export function ageLabel(birthDate: string, today: string): string {
  const birth = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const now = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!birth || !now) return "";
  const from = Date.UTC(Number(birth[1]), Number(birth[2]) - 1, Number(birth[3]));
  const to = Date.UTC(Number(now[1]), Number(now[2]) - 1, Number(now[3]));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return "";
  const days = Math.floor((to - from) / 86_400_000);
  if (days < 31) return `${days} hari`;
  const months = Math.floor(days / 30.4375);
  if (months < 12) return `${months} bulan`;
  return `${Math.floor(months / 12)} tahun`;
}

/** Digits only; a leading `0` becomes the Indonesian `62` country code. */
export function normaliseWhatsapp(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

/** `https://wa.me/<number>?text=...`, or null when no usable number is configured. */
export function whatsappHref(number: string, text: string): string | null {
  const digits = normaliseWhatsapp(number);
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** A field the referrer must fill before the sheet can be sent. The list stays short: emergency first. */
export function referralFieldErrors(draft: ReferralDraft): Record<string, string> {
  const missing: Record<string, string> = {};
  if (!draft.patient.name.trim()) missing["patient-name"] = "Nama pasien";
  if (!draft.patient.birthDate && !/^\d{1,3}$/.test(draft.patient.age.trim())) missing["patient-age"] = "Tanggal lahir atau umur pasien";
  if (!draft.patient.sex) missing["patient-sex"] = "Jenis kelamin pasien";
  if (!draft.referrer.facility.trim()) missing["referrer-facility"] = "Nama faskes atau klinik perujuk";
  if (!draft.referrer.doctor.trim()) missing["referrer-doctor"] = "Nama dokter atau bidan perujuk";
  const phone = draft.referrer.phone.replace(/\D/g, "");
  if (phone.length < 8 || phone.length > 15) missing["referrer-phone"] = "Nomor WhatsApp perujuk yang dapat dihubungi";
  if (!draft.consent) missing["referral-consent"] = "Persetujuan pengiriman data pasien";
  return missing;
}

export function missingFields(draft: ReferralDraft): string[] {
  return Object.values(referralFieldErrors(draft));
}

export function patientAgeLabel(patient: ReferralDraft["patient"], date: string): string {
  return ageLabel(patient.birthDate, date) || (patient.age.trim() ? `${patient.age.trim()} ${patient.ageUnit ?? "tahun"}` : "");
}

function vitalLine(draft: ReferralDraft): string {
  const parts: string[] = [];
  for (const key of VITAL_KEYS as readonly VitalKey[]) {
    const value = draft.clinical.vitals[key]?.trim();
    if (!value) continue;
    const { label, unit } = VITAL_LABELS[key];
    parts.push(`${label} ${value} ${unit}`);
  }
  return parts.join(" · ");
}

function checkedLabels(draft: ReferralDraft): string[] {
  const profile = profileFor(draft.clinical.profileId);
  return profile.items.filter((entry) => draft.clinical.checks[entry.id]).map((entry) => entry.label);
}

function line(label: string, value: string): string {
  return value.trim() ? `${label}: ${value.trim()}` : "";
}

/**
 * Plain-text version used for the WhatsApp handoff and the clipboard. Empty fields
 * are left out so the message stays short; the printed sheet keeps every row.
 */
export function composeReferralText(draft: ReferralDraft, reference?: string): string {
  const patient = draft.patient;
  const referrer = draft.referrer;
  const clinical = draft.clinical;
  const age = patientAgeLabel(patient, clinical.date);
  const identity = [patient.sex === "L" ? "laki-laki" : patient.sex === "P" ? "perempuan" : "", age].filter(Boolean).join(", ");
  const checks = checkedLabels(draft);
  const lines = [
    "LEMBAR RUJUKAN — RSIA MELINDA DHAI",
    reference ? `Nomor: ${reference}` : "",
    "",
    line("Pasien", [patient.name, identity].filter(Boolean).join(" · ")),
    line("No. RM", patient.rm),
    line("Keluhan utama", complaintFor(clinical.chiefComplaint)?.label ?? ""),
    line("Perujuk", [referrer.doctor, referrer.facility, referrer.city].filter(Boolean).join(" · ")),
    line("Kontak perujuk", referrer.phone),
    "",
    line("Diagnosis rujukan", clinical.diagnosis),
    line("Alasan rujukan", clinical.reason),
    line("Sejak", clinical.onset),
    line("Tanda vital", vitalLine(draft)),
    line("Kelengkapan", checks.join("; ")),
    line("Terapi sudah diberikan", clinical.therapy),
    line("Alergi", clinical.allergy),
    line("Kehamilan", clinical.pregnancy),
    "",
    line("Tujuan", `${clinical.destination} · ${clinical.insurer}`),
    line("Tanggal", `${referralDateLabel(clinical.date)}${clinical.time ? `, ${clinical.time} WIB` : ""}`),
    line("Catatan", clinical.notes),
    "",
    "Dikirim melalui MelindaOS. Keputusan klinis tetap pada dokter yang memeriksa.",
  ];
  return lines.filter((entry, index, all) => entry !== "" || (index > 0 && all[index - 1] !== "")).join("\n").trim();
}
