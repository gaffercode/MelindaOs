import { validReportDate } from "../director/director-data";

export type ScheduleItemInput = { start: string; end: string | null; title: string; place: string | null; pic: string[]; topic: string | null };
export const classifiedStatuses = ["diterima_pic", "dikerjakan", "selesai", "terkendala", "perlu_dibaca"] as const;
export type StaffReplyInput = {
  kattMessageId: string; receivedAt: string; fromName: string; originalText: string;
  attachments: { url: string; mime: string }[]; summary: string | null; needs: string | null;
  classifiedStatus: typeof classifiedStatuses[number]; confidence: number;
};

/** Thrown for every input-validation failure; callers map exactly this class to a 400. */
export class ContractError extends Error { override readonly name = "ContractError"; }
export function fail(message: string): never { throw new ContractError(message); }
export function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(`${label} tidak valid.`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) return fail(`${label}: kolom tidak dikenal.`);
  return result;
}
export function str(value: unknown, min: number, max: number, label: string, multiline = false): string {
  if (typeof value !== "string") return fail(`${label} tidak valid.`);
  const trimmed = multiline ? value : value.trim();
  const control = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if ((multiline ? trimmed.trim() : trimmed).length < min || trimmed.length > max || control.test(trimmed)) return fail(`${label} tidak valid.`);
  return trimmed;
}
function optional(value: unknown, max: number, label: string): string | null {
  if (value == null) return null;
  const result = str(value, 0, max, label);
  return result || null;
}
function isoTimestamp(value: unknown, label: string): string {
  const result = str(value, 1, 40, label);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(result)
    || !validReportDate(result.slice(0, 10)) || !Number.isFinite(Date.parse(result))) return fail(`${label} tidak valid.`);
  return result;
}
function clock(value: unknown, label: string): string {
  const result = str(value, 1, 5, label);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result) ? result : fail(`${label} tidak valid.`);
}

export function parseScheduleSubmission(value: unknown): { date: string; items: ScheduleItemInput[] } {
  const input = record(value, ["date", "items"], "Jadwal");
  const date = str(input.date, 10, 10, "Tanggal");
  if (!validReportDate(date)) return fail("Tanggal tidak valid.");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 40) return fail("Jumlah butir jadwal harus 1-40.");
  const items = input.items.map((raw): ScheduleItemInput => {
    const item = record(raw, ["start", "end", "title", "place", "pic", "topic"], "Butir jadwal");
    const pic = item.pic == null ? [] : item.pic;
    if (!Array.isArray(pic) || pic.length > 8) return fail("PIC tidak valid.");
    return {
      start: clock(item.start, "Jam mulai"),
      end: item.end == null ? null : clock(item.end, "Jam selesai"),
      title: str(item.title, 1, 200, "Judul"),
      place: optional(item.place, 120, "Tempat"),
      pic: pic.map((name) => str(name, 1, 60, "PIC")),
      topic: optional(item.topic, 300, "Topik"),
    };
  });
  return { date, items };
}

export function parseStaffReply(value: unknown): StaffReplyInput {
  const input = record(value, ["kattMessageId", "receivedAt", "fromName", "originalText", "attachments", "summary", "needs", "classifiedStatus", "confidence"], "Balasan");
  const kattMessageId = str(input.kattMessageId, 1, 200, "ID pesan");
  if (!/^[A-Za-z0-9._:-]+$/.test(kattMessageId)) return fail("ID pesan tidak valid.");
  const attachmentsRaw = input.attachments == null ? [] : input.attachments;
  if (!Array.isArray(attachmentsRaw) || attachmentsRaw.length > 10) return fail("Lampiran maksimal 10.");
  const attachments = attachmentsRaw.map((raw) => {
    const item = record(raw, ["url", "mime"], "Lampiran");
    const url = str(item.url, 1, 2000, "URL lampiran");
    let protocol = "";
    try { protocol = new URL(url).protocol; } catch { return fail("URL lampiran tidak valid."); }
    if (protocol !== "https:") return fail("URL lampiran harus https.");
    return { url, mime: str(item.mime, 1, 100, "Tipe lampiran") };
  });
  const classifiedStatus = typeof input.classifiedStatus === "string" && (classifiedStatuses as readonly string[]).includes(input.classifiedStatus)
    ? input.classifiedStatus as StaffReplyInput["classifiedStatus"] : fail("Status tidak valid.");
  if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) return fail("Confidence tidak valid.");
  const summary = optional(input.summary, 400, "Ringkasan");
  if (classifiedStatus === "terkendala" && !summary) return fail("Balasan terkendala wajib berisi ringkasan.");
  return {
    kattMessageId, receivedAt: isoTimestamp(input.receivedAt, "Waktu terima"), fromName: str(input.fromName, 1, 120, "Pengirim"),
    originalText: str(input.originalText, 1, 4000, "Teks asli", true), attachments, summary, needs: optional(input.needs, 280, "Kebutuhan"),
    classifiedStatus, confidence: input.confidence,
  };
}
