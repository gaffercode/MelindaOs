import type { MedifyBed, MedifyDiagnostics, MedifyFinance, MedifyIgd, MedifyIgdMix, MedifyInpatient, MedifyInpatientMix, MedifyOutpatient, MedifyPatients, MedifyPharmacy, MedifySatusehat, MedifySnapshot, MedifyStaff } from "../lib/medify/medify-snapshot-contract";
import type { MedifyRun } from "../lib/medify/medify-run-status-contract";

export const MEDIFY_PATHS: {
  login: string; bed: string; outpatient: string; igdVisits: string; igdDiagnoses: string; inpatient: string;
  igdDashboard: string; labPk: string; labPa: string; radiology: string; pharmacyStock: string; pharmacyCategory: string;
  staffType: string; staffStatus: string; staffActive: string; staffLeft: string; financePage: string; finance: string;
  satusehat: string; patients: string; patientVisits: string; patientsNew: string; patientPayers: string;
};
export function satusehatQuery(date: string): string;
export function satusehatSection(raw: unknown, observedAt: string, date: string): MedifySatusehat;
export function patientsSection(raw: { summary: unknown; visits: unknown; newMonthly: unknown; payer: unknown }, observedAt: string, date: string): MedifyPatients;
export function igdSection(rawVisits: unknown, rawDiagnoses: unknown, observedAt: string, date: string): MedifyIgd;
export function dashboardQuery(path: string, durasi: string, satuan: string, chart: string): string;
export function inpatientQuery(durasi: string, satuan: string, chart: string): string;
export function inpatientSection(raw: { dailyAdmissions: unknown; dailyBor: unknown; monthly: Record<"admissions" | "bor" | "toi" | "bto" | "ndr" | "gdr", unknown> }, observedAt: string, date: string): MedifyInpatient;
export function monthBefore(date: string): string;
export function stripCount(title: unknown): string;
export function inpatientMixSection(raw: Record<"diagnoses" | "wards" | "dpjp" | "payer" | "status" | "gender", unknown>, observedAt: string, date: string): MedifyInpatientMix;
export function igdMixSection(raw: Record<"discharge" | "payer", unknown>, observedAt: string, date: string): MedifyIgdMix;
export function diagnosticsSection(raw: Record<"labPk" | "labPa" | "radiology", { tests: unknown; responseTime: unknown }>, observedAt: string, date: string): MedifyDiagnostics;
export function pharmacySection(raw: Record<"stock" | "byValue" | "byQuantity" | "category", unknown>, observedAt: string, date: string): MedifyPharmacy;
export function staffSection(raw: Record<"type" | "status" | "active" | "left", unknown>, observedAt: string, date: string): MedifyStaff;
export function wibDate(now: Date): string;
export function bedSection(raw: unknown, observedAt: string): MedifyBed;
export function outpatientSection(raw: unknown, observedAt: string, date: string): MedifyOutpatient;
export function financeSection(raw: unknown, observedAt: string): MedifyFinance;
export function buildScheduledRun(slot: "morning" | "evening", startedAt: string, completedAt: string, unavailableSections: MedifyRun["unavailableSections"], runId?: string): MedifyRun;
export function buildSnapshot(sections: { bed?: MedifyBed; outpatient?: MedifyOutpatient; igd?: MedifyIgd; inpatient?: MedifyInpatient; finance?: MedifyFinance; inpatientMix?: MedifyInpatientMix; igdMix?: MedifyIgdMix; diagnostics?: MedifyDiagnostics; pharmacy?: MedifyPharmacy; staff?: MedifyStaff; satusehat?: MedifySatusehat; patients?: MedifyPatients }, failures: string[], date: string, observedAt: string, baseUrl: string, run?: MedifyRun | null): MedifySnapshot;
export class MedifySession {
  constructor(baseUrl: string, fetchImpl?: typeof fetch);
  login(email: string, password: string): Promise<void>;
}
export function describePath(query: string): string;
export function parseArgs(argv: string[], env?: Record<string, string | undefined>): { dryRun: boolean; out: string | null; dumpDir: string | null; slot: "morning" | "evening" | null };
export function pullMedify(options: { baseUrl: string; email: string; password: string; fetch?: typeof fetch; concurrency?: number | string; now?: () => Date; dumpDir?: string | null; slot?: "morning" | "evening" | null; runId?: string; startedAt?: string | null }): Promise<MedifySnapshot>;
