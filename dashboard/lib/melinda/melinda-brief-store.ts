import { readDailyDocument, DAILY_LOOKBACK_DAYS } from "../daily/daily-documents";
import type { MelindaManagementMorningBrief } from "./melinda-brief-data";
import { parseMelindaBrief } from "./melinda-brief-contract";
import { logError } from "../log";

export type MelindaBriefResult =
  | { status: "current" | "previous"; brief: MelindaManagementMorningBrief; requestedDate: string; sourceDate: string; receivedAt: string; producer: string; message: null }
  | { status: "missing" | "invalid"; brief: null; requestedDate: string; sourceDate: null; receivedAt: null; producer: null; message: string };

/**
 * Read the Management Morning Brief for `date`. When no brief exists for that date the
 * newest brief within the lookback window is returned as `previous`, so the Director always
 * sees the latest real document, labeled with its own date. Nothing is invented when the
 * store is empty or unreadable.
 */
export async function readMelindaBrief(date: string, lookbackDays = DAILY_LOOKBACK_DAYS): Promise<MelindaBriefResult> {
  const base = { requestedDate: date, sourceDate: null, receivedAt: null, producer: null } as const;
  let read;
  try {
    read = await readDailyDocument("management_brief", date, lookbackDays);
  } catch (error) {
    logError("melinda_brief_read", error);
    return { ...base, status: "invalid", brief: null, message: "Brief belum dapat dibaca dari penyimpanan. Tidak ada data contoh yang ditampilkan sebagai pengganti." };
  }
  if (!read.document) return { ...base, status: "missing", brief: null, message: "Belum ada Management Morning Brief yang dipublikasikan untuk tanggal ini maupun enam hari sebelumnya." };
  try {
    const brief = parseMelindaBrief(read.document.payload);
    if (brief.dateIso !== read.document.report_date) throw new Error("Brief date mismatch");
    return { status: brief.dateIso === date ? "current" : "previous", brief, requestedDate: date, sourceDate: brief.dateIso, receivedAt: read.document.received_at, producer: read.document.producer, message: null };
  } catch (error) {
    logError("melinda_brief_invalid", error);
    return { ...base, status: "invalid", brief: null, message: "Brief terbaru tidak lolos validasi format. Dashboard tidak menampilkan isi yang tidak valid." };
  }
}
