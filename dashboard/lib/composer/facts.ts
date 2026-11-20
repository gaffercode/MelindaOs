import { MEDIFY_RUN_SECTIONS, type MedifyRunSection } from "../medify/medify-run-status-contract";
import type { MedifySnapshot } from "../medify/medify-snapshot-contract";
import type { SatusehatSnapshot } from "../satusehat/satusehat-snapshot-contract";
import { metric, type BriefSection, type MetricId } from "./metrics";

export type FactKind = "ambang" | "keadaan" | "perubahan" | "bulanan" | "penyumbang" | "data";
export type Fact = { id: string; kind: FactKind; metric: MetricId | null; section: BriefSection | "dataLimitations"; severity: "info" | "perhatian" | "kritis"; values: number[]; text: string };

type Day = { date: string; value: number };
type Period = { periodStart: string; periodEnd: string } | null | undefined;

const COMPARED_DAYS = 7;
const MIN_EARLIER_DAYS = 4;
const COUNT_CHANGE_RATIO = 0.2;
const COUNT_CHANGE_MIN = 5;
const TOP_CONTRIBUTORS = 3;
/** The category labels the page counts as uncategorised (`medify-section-extras.tsx`). */
const UNCATEGORISED = new Set(["off", "tidak berkategori", "-"]);

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const format = (value: number, digits = 1) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits }).format(value);
/** Always one decimal, as the page prints the SATUSEHAT share. */
const share = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const withUnit = (id: MetricId, value: string) => {
  const unit = metric(id).unit;
  return unit === "%" || unit === "‰" ? `${value}${unit}` : `${value} ${unit}`;
};
const byDate = (a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : 1);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
/** A period in words: every digit in a fact text becomes a number the prose may state, so dates stay out. */
const periodWords = (period: Period) => {
  const days = period ? (Date.parse(period.periodEnd) - Date.parse(period.periodStart)) / 86_400_000 : Number.NaN;
  return days >= 27 && days <= 32 ? "dalam sebulan terakhir" : "pada periode data Medify";
};

/** The latest complete day and up to seven complete days before it; null when fewer than four earlier days exist. */
function recent(entries: Day[], date: string): { latest: number; earlier: number[]; mean: number } | null {
  const days = entries.filter((entry) => entry.date < date).sort(byDate);
  const latest = days.at(-1);
  const earlier = days.slice(-(COMPARED_DAYS + 1), -1).map((entry) => entry.value);
  if (!latest || earlier.length < MIN_EARLIER_DAYS) return null;
  return { latest: latest.value, earlier, mean: sum(earlier) / earlier.length };
}

function countChange(id: MetricId, entries: Day[], date: string): Fact | null {
  const days = recent(entries, date);
  if (!days) return null;
  const size = Math.abs(days.latest - days.mean);
  if (size < COUNT_CHANGE_MIN || size < COUNT_CHANGE_RATIO * days.mean) return null;
  const percent = days.mean > 0 ? round((size / days.mean) * 100, 1) : null;
  const mean = round(days.mean, 1);
  const amount = percent === null ? format(round(size, 1)) : `${format(percent)}%`;
  return {
    id: `perubahan:${id}`, kind: "perubahan", metric: id, section: metric(id).section, severity: "info",
    values: [days.latest, mean, ...(percent === null ? [] : [percent]), days.earlier.length],
    text: `${metric(id).label} pada hari lengkap terakhir sebanyak ${format(days.latest)}, ${days.latest > days.mean ? "naik" : "turun"} ${amount} dibanding rata-rata ${format(mean)} pada ${days.earlier.length} hari sebelumnya.`,
  };
}

/**
 * Bed occupancy at the time of the pull, rounded as the page row prints it, and the fullest wards.
 * The daily BOR series is not read: Medify revises its newest days upward for several days, so a "latest day" figure is not final.
 */
