import { validReportDate } from "./director-data";

export const instructionActions = ["approve", "request_update", "assign", "escalate", "defer", "done"] as const;
/** `umum`: a free-form instruction from the register page, not tied to a brief item (migration 202610280001). */
export const instructionSections = ["priorities", "followUps", "decisions", "umum"] as const;
export const instructionStatuses = ["dibuat", "terkirim_ke_grokbot", "gagal", "diteruskan", "diterima_pic", "dikerjakan", "terkendala", "selesai"] as const;
export type InstructionAction = typeof instructionActions[number];
export type InstructionSection = typeof instructionSections[number];
export type InstructionStatus = typeof instructionStatuses[number];
export type InstructionInput = {
  reportDate: string; section: InstructionSection; itemId: string; itemTitle: string; urgent: boolean;
  action: InstructionAction; deadline: string | null; pic: string[]; note: string; decisionOptionId: string | null; decisionLabel: string | null;
  /** The earlier instruction this one follows (a carried item); `done` closes it as `selesai`. Not stored. */
  linkedId?: string | null;
  /** The schedule item this instruction was raised from (Task 8); stored by the create RPC. */
  scheduleItemId?: string | null;
};
export const INSTRUCTION_ID = /^IOC-\d{4,9}$/;
export type InstructionHistoryEntry = { status: InstructionStatus; at: string; actor: string; note?: string };
export type Instruction = InstructionInput & { id: string; status: InstructionStatus; history: InstructionHistoryEntry[]; createdAt: string };

export const actionLabels: Record<InstructionAction, string> = {
  approve: "Setujui", request_update: "Minta update", assign: "Tugaskan",
  escalate: "Eskalasi", defer: "Tunda", done: "Tandai selesai",
};
export const statusLabels: Record<InstructionStatus | "ditunda" | "dibatalkan", string> = {
  dibuat: "Disimpan", terkirim_ke_grokbot: "Terkirim ke GrokBot", gagal: "Gagal terkirim",
  diteruskan: "Diteruskan", diterima_pic: "Diterima PIC", dikerjakan: "Dikerjakan", terkendala: "Terkendala", selesai: "Selesai", ditunda: "Ditunda", dibatalkan: "Dibatalkan",
};
export const sectionLabels: Record<InstructionSection, string> = { priorities: "Prioritas", followUps: "Tindak lanjut", decisions: "Keputusan", umum: "Umum" };
export const deadlineActions: readonly InstructionAction[] = ["request_update", "escalate"];
const progress: readonly InstructionStatus[] = ["terkirim_ke_grokbot", "diteruskan", "diterima_pic", "dikerjakan", "selesai"];
const forward: readonly InstructionStatus[] = ["diteruskan", "diterima_pic", "dikerjakan", "selesai"];
const blockedFrom: readonly InstructionStatus[] = ["diteruskan", "diterima_pic", "dikerjakan"];

function fail(): never { throw new Error("Format arahan tidak valid."); }
function text(value: unknown, max: number, required = true): string {
  if (typeof value !== "string") return fail();
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) return fail();
  return trimmed;
}
function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value as T : fail();
}

export function validDeadline(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && validReportDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60;
}

