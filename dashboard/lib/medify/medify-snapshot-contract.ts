import schemaDocument from "../../schemas/medify-snapshot-v1.schema.json";
import { DAILY_DOCUMENT_MAX_BYTES } from "../daily/daily-documents";
import { assertPublication, jsonByteLength, matchClosedSchema, PublisherValidationError, type DocumentProvenance } from "../publisher-contract";
import { assertMedifyRun, type MedifyRun } from "./medify-run-status-contract";

/**
 * Aggregate counts pulled from Medify by `scripts/medify-pull.mjs` (see the schema description).
 * Each section carries its own `observedAt`; a null section means that pull failed.
 */
export type MedifyNamedCount = { name: string; visits: number };
export type MedifyBedWard = { ward: string; kelas: string; occupied: number; capacity: number };
export type MedifyBed = { observedAt: string; wards: MedifyBedWard[] };
export type MedifyOutpatient = {
  observedAt: string;
  periodStart: string;
  periodEnd: string;
  visitsToday: number | null;
  daily: { date: string; visits: number }[];
  byClinic: MedifyNamedCount[];
  newPatients: number | null;
  returningPatients: number | null;
  byPayer: MedifyNamedCount[];
};
/** IGD visits for the last days of the current month and the month's top diagnoses (ICD-10 label, count). */
export type MedifyIgd = { observedAt: string; visitsToday: number | null; daily: { date: string; visits: number }[]; topDiagnoses: MedifyNamedCount[] };
/** Complete days only (admissions, BOR %), and Medify's monthly indicators; the last month is month to date. */
export type MedifyInpatient = {
  observedAt: string;
  daily: { date: string; admissions: number; bor: number; online?: number; onsite?: number; anjungan?: number }[];
  monthly: { month: string; admissions: number; bor: number; toi: number; bto: number; ndr: number; gdr: number }[];
};
export type MedifyFinance ={ observedAt: string; cashToday: number | null; revenueToday: number | null; receivablesTotal: number | null; payablesTotal: number | null };
/** Lists below cover Medify's rolling month (`periodStart`..`periodEnd`); labels are Medify's own. */
export type MedifyNamedTotal = { name: string; count: number };
export type MedifyNamedShare = { name: string; percent: number };
export type MedifyNamedRupiah = { name: string; rupiah: number | null };
type MedifyPeriod = { observedAt: string; periodStart: string; periodEnd: string };
export type MedifyInpatientMix = MedifyPeriod & { topDiagnoses: MedifyNamedTotal[]; byWard: MedifyNamedTotal[]; byDpjp: MedifyNamedTotal[]; byPayer: MedifyNamedTotal[]; byStatus: MedifyNamedShare[]; byGender: MedifyNamedShare[] };
export type MedifyIgdMix = MedifyPeriod & { byDischarge: MedifyNamedTotal[]; byPayer: MedifyNamedTotal[] };
export type MedifyDiagnosticUnit = { topTests: MedifyNamedTotal[]; responseTime: MedifyNamedTotal[] };
export type MedifyDiagnostics = MedifyPeriod & { labPk: MedifyDiagnosticUnit; labPa: MedifyDiagnosticUnit; radiology: MedifyDiagnosticUnit };
export type MedifyPharmacy = MedifyPeriod & { stockByUnit: MedifyNamedRupiah[]; topByValue: MedifyNamedRupiah[]; topByQuantity: MedifyNamedTotal[]; byCategory: MedifyNamedTotal[] };
export type MedifyStaff = { observedAt: string; byType: MedifyNamedTotal[]; byStatus: MedifyNamedTotal[]; activeMonthly: { month: string; count: number }[]; leftMonthly: { month: string; count: number }[] };
/** SATUSEHAT submissions for the calendar month to date, per FHIR resource in FHIR order; Medify's `lastUpdate` text kept verbatim. */
export type MedifySatusehatResource = { name: string; expected: number; sent: number; failed: number; notSent: number };
export type MedifySatusehat = MedifyPeriod & { globalPercent: number; expected: number; sent: number; failed: number; notSent: number; lastUpdate: string; resources: MedifySatusehatResource[] };
/** The cumulative patient base (payer mix is all-time, not a period), today's counts, and monthly series up to the report month. */
export type MedifyMonthlyVisits = { month: string; outpatient: number; inpatient: number; igd: number };
export type MedifyPatients = { observedAt: string; total: number; newToday: number; transactionsToday: number; byPayer: MedifyNamedTotal[]; monthlyVisits: MedifyMonthlyVisits[]; newMonthly: { month: string; count: number }[] };
export type MedifySnapshot = {
  schemaVersion: 1;
  date: string;
  bed: MedifyBed | null;
  outpatient: MedifyOutpatient | null;
  igd: MedifyIgd | null;
  inpatient: MedifyInpatient | null;
  finance: MedifyFinance | null;
  /** Optional: snapshots stored before these feeds existed do not carry them. */
  inpatientMix?: MedifyInpatientMix | null;
  igdMix?: MedifyIgdMix | null;
  diagnostics?: MedifyDiagnostics | null;
  pharmacy?: MedifyPharmacy | null;
  staff?: MedifyStaff | null;
  satusehat?: MedifySatusehat | null;
  patients?: MedifyPatients | null;
  run?: MedifyRun;
  provenance: DocumentProvenance;
};

export function parseMedifySnapshot(value: unknown): MedifySnapshot {
  if (jsonByteLength(value, "document") > DAILY_DOCUMENT_MAX_BYTES) throw new PublisherValidationError("document.size");
  matchClosedSchema(value, schemaDocument, "document");
  const snapshot = value as MedifySnapshot;
  assertPublication(snapshot, "document");
  if (snapshot.run !== undefined) assertMedifyRun(snapshot.run, snapshot.date, "document.run");
  for (const name of ["outpatient", "inpatientMix", "igdMix", "diagnostics", "pharmacy", "satusehat"] as const) {
    const section = snapshot[name];
    if (section && (section.periodStart > section.periodEnd || section.periodEnd > snapshot.date)) throw new PublisherValidationError(`document.${name}.period`);
  }
  if (snapshot.bed?.wards.some((ward) => ward.occupied > ward.capacity)) throw new PublisherValidationError("document.bed.wards");
  const validPercentage = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
  if (snapshot.satusehat && !validPercentage(snapshot.satusehat.globalPercent)) throw new PublisherValidationError("document.satusehat.globalPercent");
  if (snapshot.inpatientMix && [...snapshot.inpatientMix.byStatus, ...snapshot.inpatientMix.byGender].some((item) => !validPercentage(item.percent))) throw new PublisherValidationError("document.inpatientMix.percent");
  if (snapshot.staff && [...snapshot.staff.activeMonthly, ...snapshot.staff.leftMonthly].some((item) => item.month > snapshot.date.slice(0, 7))) throw new PublisherValidationError("document.staff.month");
  if (snapshot.run) {
    const unavailable = new Set(snapshot.run.unavailableSections.map((issue) => issue.section));
    for (const name of ["bed", "outpatient", "igd", "inpatient", "inpatientMix", "igdMix", "diagnostics", "pharmacy", "staff", "finance", "satusehat", "patients"] as const) {
      const section = snapshot[name];
      if ((section === null) !== unavailable.has(name)) throw new PublisherValidationError(`document.${name}.run`);
      if (section && "observedAt" in section && (Date.parse(section.observedAt) < Date.parse(snapshot.run.startedAt) || Date.parse(section.observedAt) > Date.parse(snapshot.run.completedAt))) throw new PublisherValidationError(`document.${name}.observedAt`);
    }
  }
  return snapshot;
}