function bedFacts(snapshot: MedifySnapshot): Fact[] {
  const wards = new Map<string, { occupied: number; capacity: number }>();
  for (const row of snapshot.bed?.wards ?? []) {
    const ward = wards.get(row.ward) ?? { occupied: 0, capacity: 0 };
    wards.set(row.ward, { occupied: ward.occupied + row.occupied, capacity: ward.capacity + row.capacity });
  }
  const occupied = sum([...wards.values()].map((ward) => ward.occupied));
  const capacity = sum([...wards.values()].map((ward) => ward.capacity));
  if (!capacity) return [];
  const bor = Math.round((occupied / capacity) * 100);
  const threshold = metric("bor").threshold;
  const beyond = (limit: number) => (threshold?.direction === "above" ? bor > limit : bor < limit);
  const critical = threshold?.kritis !== undefined && beyond(threshold.kritis);
  const limit = !threshold ? null : critical && threshold.kritis !== undefined ? threshold.kritis : beyond(threshold.perhatian) ? threshold.perhatian : null;
  const state = `Tempat tidur terisi ${format(occupied)} dari ${format(capacity)} saat data diambil (BOR ${bor}%)`;
  const section = metric("bor").section;
  const top = [...wards].filter(([, ward]) => ward.capacity > 0).sort(([, a], [, b]) => b.occupied / b.capacity - a.occupied / a.capacity).slice(0, TOP_CONTRIBUTORS);
  return [
    limit === null
      ? { id: "keadaan:bed", kind: "keadaan", metric: "bor", section, severity: "info", values: [occupied, capacity, bor], text: `${state}.` }
      : { id: "ambang:bor", kind: "ambang", metric: "bor", section, severity: critical ? "kritis" : "perhatian", values: [occupied, capacity, bor, limit], text: `${state}, ${threshold?.direction === "above" ? "di atas" : "di bawah"} batas ${limit}%.` },
    {
      id: "penyumbang:bed.wards", kind: "penyumbang", metric: null, section, severity: "info", values: top.flatMap(([, ward]) => [ward.occupied, ward.capacity]),
      text: `Ruang dengan hunian tertinggi saat data diambil: ${top.map(([name, ward]) => `"${name}" ${format(ward.occupied)} dari ${format(ward.capacity)}`).join(", ")}.`,
    },
  ];
}

/** Month to date beside the previous month. Medify keeps revising the running month, so the figure is named provisional and no direction is claimed. */
function monthlyFigures(snapshot: MedifySnapshot): Fact[] {
  const months = snapshot.inpatient?.monthly ?? [];
  const last = months.at(-1);
  const previous = months.at(-2);
  if (!last || !previous) return [];
  const facts: Fact[] = [];
  for (const id of ["bor", "toi", "ndr", "gdr"] as const) {
    const [now, before] = [round(last[id], 2), round(previous[id], 2)];
    if (now === before) continue;
    facts.push({
      id: `bulanan:${id}`, kind: "bulanan", metric: id, section: metric(id).section, severity: "info", values: [now, before],
      text: `${metric(id).label} bulan berjalan ${withUnit(id, format(now, 2))} (angka sementara, masih berubah sampai bulan ditutup); bulan sebelumnya ${withUnit(id, format(before, 2))}.`,
    });
  }
  return facts;
}

/** Medify's own share and counts, quoted as given: the share follows the patients' discharge dates and is not the ratio of the counts. */
function satusehatFact(snapshot: MedifySnapshot): Fact | null {
  const data = snapshot.satusehat;
  if (!data) return null;
  const limit = metric("satusehat_sent_percent").threshold?.perhatian;
  const below = limit !== undefined && data.globalPercent < limit;
  const state = `SATUSEHAT bulan berjalan menurut Medify ${share.format(data.globalPercent)}%: ${format(data.sent)} dari ${format(data.expected)} resource terkirim, ${format(data.failed)} gagal, ${format(data.notSent)} belum dikirim`;
  return {
    id: below ? "ambang:satusehat" : "keadaan:satusehat", kind: below ? "ambang" : "keadaan", metric: "satusehat_sent_percent", section: metric("satusehat_sent_percent").section, severity: below ? "perhatian" : "info",
    values: [data.globalPercent, data.sent, data.expected, data.failed, data.notSent, ...(below ? [limit] : [])],
    text: below ? `${state}; di bawah batas ${limit}%.` : `${state}.`,
  };
}