export function parseInstructionInput(value: unknown): InstructionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  const fields = ["reportDate", "section", "itemId", "itemTitle", "urgent", "action", "deadline", "pic", "note", "decisionOptionId", "decisionLabel", "linkedId", "scheduleItemId"];
  if (Object.keys(record).some((key) => !fields.includes(key))) return fail();
  const reportDate = text(record.reportDate, 10);
  if (!validReportDate(reportDate)) return fail();
  const section = oneOf(record.section, instructionSections);
  const action = oneOf(record.action, instructionActions);
  if (typeof record.urgent !== "boolean") return fail();
  const deadline = record.deadline == null || record.deadline === "" ? null : text(record.deadline, 16);
  if (deadline && (!validDeadline(deadline) || !deadlineActions.includes(action))) return fail();
  if (!Array.isArray(record.pic ?? []) || ((record.pic ?? []) as unknown[]).length > 8) return fail();
  const pic = [...new Set(((record.pic ?? []) as unknown[]).map((name) => text(name, 60)))];
  if (action === "assign" && !pic.length) return fail();
  const decisionOptionId = record.decisionOptionId == null ? null : text(record.decisionOptionId, 80);
  const decisionLabel = record.decisionLabel == null ? null : text(record.decisionLabel, 120);
  if ((decisionOptionId && section !== "decisions") || !decisionOptionId !== !decisionLabel) return fail();
  const linkedId = record.linkedId == null ? null : text(record.linkedId, 13);
  if (linkedId && !INSTRUCTION_ID.test(linkedId)) return fail();
  const scheduleItemId = record.scheduleItemId == null ? null : text(record.scheduleItemId, 36);
  if (scheduleItemId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scheduleItemId)) return fail();
  return {
    reportDate, section, action, deadline, pic, decisionOptionId, decisionLabel, linkedId, ...(scheduleItemId ? { scheduleItemId } : {}), urgent: record.urgent,
    itemId: text(record.itemId, 80), itemTitle: text(record.itemTitle, 300), note: record.note == null ? "" : text(record.note, 280, false),
  };
}

function validNote(note: string | null | undefined): string | null {
  const written = typeof note === "string" ? note.trim() : "";
  return written.length > 0 && written.length <= 280 && !/[\u0000-\u001f\u007f]/.test(written) ? written : null;
}

/**
 * Mirrors the `advance` branch of `melinda_director_instructions` (migration 202610300001). `previousNote` is the
 * latest history note, used only for `terkendala` → `terkendala`. A block before delivery (`dibuat`/`gagal` →
 * `terkendala`, note required, e.g. WhatsApp failed) may later be reported `diteruskan` or `diterima_pic`, but only
 * while `history` holds no forward status; without a history the instruction is assumed delivered.
 */
export function canAdvance(from: InstructionStatus, to: InstructionStatus, note?: string | null, previousNote?: string | null, history?: readonly InstructionHistoryEntry[]): boolean {
  if (from === "terkendala" && to === "terkendala") {
    const written = validNote(note);
    return written !== null && written !== (typeof previousNote === "string" ? previousNote.trim() : "");
  }
  if ((from === "dibuat" || from === "gagal") && forward.includes(to)) return true;
  if ((from === "dibuat" || from === "gagal") && to === "terkendala") return validNote(note) !== null;
  if (blockedFrom.includes(from) && to === "terkendala") return true;
  if (from === "terkendala" && (to === "dikerjakan" || to === "selesai")) return true;
  if (from === "terkendala" && (to === "diteruskan" || to === "diterima_pic")) return history !== undefined && !history.some((entry) => forward.includes(entry.status));
  const start = progress.indexOf(from), end = progress.indexOf(to);
  return start >= 0 && end > start;
}

export function latestHistoryNote(history: readonly InstructionHistoryEntry[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const note = history[index]?.note?.trim();
    if (note) return note;
  }
  return null;
}

function deadlineText(value: string): string {
  const date = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T00:00:00+07:00`));
  return `${date} ${value.slice(11, 16).replace(":", ".")} WIB`;
}

export function messageText(input: InstructionInput, id: string): string {
  return [
    `*Arahan Direktur · ${id}*`,
    `${sectionLabels[input.section]}${input.urgent ? " · MENDESAK" : ""}: ${input.itemTitle}`,
    `Arahan: ${actionLabels[input.action]}${input.decisionLabel ? ` — ${input.decisionLabel}` : ""}`,
    ...(input.deadline ? [`Tenggat: ${deadlineText(input.deadline)}`] : []),
    ...(input.pic.length ? [`PIC: ${input.pic.join(", ")}`] : []),
    ...(input.note ? [`Catatan: ${input.note}`] : []),
    "Balas pesan ini. Boleh angka (1 Diterima · 2 Selesai · 3 Ada kendala) atau tulis kendalanya.",
  ].join("\n");
}
