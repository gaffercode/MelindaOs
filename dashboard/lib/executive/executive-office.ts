import { validReportDate } from "../director/director-data";
import { fail, record, str } from "../tasks/contract";

export const readinessItems = [
  "room", "equipment", "attendees", "department_materials", "agenda", "director_documents", "minutes",
] as const;
export type ReadinessItem = typeof readinessItems[number];
export const readinessLabels: Record<ReadinessItem, string> = {
  room: "Ruang rapat", equipment: "Proyektor, internet dan fasilitas",
  attendees: "Konfirmasi peserta", department_materials: "Laporan dan materi departemen",
  agenda: "Agenda dan tujuan", director_documents: "Dokumen pimpinan",
  minutes: "Pencatat notulen",
};
type Owner = "director" | "novia";
type CalendarEvent = {
  command: "calendar_upsert"; owner: Owner; kind: "meeting" | "other"; eventId: string; meetingId: string;
  sourceUpdatedAt: string; startAt: string; endAt: string; title: string;
  place: string | null; participants: string[]; department: string | null;
  visibility: "normal" | "busy"; status: "confirmed" | "cancelled"; sharedWithNovia: boolean;
};
type ReadinessEvent = {
  command: "readiness_update"; meetingId: string; item: ReadinessItem;
  state: "ready" | "blocked"; evidence: string; messageId: string;
};
type DeliveryEvent = {
  command: "delivery_ack"; key: string; state: "sent" | "failed";
  messageId: string; note: string | null;
};
type CloseEvent = {
  command: "meeting_close"; meetingId: string; outcome: string; minutesUrl: string | null;
  messageId: string;
};
export type ExecutiveCommand = CalendarEvent | ReadinessEvent | DeliveryEvent | CloseEvent;

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  return typeof value === "string" && options.includes(value as T) ? value as T : fail(label + " tidak valid.");
}
function optional(value: unknown, max: number, label: string): string | null {
  if (value == null) return null;
  return str(value, 0, max, label) || null;
}
function identifier(value: unknown, max = 120): string {
  const item = str(value, 1, max, "Identitas");
  return /^[A-Za-z0-9._:-]+$/.test(item) ? item : fail("Identitas tidak valid.");
}
function timestamp(value: unknown): string {
  const item = str(value, 20, 40, "Waktu");
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(item)
    || !validReportDate(item.slice(0, 10)) || !Number.isFinite(Date.parse(item))) return fail("Waktu harus ISO 8601 dengan zona.");
  return item;
}
export function parseExecutiveCommand(value: unknown): ExecutiveCommand {
  const raw = record(value, ["command", "owner", "kind", "eventId", "meetingId", "sourceUpdatedAt", "startAt", "endAt", "title", "place", "participants", "department", "visibility", "status", "sharedWithNovia", "item", "state", "evidence", "messageId", "key", "note", "outcome", "minutesUrl"], "Executive office");
  const command = oneOf(raw.command, ["calendar_upsert", "readiness_update", "delivery_ack", "meeting_close"] as const, "Perintah");
  if (command === "calendar_upsert") {
    record(raw, ["command", "owner", "kind", "eventId", "meetingId", "sourceUpdatedAt", "startAt", "endAt", "title", "place", "participants", "department", "visibility", "status", "sharedWithNovia"], "Kalender");
    const startAt = timestamp(raw.startAt), endAt = timestamp(raw.endAt);
    const duration = Date.parse(endAt) - Date.parse(startAt);
    if (duration <= 0 || duration > 86_400_000) return fail("Rentang jadwal tidak valid.");
    const participants = raw.participants ?? [];
    if (!Array.isArray(participants) || participants.length > 12) return fail("Peserta tidak valid.");
    const visibility = oneOf(raw.visibility, ["normal", "busy"] as const, "Privasi");
    if (typeof raw.sharedWithNovia !== "boolean") return fail("Penanda rapat bersama tidak valid.");
    return {
      command, owner: oneOf(raw.owner, ["director", "novia"] as const, "Pemilik kalender"), kind: oneOf(raw.kind, ["meeting", "other"] as const, "Jenis agenda"),
      eventId: identifier(raw.eventId, 180), meetingId: identifier(raw.meetingId),
      sourceUpdatedAt: timestamp(raw.sourceUpdatedAt), startAt, endAt,
      title: visibility === "busy" ? "Sibuk" : str(raw.title, 1, 200, "Judul"),
      place: visibility === "busy" ? null : optional(raw.place, 120, "Tempat"),
      participants: visibility === "busy" ? [] : participants.map((p) => str(p, 1, 60, "Peserta")),
      department: visibility === "busy" ? null : optional(raw.department, 80, "Departemen"),
      visibility, status: oneOf(raw.status, ["confirmed", "cancelled"] as const, "Status jadwal"),
      sharedWithNovia: raw.sharedWithNovia,
    };
  }
  if (command === "readiness_update") {
    record(raw, ["command", "meetingId", "item", "state", "evidence", "messageId"], "Kesiapan");
    return { command, meetingId: identifier(raw.meetingId), item: oneOf(raw.item, readinessItems, "Item"),
      state: oneOf(raw.state, ["ready", "blocked"] as const, "Status"),
      evidence: str(raw.evidence, 1, 500, "Bukti"), messageId: identifier(raw.messageId, 180) };
  }
  if (command === "delivery_ack") {
    record(raw, ["command", "key", "state", "messageId", "note"], "Pengiriman");
    return { command, key: identifier(raw.key, 180), state: oneOf(raw.state, ["sent", "failed"] as const, "Status"),
      messageId: identifier(raw.messageId, 180), note: optional(raw.note, 280, "Catatan") };
  }
  record(raw, ["command", "meetingId", "outcome", "minutesUrl", "messageId"], "Arsip rapat");
  const minutesUrl = optional(raw.minutesUrl, 500, "URL notulen");
  if (minutesUrl && (!minutesUrl.startsWith("https://") || !URL.canParse(minutesUrl))) return fail("URL notulen harus HTTPS.");
  return { command, meetingId: identifier(raw.meetingId), outcome: str(raw.outcome, 1, 2000, "Hasil"),
    minutesUrl, messageId: identifier(raw.messageId, 180) };
}