function staffFacts(snapshot: MedifySnapshot): Fact[] {
  const staff = snapshot.staff;
  if (!staff) return [];
  const active = staff.byStatus.find((item) => item.name.toLowerCase() === "aktif")?.count;
  const charted = staff.activeMonthly.at(-1)?.count;
  const left = sum(staff.leftMonthly.map((item) => item.count));
  const facts: Fact[] = [];
  if (active !== undefined) facts.push({ id: "keadaan:staff_active", kind: "keadaan", metric: "staff_active", section: "staffing", severity: "info", values: [active], text: `Pegawai berstatus aktif ${format(active)} orang.` });
  if (staff.leftMonthly.length) facts.push({ id: "keadaan:staff_left", kind: "keadaan", metric: "staff_left", section: "staffing", severity: "info", values: [left, staff.leftMonthly.length], text: `Pegawai keluar ${format(left)} orang dalam ${staff.leftMonthly.length} bulan terakhir.` });
  if (active !== undefined && charted !== undefined && charted !== active) facts.push({ id: "data:staff.mismatch", kind: "data", metric: null, section: "staffing", severity: "perhatian", values: [charted, active], text: `Grafik pegawai aktif bulanan Medify menunjukkan ${format(charted)}, sedangkan status aktif ${format(active)}.` });
  return facts;
}

/** Counts only: the rupiah values of the stock are not reconciled with Finance and stay out of the facts. */
function pharmacyFacts(snapshot: MedifySnapshot): Fact[] {
  const pharmacy = snapshot.pharmacy;
  if (!pharmacy) return [];
  const all = sum(pharmacy.byCategory.map((item) => item.count));
  const uncategorised = sum(pharmacy.byCategory.filter((item) => UNCATEGORISED.has(item.name.trim().toLowerCase())).map((item) => item.count));
  const unvalued = pharmacy.stockByUnit.filter((unit) => unit.rupiah === null).length;
  const facts: Fact[] = [];
  if (uncategorised > 0) facts.push({ id: "data:pharmacy.uncategorised", kind: "data", metric: null, section: "claimsFinance", severity: "perhatian", values: [uncategorised, all], text: `${format(uncategorised)} dari ${format(all)} item farmasi belum terkategori di Medify.` });
  if (unvalued > 0) facts.push({ id: "data:pharmacy.stockMissing", kind: "data", metric: null, section: "claimsFinance", severity: "perhatian", values: [unvalued, pharmacy.stockByUnit.length], text: `${format(unvalued)} dari ${format(pharmacy.stockByUnit.length)} depo farmasi belum memiliki nilai stok tercatat di Medify.` });
  return facts;
}

type Rows = { name: string; value: number }[] | undefined;
const counts = (rows: { name: string; count: number }[] | undefined): Rows => rows?.map((row) => ({ name: row.name, value: row.count }));
const visitRows = (rows: { name: string; visits: number }[] | undefined): Rows => rows?.map((row) => ({ name: row.name, value: row.visits }));
/** `period` is given for the lists whose period the snapshot states per section; the other intros name theirs. Doctors' names and rupiah lists are left out. */
const CONTRIBUTOR_LISTS: { key: string; section: BriefSection; intro: string; rows: (snapshot: MedifySnapshot) => Rows; period?: (snapshot: MedifySnapshot) => Period }[] = [
  { key: "outpatient.byClinic", section: "serviceSummary", intro: "Poli rawat jalan dengan kunjungan terbanyak", rows: (s) => visitRows(s.outpatient?.byClinic), period: (s) => s.outpatient },
  { key: "outpatient.byPayer", section: "claimsFinance", intro: "Penjamin rawat jalan dengan kunjungan terbanyak", rows: (s) => visitRows(s.outpatient?.byPayer), period: (s) => s.outpatient },
  { key: "igd.topDiagnoses", section: "serviceSummary", intro: "Diagnosis IGD terbanyak bulan berjalan", rows: (s) => visitRows(s.igd?.topDiagnoses) },
  { key: "igdMix.byDischarge", section: "serviceSummary", intro: "Cara keluar pasien IGD terbanyak dalam sebulan terakhir", rows: (s) => counts(s.igdMix?.byDischarge) },
  { key: "inpatientMix.topDiagnoses", section: "serviceSummary", intro: "Diagnosis rawat inap terbanyak dalam sebulan terakhir", rows: (s) => counts(s.inpatientMix?.topDiagnoses) },
  { key: "inpatientMix.byWard", section: "serviceSummary", intro: "Ruang rawat inap dengan pasien terbanyak dalam sebulan terakhir", rows: (s) => counts(s.inpatientMix?.byWard) },
  { key: "inpatientMix.byPayer", section: "claimsFinance", intro: "Penjamin rawat inap terbanyak dalam sebulan terakhir", rows: (s) => counts(s.inpatientMix?.byPayer) },
  { key: "diagnostics.labPk.topTests", section: "safetyQuality", intro: "Pemeriksaan laboratorium terbanyak dalam sebulan terakhir", rows: (s) => counts(s.diagnostics?.labPk.topTests) },
  { key: "diagnostics.radiology.topTests", section: "safetyQuality", intro: "Pemeriksaan radiologi terbanyak dalam sebulan terakhir", rows: (s) => counts(s.diagnostics?.radiology.topTests) },
  { key: "pharmacy.topByQuantity", section: "claimsFinance", intro: "Obat dan BHP terbanyak menurut jumlah dalam sebulan terakhir", rows: (s) => counts(s.pharmacy?.topByQuantity) },
  { key: "staff.byType", section: "staffing", intro: "Jenis pegawai dengan jumlah terbanyak", rows: (s) => counts(s.staff?.byType) },
];

