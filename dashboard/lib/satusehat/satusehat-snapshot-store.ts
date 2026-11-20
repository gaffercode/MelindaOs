import { DAILY_LOOKBACK_DAYS, readDailyDocument } from "../daily/daily-documents";
import { validReportDate } from "../director/director-data";
import { logError } from "../log";
import { parseSatusehatSnapshot, type SatusehatSnapshot } from "./satusehat-snapshot-contract";

export type SatusehatSnapshotResult =
  | { status: "current"; snapshot: SatusehatSnapshot; receivedAt: string; checkedAt: string; message: null }
  | { status: "previous"; snapshot: SatusehatSnapshot; sourceDate: string; receivedAt: string; checkedAt: string; message: null }
  | { status: "missing" | "invalid"; snapshot: null; receivedAt: null; checkedAt: string; message: string };

/**
 * Reads the newest `satusehat_snapshot` for `date` or within the 6-day lookback window.
 * Never throws: read or contract validation failures return `invalid` and log by error code only.
 */
export async function readSatusehatSnapshot(date: string, now = new Date()): Promise<SatusehatSnapshotResult> {
  const empty = { snapshot: null, receivedAt: null, checkedAt: now.toISOString() } as const;
  if (!validReportDate(date)) return { ...empty, status: "invalid", message: "Tanggal tidak valid." };
  let read;
  try {
    read = await readDailyDocument("satusehat_snapshot", date, DAILY_LOOKBACK_DAYS);
  } catch (error) {
    logError("satusehat_snapshot_read", error);
    return { ...empty, status: "invalid", message: "Data Satu Sehat belum dapat dibaca dari penyimpanan." };
  }
  if (!read.document) return { ...empty, status: "missing", message: "Belum ada tarikan otomatis Satu Sehat untuk tanggal ini." };
  try {
    const snapshot = parseSatusehatSnapshot(read.document.payload);
    if (snapshot.date !== read.document.report_date) throw new Error("date mismatch");
    const found = { snapshot, receivedAt: read.document.received_at, checkedAt: empty.checkedAt, message: null as null };
    if (snapshot.date === date) return { status: "current", ...found };
    return { status: "previous", sourceDate: snapshot.date, ...found };
  } catch (error) {
    logError("satusehat_snapshot_invalid", error);
    return { ...empty, status: "invalid", message: "Tarikan Satu Sehat untuk tanggal ini tidak lolos validasi dan tidak ditampilkan." };
  }
}
