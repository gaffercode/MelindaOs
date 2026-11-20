import type { MedifyRunSection } from "@/lib/medify/medify-run-status-contract";
import type { MedifyFinance, MedifySnapshot } from "@/lib/medify/medify-snapshot-contract";

export const SNAPSHOT_DATE = "2099-01-15";
const OBSERVED_AT = "2099-01-15T02:30:00.000Z"; // 09:30 WIB

export type SnapshotOverrides = {
  /** BOR % of the latest complete inpatient day. */
  borLatest?: number;
  /** Replaces the wards by one ward with these occupied and total beds. */
  bed?: [number, number];
  /** First day of the outpatient period. */
  outpatientPeriodStart?: string;
  satusehatPercent?: number;
  pharmacyCategories?: [string, number][];
  stockByUnit?: [string, number | null][];
  /** Outpatient visits of consecutive complete days ending the day before the snapshot date, oldest first. */
  outpatientDaily?: number[];
  /** Sections set to null. */
  nullSections?: MedifyRunSection[];
  /** Sections listed as unavailable in a scheduled run; leaving this out leaves the run out. */
  runUnavailable?: MedifyRunSection[];
  byClinic?: [string, number][];
  topDiagnoses?: [string, number][];
  /** Replaces fields of the finance section. */
  finance?: Partial<MedifyFinance>;
  /** Staff counts by employment type. */
  staffByType?: [string, number][];
};

const daysBefore = (count: number) => new Date(Date.UTC(2099, 0, 15 - count)).toISOString().slice(0, 10);
const named = (rows: [string, number][]) => rows.map(([name, visits]) => ({ name, visits }));
const totals = (rows: [string, number][]) => rows.map(([name, count]) => ({ name, count }));
/** Visits for consecutive complete days ending yesterday, then the snapshot date's own partial entry. */
const series = (visits: number[]) => [...visits.map((count, index) => ({ date: daysBefore(visits.length - index), visits: count })), { date: SNAPSHOT_DATE, visits: 7 }];