function contributors(snapshot: MedifySnapshot): Fact[] {
  const facts: Fact[] = [];
  for (const list of CONTRIBUTOR_LISTS) {
    const top = [...(list.rows(snapshot) ?? [])].sort((a, b) => b.value - a.value).slice(0, TOP_CONTRIBUTORS);
    if (!top.length) continue;
    const intro = list.period ? `${list.intro} ${periodWords(list.period(snapshot))}` : list.intro;
    facts.push({
      id: `penyumbang:${list.key}`, kind: "penyumbang", metric: null, section: list.section, severity: "info", values: top.map((row) => row.value),
      text: `${intro}: ${top.map((row) => `"${row.name}" ${format(row.value)}`).join(", ")}.`,
    });
  }
  return facts;
}

export const SECTION_NAMES: Record<MedifyRunSection, string> = {
  bed: "tempat tidur", outpatient: "rawat jalan", igd: "IGD", inpatient: "rawat inap", inpatientMix: "komposisi rawat inap", igdMix: "komposisi IGD",
  diagnostics: "penunjang diagnostik", pharmacy: "farmasi", staff: "kepegawaian", finance: "keuangan", satusehat: "SATUSEHAT", patients: "pasien",
};

function dataLimitations(snapshot: MedifySnapshot): Fact[] {
  const missing = new Set<MedifyRunSection>(snapshot.run?.unavailableSections.map((issue) => issue.section));
  for (const name of MEDIFY_RUN_SECTIONS) if (snapshot[name] === null) missing.add(name);
  return MEDIFY_RUN_SECTIONS.filter((name) => missing.has(name)).map((name) => ({
    id: `data:${name}`, kind: "data", metric: null, section: "dataLimitations", severity: "perhatian", values: [],
    text: `Data ${SECTION_NAMES[name]} tidak tersedia pada pengambilan ini, sehingga bagian itu tidak ikut dinilai.`,
  }));
}

