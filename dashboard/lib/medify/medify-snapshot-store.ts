import { DAILY_LOOKBACK_DAYS, readDailyDocument } from "../daily/daily-documents";
import { validReportDate } from "../director/director-data";
import { logError } from "../log";
import { parseMedifySnapshot, type MedifySnapshot } from "./medify-snapshot-contract";
import type { MedifyRunStatus } from "./medify-run-status-contract";

/** `checkedAt` is when the dashboard read the store; the panel measures staleness against it. */
export type MedifySnapshotResult =
  | { status: "current"; snapshot: MedifySnapshot; receivedAt: string; checkedAt: string; message: null; runStatus?: MedifyRunStatus | null }
  | { status: "previous"; snapshot: MedifySnapshot; sourceDate: string; receivedAt: string; checkedAt: string; message: null; runStatus?: MedifyRunStatus | null }
  | { status: "missing" | "invalid"; snapshot: null; receivedAt: null; checkedAt: string; message: string; runStatus?: MedifyRunStatus | null };

/**
 * Newest Medify pull for `date`. When that date has none, the newest pull within the lookback
 * window is returned as `previous` (same window as the morning brief). Today's pull, once it
 * exists, is the one shown.
 */
export async function readMedifySnapshot(date: string, now = new Date()): Promise<MedifySnapshotResult> {
  const empty = { snapshot: null, receivedAt: null, checkedAt: now.toISOString() } as const;
  if (!validReportDate(date)) return { ...empty, status: "invalid", message: "Tanggal tidak valid." };
  let read;
  try {
    read = await readDailyDocument("medify_snapshot", date, DAILY_LOOKBACK_DAYS);
  } catch (error) {
    logError("medify_snapshot_read", error);
    return { ...empty, status: "invalid", message: "Data Medify belum dapat dibaca dari penyimpanan." };
  }
  if (!read.document) return { ...empty, status: "missing", message: "Belum ada tarikan data Medify untuk tanggal ini." };
  try {
    const snapshot = parseMedifySnapshot(read.document.payload);
    if (snapshot.date !== read.document.report_date) throw new Error("date mismatch");
    const found = { snapshot, receivedAt: read.document.received_at, checkedAt: empty.checkedAt, message: null as null };
    if (snapshot.date === date) return { status: "current", ...found };
    return { status: "previous", sourceDate: snapshot.date, ...found };
  } catch (error) {
    logError("medify_snapshot_invalid", error);
    return { ...empty, status: "invalid", message: "Tarikan Medify untuk tanggal ini tidak lolos validasi dan tidak ditampilkan." };
  }
}
