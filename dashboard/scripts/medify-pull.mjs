#!/usr/bin/env node
/**
 * Pull aggregate counts from Medify and publish them as a `medify_snapshot`.
 *
 *   node scripts/medify-pull.mjs                 pull and publish to the dashboard
 *   node scripts/medify-pull.mjs --dry-run       pull and print the payload
 *   node scripts/medify-pull.mjs --out <file>    pull and write the payload (file mode: data/medify/<date>.json)
 *   ... --dump-raw <dir>                         debug: keep the first 64 KB of every JSON response of a FAILED section
 *                                                in <dir> (one file per path, never printed); env MEDIFY_DUMP_RAW_DIR
 *
 * Environment (scheduler host only, never the app server; see deploy/biznet-medify/README.md):
 *   MEDIFY_BASE_URL                  default https://simrs.melinda.co.id
 *   MEDIFY_EMAIL, MEDIFY_PASSWORD    the reporting-only account, never an admin account
 *   MELINDAOS_DASHBOARD_URL, MELINDAOS_PUBLISHER_TOKEN for publishing
 *   MEDIFY_CONCURRENCY               sections pulled at the same time, 1-4 (default 3)
 *   MEDIFY_DUMP_RAW_DIR              same as --dump-raw
 *
 * Only the paths in MEDIFY_PATHS are ever requested, and only counts and totals leave this script.
 * One login attempt per run; a failed login stops the run so the account is never locked by retries.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublisherClient, prepareMedifyRunStatus, prepareMedifySnapshot, publisherFromEnv, submitMedifyRunStatus, submitMedifySnapshot } from "./daily-publisher-client.mjs";

export const MEDIFY_PATHS = {
  login: "/login",
  bed: "/api/rawatinap/medify-online/get-ketersediaan-bed",
  outpatient: "/api/rawatjalan/statistik?poliklinik_id=&date_range=harian&date_start=&date_end=",
  igdVisits: "/api/igd/statistik/kunjungan-pasien",
  igdDiagnoses: "/api/igd/statistik/sepuluh-besar-penyakit",
  inpatient: "/dashboards/api/rawat-inap",
  igdDashboard: "/dashboards/api/igd",
  labPk: "/dashboards/api/labpk",
  labPa: "/dashboards/api/labpa",
  radiology: "/dashboards/api/radiologi",
  pharmacyStock: "/dashboards/api/persediaan-farmasi",
  pharmacyCategory: "/dashboards/api/obat-by-kategori",
  staffType: "/kepegawaian/statistik/jenis-pegawai",
  staffStatus: "/kepegawaian/statistik/status-pegawai",
  staffActive: "/kepegawaian/statistik/pegawai-aktif",
  staffLeft: "/kepegawaian/statistik/pegawai-keluar",
  financePage: "/keuangan-v2",
  finance: "/keuangan-v2/dashboard/data",
  satusehat: "/satusehat-v2/dashboard/get-data",
  patients: "/api/pasien/statistik",
  patientVisits: "/api/pasien/statistik/kunjungan",
  patientsNew: "/api/pasien/statistik/pasienbaru",
  patientPayers: "/api/pasien/statistik/jenispasien",
};
const ALLOWED = new Set(Object.values(MEDIFY_PATHS).map((path) => path.split("?")[0]));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INPATIENT_RATES = ["bor", "toi", "bto", "ndr", "gdr"];
const MEDIFY_RUN_SECTIONS = ["bed", "outpatient", "igd", "inpatient", "inpatientMix", "igdMix", "diagnostics", "pharmacy", "staff", "finance", "satusehat", "patients"];
const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const DUMP_BYTES = 65_536;
/** obat-by-kategori is read only until its aggregate table closes (the per-patient resep_table after it is several MB); this bounds that prefix. */
const CATEGORY_PREFIX_BYTES = 262_144;
const USAGE = "Usage: node scripts/medify-pull.mjs [--dry-run | --out <file>] [--dump-raw <dir>]";
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 4;

/** Sections pulled at the same time; each section issues one request at a time, so this caps the load on Medify. */
export function clampConcurrency(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(MAX_CONCURRENCY, Math.max(1, number)) : DEFAULT_CONCURRENCY;
}

/** Run `tasks` with at most `limit` in flight; same result shape as Promise.allSettled, in task order. */
async function settleWithLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await tasks[index]() }; } catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export function wibDate(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
}