function satusehatPortalFacts(portal: SatusehatSnapshot | null | undefined): Fact[] {
  if (!portal) return [];
  const facts: Fact[] = [];
  const okResources = portal.resources.filter((resource) => resource.status === "ok");
  const totalRecords = okResources.reduce((acc, resource) => acc + resource.count, 0);
  const resourceCount = (name: string) =>
    portal.resources.find((resource) => resource.name === name && resource.status === "ok")?.count ?? null;

  if (portal.resources.length > 0) {
    facts.push({
      id: "keadaan:satusehat_kemenkes.total",
      kind: "keadaan",
      metric: null,
      section: "safetyQuality",
      severity: "info",
      values: [totalRecords, okResources.length, portal.resources.length],
      text: `Data Satu Sehat Kemenkes mencatat ${format(totalRecords)} catatan dari ${format(okResources.length)} dari ${format(portal.resources.length)} jenis data layanan dalam sebulan terakhir.`,
    });
  }

  if (portal.logSummary && portal.logSummary.successRatePercent < 95) {
    const successPct = round(portal.logSummary.successRatePercent, 1);
    const failed = portal.logSummary.failedTransactions;
    const totalTx = portal.logSummary.totalTransactions;
    facts.push({
      id: "ambang:satusehat_kemenkes.error_rate",
      kind: "ambang",
      metric: null,
      section: "safetyQuality",
      severity: "perhatian",
      values: [successPct, failed, totalTx, 95],
      text: `Tingkat keberhasilan pengiriman ke Satu Sehat Kemenkes ${share.format(successPct)}% (${format(failed)} gagal dari ${format(totalTx)} pengiriman); di bawah batas ${95}%.`,
    });
  }

  const serviceRequest = resourceCount("ServiceRequest");
  const diagnosticReport = resourceCount("DiagnosticReport");
  if (serviceRequest !== null && diagnosticReport !== null && serviceRequest > 0 && diagnosticReport / serviceRequest < 0.5) {
    const labSharePct = round((diagnosticReport / serviceRequest) * 100, 1);
    facts.push({
      id: "ambang:satusehat_kemenkes.lab_gap",
      kind: "ambang",
      metric: null,
      section: "safetyQuality",
      severity: "perhatian",
      values: [diagnosticReport, serviceRequest, labSharePct, 50],
      text: `Hasil akhir pemeriksaan lab di Satu Sehat Kemenkes baru ${format(diagnosticReport)} dari ${format(serviceRequest)} permintaan (${share.format(labSharePct)}%); di bawah ambang ${50}%.`,
    });
  }

  const imaging = resourceCount("ImagingStudy");
  const immunization = resourceCount("Immunization");
  if ((imaging !== null && imaging === 0) || (immunization !== null && immunization < 10)) {
    const immVal = immunization ?? 0;
    const imgVal = imaging ?? 0;
    facts.push({
      id: "ambang:satusehat_kemenkes.rsia_gap",
      kind: "ambang",
      metric: null,
      section: "safetyQuality",
      severity: "perhatian",
      values: [immVal, imgVal, 10],
      text: `Laporan layanan utama ibu dan anak di Satu Sehat Kemenkes masih minim dalam sebulan terakhir: imunisasi tercatat ${format(immVal)} dan pencitraan radiologi atau USG ${format(imgVal)} (target minimal ${10}).`,
    });
  }

  if (portal.unavailableResources.length > 0) {
    facts.push({
      id: "data:satusehat_kemenkes.unavailable",
      kind: "data",
      metric: null,
      section: "dataLimitations",
      severity: "perhatian",
      values: [portal.unavailableResources.length],
      text: `Sebanyak ${format(portal.unavailableResources.length)} jenis data Satu Sehat Kemenkes gagal ditarik pada pengambilan ini sehingga tidak ikut dinilai: ${portal.unavailableResources.join(", ")}.`,
    });
  }

  return facts;
}

export function detectFacts(snapshot: MedifySnapshot, satusehatPortal: SatusehatSnapshot | null = null): Fact[] {
  const visits = (entries: { date: string; visits: number }[] | undefined): Day[] => (entries ?? []).map((entry) => ({ date: entry.date, value: entry.visits }));
  return [
    ...bedFacts(snapshot),
    countChange("outpatient_visits", visits(snapshot.outpatient?.daily), snapshot.date),
    countChange("igd_visits", visits(snapshot.igd?.daily), snapshot.date),
    countChange("admissions", (snapshot.inpatient?.daily ?? []).map((entry) => ({ date: entry.date, value: entry.admissions })), snapshot.date),
    ...monthlyFigures(snapshot),
    satusehatFact(snapshot),
    ...contributors(snapshot),
    ...staffFacts(snapshot),
    ...pharmacyFacts(snapshot),
    ...dataLimitations(snapshot),
    ...satusehatPortalFacts(satusehatPortal),
  ].filter((fact): fact is Fact => fact !== null);
}
