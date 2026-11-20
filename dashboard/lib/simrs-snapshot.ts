import { readDailyDocument } from "./daily/daily-documents";
import type { MelindaManagementMorningBrief, MelindaSimrsMetric, MelindaSimrsPulse } from "./melinda/melinda-brief-data";
import { simrsMetric, MelindaBriefValidationError } from "./melinda/melinda-brief-contract";
import { logError } from "./log";
import { validReportDate } from "./director/director-data";

/**
 * Aggregate census snapshot exported from Medify (counts only, never patient rows).
 * Produced by `runtime/src/melinda_maaf/simrs_aggregate.py`. Stored snapshots are read from
 * Supabase (protected mode; nothing publishes new ones) or from `data/simrs/YYYY-MM-DD.json` (file mode).
 */
export type SimrsSnapshot = {
  tanggal: string;
  headerRight: string;
  syncStatus: string;
  catatan: string;
  metrics: MelindaSimrsMetric[];
};

const KEYS = ["tanggal", "diamatiPada", "sumber", "berkas", "headerRight", "syncStatus", "catatan", "metrics"];

function short(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

export function parseSimrsSnapshot(value: unknown, date: string): SimrsSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !validReportDate(date)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !KEYS.includes(key))) return null;
  if (record.tanggal !== date) return null;
  if (!short(record.headerRight, 80) || !short(record.syncStatus, 120) || !short(record.catatan, 2000)) return null;
  if (record.diamatiPada !== undefined && !(short(record.diamatiPada, 40) && Number.isFinite(Date.parse(record.diamatiPada)))) return null;
  if (record.sumber !== undefined && !short(record.sumber, 120)) return null;
  if (record.berkas !== undefined && !short(record.berkas, 200)) return null;
  if (!Array.isArray(record.metrics) || record.metrics.length === 0 || record.metrics.length > 12) return null;
  try {
    const metrics = record.metrics.map((metric, index) => simrsMetric(metric, `snapshot.metrics[${index}]`));
    return { tanggal: date, headerRight: record.headerRight, syncStatus: record.syncStatus, catatan: record.catatan, metrics };
  } catch (error) {
    if (error instanceof MelindaBriefValidationError) return null;
    throw error;
  }
}

/** Snapshot for exactly `date`; a census from another day is never shown under today's date. */
export async function readSimrsSnapshot(date: string, directory?: string): Promise<SimrsSnapshot | null> {
  if (!validReportDate(date)) return null;
  try {
    const { document } = await readDailyDocument("simrs_snapshot", date, 0, { directory });
    return document ? parseSimrsSnapshot(document.payload, date) : null;
  } catch (error) {
    logError("simrs_snapshot_read", error);
    return null;
  }
}

export function withSimrsSnapshot(brief: MelindaManagementMorningBrief, snapshot: SimrsSnapshot): MelindaManagementMorningBrief {
  const pulse: MelindaSimrsPulse = {
    headerRight: snapshot.headerRight,
    systemUrl: brief.simrsPulse?.systemUrl ?? "https://simrs.melinda.co.id",
    platformVersion: brief.simrsPulse?.platformVersion ?? "Medify for Hospital",
    syncStatus: snapshot.syncStatus,
    metrics: snapshot.metrics,
    catatan: snapshot.catatan,
  };
  return { ...brief, simrsPulse: pulse };
}
