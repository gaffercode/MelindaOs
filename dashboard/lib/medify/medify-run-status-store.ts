import { readDailyDocument } from "../daily/daily-documents";
import { validReportDate } from "../director/director-data";
import { logError } from "../log";
import { parseMedifyRunStatus, type MedifyRunStatus } from "./medify-run-status-contract";

export type MedifyRunStatusResult = { status: MedifyRunStatus | null; message: string | null };

export async function readMedifyRunStatus(date: string): Promise<MedifyRunStatusResult> {
  if (!validReportDate(date)) return { status: null, message: "Tanggal status Medify tidak valid." };
  try {
    const read = await readDailyDocument("medify_run_status", date, 0);
    if (!read.document) return { status: null, message: null };
    const status = parseMedifyRunStatus(read.document.payload);
    return status.date === read.document.report_date ? { status, message: null } : { status: null, message: "Status tarikan Medify tidak valid." };
  } catch (error) {
    logError("medify_run_status_read", error);
    return { status: null, message: "Status tarikan Medify belum dapat dibaca." };
  }
}