function count(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) throw new Error("angka tidak valid");
  return Math.round(number);
}
function rate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100_000) throw new Error("indikator tidak valid");
  return Math.round(number * 100) / 100;
}
function percentage(value) {
  const parsed = rate(value);
  if (parsed > 100) throw new Error("format persentase di luar batas");
  return parsed;
}
function rupiah(value) {
  const number = Number(value);
  return value !== null && value !== "" && Number.isFinite(number) && number >= 0 && number <= 1e15 ? Math.round(number) : null;
}
function label(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return text || fallback;
}
function entries(value) {
  return value && typeof value === "object" ? Object.entries(value) : [];
}

export function bedSection(raw, observedAt) {
  if (!Array.isArray(raw)) throw new Error("format bed berubah");
  const wards = raw.flatMap((ward) => (Array.isArray(ward?.data) ? ward.data : []).map((room) => ({
    ward: label(ward.nama, "Tanpa nama"),
    kelas: label(room?.kelas, "Tanpa kelas"),
    occupied: count(room?.bed_terisi),
    capacity: count(room?.bed_kapasitas),
  })));
  if (wards.length === 0 || wards.length > 60) throw new Error("format bed berubah");
  if (wards.some((ward) => ward.occupied > ward.capacity)) throw new Error("format bed: terisi melebihi kapasitas");
  return { observedAt, wards };
}

export function outpatientSection(raw, observedAt, date) {
  if (!raw || typeof raw !== "object" || "error" in raw) throw new Error("statistik rawat jalan ditolak");
  const daily = entries(raw.kunjungan_date)
    .filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= date)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-62)
    .map(([day, visits]) => ({ date: day, visits: count(visits) }));
  if (daily.length === 0) throw new Error("statistik rawat jalan kosong");
  const named = (value) => entries(value).slice(0, 60).map(([key, item]) => (item && typeof item === "object"
    ? { name: label(item.name, key), visits: count(item.value) }
    : { name: label(key, "Lainnya"), visits: count(item) }));
  // Medify labels key "1" as Pasien Baru and every other key as Pasien Lama.
  const patients = raw.pasien_poli && typeof raw.pasien_poli === "object" ? raw.pasien_poli : {};
  return {
    observedAt,
    periodStart: daily[0].date,
    periodEnd: daily.at(-1).date,
    visitsToday: daily.find((day) => day.date === date)?.visits ?? null,
    daily,
    byClinic: named(raw.kunjungan_poli_all),
    newPatients: "1" in patients ? count(patients["1"]) : null,
    returningPatients: "0" in patients ? count(patients["0"]) : null,
    byPayer: named(raw.pembayaran_poli),
  };
}

