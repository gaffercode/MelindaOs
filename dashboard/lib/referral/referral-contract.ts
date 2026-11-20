import { COMPLAINTS } from "./referral-complaints";
import { REFERRAL_PROFILES } from "./referral-checklist";
import {
  CITIES,
  DESTINATIONS,
  FACILITY_TYPES,
  INSURERS,
  REFERRAL_STATUSES,
  SEXES,
  VITAL_KEYS,
  type ReferralDraft,
  type ReferralStatus,
  type VitalKey,
} from "./referral-types";

/** A rejected referral payload. `path` names the field, never its content. */
export class ReferralValidationError extends Error {
  override readonly name = "ReferralValidationError";
  constructor(public readonly path: string) {
    super(path);
  }
}

const fail = (path: string): never => {
  throw new ReferralValidationError(path);
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, path: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) fail(path);
    return "";
  }
  if (typeof value !== "string") return fail(path);
  const clean = value.trim();
  if (clean.length > max || (required && clean.length === 0)) return fail(path);
  return clean;
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[], fallback?: T): T {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    return fail(path);
  }
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) return fail(path);
  return value as T;
}

function date(value: unknown, path: string, required: boolean): string {
  const clean = text(value, path, 10, required);
  if (clean && !/^\d{4}-\d{2}-\d{2}$/.test(clean)) fail(path);
  return clean;
}

function time(value: unknown, path: string): string {
  const clean = text(value, path, 5);
  if (clean && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clean)) fail(path);
  return clean;
}

const VITAL_VALUE = /^[0-9][0-9.,/\s-]{0,19}$/;

/**
 * Deep validation for the public submission. The browser form is a convenience; this
 * function is the boundary. Unknown keys are ignored, every accepted key is bounded,
 * and the enums come from the same constants the form renders.
 */
export function parseReferralPayload(value: unknown): ReferralDraft {
  if (!isRecord(value)) return fail("draft");
  const patient = value.patient;
  const referrer = value.referrer;
  const clinical = value.clinical;
  if (!isRecord(patient)) return fail("patient");
  if (!isRecord(referrer)) return fail("referrer");
  if (!isRecord(clinical)) return fail("clinical");

  const name = text(patient.name, "patient.name", 120, true);
  const birthDate = date(patient.birthDate, "patient.birthDate", false);
  const age = text(patient.age, "patient.age", 3);
  const ageUnit = oneOf(patient.ageUnit, "patient.ageUnit", ["hari", "bulan", "tahun"] as const, "tahun");
  if (!birthDate && !/^\d{1,3}$/.test(age)) fail("patient.age");
  if (age && !/^\d{1,3}$/.test(age)) fail("patient.age");
  const sex = oneOf(patient.sex, "patient.sex", SEXES);
  const rm = text(patient.rm, "patient.rm", 30);
  const nik = text(patient.nik, "patient.nik", 16);
  if (nik && !/^\d{16}$/.test(nik)) fail("patient.nik");

  const facilityType = oneOf(referrer.facilityType, "referrer.facilityType", FACILITY_TYPES);
  const facility = text(referrer.facility, "referrer.facility", 160, true);
  const city = oneOf(referrer.city, "referrer.city", CITIES, "Kediri Kota");
  const doctor = text(referrer.doctor, "referrer.doctor", 120, true);
  const phone = text(referrer.phone, "referrer.phone", 24, true);
  if (phone.replace(/\D/g, "").length < 8 || phone.replace(/\D/g, "").length > 15) fail("referrer.phone");

  const profileId = oneOf(clinical.profileId, "clinical.profileId", REFERRAL_PROFILES.map((profile) => profile.id), "umum");
  const chiefComplaint = oneOf(clinical.chiefComplaint, "clinical.chiefComplaint", COMPLAINTS.map((complaint) => complaint.id), "");
  const diagnosis = text(clinical.diagnosis, "clinical.diagnosis", 200);
  const reason = text(clinical.reason, "clinical.reason", 1000);
  const onset = text(clinical.onset, "clinical.onset", 80);
  const therapy = text(clinical.therapy, "clinical.therapy", 1000);
  const allergy = text(clinical.allergy, "clinical.allergy", 300);
  const pregnancy = text(clinical.pregnancy, "clinical.pregnancy", 120);
  const insurer = oneOf(clinical.insurer, "clinical.insurer", INSURERS);
  const destination = oneOf(clinical.destination, "clinical.destination", DESTINATIONS);
  const reportDate = date(clinical.date, "clinical.date", true);
  const reportTime = time(clinical.time, "clinical.time");
  const notes = text(clinical.notes, "clinical.notes", 1000);

  const rawVitals = clinical.vitals;
  if (!isRecord(rawVitals)) return fail("clinical.vitals");
  const vitals = Object.fromEntries(
    VITAL_KEYS.map((key) => {
      const value = rawVitals[key];
      if (value === undefined || value === null || value === "") return [key, ""];
      if (typeof value !== "string" || value.length > 20 || !VITAL_VALUE.test(value.trim())) return fail(`clinical.vitals.${key}`);
      return [key, value.trim()];
    }),
  ) as Record<VitalKey, string>;

  const rawChecks = clinical.checks;
  if (!isRecord(rawChecks)) return fail("clinical.checks");
  const entries = Object.entries(rawChecks);
  if (entries.length > 80) return fail("clinical.checks");
  const checks: Record<string, boolean> = {};
  for (const [key, checked] of entries) {
    if (!/^[a-z0-9_]{1,60}$/.test(key) || typeof checked !== "boolean") fail("clinical.checks");
    if (checked) checks[key] = true;
  }

  if (value.consent !== true) fail("consent");

  return {
    patient: { name, birthDate, age, sex, rm, nik, ...(patient.ageUnit ? { ageUnit } : {}) },
    referrer: { facilityType, facility, city, doctor, phone },
    clinical: {
      profileId,
      chiefComplaint,
      diagnosis,
      reason,
      onset,
      vitals,
      checks,
      therapy,
      allergy,
      pregnancy,
      insurer,
      destination,
      date: reportDate,
      time: reportTime,
      notes,
    },
    consent: true,
  };
}

/** Status accepted from the dashboard; anything else is a request error. */
export function parseReferralStatus(value: unknown): ReferralStatus {
  if (typeof value !== "string" || !(REFERRAL_STATUSES as readonly string[]).includes(value)) return fail("status");
  return value as ReferralStatus;
}