export function snapshot(overrides: SnapshotOverrides = {}): MedifySnapshot {
  const outpatientDaily = overrides.outpatientDaily ?? [100, 102, 98, 101, 99, 100, 103];
  const base: MedifySnapshot = {
    schemaVersion: 1,
    date: SNAPSHOT_DATE,
    bed: { observedAt: OBSERVED_AT, wards: overrides.bed ? [{ ward: "Ruang Sintetis A", kelas: "1", occupied: overrides.bed[0], capacity: overrides.bed[1] }] : [{ ward: "Ruang Sintetis A", kelas: "1", occupied: 4, capacity: 4 }, { ward: "Ruang Sintetis B", kelas: "2", occupied: 2, capacity: 6 }] },
    outpatient: {
      observedAt: OBSERVED_AT, periodStart: overrides.outpatientPeriodStart ?? series(outpatientDaily)[0].date, periodEnd: SNAPSHOT_DATE, visitsToday: 7, daily: series(outpatientDaily),
      byClinic: named(overrides.byClinic ?? [["Poli Sintetis A", 60], ["Poli Sintetis B", 40]]), newPatients: 5, returningPatients: 12,
      byPayer: named([["BPJS", 70], ["Tunai", 30]]),
    },
    igd: {
      observedAt: OBSERVED_AT, visitsToday: 3, daily: series([20, 21, 19, 20, 22, 20, 21]),
      topDiagnoses: named([["O80.0-Spontaneous vertex delivery", 9], ["O82.1-Delivery by emergency caesarean section", 4]]),
    },
    inpatient: {
      observedAt: OBSERVED_AT,
      daily: [60, 62, 61, 63, 60, 62, overrides.borLatest ?? 62].map((bor, index) => ({ date: daysBefore(7 - index), admissions: 8 + (index % 3), bor })),
      monthly: [
        { month: "2098-12", admissions: 150, bor: 44.92, toi: 3.46, bto: 4.57, ndr: 0, gdr: 6.76 },
        { month: "2099-01", admissions: 70, bor: 53.7, toi: 2.3, bto: 4.6, ndr: 0, gdr: 0 },
      ],
    },
    finance: { observedAt: OBSERVED_AT, cashToday: 1250000, revenueToday: 3400000, receivablesTotal: 100000, payablesTotal: 900000, ...overrides.finance },
    inpatientMix: {
      observedAt: OBSERVED_AT, periodStart: "2098-12-15", periodEnd: SNAPSHOT_DATE,
      topDiagnoses: totals(overrides.topDiagnoses ?? [["P03.4 - Fetus and newborn affected by caesarean delivery", 66], ["O63.0 - Prolonged first stage of labour", 22]]),
      byWard: totals([["Ruang Sintetis A", 124]]), byDpjp: totals([["dr. Sintetis Satu, Sp.OG", 12]]), byPayer: totals([["BPJS", 229], ["Tunai", 5]]),
      byStatus: [{ name: "Lama", percent: 59 }, { name: "Baru", percent: 41 }], byGender: [{ name: "Laki Laki", percent: 24 }, { name: "Perempuan", percent: 76 }],
    },
    igdMix: { observedAt: OBSERVED_AT, periodStart: "2098-12-15", periodEnd: SNAPSHOT_DATE, byDischarge: totals([["Rawat Inap", 127], ["Sembuh", 20]]), byPayer: totals([["BPJS", 131]]) },
    diagnostics: {
      observedAt: OBSERVED_AT, periodStart: "2098-12-15", periodEnd: SNAPSHOT_DATE,
      labPk: { topTests: totals([["Darah Lengkap Sintetis", 146]]), responseTime: totals([["< 3 Jam", 144]]) },
      labPa: { topTests: [], responseTime: totals([["< 3 Jam", 0]]) },
      radiology: { topTests: [], responseTime: totals([["< 3 Jam", 0]]) },
    },
    pharmacy: {
      observedAt: OBSERVED_AT, periodStart: "2098-12-15", periodEnd: SNAPSHOT_DATE,
      stockByUnit: (overrides.stockByUnit ?? [["Gudang Sintetis", 478945157]]).map(([name, rupiah]) => ({ name, rupiah })), topByValue: [{ name: "Infus Sintetis", rupiah: 318355396 }],
      topByQuantity: totals([["Paracetamol 500 Tab", 1308]]), byCategory: totals(overrides.pharmacyCategories ?? [["Fornas", 1173]]),
    },
    staff: {
      observedAt: OBSERVED_AT, byType: totals(overrides.staffByType ?? [["Tetap", 40], ["Kontrak", 28]]), byStatus: totals([["Aktif", 69], ["Tidak Aktif", 7]]),
      activeMonthly: [{ month: "2098-12", count: 61 }, { month: "2099-01", count: 61 }], leftMonthly: [{ month: "2098-12", count: 1 }, { month: "2099-01", count: 0 }],
    },
    satusehat: {
      observedAt: OBSERVED_AT, periodStart: "2099-01-01", periodEnd: SNAPSHOT_DATE, globalPercent: overrides.satusehatPercent ?? 44.8, expected: 561, sent: 556, failed: 0, notSent: 4, lastUpdate: "15 Jan 2099, 09:30 WIB",
      resources: [{ name: "Encounter", expected: 561, sent: 556, failed: 0, notSent: 4 }],
    },
    patients: {
      observedAt: OBSERVED_AT, total: 3009, newToday: 0, transactionsToday: 9, byPayer: totals([["BPJS", 2708], ["Tunai", 2581]]),
      monthlyVisits: [{ month: "2098-12", outpatient: 335, inpatient: 203, igd: 147 }, { month: "2099-01", outpatient: 240, inpatient: 273, igd: 165 }],
      newMonthly: [{ month: "2098-12", count: 243 }, { month: "2099-01", count: 40 }],
    },
    provenance: {
      producer: "medify-pull", sourceObservedAt: OBSERVED_AT, periodStart: SNAPSHOT_DATE, periodEnd: SNAPSHOT_DATE, cutoff: null,
      sources: [{ name: "Medify SIMRS", url: "https://medify.synthetic.example/", note: "Hanya angka agregat, tanpa data pasien." }], notes: "",
    },
  };
  const nulled: Partial<Record<MedifyRunSection, null>> = {};
  for (const name of overrides.nullSections ?? []) nulled[name] = null;
  const unavailable = overrides.runUnavailable;
  const run: Pick<MedifySnapshot, "run"> = unavailable
    ? { run: { slot: "morning", runId: "medify-morning-20990115-a1", status: unavailable.length ? "degraded" : "complete", startedAt: "2099-01-15T02:00:00.000Z", completedAt: "2099-01-15T02:31:00.000Z", unavailableSections: unavailable.map((section) => ({ section, reason: "request_failed" })) } }
    : {};
  return { ...base, ...nulled, ...run };
}