/** Medify labels IGD days as "13 Oct" for the last days of the requested month. */
export function igdSection(rawVisits, rawDiagnoses, observedAt, date) {
  if (!Array.isArray(rawVisits?.data) || !Array.isArray(rawDiagnoses?.data)) throw new Error("format IGD berubah");
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  const daily = rawVisits.data.flatMap((item) => {
    const [day, name] = String(item?.kategori ?? "").split(" ");
    const index = MONTHS.indexOf(name);
    if (index < 0 || !/^\d{1,2}$/.test(day ?? "")) return [];
    const iso = `${index + 1 > month ? year - 1 : year}-${String(index + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
    return iso <= date ? [{ date: iso, visits: count(item.value) }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(-31);
  return {
    observedAt,
    visitsToday: daily.find((day) => day.date === date)?.visits ?? null,
    daily,
    topDiagnoses: rawDiagnoses.data.slice(0, 10).map((item) => ({ name: label(item?.kategori, "Tanpa diagnosis"), visits: count(item?.value) })),
  };
}

export function dashboardQuery(path, durasi, satuan, chart) {
  const filters = { durasi_waktu: durasi, start_date: "", end_date: "", satuan_waktu: satuan, bangsal: "all", tipe_debitur: "all", nama_asuransi: "all", jenis_kelamin: "all", status_pasien: "all", id_chart: chart };
  return `${path}?${new URLSearchParams(filters)}`;
}
export function inpatientQuery(durasi, satuan, chart) {
  return dashboardQuery(MEDIFY_PATHS.inpatient, durasi, satuan, chart);
}

/** Medify's rawat inap charts: admissions and channels in `chartData.dataset[].value_N`, indicators in `chartData[].value`. */
function chartSeries(raw, field) {
  const rows = /^value_\d$/.test(field) ? raw?.chartData?.dataset : raw?.chartData;
  if (!Array.isArray(rows)) throw new Error("format rawat inap berubah");
  return new Map(rows.map((row) => [String(row?.date ?? ""), row?.[field]]));
}
function pick(series, day) {
  if (!series.has(day)) throw new Error("format rawat inap berubah");
  return series.get(day);
}
function datedRows(series, keep, limit) {
  return [...series].filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && keep(day)).sort(([a], [b]) => a.localeCompare(b)).slice(-limit);
}

/** Daily admissions and BOR for complete days only (today is still open), and the monthly indicators. */
export function inpatientSection(raw, observedAt, date) {
  const dailyBor = chartSeries(raw.dailyBor, "value");
  // Medify's series: value_1 Online, value_2 Onsite, value_3 Anjungan (value_4 Non Anjungan is derivable).
  const channels = Object.entries({ online: "value_1", onsite: "value_2", anjungan: "value_3" }).map(([name, field]) => [name, chartSeries(raw.dailyAdmissions, field)]);
  const daily = datedRows(chartSeries(raw.dailyAdmissions, "value_0"), (day) => day < date, 31)
    .map(([day, admissions]) => ({
      date: day, admissions: count(admissions), bor: rate(pick(dailyBor, day)),
      ...Object.fromEntries(channels.filter(([, series]) => series.get(day) !== undefined).map(([name, series]) => [name, count(series.get(day))])),
    }));
  const rates = Object.fromEntries(INPATIENT_RATES.map((name) => [name, chartSeries(raw.monthly[name], "value")]));
  const monthly = datedRows(chartSeries(raw.monthly.admissions, "value_0"), (day) => day <= date, 13)
    .map(([day, admissions]) => ({ month: day.slice(0, 7), admissions: count(admissions), ...Object.fromEntries(INPATIENT_RATES.map((name) => [name, rate(pick(rates[name], day))])) }));
  if (daily.length === 0 || monthly.length === 0) throw new Error("statistik rawat inap kosong");
  return { observedAt, daily, monthly };
}

/** Rolling period of Medify's `durasi_waktu=1m`: the same day one month earlier through `date`. */
export function monthBefore(date) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCMonth(day.getUTCMonth() - 1);
  return day.toISOString().slice(0, 10);
}

/** Medify dashboard bars: `chartData[]` of `{ title, value }`. A non-array `chartData`, or a bare `[]` (labpa/radiologi with no transactions), means no rows for the period. */
function bars(raw, where) {
  if (Array.isArray(raw) && raw.length === 0) return [];
  if (!raw || typeof raw !== "object" || !("chartData" in raw)) throw new Error(where ? `format grafik berubah: ${where}` : "format grafik berubah");
  return Array.isArray(raw.chartData) ? raw.chartData : [];
}
/** Titles often carry Medify's own "146 : " or "1.31 Rb : " count prefix. */
export function stripCount(title) {
  return String(title ?? "").replace(/^\s*[\d.,]+\s*(?:Rb|Jt|M)?\s*:\s*/, "");
}
function namedCounts(raw, where) {
  return bars(raw, where).slice(0, 10).map((row) => ({ name: label(stripCount(row?.title), "Tanpa nama"), count: count(row?.value) }));
}
function shares(raw) {
  return bars(raw).slice(0, 10).map((row) => ({ name: label(stripCount(row?.title), "Tanpa nama"), percent: percentage(row?.value) }));
}

/** Rawat inap over the rolling month: top diagnoses, wards, DPJP, payer counts; status and gender arrive as percentages. */
export function inpatientMixSection(raw, observedAt, date) {
  return {
    observedAt, periodStart: monthBefore(date), periodEnd: date,
    topDiagnoses: namedCounts(raw.diagnoses), byWard: namedCounts(raw.wards), byDpjp: namedCounts(raw.dpjp),
    byPayer: namedCounts(raw.payer), byStatus: shares(raw.status), byGender: shares(raw.gender),
  };
}

export function igdMixSection(raw, observedAt, date) {
  return { observedAt, periodStart: monthBefore(date), periodEnd: date, byDischarge: namedCounts(raw.discharge), byPayer: namedCounts(raw.payer) };
}

/** Lab PK, Lab PA, radiologi: top tests and Medify's response-time groups, labels kept verbatim. */
export function diagnosticsSection(raw, observedAt, date) {
  const unit = (item, path) => ({ topTests: namedCounts(item.tests, `${path} transaksi_per_tarif`), responseTime: namedCounts(item.responseTime, `${path} transaksi_response_time`) });
  return { observedAt, periodStart: monthBefore(date), periodEnd: date, labPk: unit(raw.labPk, MEDIFY_PATHS.labPk), labPa: unit(raw.labPa, MEDIFY_PATHS.labPa), radiology: unit(raw.radiology, MEDIFY_PATHS.radiology) };
}

export function pharmacySection(raw, observedAt, date) {
  const chart = (id) => `${MEDIFY_PATHS.pharmacyStock} ${id}`;
  const money = (rows, where) => bars(rows, where).slice(0, 10).map((row) => ({ name: label(stripCount(row?.title), "Tanpa nama"), rupiah: rupiah(row?.value) }));
  const categories = raw.category?.data?.kategori_table;
  if (!Array.isArray(categories)) throw new Error(`format kategori obat berubah: ${MEDIFY_PATHS.pharmacyCategory}`);
  return {
    observedAt, periodStart: monthBefore(date), periodEnd: date,
    stockByUnit: money(raw.stock, chart("kekayaan_per_unit")), topByValue: money(raw.byValue, chart("nilai_transaksi_per_obat")), topByQuantity: namedCounts(raw.byQuantity, chart("jumlah_transaksi_per_obat")),
    byCategory: categories.slice(0, 20).map((row) => ({ name: label(row?.nama, "Tanpa kategori"), count: count(row?.jumlah) })),
  };
}

/** Kepegawaian statistik pages: `{ category, jumlah }` totals and monthly `{ tanggal, active | out }`. */
export function staffSection(raw, observedAt, date) {
  const totals = (rows) => {
    if (!Array.isArray(rows)) throw new Error("format kepegawaian berubah");
    return rows.slice(0, 20).map((row) => ({ name: label(row?.category, "Lainnya"), count: count(row?.jumlah) }));
  };
  const monthly = (rows, field) => {
    if (!Array.isArray(rows)) throw new Error("format kepegawaian berubah");
    if (rows.some((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.tanggal ?? "")) && String(row.tanggal) > date)) throw new Error("format kepegawaian: bulan setelah tanggal laporan");
    return rows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.tanggal ?? ""))).slice(0, 13)
      .map((row) => ({ month: String(row.tanggal).slice(0, 7), count: count(row[field]) }))
      .sort((a, b) => a.month.localeCompare(b.month));
  };
  return { observedAt, byType: totals(raw.type), byStatus: totals(raw.status), activeMonthly: monthly(raw.active, "active"), leftMonthly: monthly(raw.left, "out") };
}

export function financeSection(raw, observedAt) {
  const data = raw?.data;
  if (!data || typeof data !== "object") throw new Error("format keuangan berubah");
  return {
    observedAt,
    cashToday: rupiah(data.kas_hari_ini),
    revenueToday: rupiah(data.pendapatan_total_all),
    receivablesTotal: rupiah(data.piutang_total_all),
    payablesTotal: rupiah(data.utang_total_all),
  };
}

/** Medify's SATUSEHAT summary filters by discharge date; the dashboard asks for the calendar month to date. */
export function satusehatQuery(date) {
  const dmy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
  return `${MEDIFY_PATHS.satusehat}?${new URLSearchParams({ tipe: "dashboard-summary", date_start: dmy(`${date.slice(0, 7)}-01`), date_end: dmy(date), kirim_start: "", kirim_end: "" })}`;
}

/** Per FHIR resource: expected, sent, failed, not yet sent. Medify's `unprocessed` can be negative and is dropped. */
export function satusehatSection(raw, observedAt, date) {
  const data = raw?.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.resources)) throw new Error("format SATUSEHAT berubah");
  const resources = data.resources.slice(0, 40)
    .map((row) => ({ order: Number(row?.fhir_order) || 0, name: label(row?.name, "Tanpa nama"), expected: count(row?.expected), sent: count(row?.sent), failed: count(row?.failed), notSent: count(row?.not_sent) }))
    .sort((a, b) => a.order - b.order)
    .map((row) => ({ name: row.name, expected: row.expected, sent: row.sent, failed: row.failed, notSent: row.notSent }));
  return {
    observedAt, periodStart: `${date.slice(0, 7)}-01`, periodEnd: date,
    globalPercent: percentage(data.global_percent), expected: count(data.expected), sent: count(data.sent), failed: count(data.failed), notSent: count(data.not_sent),
    lastUpdate: label(data.last_update, "tidak tercatat"),
    resources,
  };
}

/** Patient statistics: the cumulative base and payer mix, monthly visits per service line, monthly new patients (months after `date` are placeholders). */
export function patientsSection(raw, observedAt, date) {
  const { summary, visits, newMonthly, payer } = raw;
  if (!summary || typeof summary !== "object" || !Array.isArray(visits) || !Array.isArray(newMonthly) || !Array.isArray(payer)) throw new Error("format statistik pasien berubah");
  const month = date.slice(0, 7);
  const monthlyVisits = visits.filter((row) => /^\d{4}-\d{2}$/.test(String(row?.month ?? "")) && row.month <= month).slice(-13)
    .map((row) => ({ month: row.month, outpatient: count(row.jalan), inpatient: count(row.inap), igd: count(row.igd) }));
  const monthKey = (row) => (/^\d{2}-\d{4}$/.test(String(row?.date ?? "")) ? `${row.date.slice(3)}-${row.date.slice(0, 2)}` : "");
  const newRows = newMonthly.filter((row) => monthKey(row) && monthKey(row) <= month).slice(-13).map((row) => ({ month: monthKey(row), count: count(row.value) }));
  return {
    observedAt,
    total: count(summary.totalPasien), newToday: count(summary.pasienBaru), transactionsToday: count(summary.transaksi),
    byPayer: payer.slice(0, 10).map((row) => ({ name: label(row?.jenis, "Lainnya"), count: count(row?.jumlah) })),
    monthlyVisits, newMonthly: newRows,
  };
}

export function buildScheduledRun(slot, startedAt, completedAt, unavailableSections, runId = randomUUID()) {
  return { slot, runId, status: unavailableSections.length ? "degraded" : "complete", startedAt, completedAt, unavailableSections };
}

function safeRunIssue(failure) {
  const section = String(failure).split(" ")[0];
  const reason = failure.includes("format ") ? "format_changed" : failure.includes("terlalu besar") ? "response_too_large" : failure.includes("HTTP 403") ? "access_denied" : "request_failed";
  return MEDIFY_RUN_SECTIONS.includes(section) ? { section, reason } : { section: null, reason: "validation_failed" };
}

export function buildSnapshot(sections, failures, date, observedAt, baseUrl, run = null) {
  return {
    schemaVersion: 1,
    date,
    bed: sections.bed ?? null,
    outpatient: sections.outpatient ?? null,
    igd: sections.igd ?? null,
    inpatient: sections.inpatient ?? null,
    finance: sections.finance ?? null,
    inpatientMix: sections.inpatientMix ?? null,
    igdMix: sections.igdMix ?? null,
    diagnostics: sections.diagnostics ?? null,
    pharmacy: sections.pharmacy ?? null,
    staff: sections.staff ?? null,
    satusehat: sections.satusehat ?? null,
    patients: sections.patients ?? null,
    ...(run ? { run } : {}),
    provenance: {
      producer: "medify-pull",
      sourceObservedAt: observedAt,
      periodStart: date,
      periodEnd: date,
      cutoff: null,
      sources: [{ name: "Medify SIMRS", url: `${new URL(baseUrl).origin}/`, note: "Akun laporan Direktur; hanya angka agregat, tanpa data pasien." }],
      notes: failures.length ? `Gagal ditarik: ${failures.join("; ")}.` : "",
    },
  };
}

/** Reads at most MAX_RESPONSE_BYTES; `capture` (debug dump) gets the first DUMP_BYTES even when the read is cut short. */
async function boundedText(response, capture) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      chunks.push(value);
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        capture?.(Buffer.concat(chunks, Math.min(bytes, DUMP_BYTES)));
        throw Object.assign(new Error("respons terlalu besar"), { bytesRead: bytes });
      }
    }
  } finally { reader.releaseLock(); }
  capture?.(Buffer.concat(chunks, Math.min(bytes, DUMP_BYTES)));
  return Buffer.concat(chunks).toString("utf8");
}

/** Byte range of the JSON array under `"key":` in `buffer` (UTF-8 continuation bytes never look like `"`, `[`, `]` or `\\`), or null while the array is still incomplete. */
function arrayRange(buffer, key) {
  const marker = Buffer.from(`"${key}":`);
  const found = buffer.indexOf(marker);
  if (found === -1) return null;
  let index = found + marker.length;
  while (index < buffer.length && [0x20, 0x09, 0x0a, 0x0d].includes(buffer[index])) index += 1;
  if (index >= buffer.length) return null;
  if (buffer[index] !== 0x5b) throw new Error(`format ${key} berubah`);
  const start = index;
  let depth = 0;
  let inString = false;
  for (; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (inString) {
      if (byte === 0x5c) index += 1;
      else if (byte === 0x22) inString = false;
    } else if (byte === 0x22) inString = true;
    else if (byte === 0x5b) depth += 1;
    else if (byte === 0x5d && (depth -= 1) === 0) return { start, end: index + 1 };
  }
  return null;
}

/** Reads the body only until the `key` array closes, then cancels the rest: what follows (per-patient rows) is never read in full, parsed, or kept, and nothing here is captured for the dump. */
async function boundedArray(response, key) {
  if (!response.body) throw new Error(`format ${key} berubah`);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      chunks.push(value);
      const buffer = Buffer.concat(chunks);
      const range = arrayRange(buffer, key);
      if (range) {
        await reader.cancel();
        return JSON.parse(buffer.subarray(range.start, range.end).toString("utf8"));
      }
      if (bytes > CATEGORY_PREFIX_BYTES) throw Object.assign(new Error("respons terlalu besar"), { bytesRead: bytes });
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally { reader.releaseLock(); }
  throw new Error(`format ${key} berubah`);
}

/** Path plus the chart and period that identify one Medify call, for error notes and dump file names. */
export function describePath(query) {
  const url = new URL(query, "https://medify.invalid");
  return [url.pathname, url.searchParams.get("id_chart"), url.searchParams.get("durasi_waktu")].filter(Boolean).join(" ");
}

/** One section's view of the session: fetch errors name the path, and with `dump` every `json` body is kept (first 64 KB) for the dump of a failed section; `jsonArray` bodies never are. */
function sectionClient(session, name, dump) {
  const raw = [];
  const keep = (query) => (dump ? (head) => raw.push({ file: `${name}--${describePath(query).replace(/^\//, "").replace(/[^A-Za-z0-9_-]+/g, "_")}.txt`, head }) : undefined);
  const labelled = async (query, read) => {
    try {
      return await read();
    } catch (error) {
      const message = error instanceof Error ? error.message : "gagal";
      throw new Error(`${message}: ${describePath(query)}${error?.bytesRead ? `, ${error.bytesRead} byte terbaca` : ""}`);
    }
  };
  return {
    raw,
    text: (query, init) => session.text(query, init),
    json: (query, init) => labelled(query, () => session.json(query, init, keep(query))),
    jsonArray: (query, key, init) => labelled(query, () => session.jsonArray(query, key, init)),
  };
}

export class MedifySession {
  constructor(baseUrl, fetchImpl = globalThis.fetch) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("MEDIFY_BASE_URL harus https tanpa kredensial");
    this.origin = url.origin;
    this.fetch = fetchImpl;
    this.cookies = new Map();
  }

  async request(path, init = {}) {
    const target = new URL(path, this.origin);
    if (target.origin !== this.origin || !ALLOWED.has(target.pathname)) throw new Error("Path Medify tidak diizinkan");
    const headers = { ...init.headers };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await this.fetch(`${this.origin}${path}`, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const pair = line.split(";")[0];
      const split = pair.indexOf("=");
      if (split > 0) this.cookies.set(pair.slice(0, split).trim(), pair.slice(split + 1).trim());
    }
    return response;
  }

  async text(path, init, capture) {
    const response = await this.request(path, init);
    if (response.status !== 200) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    return boundedText(response, capture);
  }

  async json(path, init = {}, capture) {
    const text = await this.text(path, { ...init, headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", ...init.headers } }, capture);
    try { return JSON.parse(text); } catch { throw new Error("bukan JSON, sesi Medify mungkin berakhir"); }
  }

  /** Only the JSON array under `key`: the body is read until that array closes, then cancelled (see boundedArray). */
  async jsonArray(path, key, init = {}) {
    const response = await this.request(path, { ...init, headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", ...init.headers } });
    if (response.status !== 200) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    return boundedArray(response, key);
  }

  async login(email, password) {
    const page = await this.text(MEDIFY_PATHS.login);
    const input = page.match(/<input[^>]*name=["']_token["'][^>]*>/)?.[0] ?? "";
    const token = input.match(/value=["']([^"']+)["']/)?.[1];
    if (!token) throw new Error("Halaman login Medify berubah; penarikan dihentikan");
    const response = await this.request(MEDIFY_PATHS.login, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _token: token, email, password }).toString(),
    });
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (response.status !== 302 || !location || new URL(location, this.origin).pathname === MEDIFY_PATHS.login) {
      throw new Error("Login Medify gagal; periksa akun laporan. Tidak dicoba ulang");
    }
  }
}

/**
 * One login, then the sections through a small queue: at most `concurrency` sections at a time, and the
 * requests inside a section stay sequential, so Medify never sees more than `concurrency` requests at once.
 * A failed section becomes null and is named in provenance.notes with the Medify path that failed; with `dumpDir`
 * the raw JSON responses of failed sections (first 64 KB each) are written there for diagnosis, nothing else.
 */
export async function pullMedify({ baseUrl, email, password, fetch: fetchImpl, now = () => new Date(), concurrency, dumpDir, slot = null, runId = randomUUID(), startedAt = null }) {
  const limit = clampConcurrency(concurrency);
  const session = new MedifySession(baseUrl, fetchImpl);
  await session.login(email, password);
  const date = wibDate(now());
  const stamp = () => now().toISOString();
  const steps = {
    bed: async ({ json }) => bedSection(await json(MEDIFY_PATHS.bed), stamp()),
    outpatient: async ({ json }) => outpatientSection(await json(MEDIFY_PATHS.outpatient), stamp(), date),
    igd: async ({ json }) => {
      const month = `?date=${date.slice(5, 7)}-${date.slice(0, 4)}`;
      const visits = await json(`${MEDIFY_PATHS.igdVisits}${month}`);
      return igdSection(visits, await json(`${MEDIFY_PATHS.igdDiagnoses}${month}`), stamp(), date);
    },
    inpatient: async ({ json }) => {
      const chart = (durasi, satuan, id) => json(inpatientQuery(durasi, satuan, id));
      const raw = { dailyAdmissions: await chart("1m", "day", "kunjungan_all_line_chart"), dailyBor: await chart("1m", "day", "grafik_indikator_bor"), monthly: { admissions: await chart("1y", "month", "kunjungan_all_line_chart") } };
      for (const name of INPATIENT_RATES) raw.monthly[name] = await chart("1y", "month", `grafik_indikator_${name}`);
      return inpatientSection(raw, stamp(), date);
    },
    inpatientMix: async ({ json }) => {
      const chart = (id) => json(inpatientQuery("1m", "day", id));
      return inpatientMixSection({
        diagnoses: await chart("sepuluh_besar_penyakit"), wards: await chart("sepuluh_besar_bangsal"), dpjp: await chart("sepuluh_besar_dpjp"),
        payer: await chart("pasien_demografi_debitur"), status: await chart("pasien_demografi_status"), gender: await chart("pasien_demografi_gender"),
      }, stamp(), date);
    },
    igdMix: async ({ json }) => {
      const chart = (id) => json(dashboardQuery(MEDIFY_PATHS.igdDashboard, "1m", "day", id));
      return igdMixSection({ discharge: await chart("kunjungan_status_krs"), payer: await chart("pasien_demografi_debitur") }, stamp(), date);
    },
    diagnostics: async ({ json }) => {
      const unit = async (path) => ({ tests: await json(dashboardQuery(path, "1m", "day", "transaksi_per_tarif")), responseTime: await json(dashboardQuery(path, "1m", "day", "transaksi_response_time")) });
      return diagnosticsSection({ labPk: await unit(MEDIFY_PATHS.labPk), labPa: await unit(MEDIFY_PATHS.labPa), radiology: await unit(MEDIFY_PATHS.radiology) }, stamp(), date);
    },
    pharmacy: async ({ json, jsonArray }) => {
      const chart = (id) => json(dashboardQuery(MEDIFY_PATHS.pharmacyStock, "1m", "day", id));
      return pharmacySection({
        stock: await chart("kekayaan_per_unit"), byValue: await chart("nilai_transaksi_per_obat"), byQuantity: await chart("jumlah_transaksi_per_obat"),
        category: { data: { kategori_table: await jsonArray(`${MEDIFY_PATHS.pharmacyCategory}?durasi_waktu=1m`, "kategori_table") } },
      }, stamp(), date);
    },
    staff: async ({ json }) => staffSection({
      type: await json(MEDIFY_PATHS.staffType), status: await json(MEDIFY_PATHS.staffStatus),
      active: await json(MEDIFY_PATHS.staffActive), left: await json(MEDIFY_PATHS.staffLeft),
    }, stamp(), date),
    finance: async ({ json, text }) => {
      const page = await text(MEDIFY_PATHS.financePage);
      const csrf = page.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/)?.[1];
      if (!csrf) throw new Error("token halaman keuangan tidak ditemukan");
      const raw = await json(MEDIFY_PATHS.finance, {
        method: "POST",
        headers: { "X-CSRF-TOKEN": csrf, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: new URLSearchParams({ durasi: "1d", start_date: "", end_date: "" }).toString(),
      });
      return financeSection(raw, stamp());
    },
    satusehat: async ({ json }) => satusehatSection(await json(satusehatQuery(date)), stamp(), date),
    patients: async ({ json }) => patientsSection({
      summary: await json(MEDIFY_PATHS.patients), visits: await json(MEDIFY_PATHS.patientVisits),
      newMonthly: await json(MEDIFY_PATHS.patientsNew), payer: await json(MEDIFY_PATHS.patientPayers),
    }, stamp(), date),
  };
  const sections = {};
  const failures = [];
  const names = Object.keys(steps);
  const clients = names.map((name) => sectionClient(session, name, Boolean(dumpDir)));
  const results = await settleWithLimit(names.map((name, index) => () => steps[name](clients[index])), limit);
  names.forEach((name, index) => {
    const result = results[index];
    if (result.status === "fulfilled") sections[name] = result.value;
    else failures.push(`${name} (${result.reason instanceof Error ? result.reason.message : "gagal"})`);
  });
  if (dumpDir && failures.length) {
    await mkdir(dumpDir, { recursive: true });
    for (const [index, client] of clients.entries()) {
      if (results[index].status === "rejected") for (const { file, head } of client.raw) await writeFile(resolve(dumpDir, file), head);
    }
  }
  const completedAt = stamp();
  const run = slot ? buildScheduledRun(slot, startedAt ?? completedAt, completedAt, failures.map(safeRunIssue).filter((issue) => issue.section !== null), runId) : null;
  return buildSnapshot(sections, failures, date, completedAt, baseUrl, run);
}

export function parseArgs(argv, env = {}) {
  const options = { dryRun: false, out: null, dumpDir: env.MEDIFY_DUMP_RAW_DIR || null, slot: null };
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--out" && args.length) options.out = args.shift();
    else if (arg === "--dump-raw" && args.length) options.dumpDir = args.shift();
    else if (arg === "--slot" && args.length && ["morning", "evening"].includes(args[0])) options.slot = args.shift();
    else throw new Error(USAGE);
  }
  if (options.dryRun && options.out) throw new Error(USAGE);
  return options;
}

async function main() {
  const { dryRun, out, dumpDir, slot } = parseArgs(process.argv.slice(2), process.env);
  const { MEDIFY_EMAIL: email, MEDIFY_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error("Isi MEDIFY_EMAIL dan MEDIFY_PASSWORD dengan akun laporan");
  const publisher = publisherFromEnv(process.env);
  if (!dryRun && !out) assertPublisherClient(publisher);
  const startedAt = new Date().toISOString(), runId = randomUUID();
  const publishStatus = async (status, unavailableSections, snapshotReceipt = null) => {
    if (!slot || dryRun || out) return;
    const body = { schemaVersion: 1, date: wibDate(new Date()), slot, runId, status, startedAt, completedAt: new Date().toISOString(), unavailableSections, snapshotRevisionId: snapshotReceipt?.revisionId ?? null, snapshotReceivedAt: snapshotReceipt?.receivedAt ?? null };
    await submitMedifyRunStatus(prepareMedifyRunStatus(JSON.stringify(body), `medify-run-${runId}`), publisher);
  };
  let snapshot;
  try {
    snapshot = await pullMedify({ baseUrl: process.env.MEDIFY_BASE_URL || "https://simrs.melinda.co.id", email, password, concurrency: process.env.MEDIFY_CONCURRENCY, dumpDir, slot, runId, startedAt });
  } catch (error) {
    await publishStatus("failed", [{ section: null, reason: String(error).includes("Login Medify") ? "login_failed" : "validation_failed" }]);
    throw error;
  }
  if (!MEDIFY_RUN_SECTIONS.some((section) => snapshot[section])) {
    await publishStatus("failed", [{ section: null, reason: "validation_failed" }]);
    process.exitCode = 1;
    return;
  }
  const pretty = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (dryRun) process.stdout.write(pretty);
  else if (out) await writeFile(out, pretty, "utf8");
  else {
    let receipt;
    try {
      receipt = await submitMedifySnapshot(prepareMedifySnapshot(JSON.stringify(snapshot), slot ? `medify-snapshot-${runId}` : undefined), publisher);
    } catch (error) {
      await publishStatus("failed", [{ section: null, reason: "request_failed" }]);
      throw error;
    }
    await publishStatus(snapshot.run?.status ?? "complete", snapshot.run?.unavailableSections ?? [], receipt);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
  if (snapshot.provenance.notes) process.stderr.write(`${snapshot.provenance.notes}\n`);
  if (snapshot.provenance.notes && dumpDir) process.stderr.write(`Respons mentah bagian yang gagal disimpan di ${resolve(dumpDir)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Penarikan Medify gagal"}\n`); process.exitCode = 1; });
}