export type OfficeCalendarRow = {
  owner: Owner; kind: "meeting" | "other"; eventId: string; meetingId: string; startAt: string; endAt: string;
  title: string; status: string; visibility: string; sharedWithNovia: boolean;
  department: string | null;
};
export type OfficeReadinessRow = { meetingId: string; item: ReadinessItem; state: "ready" | "blocked"; evidence: string; recordedAt: string };
export function buildOfficePlan(events: OfficeCalendarRow[], updates: OfficeReadinessRow[]) {
  const directorEvents = events.filter((e) => e.owner === "director" && e.kind === "meeting" && e.status === "confirmed")
    .sort((a,b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const novia = events.filter((e) => e.owner === "novia" && e.status === "confirmed");
  return directorEvents.map((event) => {
    const synchronized = !event.sharedWithNovia || novia.some((n) => n.meetingId === event.meetingId && n.startAt === event.startAt && n.endAt === event.endAt);
    const conflict = event.sharedWithNovia && novia.some((n) => n.meetingId !== event.meetingId &&
      Date.parse(n.startAt) < Date.parse(event.endAt) && Date.parse(event.startAt) < Date.parse(n.endAt));
    const checklist = readinessItems.map((item) => {
      const latest = updates.filter((u) => u.meetingId === event.meetingId && u.item === item)
        .sort((a,b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0];
      return { item, label: readinessLabels[item], state: latest?.state ?? "pending", evidence: latest?.evidence ?? null };
    });
    return {
      ...event, synchronized, conflict, checklist,
      readiness: checklist.some((c) => c.state === "blocked") || conflict ? "blocked"
        : checklist.every((c) => c.state === "ready") && synchronized ? "ready" : "partial",
    };
  });
}
